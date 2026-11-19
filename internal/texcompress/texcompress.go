// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Package texcompress rewrites the images of a finished map or variant GLB as KTX2 GPU textures
// (Basis Universal, glTF KHR_texture_basisu): the GLB gets smaller, and the viewer uploads the
// textures to the GPU still block-compressed (BC7 on desktop, a quarter of RGBA8) instead of
// decoding PNG and JPEG into raw RGBA.
//
// The pass reads the GLB as generic JSON (numbers kept as text), like himap's
// ExterniseImagesGLB: every field it does not know passes through unchanged. Each PNG or JPEG
// image is decoded, encoded with the settings of its class (color, data, normal: see classify)
// and written back in its own buffer view with mimeType image/ktx2; the textures that read it
// name it through KHR_texture_basisu, which the document lists in extensionsUsed and
// extensionsRequired. No PNG fallback is kept: it would put the old bytes back in the file, and
// the viewer that reads these GLBs carries a KTX2 loader. Images already in KTX2 are left as they
// are, so the pass is idempotent.
package texcompress

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg" // the himap writer's color maps
	_ "image/png"  // the himap writer's data maps
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/basisu"
)

const (
	glbMagic     = 0x46546C67 // "glTF"
	glbChunkJSON = 0x4E4F534A
	glbChunkBIN  = 0x004E4942
	mimePNG      = "image/png"
	mimeJPEG     = "image/jpeg"
	// MimeKTX2 is the media type of a KTX2 image in glTF.
	MimeKTX2  = "image/ktx2"
	extBasisu = "KHR_texture_basisu"
)

// Format is the image format a build writes its textures in.
type Format string

const (
	// FormatPNG keeps the himap writer's PNG and JPEG images (the output before this pass).
	FormatPNG Format = "png"
	// FormatKTX2 rewrites them as KTX2 (this pass).
	FormatKTX2 Format = "ktx2"
)

// DefaultFormat is the texture format of map and variant builds when the caller names none.
const DefaultFormat = FormatKTX2

// ParseFormat validates a format name from a flag; empty is DefaultFormat.
func ParseFormat(s string) (Format, bool) {
	switch Format(s) {
	case "":
		return DefaultFormat, true
	case FormatPNG, FormatKTX2:
		return Format(s), true
	}
	return DefaultFormat, false
}

// ErrNotGLB: the bytes are not a GLB with a JSON chunk and an optional binary chunk.
var ErrNotGLB = errors.New("texcompress: not a readable GLB")

// Options tune a pass.
type Options struct {
	// Workers is the number of images encoded at once; 0 is half the logical CPUs (a build runs
	// on the user's own machine, beside the game and the browser).
	Workers int
	// Preset returns the encoder settings of a class; nil is Preset.
	Preset func(Class) basisu.Options
	// Progress, if set, is called after each image with the count done and the total.
	Progress func(done, total int)
}

// ClassStats sums one class of images.
type ClassStats struct {
	Images    int
	BytesIn   int64 // PNG/JPEG bytes
	BytesOut  int64 // KTX2 bytes
	Texels    int64 // base level texels
	EncodeDur time.Duration
}

// Stats summarizes a pass.
type Stats struct {
	// Encoded counts the images rewritten; Kept the images left as they were (already KTX2, or
	// external).
	Encoded, Kept int
	// Aligned counts the encoded images resampled to multiple-of-4 sides (blockAligned).
	Aligned int
	ByClass map[Class]*ClassStats
	// GPURGBA8 is the GPU memory the images take uploaded as RGBA8 with a full mip chain (the
	// viewer's PNG path); GPUBlock the same images as 16-byte 4x4 blocks with a full mip chain
	// (BC7, what the KTX2 images transcode to on desktop).
	GPURGBA8, GPUBlock int64
	// BytesIn and BytesOut are the GLB's size before and after.
	BytesIn, BytesOut int64
	Duration          time.Duration
}

