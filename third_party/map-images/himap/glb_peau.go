// Package himap — glb_peau.go : un modele a peau en GLB, avec une peau glTF standard.
//
// Le maillage s'ecrit comme celui d'une arme (documentGLB : groupe `structure`, une primitive par
// materiau, rendu neutre), puis :
//
//	os          : un noeud par noeud du squelette, nomme comme le jeu (ModeleAPeau.Noms), enfant de
//	              son parent, en translation / rotation / echelle LOCALES de la pose de repos
//	skins[0]    : les os dans l'ordre du squelette (`joints`, les rangs des influences) et leurs
//	              matrices inverses de liaison lues dans le tag (`inverseBindMatrices`, MAT4)
//	primitives  : JOINTS_0 (VEC4 d'entiers 16 bits) et WEIGHTS_0 (VEC4 flottants, somme 1)
//	scene       : le noeud du maillage, qui reference la peau, et la racine du squelette
//
// Une section rigide est liee a son noeud a poids 1 (peau.go) : tout le modele suit le meme
// squelette, et un lecteur glTF n'en fait qu'un maillage a peau.
//
// AXES : ceux de glb.go, (x, z, -y) du repere Halo, appliques aux os comme aux sommets : C est une
// rotation, la translation devient C.t, le quaternion (x, z, -y, w), une matrice M devient C.M.C^T.
package himap

import (
	"encoding/binary"
	"fmt"
	"io"
	"math"
)

// typeVec4 : le type d'accesseur des influences (quatre os, quatre poids).
const typeVec4 = "VEC4"

// gltfSkin : une peau glTF.
type gltfSkin struct {
	InverseBindMatrices int   `json:"inverseBindMatrices"`
	Joints              []int `json:"joints"`
	Skeleton            *int  `json:"skeleton,omitempty"`
}

// EcritGLBPeau ecrit le modele a peau en GLB, sans animation (EcritGLBPeauAnime).
func EcritGLBPeau(w io.Writer, m *ModeleAPeau, generateur string, extras map[string]any) error {
	return EcritGLBPeauAnime(w, m, nil, generateur, extras)
}

// documentPeau assemble le document du modele a peau ; rend le noeud du premier os (`base`, les os
// suivent dans l'ordre du squelette) et celui de la racine du squelette.
func documentPeau(m *ModeleAPeau, generateur string, extras map[string]any) (*gltfDoc, *tamponGLB, int, int, error) {
	if n := len(m.Maillage.Structure.Sommets) / 3; len(m.Influences) != n {
		return nil, nil, 0, 0, fmt.Errorf("%d influences for %d vertices", len(m.Influences), n)
	}
	if len(m.Noms) != len(m.Noeuds) || len(m.Noeuds) == 0 {
		return nil, nil, 0, 0, fmt.Errorf("skeleton of %d nodes and %d names", len(m.Noeuds), len(m.Noms))
	}
	doc, bin, err := documentGLB(m.Maillage, generateur, extras)
	if err != nil {
		return nil, nil, 0, 0, err
	}
	if len(doc.Nodes) != 1 {
		return nil, nil, 0, 0, fmt.Errorf("a skinned model carries only its structure (%d groups)", len(doc.Nodes))
	}
	joints, poids := ajouteInfluences(doc, bin, m.Influences)
	for i := range doc.Meshes[0].Primitives {
		doc.Meshes[0].Primitives[i].Attributes["JOINTS_0"] = joints
		doc.Meshes[0].Primitives[i].Attributes["WEIGHTS_0"] = poids
	}
	base := len(doc.Nodes)
	racine, err := ajouteOs(doc, m)
	if err != nil {
		return nil, nil, 0, 0, err
	}
	ibm := ajouteMatricesInverses(doc, bin, m.Noeuds)
	skin := gltfSkin{InverseBindMatrices: ibm, Skeleton: &racine}
	for i := range m.Noeuds {
		skin.Joints = append(skin.Joints, base+i)
	}
	doc.Skins = []gltfSkin{skin}
	zero := 0
	doc.Nodes[0].Skin = &zero
	return doc, bin, base, racine, nil
}

