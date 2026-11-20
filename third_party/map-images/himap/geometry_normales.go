// Package himap — geometry_normales.go (LOCAL-CHANGE (infinite-theater-3d)): the game's own vertex
// normals of a LOD.
//
// The LOD's 19 buffer indices are one per usage (geometry_uv.go, peau.go): position at slot 0, the
// three UV sets at 1 to 3, the NORMAL at slot 5, the blend indices and weights at 7 and 8. Slot 5
// holds one 32-bit word per vertex (format 15, stride 4):
//
//	bits  0-9   x   unsigned, read as v / 1023 * 2 - 1
//	bits 10-19  y   idem
//	bits 20-29  z   idem
//	bits 30-31  a 2-bit field (only 1 and 3 on the Spartan's sections), not read
//
// The three fields carry the normal's DIRECTION, not a unit vector: their length spreads from 0 to
// 1.5 with no bearing on how well the direction agrees with the surface, so the reader normalizes
// it. Measured on the Spartan's `mode` (3db5318c: every one of its 1218 sections carries slot 5 in
// format 15; 2.46 M vertices), against the area-weighted normal of the triangles each vertex
// belongs to: mean dot 0.86, 73% of the vertices within 30 degrees (those at a mean dot of 0.98),
// exact on flat panels; the rest bend the same way on both sides of the body (a vertex and its
// mirror deviate identically), the mark of authored normals rather than of a misread. The raw
// fields as a signed 10-bit or octahedral encoding agree with nothing (mean dot under 0.55).
//
// Slot 6 (format 19, stride 4, always 0x80 in its top byte) is not read.
//
// Only the models the replay draws close (the Spartan, its pieces and attachments, the first-person
// rig, weapons and other objects, `MaillageMonde.avecNormales`) read their normals; a map's
// geometry is written as before, without them.
package himap

import (
	"encoding/binary"
	"math"
)

// Grammar of the normals buffer of a LOD.
const (
	emplacementNormales  = 5
	formatNormales101010 = 15
	pasNormales          = 4
	normale10BitsMax     = 1023
)

// normales reads the normals of the LOD `l` for its `nVerts` vertices; nil when the slot is empty,
// of another format, stride or count, or outside the blob.
func (a *RuntimeGeoAsset) normales(l lodEntry, nVerts int) [][3]float32 {
	k := int(int16(binary.LittleEndian.Uint16(a.info.tag[l.abs+lodOffVertexBuffer+2*emplacementNormales:])))
	if k < 0 || k >= len(a.vertexDescs) {
		return nil
	}
	d := a.vertexDescs[k]
	if d.Usage != formatNormales101010 || d.Stride != pasNormales || d.Count != nVerts || d.Offset < 0 || d.Offset+d.Size > len(a.blob) {
		return nil
	}
	return normalesDuTampon(a.blob[d.Offset:d.Offset+d.Size], nVerts)
}

// normalesDuTampon decodes `n` packed normals (decodeNormale); nil when `b` is too short.
func normalesDuTampon(b []byte, n int) [][3]float32 {
	if len(b) < n*pasNormales {
		return nil
	}
	out := make([][3]float32, n)
	for i := range out {
		out[i] = decodeNormale(binary.LittleEndian.Uint32(b[i*pasNormales:]))
	}
	return out
}

// decodeNormale reads one packed normal as a unit vector, in the model's axes. Each field is
// (2v - 1023) / 1023, an odd multiple of 1/1023, so the vector is never null.
func decodeNormale(p uint32) [3]float32 {
	var v [3]float64
	l := 0.0
	for c := range v {
		v[c] = float64(p>>(10*c)&normale10BitsMax)/normale10BitsMax*2 - 1
		l += v[c] * v[c]
	}
	l = math.Sqrt(l)
	return [3]float32{float32(v[0] / l), float32(v[1] / l), float32(v[2] / l)}
}

// MeshAvecNormales is Mesh with the LOD's normals (Mesh.Normales, nil when the LOD carries none
// readable).
func (a *RuntimeGeoAsset) MeshAvecNormales(meshIndex int) *Mesh {
	m := a.Mesh(meshIndex)
	if m == nil {
		return nil
	}
	if l, ok := a.chooseLOD(meshIndex); ok {
		m.Normales = a.normales(l, len(m.Vertices))
	}
	return m
}

// normaleMonde turns a model-space normal into the instance's world space: the inverse transpose
// of the placement (axes and per-axis scale), normalized. A mirrored placement keeps the normal
// on the side the face's (reversed) winding faces.
func (in Instance) normaleMonde(n [3]float32) [3]float32 {
	var a, b, c [3]float64
	for k := 0; k < 3; k++ {
		a[k] = in.Forward[k] * in.Scale[0]
		b[k] = in.Left[k] * in.Scale[1]
		c[k] = in.Up[k] * in.Scale[2]
	}
	bc, ca, ab := produitVectoriel(b, c), produitVectoriel(c, a), produitVectoriel(a, b)
	det := a[0]*bc[0] + a[1]*bc[1] + a[2]*bc[2]
	var w [3]float64
	l := 0.0
	for k := 0; k < 3; k++ {
		w[k] = float64(n[0])*bc[k] + float64(n[1])*ca[k] + float64(n[2])*ab[k]
		if det < 0 {
			w[k] = -w[k]
		}
		l += w[k] * w[k]
	}
	if l == 0 || math.IsNaN(l) || math.IsInf(l, 0) {
		return n
	}
	l = math.Sqrt(l)
	return [3]float32{float32(w[0] / l), float32(w[1] / l), float32(w[2] / l)}
}

func produitVectoriel(u, v [3]float64) [3]float64 {
	return [3]float64{u[1]*v[2] - u[2]*v[1], u[2]*v[0] - u[0]*v[2], u[0]*v[1] - u[1]*v[0]}
}

// ajouteNormales appends the normals of `m`'s vertices (placed by `in`) to the group, whose
// vertices before `m` number `base`. The group keeps normals only while every mesh it holds
// carries them: a mesh without normals (or a group that already lacks them) drops them all, and
// the writer then writes none (ajouteNormalesGLB) rather than misaligned ones.
func (g *GroupeMaillage) ajouteNormales(m *Mesh, in Instance, base int) {
	aligne := len(g.Normales) == 3*base
	if len(m.Normales) != len(m.Vertices) || !aligne {
		g.Normales = nil
		return
	}
	for _, n := range m.Normales {
		w := in.normaleMonde(n)
		g.Normales = append(g.Normales, w[0], w[1], w[2])
	}
}
