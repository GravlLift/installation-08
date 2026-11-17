// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Package geocompress rewrites the geometry of a finished GLB with meshoptimizer's codecs, as
// glTF's EXT_meshopt_compression: vertex attributes, triangle indices, instance transforms and
// animation data shrink on disk and on the wire, and the viewer (three's GLTFLoader with
// MeshoptDecoder) decodes them back into the same accessor types the uncompressed file had.
//
// Every decoded accessor keeps its component type: float attributes stay 32-bit floats (the
// exponential filter decodes to floats), indices stay 16 or 32-bit. KHR_mesh_quantization is not
// used, so nothing that reads geometry on the client (ray index, merges, bounds, back faces,
// shadow proxies, the top-down view, the layered materials' UV sets) sees a different layout.
//
//   - POSITION is lossless (vertex codec only). The game stacks decals a fraction of a millimeter
//     in front of their walls: rounding positions to a 2^-10 unit grid (0.49 mm at most) made
//     signs on Streets z-fight, and one exponent per value saved only 3 MB of its 88.
//   - Other float vertex attributes (TEXCOORD_n, NORMAL, TANGENT, COLOR_n, WEIGHTS_n, custom
//     ones) use the exponential filter with 24-bit mantissas: shared component exponents (fixed
//     point at the resolution of the largest magnitude in the buffer) when that resolution is at
//     most 2^-21 (values below 4: normals, lightmap UVs), else one exponent per value (within a
//     unit in the last place of each float). The measured maxima are in Stats.
//   - Everything else is lossless: indices (index buffer codec for triangle lists, index sequence
//     codec otherwise), integer attributes, instance transforms, animation keys, skins.
//   - Images (KTX2 is already compressed), views read through the document's extras (the baked
//     light probes) and views the codecs cannot take stay as they are.
//
// Each encoded view is decoded back and checked before it is kept (byte for byte when lossless,
// against the error bound when filtered); a view that does not get smaller stays as it was. The
// compressed views move to a fallback buffer without data (EXT_meshopt_compression's
// `fallback`), so the file names the extension in extensionsRequired: a loader without the
// decoder fails loudly instead of drawing garbage.
//
// The pass reads the GLB as generic JSON (numbers kept as text), like texcompress: every field it
// does not know passes through unchanged. It is idempotent: a GLB that already lists the
// extension is copied as it is (with Options.Extras merged).
package geocompress

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/meshopt"
)

const (
	glbMagic     = 0x46546C67 // "glTF"
	glbChunkJSON = 0x4E4F534A
	glbChunkBIN  = 0x004E4942
	// Extension is the glTF extension the pass writes.
	Extension = "EXT_meshopt_compression"

	compFloat  = 5126
	compUint32 = 5125
	compUint16 = 5123
)

// sharedResolution is the coarsest fixed-point resolution a non-position float attribute is
// encoded at (2^-21: UVs below 4 in magnitude; a 4096-texel texture tiled 90 times moves by at
// most 0.09 texel). Coarser, the attribute keeps one exponent per value.
const sharedResolution = 1.0 / (1 << 21)

// ErrNotGLB: the bytes are not a GLB this pass can read (one buffer, views inside the binary chunk).
var ErrNotGLB = errors.New("geocompress: not a readable GLB")

// Options tune a pass.
type Options struct {
	// Extras are merged into asset.extras (the build-format stamp of the map and variant builds).
	Extras map[string]any
	// Workers is the number of views encoded at once; 0 is min(4, half the logical CPUs).
	Workers int
}

// KindStats sums one kind of view.
type KindStats struct {
	Views             int
	BytesIn, BytesOut int64
}

// Stats summarizes a pass.
type Stats struct {
	// Compressed counts the views rewritten; Kept the geometry views left as they were (no gain,
	// or a layout the codecs do not take).
	Compressed, Kept int
	// Rejected names the views kept because the codecs refused them or their decoding did not
	// check out (a codec bug; the view stays raw and the file stays right).
	Rejected []string
	ByKind   map[string]*KindStats
	// MaxAttributeError is the largest absolute error of the filtered float attributes (UV units
	// for TEXCOORD_n), by semantic.
	MaxAttributeError map[string]float64
	// Triangles is the count of triangles drawn by the meshes' primitives.
	Triangles         int
	BytesIn, BytesOut int64
	Duration          time.Duration
}