// Preset is the default encoder settings of a class: UASTC LDR 4x4 at pack level 1, no RDO,
// Zstandard level 19, full mip chain, for every class. Measured on Streets at High
// (internal/texcompress/bench_test.go, 12 to 24 images per class): data and normal maps come
// out at 0.96 bytes per base texel with mips (0.59 to 0.66 of their PNG) at 46.6 dB median PSNR;
// ETC1S would be 0.2 of the PNG but at 27 to 28 dB, since it cannot keep a control map's
// independent channels. RDO (lambda 1 to 6) saved 3 to 14% for 4 to 9 dB and five to seven times
// the CPU; Zstandard 19 saves 3.5% over 9 for 8% more CPU. Color is UASTC too (1.0 B/texel at
// 49.8 dB): ETC1S color is 0.19 B/texel, as small as the JPEG it replaces, but 38 dB median and
// 29 dB worst, and the viewer prefers one codec for all.
func Preset(c Class) basisu.Options {
	o := basisu.Options{Codec: basisu.UASTC, UASTCLevel: 1, ZstdLevel: 19, Mipmaps: true, MipWrap: true}
	switch c {
	case ClassColor:
		o.SRGB = true
	case ClassNormal:
		o.NormalMap = true
	}
	return o
}

// CompressFile rewrites the GLB at `src` with KTX2 images into `dst` (written under a temporary
// name, then renamed: a reader never sees a half-written file). `src` and `dst` may be the same.
func CompressFile(ctx context.Context, src, dst string, o Options) (Stats, error) {
	f, err := os.Open(src) //nolint:gosec // build output path, set by the caller
	if err != nil {
		return Stats{}, err
	}
	info, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return Stats{}, err
	}
	tmp := dst + ".ktx2.tmp"
	out, err := os.Create(tmp) //nolint:gosec // build output path, set by the caller
	if err != nil {
		_ = f.Close()
		return Stats{}, err
	}
	// The encoded images wait in a file beside the output, not in memory: a High map's come to
	// about 800 MB.
	spill, err := os.CreateTemp(filepath.Dir(dst), filepath.Base(dst)+".*.ktx2.part")
	if err != nil {
		_ = f.Close()
		_ = out.Close()
		_ = os.Remove(tmp)
		return Stats{}, err
	}
	defer func() { _ = spill.Close(); _ = os.Remove(spill.Name()) }()
	w := bufio.NewWriterSize(out, 1<<20)
	st, err := compress(ctx, f, info.Size(), w, o, &fileBlobs{f: spill})
	if err == nil {
		err = w.Flush()
	}
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	_ = f.Close()
	if err == nil {
		err = os.Rename(tmp, dst)
	}
	if err != nil {
		_ = os.Remove(tmp)
		return Stats{}, err
	}
	return st, nil
}

// CompressGLB is Compress over bytes in memory.
func CompressGLB(ctx context.Context, glb []byte, o Options) ([]byte, Stats, error) {
	var buf bytes.Buffer
	st, err := Compress(ctx, bytes.NewReader(glb), int64(len(glb)), &buf, o)
	if err != nil {
		return nil, Stats{}, err
	}
	return buf.Bytes(), st, nil
}

// glbFile is an opened GLB: its document and where its binary chunk lies in the source.
type glbFile struct {
	doc            map[string]any
	binOff, binLen int64
}

