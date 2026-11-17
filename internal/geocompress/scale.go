package geocompress

import (
	"encoding/binary"
	"encoding/json"
	"io"
	"math"
)

// meshScales returns, per mesh, an upper bound of the world scale the nodes that draw it apply:
// the product of each ancestor's largest axis scale, times the largest scale of the node's
// EXT_mesh_gpu_instancing instances. The position grid of a mesh is divided by it, so its
// world-space error stays within the step. A mesh no node draws gets 1.
func meshScales(doc map[string]any, accs []map[string]any, r io.ReaderAt, g glbFile) []float64 {
	meshes, _ := doc["meshes"].([]any)
	out := make([]float64, len(meshes))
	for i := range out {
		out[i] = 1
	}
	nodes, _ := doc["nodes"].([]any)
	if len(nodes) == 0 {
		return out
	}
	seen := make([]bool, len(meshes))
	hasParent := make([]bool, len(nodes))
	for _, nv := range nodes {
		n, _ := nv.(map[string]any)
		children, _ := n["children"].([]any)
		for _, c := range children {
			if ci, ok := entier(c); ok && ci >= 0 && ci < len(nodes) {
				hasParent[ci] = true
			}
		}
	}
	var walk func(i int, parent float64, depth int)
	walk = func(i int, parent float64, depth int) {
		if depth > 256 {
			return // a cycle: not a valid glTF; the default scale stands
		}
		n, _ := nodes[i].(map[string]any)
		s := parent * nodeScale(n)
		if mi, ok := entier(n["mesh"]); ok && mi >= 0 && mi < len(meshes) {
			world := s * instanceScale(n, accs, r, g)
			if !seen[mi] {
				out[mi], seen[mi] = world, true
			} else {
				out[mi] = max(out[mi], world)
			}
		}
		children, _ := n["children"].([]any)
		for _, c := range children {
			if ci, ok := entier(c); ok && ci >= 0 && ci < len(nodes) {
				walk(ci, s, depth+1)
			}
		}
	}
	for i := range nodes {
		if !hasParent[i] {
			walk(i, 1, 0)
		}
	}
	for i := range out {
		if !(out[i] > 0) || math.IsInf(out[i], 0) {
			out[i] = 1
		}
	}
	return out
}

// nodeScale is a node's largest axis scale: of its TRS scale, or its matrix's column lengths.
func nodeScale(n map[string]any) float64 {
	if m, ok := n["matrix"].([]any); ok && len(m) == 16 {
		var s float64
		for c := range 3 {
			var l float64
			for r := range 3 {
				v := number(m[c*4+r])
				l += v * v
			}
			s = max(s, math.Sqrt(l))
		}
		return s
	}
	if sc, ok := n["scale"].([]any); ok && len(sc) == 3 {
		return max(math.Abs(number(sc[0])), math.Abs(number(sc[1])), math.Abs(number(sc[2])))
	}
	return 1
}

// instanceScale is the largest axis scale of a node's EXT_mesh_gpu_instancing SCALE attribute
// (1 without one, or when it cannot be read as floats).
func instanceScale(n map[string]any, accs []map[string]any, r io.ReaderAt, g glbFile) float64 {
	attrs := instancingOf(n)
	ai, ok := entier(attrs["SCALE"])
	if !ok || ai < 0 || ai >= len(accs) {
		return 1
	}
	a := accs[ai]
	if c, _ := entier(a["componentType"]); c != compFloat {
		return 1
	}
	bv, ok := entier(a["bufferView"])
	views, _ := g.doc["bufferViews"].([]any)
	if !ok || bv < 0 || bv >= len(views) {
		return 1
	}
	vw, err := viewOf(views[bv], g.binLen)
	if err != nil {
		return 1
	}
	stride := 12
	if s, ok := entier(views[bv].(map[string]any)["byteStride"]); ok && s >= 12 {
		stride = s
	}
	off, _ := entier(a["byteOffset"])
	count, _ := entier(a["count"])
	if count <= 0 || int64(off+(count-1)*stride+12) > vw.n {
		return 1
	}
	buf := make([]byte, (count-1)*stride+12)
	if _, err := r.ReadAt(buf, g.binOff+vw.off+int64(off)); err != nil {
		return 1
	}
	s := 0.0
	for i := range count {
		for c := range 3 {
			v := float64(math.Float32frombits(binary.LittleEndian.Uint32(buf[i*stride+c*4:])))
			if !math.IsNaN(v) && !math.IsInf(v, 0) {
				s = max(s, math.Abs(v))
			}
		}
	}
	if s == 0 {
		return 1
	}
	return s
}

func number(v any) float64 {
	switch x := v.(type) {
	case json.Number:
		f, _ := x.Float64()
		return f
	case float64:
		return x
	}
	return 0
}