// CompressFile rewrites the GLB at `src` into `dst` (written under a temporary name, then
// renamed). `src` and `dst` may be the same.
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
	tmp := dst + ".mo.tmp"
	out, err := os.Create(tmp) //nolint:gosec // build output path, set by the caller
	if err != nil {
		_ = f.Close()
		return Stats{}, err
	}
	w := bufio.NewWriterSize(out, 1<<20)
	st, err := Compress(ctx, f, info.Size(), w, o)
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

// Uses says whether the GLB's JSON (a header-only read) lists the extension in extensionsUsed.
func Uses(path string) (bool, error) {
	f, err := os.Open(path) //nolint:gosec // cache path, set by the caller
	if err != nil {
		return false, err
	}
	defer func() { _ = f.Close() }()
	info, err := f.Stat()
	if err != nil {
		return false, err
	}
	g, err := openGLB(f, info.Size())
	if err != nil {
		return false, err
	}
	return listed(g.doc, "extensionsUsed"), nil
}

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

// Compress reads a GLB of `size` bytes from `r` and writes it to `w` with its geometry encoded.
// The encoded views are held in memory until `w` is written (a map's come to a few hundred MB).
func Compress(ctx context.Context, r io.ReaderAt, size int64, w io.Writer, o Options) (Stats, error) {
	start := time.Now()
	g, err := openGLB(r, size)
	if err != nil {
		return Stats{}, err
	}
	st := Stats{ByKind: map[string]*KindStats{}, MaxAttributeError: map[string]float64{}, BytesIn: size}
	verbatim := func() error {
		if _, err := io.Copy(w, io.NewSectionReader(r, 0, size)); err != nil {
			return err
		}
		st.BytesOut, st.Duration = size, time.Since(start)
		return nil
	}
	if len(o.Extras) == 0 && listed(g.doc, "extensionsUsed") {
		return st, verbatim()
	}
	mergeExtras(g.doc, o.Extras)
	if listed(g.doc, "extensionsUsed") {
		// Already compressed: only the extras change, the binary chunk is copied as it is.
		return st, writeGLB(w, g.doc, g.binLen, func(w io.Writer) error {
			_, err := io.Copy(w, io.NewSectionReader(r, g.binOff, g.binLen))
			return err
		}, &st, start)
	}
	buffers, _ := g.doc["buffers"].([]any)
	if len(buffers) != 1 {
		return Stats{}, fmt.Errorf("%w: %d buffers (one expected)", ErrNotGLB, len(buffers))
	}
	plan, err := planViews(g, r)
	if err != nil {
		return Stats{}, err
	}
	st.Triangles = plan.triangles
	results, err := encodeAll(ctx, r, plan.jobs, o.Workers)
	if err != nil {
		return Stats{}, err
	}
	encoded := map[int]*result{}
	for i := range results {
		res := &results[i]
		jb := plan.jobs[i]
		ks := st.ByKind[jb.kind]
		if ks == nil {
			ks = &KindStats{}
			st.ByKind[jb.kind] = ks
		}
		ks.Views++
		ks.BytesIn += jb.n
		if res.err != nil {
			st.Rejected = append(st.Rejected, res.err.Error())
		}
		if res.data == nil || int64(len(res.data)) >= jb.n {
			ks.BytesOut += jb.n
			st.Kept++
			continue
		}
		ks.BytesOut += int64(len(res.data))
		st.Compressed++
		encoded[jb.view] = res
		if res.filtered {
			st.MaxAttributeError[jb.semantic] = max(st.MaxAttributeError[jb.semantic], res.maxErr)
		}
	}
	if len(encoded) == 0 && len(o.Extras) == 0 {
		// Nothing to encode and nothing to stamp: the file stays byte for byte as it was.
		return st, verbatim()
	}
	return st, rewrite(g, r, w, encodedViews(plan, encoded), &st, start)
}

// compressedView is one view's encoding, as written.
type compressedView struct {
	data   []byte
	stride int
	count  int
	mode   string
	filter bool
}

func encodedViews(plan viewPlan, enc map[int]*result) map[int]compressedView {
	out := map[int]compressedView{}
	for _, jb := range plan.jobs {
		res, ok := enc[jb.view]
		if !ok {
			continue
		}
		out[jb.view] = compressedView{data: res.data, stride: jb.stride, count: jb.count, mode: jb.mode, filter: res.filtered}
	}
	return out
}

