// Package himap — glb_decorateurs.go : scattered decorators as GPU instances
// (LOCAL-CHANGE (infinite-theater-3d), see decorateurs_pose.go).
//
// Each carpet is one mesh and one node carrying EXT_mesh_gpu_instancing: per clump a
// TRANSLATION, a ROTATION (quaternion about the up axis) and a uniform SCALE, in glTF axes.
package himap

import (
	"encoding/binary"
	"math"
)

const extInstancing = "EXT_mesh_gpu_instancing"

func ajouteDecorateurs(doc *gltfDoc, bin *tamponGLB, tapis []TapisDecorateur, rangMateriau func(uint32) int) {
	ajoute := false
	for i := range tapis {
		t := &tapis[i]
		n := len(t.Positions)
		if n == 0 || t.Maillage.Triangles() == 0 || len(t.Lacets) != n || len(t.Echelles) != n {
			continue
		}
		avant := len(doc.Nodes)
		ajouteGroupe(doc, bin, t.Nom, &t.Maillage, rangMateriau)
		if len(doc.Nodes) == avant {
			continue
		}
		translations := make([][3]float32, n)
		rotations := make([][4]float32, n)
		echelles := make([][3]float32, n)
		for k, p := range t.Positions {
			// Halo (x, y, z up) to glTF (x, z, -y): a turn about Halo z is a turn about glTF y.
			translations[k] = [3]float32{p[0], p[2], -p[1]}
			s, c := math.Sincos(float64(t.Lacets[k]) / 2)
			rotations[k] = [4]float32{0, float32(s), 0, float32(c)}
			e := t.Echelles[k]
			echelles[k] = [3]float32{e, e, e}
		}
		attrs := map[string]int{
			"TRANSLATION": accesseurInstances(doc, bin, translations, "VEC3"),
			"ROTATION":    accesseurInstances(doc, bin, rotations, "VEC4"),
			"SCALE":       accesseurInstances(doc, bin, echelles, "VEC3"),
		}
		doc.Nodes[len(doc.Nodes)-1].Extensions = map[string]any{extInstancing: map[string]any{"attributes": attrs}}
		ajoute = true
	}
	if ajoute {
		doc.ExtUsed = append(doc.ExtUsed, extInstancing)
	}
}

func accesseurInstances[T [3]float32 | [4]float32](doc *gltfDoc, bin *tamponGLB, v []T, typ string) int {
	debut := bin.Len()
	_ = binary.Write(bin, binary.LittleEndian, v)
	bin.aligne4()
	doc.BufferViews = append(doc.BufferViews, gltfBufferView{ByteOffset: debut, ByteLength: bin.Len() - debut})
	doc.Accessors = append(doc.Accessors, gltfAccessor{BufferView: len(doc.BufferViews) - 1, ComponentType: glComponentF32, Count: len(v), Type: typ})
	return len(doc.Accessors) - 1
}
