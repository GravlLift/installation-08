// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

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
	"image/color"
	"io"
	"io/fs"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/basisu"
)

// WHY BLOCK ALIGNMENT. The viewer transcodes every KTX2 image to a 4x4-block GPU format (BC7 on
// desktop). Direct3D 11, under the browser's WebGL (ANGLE), refuses block-compressed storage
// whose base level is not a multiple of 4 on each side ("glTexStorage2D: Invalid compressed image
// size"), and every mip upload after it fails ("Level of detail outside of range"): the texture
// never reaches the GPU and the surface draws without it. Vacancy alone had 22 such images
// (2026-11-18 map sweep). The texture coordinates are normalized, so a texture resampled to the
// next multiple of 4 maps exactly as before.

// blockAligned returns `img` resampled (bilinear, wrapping like the mip chain) to the next
// multiple of 4 on each side, and true; or `img` itself and false when both sides already are.
// The channels are resampled independently and unpremultiplied: data maps keep their color
// under zero alpha.
func blockAligned(img image.Image) (image.Image, bool) {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	nw, nh := (w+3)&^3, (h+3)&^3
	if (nw == w && nh == h) || w <= 0 || h <= 0 {
		return img, false
	}
	src := nrgbaOf(img)
	dst := image.NewNRGBA(image.Rect(0, 0, nw, nh))
	wrap := func(v, n int) int { return ((v % n) + n) % n }
	for y := range nh {
		fy := (float64(y)+0.5)*float64(h)/float64(nh) - 0.5
		y0 := int(math.Floor(fy))
		ty := fy - float64(y0)
		r0, r1 := wrap(y0, h)*src.Stride, wrap(y0+1, h)*src.Stride
		for x := range nw {
			fx := (float64(x)+0.5)*float64(w)/float64(nw) - 0.5
			x0 := int(math.Floor(fx))
			tx := fx - float64(x0)
			c0, c1 := wrap(x0, w)*4, wrap(x0+1, w)*4
			o := y*dst.Stride + x*4
			for c := range 4 {
				top := float64(src.Pix[r0+c0+c])*(1-tx) + float64(src.Pix[r0+c1+c])*tx
				bot := float64(src.Pix[r1+c0+c])*(1-tx) + float64(src.Pix[r1+c1+c])*tx
				dst.Pix[o+c] = uint8(math.Round(top*(1-ty) + bot*ty))
			}
		}
	}
	return dst, true
}

// nrgbaOf returns `img` as an *image.NRGBA whose bounds start at (0, 0).
func nrgbaOf(img image.Image) *image.NRGBA {
	if n, ok := img.(*image.NRGBA); ok && n.Rect.Min == (image.Point{}) {
		return n
	}
	b := img.Bounds()
	n := image.NewNRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	for y := range b.Dy() {
		for x := range b.Dx() {
			n.SetNRGBA(x, y, color.NRGBAModel.Convert(img.At(b.Min.X+x, b.Min.Y+y)).(color.NRGBA))
		}
	}
	return n
}

// ktx2Size reads the pixel width and height from a KTX2 header.
func ktx2Size(data []byte) (int, int, bool) {
	if len(data) < 28 || !bytes.HasPrefix(data, []byte{0xAB, 'K', 'T', 'X', ' ', '2', '0', 0xBB}) {
		return 0, 0, false
	}
	return int(binary.LittleEndian.Uint32(data[20:])), int(binary.LittleEndian.Uint32(data[24:])), true
}

// ktx2Class reads a KTX2 file's class from its data format descriptor: an sRGB transfer function
// is a color image, anything else is data. A standalone KTX2 does not record whether it was
// encoded as a normal map; data is the safe reading (the same codec, without the encoder's
// normal-map weighting).
func ktx2Class(data []byte) Class {
	if len(data) < 52 {
		return ClassData
	}
	dfd := int(binary.LittleEndian.Uint32(data[48:]))
	// The DFD's total size (4), the basic block's header (8), then color model, primaries and
	// the transfer function.
	if t := dfd + 4 + 8 + 2; dfd > 0 && t < len(data) && data[t] == 2 {
		return ClassColor
	}
	return ClassData
}