// rewrite writes the GLB: the views in their order in the binary chunk, each compressed one as
// its encoding (its view moved to the fallback buffer), every other one as it was.
func rewrite(g glbFile, r io.ReaderAt, w io.Writer, enc map[int]compressedView, st *Stats, start time.Time) error {
	rawViews, _ := g.doc["bufferViews"].([]any)
	type place struct{ off, n int64 }
	src := make([]place, len(rawViews))
	for i, v := range rawViews {
		vw, err := viewOf(v, g.binLen)
		if err != nil {
			return err
		}
		src[i] = place{vw.off, vw.n}
	}
	var binLen, fallbackLen int64
	for i := range rawViews {
		vm := rawViews[i].(map[string]any)
		if c, ok := enc[i]; ok {
			ext := map[string]any{
				"buffer": json.Number("0"), "byteOffset": num(binLen), "byteLength": num(int64(len(c.data))),
				"byteStride": num(int64(c.stride)), "count": num(int64(c.count)), "mode": c.mode,
			}
			if c.filter {
				ext["filter"] = "EXPONENTIAL"
			}
			exts, _ := vm["extensions"].(map[string]any)
			if exts == nil {
				exts = map[string]any{}
				vm["extensions"] = exts
			}
			exts[Extension] = ext
			vm["buffer"] = json.Number("1")
			vm["byteOffset"] = num(fallbackLen)
			fallbackLen += pad4(src[i].n)
			binLen += pad4(int64(len(c.data)))
			continue
		}
		vm["byteOffset"] = num(binLen)
		binLen += pad4(src[i].n)
	}
	buffers, _ := g.doc["buffers"].([]any)
	if len(buffers) == 0 {
		return fmt.Errorf("%w: no buffer", ErrNotGLB)
	}
	buffers[0].(map[string]any)["byteLength"] = num(binLen)
	if len(enc) > 0 {
		g.doc["buffers"] = append(buffers, map[string]any{
			"byteLength": num(fallbackLen),
			"extensions": map[string]any{Extension: map[string]any{"fallback": true}},
		})
		addExtension(g.doc, "extensionsUsed")
		addExtension(g.doc, "extensionsRequired")
	}
	return writeGLB(w, g.doc, binLen, func(w io.Writer) error {
		zero := make([]byte, 4)
		for i, p := range src {
			n := p.n
			if c, ok := enc[i]; ok {
				n = int64(len(c.data))
				if _, err := w.Write(c.data); err != nil {
					return err
				}
			} else if _, err := io.Copy(w, io.NewSectionReader(r, g.binOff+p.off, p.n)); err != nil {
				return err
			}
			if pd := pad4(n) - n; pd > 0 {
				if _, err := w.Write(zero[:pd]); err != nil {
					return err
				}
			}
		}
		return nil
	}, st, start)
}