func openGLB(r io.ReaderAt, size int64) (glbFile, error) {
	var hdr [20]byte
	if size < 20 {
		return glbFile{}, fmt.Errorf("%w: header", ErrNotGLB)
	}
	if _, err := r.ReadAt(hdr[:], 0); err != nil {
		return glbFile{}, fmt.Errorf("%w: %w", ErrNotGLB, err)
	}
	if binary.LittleEndian.Uint32(hdr[0:]) != glbMagic || binary.LittleEndian.Uint32(hdr[16:]) != glbChunkJSON {
		return glbFile{}, fmt.Errorf("%w: header", ErrNotGLB)
	}
	lj := int64(binary.LittleEndian.Uint32(hdr[12:]))
	if 20+lj > size {
		return glbFile{}, fmt.Errorf("%w: JSON chunk", ErrNotGLB)
	}
	js := make([]byte, lj)
	if _, err := r.ReadAt(js, 20); err != nil {
		return glbFile{}, fmt.Errorf("%w: %w", ErrNotGLB, err)
	}
	dec := json.NewDecoder(bytes.NewReader(js))
	dec.UseNumber()
	var g glbFile
	if err := dec.Decode(&g.doc); err != nil {
		return glbFile{}, fmt.Errorf("%w: %w", ErrNotGLB, err)
	}
	if o := 20 + lj; o+8 <= size {
		var ch [8]byte
		if _, err := r.ReadAt(ch[:], o); err != nil {
			return glbFile{}, fmt.Errorf("%w: %w", ErrNotGLB, err)
		}
		g.binLen = int64(binary.LittleEndian.Uint32(ch[0:]))
		if binary.LittleEndian.Uint32(ch[4:]) != glbChunkBIN || o+8+g.binLen > size {
			return glbFile{}, fmt.Errorf("%w: binary chunk", ErrNotGLB)
		}
		g.binOff = o + 8
	}
	return g, nil
}

// AssetExtras reads the asset.extras object of the GLB at path: a header-only read (the
// 20-byte header and the JSON chunk the header sizes; the binary chunk is never read, so
// a multi-gigabyte GLB costs two small reads). Nil with no error when the GLB has no
// asset.extras; ErrNotGLB (wrapped) when the file is not a GLB with a readable JSON chunk.
func AssetExtras(path string) (map[string]any, error) {
	f, err := os.Open(path) //nolint:gosec // cache path, set by the caller
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	glb, err := openGLB(f, info.Size())
	if err != nil {
		return nil, err
	}
	asset, _ := glb.doc["asset"].(map[string]any)
	if asset == nil {
		return nil, nil
	}
	extras, _ := asset["extras"].(map[string]any)
	return extras, nil
}

// UsesBasisu says whether the GLB at path lists KHR_texture_basisu in its
// extensionsUsed: a header-only read (the 20-byte header and the JSON chunk the header
// sizes; the binary chunk is never read). The KTX2 pass is the only writer that adds the
// extension, so an unstamped GLB (built before asset.extras.buildFormat existed) that
// lists it is format 2; the only pre-format-2 GLBs are the PNG ones.
func UsesBasisu(path string) (bool, error) {
	f, err := os.Open(path) //nolint:gosec // cache path, set by the caller
	if err != nil {
		return false, err
	}
	defer func() { _ = f.Close() }()
	info, err := f.Stat()
	if err != nil {
		return false, err
	}
	glb, err := openGLB(f, info.Size())
	if err != nil {
		return false, err
	}
	list, _ := glb.doc["extensionsUsed"].([]any)
	for _, e := range list {
		if e == extBasisu {
			return true, nil
		}
	}
	return false, nil
}

// view is a buffer view's place in the source binary chunk.
type view struct{ off, n int64 }

func viewOf(v any, binLen int64) (view, error) {
	m, _ := v.(map[string]any)
	off, _ := entier(m["byteOffset"])
	n, ok := entier(m["byteLength"])
	if !ok || off < 0 || n < 0 || int64(off)+int64(n) > binLen {
		return view{}, fmt.Errorf("%w: buffer view outside the binary chunk", ErrNotGLB)
	}
	if b, ok := entier(m["buffer"]); ok && b != 0 {
		return view{}, fmt.Errorf("%w: buffer view on buffer %d (one buffer expected)", ErrNotGLB, b)
	}
	return view{int64(off), int64(n)}, nil
}

// job is one image to encode. `ktx2`: the source is a KTX2 image (RealignFile), decoded from its
// base level instead of as a PNG or JPEG.
type job struct {
	image, view int
	class       Class
	ktx2        bool
}