// RealignKTX2File is RealignFile for a standalone KTX2 file (a library's externalized image):
// when its sides are not multiples of 4 it is decoded, resampled (blockAligned), re-encoded with
// its class's preset and written in place under a temporary name, then renamed. It reports
// whether it rewrote the file; an aligned file, or one that is not KTX2, is left untouched.
func RealignKTX2File(path string, o Options) (bool, error) {
	data, err := os.ReadFile(path) //nolint:gosec // library file path, set by the caller
	if err != nil {
		return false, err
	}
	w, h, ok := ktx2Size(data)
	if !ok || (w%4 == 0 && h%4 == 0) {
		return false, nil
	}
	img, err := basisu.Decode(data, 0)
	if err != nil {
		return false, fmt.Errorf("texcompress: %s: %w", path, err)
	}
	aligned, _ := blockAligned(img)
	preset := o.Preset
	if preset == nil {
		preset = Preset
	}
	out, err := basisu.Encode(aligned, preset(ktx2Class(data)))
	if err != nil {
		return false, fmt.Errorf("texcompress: %s: %w", path, err)
	}
	tmp := path + ".realign.tmp"
	if err := os.WriteFile(tmp, out, 0o644); err != nil { //nolint:gosec // library file
		return false, err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return false, err
	}
	return true, nil
}

// RealignedMarker is the file RealignDir leaves in a folder it has fully checked: a later call
// skips the folder. A library rebuilt by today's encoder is aligned already, and a rebuild
// moves the old folder (and its marker) aside, so the new one is checked once, cheaply.
const RealignedMarker = ".ktx2-block-aligned"

// RealignDir is the upgrade of a library folder written before the encoder aligned its images
// (the weapon, first-person and Spartan piece libraries): every GLB (RealignFile) and standalone
// KTX2 (RealignKTX2File) under `dir` with an image whose sides are not multiples of 4 is
// realigned in place. It returns the files rewritten. A folder holding the marker, or absent, is
// skipped; the marker is written only when every file was checked without error.
func RealignDir(ctx context.Context, dir string, o Options) (int, error) {
	if _, err := os.Stat(filepath.Join(dir, RealignedMarker)); err == nil {
		return 0, nil
	}
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return 0, nil
	}
	rewritten := 0
	var firstErr error
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if cerr := ctx.Err(); cerr != nil {
			return cerr
		}
		if d.IsDir() {
			return nil
		}
		var did bool
		var ferr error
		switch strings.ToLower(filepath.Ext(path)) {
		case ".ktx2":
			did, ferr = RealignKTX2File(path, o)
		case ".glb":
			var st Stats
			st, ferr = RealignFile(ctx, path, nil, o)
			did = st.Aligned > 0
			if errors.Is(ferr, ErrNotGLB) {
				ferr = nil // not a model (a stray or partial file): nothing to align
			}
		default:
			return nil
		}
		if ferr != nil && firstErr == nil {
			firstErr = ferr
		}
		if did {
			rewritten++
		}
		return nil
	})
	if err == nil {
		err = firstErr
	}
	if err != nil {
		return rewritten, err
	}
	return rewritten, os.WriteFile(filepath.Join(dir, RealignedMarker), []byte("every KTX2 image here has sides that are multiples of 4\n"), 0o644) //nolint:gosec // marker
}