// writeGLB writes the GLB header, the document and a binary chunk of `binLen` bytes that `bin`
// writes, and records the output size and the pass's duration in `st`.
func writeGLB(w io.Writer, doc map[string]any, binLen int64, bin func(io.Writer) error, st *Stats, start time.Time) error {
	js, err := json.Marshal(doc)
	if err != nil {
		return fmt.Errorf("geocompress: glTF JSON: %w", err)
	}
	jsLen := pad4(int64(len(js)))
	total := 12 + 8 + jsLen + 8 + binLen
	if total > 1<<32-1 {
		return fmt.Errorf("geocompress: output GLB of %d bytes exceeds 4 GiB", total)
	}
	var hdr [20]byte
	binary.LittleEndian.PutUint32(hdr[0:], glbMagic)
	binary.LittleEndian.PutUint32(hdr[4:], 2)
	binary.LittleEndian.PutUint32(hdr[8:], uint32(total))
	binary.LittleEndian.PutUint32(hdr[12:], uint32(jsLen))
	binary.LittleEndian.PutUint32(hdr[16:], glbChunkJSON)
	if _, err := w.Write(hdr[:]); err != nil {
		return err
	}
	if _, err := w.Write(js); err != nil {
		return err
	}
	if _, err := w.Write(bytes.Repeat([]byte{' '}, int(jsLen-int64(len(js))))); err != nil {
		return err
	}
	var ch [8]byte
	binary.LittleEndian.PutUint32(ch[0:], uint32(binLen))
	binary.LittleEndian.PutUint32(ch[4:], glbChunkBIN)
	if _, err := w.Write(ch[:]); err != nil {
		return err
	}
	if err := bin(w); err != nil {
		return err
	}
	st.BytesOut, st.Duration = total, time.Since(start)
	return nil
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

// job is one view to encode.
type job struct {
	view int
	off  int64 // in the binary chunk
	n    int64
	// kind names the view in Stats (the attribute semantic, "indices", "instancing", "animation",
	// "skin", "other").
	kind, semantic string
	mode           string // ATTRIBUTES, TRIANGLES, INDICES
	stride, count  int
	// filter: float attribute (not POSITION) encoded with the exponential filter.
	filter bool
	// indexSize is 2 or 4 for an index view.
	indexSize int
	accessors []int
}

type result struct {
	data   []byte
	maxErr float64
	// filtered: the data carries the exponential filter.
	filtered bool
	// err: the view was refused (kept raw).
	err error
}

// viewPlan is the views the pass encodes and the facts it gathered from the document.
type viewPlan struct {
	jobs      []job
	accessors []map[string]any
	triangles int
}

// accUse is how the document uses one accessor.
type accUse struct {
	semantic  string // attribute semantic, "" when not an attribute
	indices   bool
	triangles bool // indices of triangle-list primitives only
	other     string
}

// planViews decides, for every buffer view, whether and how it is encoded.
func planViews(g glbFile, r io.ReaderAt) (viewPlan, error) {
	doc := g.doc
	rawAcc, _ := doc["accessors"].([]any)
	accs := make([]map[string]any, len(rawAcc))
	for i, a := range rawAcc {
		accs[i], _ = a.(map[string]any)
	}
	uses := make([]accUse, len(accs))
	mark := func(i int, f func(u *accUse)) {
		if i >= 0 && i < len(uses) {
			f(&uses[i])
		}
	}
	var plan viewPlan
	plan.accessors = accs
	meshes, _ := doc["meshes"].([]any)
	for _, mv := range meshes {
		m, _ := mv.(map[string]any)
		prims, _ := m["primitives"].([]any)
		for _, pv := range prims {
			p, _ := pv.(map[string]any)
			mode, ok := entier(p["mode"])
			if !ok {
				mode = 4
			}
			if attrs, ok := p["attributes"].(map[string]any); ok {
				for sem, av := range attrs {
					if a, ok := entier(av); ok {
						mark(a, func(u *accUse) {
							if u.semantic != "" && u.semantic != sem {
								u.other = "attribute shared by two semantics"
							}
							u.semantic = sem
						})
					}
				}
			}
			if targets, ok := p["targets"].([]any); ok {
				for _, tv := range targets {
					t, _ := tv.(map[string]any)
					for _, av := range t {
						if a, ok := entier(av); ok {
							mark(a, func(u *accUse) { u.other = "morph" })
						}
					}
				}
			}
			if iv, ok := entier(p["indices"]); ok {
				mark(iv, func(u *accUse) {
					if !u.indices {
						u.triangles = true
					}
					u.indices = true
					if mode != 4 {
						u.triangles = false
					}
				})
				if mode == 4 && iv < len(accs) {
					if c, ok := entier(accs[iv]["count"]); ok {
						plan.triangles += c / 3
					}
				}
			}
		}
	}
	nodes, _ := doc["nodes"].([]any)
	for _, nv := range nodes {
		n, _ := nv.(map[string]any)
		if inst := instancingOf(n); inst != nil {
			for _, av := range inst {
				if a, ok := entier(av); ok {
					mark(a, func(u *accUse) { u.other = "instancing" })
				}
			}
		}
	}
	anims, _ := doc["animations"].([]any)
	for _, av := range anims {
		an, _ := av.(map[string]any)
		samplers, _ := an["samplers"].([]any)
		for _, sv := range samplers {
			s, _ := sv.(map[string]any)
			for _, k := range []string{"input", "output"} {
				if a, ok := entier(s[k]); ok {
					mark(a, func(u *accUse) { u.other = "animation" })
				}
			}
		}
	}
	skins, _ := doc["skins"].([]any)
	for _, sv := range skins {
		s, _ := sv.(map[string]any)
		if a, ok := entier(s["inverseBindMatrices"]); ok {
			mark(a, func(u *accUse) { u.other = "skin" })
		}
	}
	// Views read by an image or a sparse accessor are never encoded.
	reserved := map[int]bool{}
	images, _ := doc["images"].([]any)
	for _, iv := range images {
		im, _ := iv.(map[string]any)
		if bv, ok := entier(im["bufferView"]); ok {
			reserved[bv] = true
		}
	}
	byView := map[int][]int{}
	for i, a := range accs {
		if sp, ok := a["sparse"].(map[string]any); ok {
			for _, k := range []string{"indices", "values"} {
				if m, ok := sp[k].(map[string]any); ok {
					if bv, ok := entier(m["bufferView"]); ok {
						reserved[bv] = true
					}
				}
			}
		}
		if bv, ok := entier(a["bufferView"]); ok {
			byView[bv] = append(byView[bv], i)
		}
	}
	rawViews, _ := doc["bufferViews"].([]any)
	for vi, v := range rawViews {
		vw, err := viewOf(v, g.binLen)
		if err != nil {
			return viewPlan{}, err
		}
		users := byView[vi]
		if reserved[vi] || len(users) == 0 || vw.n == 0 {
			continue
		}
		vm := v.(map[string]any)
		if jb, ok := planView(vi, vw, vm, users, accs, uses); ok {
			jb.off = g.binOff + vw.off
			plan.jobs = append(plan.jobs, jb)
		}
	}
	return plan, nil
}

// planView decides one view's encoding from its accessors; ok=false leaves it as it is.
func planView(vi int, vw view, vm map[string]any, users []int, accs []map[string]any, uses []accUse) (job, bool) {
	viewStride, hasStride := entier(vm["byteStride"])
	jb := job{view: vi, n: vw.n, accessors: users}
	first := accs[users[0]]
	u := uses[users[0]]
	comp, _ := entier(first["componentType"])
	typ, _ := first["type"].(string)
	elem := componentSize(comp) * typeComponents(typ)
	if elem == 0 {
		return job{}, false
	}
	// Indices: one accessor per view, tightly packed, 16 or 32-bit.
	if u.indices {
		if len(users) != 1 || u.semantic != "" || u.other != "" || (comp != compUint16 && comp != compUint32) {
			return job{}, false
		}
		off, _ := entier(first["byteOffset"])
		count, _ := entier(first["count"])
		if off != 0 || int64(count*elem) != vw.n {
			return job{}, false
		}
		jb.kind, jb.indexSize, jb.stride, jb.count = "indices", elem, elem, count
		jb.mode = "INDICES"
		if u.triangles && count%3 == 0 {
			jb.mode = "TRIANGLES"
		}
		return jb, true
	}
	// Vertex-like data: ATTRIBUTES over the view's stride (its own, or the element size of its
	// single accessor). The stride must be a multiple of 4 and the view a whole number of elements.
	stride := elem
	if hasStride {
		stride = viewStride
	}
	if stride%4 != 0 || stride > 256 || vw.n%int64(stride) != 0 {
		return job{}, false
	}
	jb.stride, jb.count, jb.mode = stride, int(vw.n/int64(stride)), "ATTRIBUTES"
	for _, a := range users {
		if uses[a].indices {
			return job{}, false
		}
	}
	switch {
	case u.other != "":
		jb.kind = u.other
	case u.semantic != "":
		jb.kind = u.semantic
		if strings.HasPrefix(u.semantic, "TEXCOORD_") {
			jb.kind = "TEXCOORD_n"
		}
	default:
		jb.kind = "other"
	}
	// The exponential filter: a float attribute other than POSITION, alone in its view, tightly
	// packed.
	off, _ := entier(first["byteOffset"])
	count, _ := entier(first["count"])
	if len(users) == 1 && u.semantic != "" && u.semantic != "POSITION" && u.other == "" && comp == compFloat && off == 0 && stride == elem && count == jb.count {
		if norm, _ := first["normalized"].(bool); !norm {
			jb.filter = true
			jb.semantic = u.semantic
		}
	}
	return jb, true
}

// encodeAll encodes the jobs on a few goroutines, the biggest first, and returns their results
// in job order. A job that fails its check fails the pass.
func encodeAll(ctx context.Context, r io.ReaderAt, jobs []job, workers int) ([]result, error) {
	if workers <= 0 {
		workers = max(1, min(4, runtime.NumCPU()/2))
	}
	order := make([]int, len(jobs))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(a, b int) bool { return jobs[order[a]].n > jobs[order[b]].n })
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	results := make([]result, len(jobs))
	next := make(chan int)
	var wg sync.WaitGroup
	var firstErr error
	var once sync.Once
	fail := func(err error) { once.Do(func() { firstErr = err; cancel() }) }
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for k := range next {
				jb := jobs[k]
				raw := make([]byte, jb.n)
				if _, err := r.ReadAt(raw, jb.off); err != nil {
					fail(fmt.Errorf("geocompress: view %d: %w", jb.view, err))
					continue
				}
				res, err := encodeJob(jb, raw)
				if err != nil {
					// A view the codecs refuse, or whose decoding does not check out, stays as it
					// was: the file is still right, only that view is not smaller.
					res = result{err: fmt.Errorf("view %d (%s): %w", jb.view, jb.kind, err)}
				}
				results[k] = res
			}
		}()
	}