// result is one encoded image, stored at `off` (`n` bytes) in the pass's blobs.
type result struct {
	off, n  int64
	w, h    int
	err     error
	inSize  int64
	dur     time.Duration
	aligned bool
}

// Compress reads a GLB of `size` bytes from `r` and writes it to `w` with its PNG and JPEG
// images rewritten as KTX2. The encoded images are held in memory until `w` is written
// (CompressFile holds them in a file).
func Compress(ctx context.Context, r io.ReaderAt, size int64, w io.Writer, o Options) (Stats, error) {
	return compress(ctx, r, size, w, o, &memBlobs{})
}

// blobs holds the encoded images until the output is written.
type blobs interface {
	// put stores b and returns its offset.
	put(b []byte) (int64, error)
	io.ReaderAt
}

type memBlobs struct {
	mu  sync.Mutex
	buf []byte
}

func (m *memBlobs) put(b []byte) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	off := int64(len(m.buf))
	m.buf = append(m.buf, b...)
	return off, nil
}

func (m *memBlobs) ReadAt(p []byte, off int64) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return bytes.NewReader(m.buf).ReadAt(p, off)
}

type fileBlobs struct {
	mu   sync.Mutex
	f    *os.File
	size int64
}

func (s *fileBlobs) put(b []byte) (int64, error) {
	s.mu.Lock()
	off := s.size
	s.size += int64(len(b))
	s.mu.Unlock()
	_, err := s.f.WriteAt(b, off)
	return off, err
}

func (s *fileBlobs) ReadAt(p []byte, off int64) (int, error) { return s.f.ReadAt(p, off) }