// ajouteInfluences verse les os et les poids de chaque sommet ; rend leurs accesseurs.
func ajouteInfluences(doc *gltfDoc, bin *tamponGLB, inf []Influences) (joints, poids int) {
	offOs := bin.Len()
	for _, v := range inf {
		_ = binary.Write(bin, binary.LittleEndian, v.Os)
	}
	doc.BufferViews = append(doc.BufferViews,
		gltfBufferView{ByteOffset: offOs, ByteLength: bin.Len() - offOs, Target: glArrayBuffer})
	joints = len(doc.Accessors)
	doc.Accessors = append(doc.Accessors, gltfAccessor{BufferView: len(doc.BufferViews) - 1,
		ComponentType: glComponentU16, Count: len(inf), Type: typeVec4})
	offPoids := bin.Len()
	for _, v := range inf {
		_ = binary.Write(bin, binary.LittleEndian, v.Poids)
	}
	doc.BufferViews = append(doc.BufferViews,
		gltfBufferView{ByteOffset: offPoids, ByteLength: bin.Len() - offPoids, Target: glArrayBuffer})
	poids = len(doc.Accessors)
	doc.Accessors = append(doc.Accessors, gltfAccessor{BufferView: len(doc.BufferViews) - 1,
		ComponentType: glComponentF32, Count: len(inf), Type: typeVec4})
	return joints, poids
}

// ajouteOs ajoute un noeud par os, a la suite, dans l'ordre du squelette, et rend le rang de la
// racine du squelette. Un squelette sans racine unique, ou dont un parent boucle, est refuse : glTF
// veut un arbre.
func ajouteOs(doc *gltfDoc, m *ModeleAPeau) (int, error) {
	base := len(doc.Nodes)
	for i, n := range m.Noeuds {
		t, q, s := trsGLTF(n)
		doc.Nodes = append(doc.Nodes, gltfNode{Name: m.Noms[i], Translation: &t, Rotation: &q, Scale: &s})
	}
	racine := -1
	for i, n := range m.Noeuds {
		if n.Parent < 0 || n.Parent >= len(m.Noeuds) {
			if racine >= 0 {
				return 0, fmt.Errorf("skeleton with multiple roots (%d and %d)", racine-base, i)
			}
			racine = base + i
			continue
		}
		doc.Nodes[base+n.Parent].Children = append(doc.Nodes[base+n.Parent].Children, base+i)
	}
	if racine < 0 {
		return 0, fmt.Errorf("skeleton without a root")
	}
	for i := range m.Noeuds {
		j, pas := i, 0
		for j >= 0 && j < len(m.Noeuds) && pas <= len(m.Noeuds) {
			j, pas = m.Noeuds[j].Parent, pas+1
		}
		if pas > len(m.Noeuds) {
			return 0, fmt.Errorf("node %d loops back on itself", i)
		}
	}
	return racine, nil
}

// ajouteMatricesInverses verse la matrice inverse de liaison de chaque os (colonnes, axes glTF).
func ajouteMatricesInverses(doc *gltfDoc, bin *tamponGLB, noeuds []Noeud) int {
	off := bin.Len()
	for _, n := range noeuds {
		_ = binary.Write(bin, binary.LittleEndian, matriceInverseGLTF(n))
	}
	doc.BufferViews = append(doc.BufferViews, gltfBufferView{ByteOffset: off, ByteLength: bin.Len() - off})
	doc.Accessors = append(doc.Accessors, gltfAccessor{BufferView: len(doc.BufferViews) - 1,
		ComponentType: glComponentF32, Count: len(noeuds), Type: "MAT4"})
	return len(doc.Accessors) - 1
}

// versGLTF : (x, y, z) Halo -> (x, z, -y) glTF.
func versGLTF(v [3]float64) [3]float32 {
	return [3]float32{float32(v[0]), float32(v[2]), float32(-v[1])}
}

// trsGLTF rend la pose locale d'un noeud en axes glTF ; le quaternion est normalise (un quaternion
// nul vaut l'identite, comme dans quatVersRot).
func trsGLTF(n Noeud) (t [3]float32, q [4]float32, s [3]float32) {
	t = versGLTF(n.Pos)
	x, y, z, w := n.Quat[0], n.Quat[1], n.Quat[2], n.Quat[3]
	if l := math.Sqrt(x*x + y*y + z*z + w*w); l > 1e-9 {
		q = [4]float32{float32(x / l), float32(z / l), float32(-y / l), float32(w / l)}
	} else {
		q = [4]float32{0, 0, 0, 1}
	}
	e := float32(n.Scale)
	return t, q, [3]float32{e, e, e}
}

// matriceInverseGLTF rend C.M.C^T en colonnes : les colonnes Halo (avant, gauche, haut) deviennent
// (C.avant, C.haut, -C.gauche), la translation C.position.
func matriceInverseGLTF(n Noeud) [16]float32 {
	c0, c1, g := versGLTF(n.InvAxes[0]), versGLTF(n.InvAxes[2]), versGLTF(n.InvAxes[1])
	c2 := [3]float32{-g[0], -g[1], -g[2]}
	t := versGLTF(n.InvPos)
	return [16]float32{
		c0[0], c0[1], c0[2], 0,
		c1[0], c1[1], c1[2], 0,
		c2[0], c2[1], c2[2], 0,
		t[0], t[1], t[2], 1,
	}
}