feed:
	for _, k := range order {
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

// encodeJob encodes one view and checks its decoding.
func encodeJob(jb job, raw []byte) (result, error) {
	switch jb.mode {
	case "TRIANGLES", "INDICES":
		idx := make([]uint32, jb.count)
		maxIdx := uint32(0)
		for i := range idx {
			if jb.indexSize == 2 {
				idx[i] = uint32(binary.LittleEndian.Uint16(raw[i*2:]))
			} else {
				idx[i] = binary.LittleEndian.Uint32(raw[i*4:])
			}
			maxIdx = max(maxIdx, idx[i])
		}
		var enc, dec []byte
		var err error
		if jb.mode == "TRIANGLES" {
			if enc, err = meshopt.EncodeIndexBuffer(idx, int(maxIdx)+1); err == nil {
				dec, err = meshopt.DecodeIndexBuffer(enc, jb.count, jb.indexSize)
			}
		} else {
			if enc, err = meshopt.EncodeIndexSequence(idx, int(maxIdx)+1); err == nil {
				dec, err = meshopt.DecodeIndexSequence(enc, jb.count, jb.indexSize)
			}
		}
		if err != nil {
			return result{}, err
		}
		if jb.mode == "TRIANGLES" {
			// The index buffer codec keeps the triangles in their order but may rotate the three
			// indices of one (same winding, same triangle): compare modulo that rotation.
			if !sameTriangles(dec, idx, jb.indexSize) {
				return result{}, errors.New("index round trip differs")
			}
		} else if !bytes.Equal(dec, raw) {
			return result{}, errors.New("index round trip differs")
		}
		return result{data: enc}, nil
	}
	if !jb.filter {
		enc, err := meshopt.EncodeVertexBuffer(raw, jb.count, jb.stride)
		if err != nil {
			return result{}, err
		}
		dec, err := meshopt.DecodeVertexBuffer(enc, jb.count, jb.stride)
		if err != nil {
			return result{}, err
		}
		if !bytes.Equal(dec, raw) {
			return result{}, errors.New("vertex round trip differs")
		}
		return result{data: enc}, nil
	}
	return encodeFiltered(jb, raw)
}

// encodeFiltered encodes a float attribute with the exponential filter, checks the decoded floats
// and measures their error.
func encodeFiltered(jb job, raw []byte) (result, error) {
	n := jb.count * jb.stride / 4
	src := make([]float32, n)
	for i := range src {
		src[i] = math.Float32frombits(binary.LittleEndian.Uint32(raw[i*4:]))
		if f := float64(src[i]); math.IsNaN(f) || math.IsInf(f, 0) {
			return result{}, nil // the filter takes finite values only: keep the view raw
		}
	}
	// The attribute shares its exponents (fixed point at the resolution of its largest magnitude)
	// only while that resolution is at most sharedResolution; above it (UVs in the hundreds, whose
	// texture may also tile 90 times) each value keeps its own exponent, within a unit in the
	// last place.
	mode := meshopt.ExpSharedComponent
	var top float64
	for _, v := range src {
		top = max(top, math.Abs(float64(v)))
	}
	if _, e := math.Frexp(top); math.Ldexp(1, e-23) > sharedResolution {
		mode = meshopt.ExpSeparate
	}
	filtered, err := meshopt.EncodeFilterExp(src, jb.count, jb.stride, 24, mode)
	if err != nil {
		return result{}, err
	}
	enc, err := meshopt.EncodeVertexBuffer(filtered, jb.count, jb.stride)
	if err != nil {
		return result{}, err
	}
	dec, err := meshopt.DecodeVertexBuffer(enc, jb.count, jb.stride)
	if err != nil {
		return result{}, err
	}
	if !bytes.Equal(dec, filtered) {
		return result{}, errors.New("filtered vertex round trip differs")
	}
	meshopt.DecodeFilterExp(dec, jb.count, jb.stride)
	var worst float64
	for i := range src {
		got := float64(math.Float32frombits(binary.LittleEndian.Uint32(dec[i*4:])))
		d := math.Abs(got - float64(src[i]))
		worst = max(worst, d)
		if mode == meshopt.ExpSeparate && d > ulp(src[i]) {
			return result{}, fmt.Errorf("separate exponents off by %g at %g", d, src[i])
		}
	}
	return result{data: enc, filtered: true, maxErr: worst}, nil
}

// sameTriangles says whether the decoded index bytes (`size` 2 or 4) hold the triangles of
// `want` in order, each one equal to the original or to a rotation of it.
func sameTriangles(dec []byte, want []uint32, size int) bool {
	at := func(i int) uint32 {
		if size == 2 {
			return uint32(binary.LittleEndian.Uint16(dec[i*2:]))
		}
		return binary.LittleEndian.Uint32(dec[i*4:])
	}
	for t := 0; t+2 < len(want); t += 3 {
		a, b, c := at(t), at(t+1), at(t+2)
		x, y, z := want[t], want[t+1], want[t+2]
		if !(a == x && b == y && c == z) && !(a == y && b == z && c == x) && !(a == z && b == x && c == y) {
			return false
		}
	}
	return true
}

// ulp is the distance from |v| to the next float32 up.
func ulp(v float32) float64 {
	a := float32(math.Abs(float64(v)))
	return float64(math.Nextafter32(a, float32(math.Inf(1))) - a)
}

func componentSize(c int) int {
	switch c {
	case 5120, 5121:
		return 1
	case 5122, 5123:
		return 2
	case 5125, 5126:
		return 4
	}
	return 0
}

func typeComponents(t string) int {
	switch t {
	case "SCALAR":
		return 1
	case "VEC2":
		return 2
	case "VEC3":
		return 3
	case "VEC4", "MAT2":
		return 4
	case "MAT3":
		return 9
	case "MAT4":
		return 16
	}
	return 0
}

func instancingOf(n map[string]any) map[string]any {
	ext, _ := n["extensions"].(map[string]any)
	inst, _ := ext["EXT_mesh_gpu_instancing"].(map[string]any)
	attrs, _ := inst["attributes"].(map[string]any)
	return attrs
}

func listed(doc map[string]any, key string) bool {
	list, _ := doc[key].([]any)
	for _, e := range list {
		if e == Extension {
			return true
		}
	}
	return false
}

func addExtension(doc map[string]any, key string) {
	if listed(doc, key) {
		return
	}
	list, _ := doc[key].([]any)
	doc[key] = append(list, Extension)
}

func mergeExtras(doc map[string]any, extras map[string]any) {
	if len(extras) == 0 {
		return
	}
	asset, _ := doc["asset"].(map[string]any)
	if asset == nil {
		asset = map[string]any{"version": "2.0"}
		doc["asset"] = asset
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

func num(n int64) json.Number { return json.Number(fmt.Sprint(n)) }

func pad4(n int64) int64 { return (n + 3) &^ 3 }

// entier reads a JSON integer (json.Number, float64 or int).
func entier(v any) (int, bool) {
	switch x := v.(type) {
	case json.Number:
		i, err := x.Int64()
		return int(i), err == nil
	case float64:
		return int(x), x == math.Trunc(x)
	case int:
		return x, true
	}
	return 0, false
}