func compress(ctx context.Context, r io.ReaderAt, size int64, w io.Writer, o Options, store blobs) (Stats, error) {
	start := time.Now()
	g, err := openGLB(r, size)
	if err != nil {
		return Stats{}, err
	}
	preset := o.Preset
	if preset == nil {
		preset = Preset
	}
	images, _ := g.doc["images"].([]any)
	rawViews, _ := g.doc["bufferViews"].([]any)
	views := make([]view, len(rawViews))
	for i, v := range rawViews {
		if views[i], err = viewOf(v, g.binLen); err != nil {
			return Stats{}, err
		}
	}
	classes := classify(g.doc)
	st := Stats{ByClass: map[Class]*ClassStats{}, BytesIn: size}
	var jobs []job
	imageViews := map[int]bool{}
	for i, iv := range images {
		img, _ := iv.(map[string]any)
		bv, ok := entier(img["bufferView"])
		mime, _ := img["mimeType"].(string)
		if !ok || (mime != mimePNG && mime != mimeJPEG) {
			st.Kept++
			continue
		}
		if bv < 0 || bv >= len(views) {
			return Stats{}, fmt.Errorf("%w: image %d without a readable buffer view", ErrNotGLB, i)
		}
		if imageViews[bv] {
			return Stats{}, fmt.Errorf("%w: buffer view %d shared by two images", ErrNotGLB, bv)
		}
		imageViews[bv] = true
		jobs = append(jobs, job{image: i, view: bv, class: classes[i]})
	}
	if len(jobs) == 0 {
		if _, err := io.Copy(w, io.NewSectionReader(r, 0, size)); err != nil {
			return Stats{}, err
		}
		st.BytesOut, st.Duration = size, time.Since(start)
		return st, nil
	}
	accessors, _ := g.doc["accessors"].([]any)
	for _, a := range accessors {
		acc, _ := a.(map[string]any)
		if bv, ok := entier(acc["bufferView"]); ok && imageViews[bv] {
			return Stats{}, fmt.Errorf("%w: buffer view %d shared by an image and an accessor", ErrNotGLB, bv)
		}
	}

	results, err := encodeAll(ctx, r, g.binOff, views, jobs, preset, o, store)
	if err != nil {
		return Stats{}, err
	}

	// The document: each encoded image becomes KTX2, its textures name it through the extension.
	encodedImage := map[int]bool{}
	newData := map[int]result{}
	for k, jb := range jobs {
		res := results[k]
		cs := st.ByClass[jb.class]
		if cs == nil {
			cs = &ClassStats{}
			st.ByClass[jb.class] = cs
		}
		cs.Images++
		cs.BytesIn += res.inSize
		cs.BytesOut += res.n
		cs.Texels += int64(res.w) * int64(res.h)
		cs.EncodeDur += res.dur
		st.GPURGBA8 += gpuRGBA8(res.w, res.h)
		st.GPUBlock += gpuBlocks(res.w, res.h)
		img := images[jb.image].(map[string]any)
		img["mimeType"] = MimeKTX2
		newData[jb.view] = res
		encodedImage[jb.image] = true
		st.Encoded++
		if res.aligned {
			st.Aligned++
		}
	}
	textures, _ := g.doc["textures"].([]any)
	for _, tv := range textures {
		t, _ := tv.(map[string]any)
		src, ok := entier(t["source"])
		if !ok || !encodedImage[src] {
			continue
		}
		ext, _ := t["extensions"].(map[string]any)
		if ext == nil {
			ext = map[string]any{}
			t["extensions"] = ext
		}
		ext[extBasisu] = map[string]any{"source": json.Number(fmt.Sprint(src))}
		delete(t, "source")
	}
	addExtension(g.doc, "extensionsUsed")
	addExtension(g.doc, "extensionsRequired")

	// The binary chunk: the views in their order, each aligned on 4 bytes.
	var binLen int64
	for i := range views {
		n := views[i].n
		if d, ok := newData[i]; ok {
			n = d.n
		}
		vm := rawViews[i].(map[string]any)
		vm["byteOffset"] = json.Number(fmt.Sprint(binLen))
		vm["byteLength"] = json.Number(fmt.Sprint(n))
		binLen += pad4(n)
	}
	buffers, _ := g.doc["buffers"].([]any)
	if len(buffers) != 1 {
		return Stats{}, fmt.Errorf("%w: %d buffers (one expected)", ErrNotGLB, len(buffers))
	}
	buffers[0].(map[string]any)["byteLength"] = json.Number(fmt.Sprint(binLen))
	js, err := json.Marshal(g.doc)
	if err != nil {
		return Stats{}, fmt.Errorf("texcompress: glTF JSON: %w", err)
	}
	jsLen := pad4(int64(len(js)))
	total := 12 + 8 + jsLen + 8 + binLen
	if total > 1<<32-1 {
		return Stats{}, fmt.Errorf("texcompress: output GLB of %d bytes exceeds 4 GiB", total)
	}
	var hdr [20]byte
	binary.LittleEndian.PutUint32(hdr[0:], glbMagic)
	binary.LittleEndian.PutUint32(hdr[4:], 2)
	binary.LittleEndian.PutUint32(hdr[8:], uint32(total))
	binary.LittleEndian.PutUint32(hdr[12:], uint32(jsLen))
	binary.LittleEndian.PutUint32(hdr[16:], glbChunkJSON)
	if _, err := w.Write(hdr[:]); err != nil {
		return Stats{}, err
	}
	if _, err := w.Write(js); err != nil {
		return Stats{}, err
	}
	if _, err := w.Write(bytes.Repeat([]byte{' '}, int(jsLen-int64(len(js))))); err != nil {
		return Stats{}, err
	}
	var ch [8]byte
	binary.LittleEndian.PutUint32(ch[0:], uint32(binLen))
	binary.LittleEndian.PutUint32(ch[4:], glbChunkBIN)
	if _, err := w.Write(ch[:]); err != nil {
		return Stats{}, err
	}
	zero := make([]byte, 4)
	for i, v := range views {
		n := v.n
		if d, ok := newData[i]; ok {
			n = d.n
			if _, err := io.Copy(w, io.NewSectionReader(store, d.off, d.n)); err != nil {
				return Stats{}, err
			}
		} else if _, err := io.Copy(w, io.NewSectionReader(r, g.binOff+v.off, v.n)); err != nil {
			return Stats{}, err
		}
		if p := pad4(n) - n; p > 0 {
			if _, err := w.Write(zero[:p]); err != nil {
				return Stats{}, err
			}
		}
	}
	st.BytesOut, st.Duration = total, time.Since(start)
	return st, nil
}

