// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package texcompress

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"io"
	"math"
	"os"
	"time"
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