// RealignFile brings the KTX2 images of the GLB at `path` whose sides are not multiples of 4 to
// block-aligned sizes, in place, and merges `extras` into its asset.extras (nil: none). It is the
// upgrade of a GLB built before the encoder aligned its images (mapmesh.UpgradeFile), and works
// on a geometry-compressed GLB too: each re-encoded image is APPENDED to the binary chunk and its
// buffer view pointed there, so no other byte of the chunk moves (EXT_meshopt_compression's
// offsets, the fallback buffer and every other view stay valid); the replaced image's old bytes
// are left unreferenced. Stats.Encoded = Stats.Aligned = the images re-encoded. A GLB with no
// such image and no extras to merge is not rewritten.
func RealignFile(ctx context.Context, path string, extras map[string]any, o Options) (Stats, error) {
	start := time.Now()
	f, err := os.Open(path) //nolint:gosec // build output path, set by the caller
	if err != nil {
		return Stats{}, err
	}
	defer func() { _ = f.Close() }()
	info, err := f.Stat()
	if err != nil {
		return Stats{}, err
	}
	g, err := openGLB(f, info.Size())
	if err != nil {
		return Stats{}, err
	}
	st := Stats{ByClass: map[Class]*ClassStats{}, BytesIn: info.Size()}
	images, _ := g.doc["images"].([]any)
	rawViews, _ := g.doc["bufferViews"].([]any)
	views := make([]view, len(rawViews))
	classes := classify(g.doc)
	var jobs []job
	for i, iv := range images {
		img, _ := iv.(map[string]any)
		bv, ok := entier(img["bufferView"])
		mime, _ := img["mimeType"].(string)
		if !ok || mime != MimeKTX2 || bv < 0 || bv >= len(rawViews) {
			st.Kept++
			continue
		}
		v, err := viewOf(rawViews[bv], g.binLen)
		if err != nil {
			return Stats{}, err
		}
		views[bv] = v
		head := make([]byte, min(v.n, 28))
		if _, err := f.ReadAt(head, g.binOff+v.off); err != nil {
			return Stats{}, err
		}
		w, h, ok := ktx2Size(head)
		if !ok || (w%4 == 0 && h%4 == 0) {
			st.Kept++
			continue
		}
		jobs = append(jobs, job{image: i, view: bv, class: classes[i], ktx2: true})
	}
	if len(jobs) == 0 && len(extras) == 0 {
		st.BytesOut, st.Duration = info.Size(), time.Since(start)
		return st, nil
	}
	preset := o.Preset
	if preset == nil {
		preset = Preset
	}
	store := &memBlobs{}
	results, err := encodeAll(ctx, f, g.binOff, views, jobs, preset, o, store)
	if err != nil {
		return Stats{}, err
	}

	// The appended images start after the existing chunk, each on 4 bytes.
	base := pad4(g.binLen)
	end := base
	for k, jb := range jobs {
		res := results[k]
		vm := rawViews[jb.view].(map[string]any)
		vm["byteOffset"] = json.Number(fmt.Sprint(end))
		vm["byteLength"] = json.Number(fmt.Sprint(res.n))
		end = pad4(end + res.n)
		st.Encoded++
		st.Aligned++
	}
	if len(jobs) > 0 {
		buffers, _ := g.doc["buffers"].([]any)
		if len(buffers) == 0 {
			return Stats{}, fmt.Errorf("%w: no buffer", ErrNotGLB)
		}
		buffers[0].(map[string]any)["byteLength"] = json.Number(fmt.Sprint(end))
	}
	if len(extras) > 0 {
		asset, _ := g.doc["asset"].(map[string]any)
		if asset == nil {
			asset = map[string]any{}
			g.doc["asset"] = asset
		}
		ex, _ := asset["extras"].(map[string]any)
		if ex == nil {
			ex = map[string]any{}
			asset["extras"] = ex
		}
		for k, v := range extras {
			ex[k] = v
		}
	}
	js, err := json.Marshal(g.doc)
	if err != nil {
		return Stats{}, fmt.Errorf("texcompress: glTF JSON: %w", err)
	}
	jsLen := pad4(int64(len(js)))
	total := 12 + 8 + jsLen + 8 + end
	if total > 1<<32-1 {
		return Stats{}, fmt.Errorf("texcompress: output GLB of %d bytes exceeds 4 GiB", total)
	}

	tmp := path + ".realign.tmp"
	out, err := os.Create(tmp) //nolint:gosec // build output path, set by the caller
	if err != nil {
		return Stats{}, err
	}
	werr := func() error {
		w := bufio.NewWriterSize(out, 1<<20)
		var hdr [20]byte
		binary.LittleEndian.PutUint32(hdr[0:], glbMagic)
		binary.LittleEndian.PutUint32(hdr[4:], 2)
		binary.LittleEndian.PutUint32(hdr[8:], uint32(total))
		binary.LittleEndian.PutUint32(hdr[12:], uint32(jsLen))
		binary.LittleEndian.PutUint32(hdr[16:], glbChunkJSON)
		w.Write(hdr[:])
		w.Write(js)
		w.Write(bytes.Repeat([]byte{' '}, int(jsLen-int64(len(js)))))
		var ch [8]byte
		binary.LittleEndian.PutUint32(ch[0:], uint32(end))
		binary.LittleEndian.PutUint32(ch[4:], glbChunkBIN)
		w.Write(ch[:])
		if _, err := io.Copy(w, io.NewSectionReader(f, g.binOff, g.binLen)); err != nil {
			return err
		}
		zero := make([]byte, 4)
		w.Write(zero[:base-g.binLen])
		for k := range jobs {
			res := results[k]
			if _, err := io.Copy(w, io.NewSectionReader(store, res.off, res.n)); err != nil {
				return err
			}
			w.Write(zero[:pad4(res.n)-res.n])
		}
		return w.Flush() // a bufio.Writer keeps its first write error and returns it here
	}()
	if cerr := out.Close(); werr == nil {
		werr = cerr
	}
	_ = f.Close()
	if werr == nil {
		werr = os.Rename(tmp, path)
	}
	if werr != nil {
		_ = os.Remove(tmp)
		return Stats{}, werr
	}
	st.BytesOut, st.Duration = total, time.Since(start)
	return st, nil
}