// encodeAll encodes the jobs on `o.Workers` goroutines and returns their results in order. An
// image that fails to decode or encode fails the pass: a build must not publish a GLB whose
// texture silently went missing.
func encodeAll(ctx context.Context, r io.ReaderAt, binOff int64, views []view, jobs []job, preset func(Class) basisu.Options, o Options, store blobs) ([]result, error) {
	workers := o.Workers
	if workers <= 0 {
		workers = max(1, runtime.NumCPU()/2)
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	results := make([]result, len(jobs))
	next := make(chan int)
	var done atomic.Int64
	var wg sync.WaitGroup
	var firstErr error
	var errOnce sync.Once
	fail := func(err error) {
		errOnce.Do(func() { firstErr = err; cancel() })
	}
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for k := range next {
				jb := jobs[k]
				v := views[jb.view]
				src := make([]byte, v.n)
				if _, err := r.ReadAt(src, binOff+v.off); err != nil {
					fail(fmt.Errorf("texcompress: image %d: %w", jb.image, err))
					continue
				}
				t0 := time.Now()
				var img image.Image
				var err error
				if jb.ktx2 {
					img, err = basisu.Decode(src, 0)
				} else {
					img, _, err = image.Decode(bytes.NewReader(src))
				}
				if err != nil {
					fail(fmt.Errorf("texcompress: image %d: decode: %w", jb.image, err))
					continue
				}
				img, aligned := blockAligned(img)
				data, err := basisu.Encode(img, preset(jb.class))
				if err != nil {
					fail(fmt.Errorf("texcompress: image %d (%s): %w", jb.image, jb.class, err))
					continue
				}
				off, err := store.put(data)
				if err != nil {
					fail(fmt.Errorf("texcompress: image %d: %w", jb.image, err))
					continue
				}
				b := img.Bounds()
				results[k] = result{off: off, n: int64(len(data)), w: b.Dx(), h: b.Dy(), inSize: v.n, dur: time.Since(t0), aligned: aligned}
				n := done.Add(1)
				if o.Progress != nil {
					o.Progress(int(n), len(jobs))
				}
			}
		}()
	}
feed:
	for k := range jobs {
		select {
		case next <- k:
		case <-ctx.Done():
			break feed
		}
	}
	close(next)
	wg.Wait()
	if firstErr != nil {
		return nil, firstErr
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return results, nil
}

// addExtension adds KHR_texture_basisu to the document's list `key` once.
func addExtension(doc map[string]any, key string) {
	list, _ := doc[key].([]any)
	for _, e := range list {
		if e == extBasisu {
			return
		}
	}
	doc[key] = append(list, extBasisu)
}

func pad4(n int64) int64 { return (n + 3) &^ 3 }

// gpuRGBA8 is the bytes of a w x h RGBA8 texture with its full mip chain.
func gpuRGBA8(w, h int) int64 {
	var n int64
	for {
		n += int64(w) * int64(h) * 4
		if w == 1 && h == 1 {
			return n
		}
		w, h = max(1, w/2), max(1, h/2)
	}
}

// gpuBlocks is the bytes of a w x h texture of 16-byte 4x4 blocks (BC7, BC3, ASTC 4x4) with its
// full mip chain.
func gpuBlocks(w, h int) int64 {
	var n int64
	for {
		n += int64((w+3)/4) * int64((h+3)/4) * 16
		if w == 1 && h == 1 {
			return n
		}
		w, h = max(1, w/2), max(1, h/2)
	}
}
