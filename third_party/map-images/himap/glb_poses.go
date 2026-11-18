// Package himap — glb_poses.go (LOCAL-CHANGE (infinite-theater-3d)): a variant layer's
// placements in the GLB (maillage_variante_poses.go).
//
// Each geometry's vertices and indices are written once. A glTF mesh is one geometry under one
// material per index list; placements whose materials agree share it, and every primitive of a
// geometry reads the same vertex accessors, whatever its mesh. A placement is a node naming that
// mesh with its pose as a matrix (glTF axes). A kit piece is a child node of an unnamed node
// carrying its object's pose: the piece's own pose stays a separate matrix, so the product of a
// non-uniform object scale and a turned piece (a shear no single TRS holds) is composed by the
// reader. Nodes are named after their group (`structure`, `ombre`), as the soup's two nodes were.
package himap

import (
	"fmt"
	"strings"
)

// geometrieGLB is a geometry's accessors once written: its vertex attributes, and its index
// lists by key (GeometrieVariante) in key order.
type geometrieGLB struct {
	attributs map[string]int
	cles      []uint32
	indices   []int
}

// ajoutePosesVariante writes the placements of `pv` (nil: nothing) as nodes on shared meshes.
func ajoutePosesVariante(doc *gltfDoc, bin *tamponGLB, pv *PosesVariante, rangMateriau func(uint32) int) {
	if pv == nil || len(pv.Poses) == 0 {
		return
	}
	ecrites := make([]*geometrieGLB, len(pv.Geometries))
	meshes := map[string]int{}
	parents := map[int]int{}
	for _, p := range pv.Poses {
		g := &pv.Geometries[p.Geometrie]
		if ecrites[p.Geometrie] == nil {
			attributs := ecritSommetsGroupe(doc, bin, &g.Maillage)
			cles, indices := ecritIndicesGroupe(doc, bin, &g.Maillage)
			ecrites[p.Geometrie] = &geometrieGLB{attributs: attributs, cles: cles, indices: indices}
		}
		mesh := meshDePose(doc, pv, p, ecrites[p.Geometrie], rangMateriau, meshes)
		noeud := gltfNode{Name: nomGroupePose(g.Ombre), Mesh: &mesh}
		// LOCAL-CHANGE: optional Forge object identity for diagnostic builds.
		if p.Objet >= 0 && p.Objet < len(pv.DebugObjects) {
			o := pv.DebugObjects[p.Objet]
			noeud.Name = fmt.Sprintf("%s mvar=%d type=%d", noeud.Name, o.Index, o.TypeID)
		}
		if p.Locale == nil {
			noeud.Matrix = matriceGLTF(p.Parent)
			doc.Nodes = append(doc.Nodes, noeud)
			continue
		}
		parent, ok := parents[p.Objet]
		if !ok {
			parent = len(doc.Nodes)
			parents[p.Objet] = parent
			doc.Nodes = append(doc.Nodes, gltfNode{Matrix: matriceGLTF(p.Parent)})
		}
		noeud.Matrix = matriceGLTF(*p.Locale)
		doc.Nodes = append(doc.Nodes, noeud)
		doc.Nodes[parent].Children = append(doc.Nodes[parent].Children, len(doc.Nodes)-1)
	}
}

// nomGroupePose names a placement's node after its group (the view hides `ombre*` nodes).
func nomGroupePose(ombre bool) string {
	if ombre {
		return "ombre"
	}
	return "structure"
}

// meshDePose returns the glTF mesh of a placement: its geometry's index lists, each under the
// material the placement draws for it, written the first time this combination occurs.
func meshDePose(doc *gltfDoc, pv *PosesVariante, p PoseVariante, g *geometrieGLB, rangMateriau func(uint32) int, meshes map[string]int) int {
	ids := make([]uint32, len(g.cles))
	var cle strings.Builder
	fmt.Fprintf(&cle, "%d", p.Geometrie)
	for k, c := range g.cles {
		ids[k] = pv.materiauDe(p, c)
		fmt.Fprintf(&cle, ":%d", ids[k])
	}
	if i, ok := meshes[cle.String()]; ok {
		return i
	}
	mesh := gltfMesh{Name: nomGroupePose(pv.Geometries[p.Geometrie].Ombre)}
	for k, id := range ids {
		mesh.Primitives = append(mesh.Primitives, gltfPrimitive{
			Attributes: g.attributs, Indices: g.indices[k], Material: rangMateriau(id), Mode: glTriangles,
		})
	}
	doc.Meshes = append(doc.Meshes, mesh)
	meshes[cle.String()] = len(doc.Meshes) - 1
	return len(doc.Meshes) - 1
}

// matriceGLTF returns the pose `in` (Instance.LocalToWorld, Halo axes) as a column-major glTF
// matrix in glTF axes. With C(x, y, z) = (x, z, -y), the glTF matrix is C·M·C⁻¹: its columns are
// C of the forward column, C of the up column, minus C of the left column, and C of the position.
func matriceGLTF(in Instance) *[16]float32 {
	c := func(v [3]float64, s float64) [3]float32 {
		return [3]float32{float32(v[0] * s), float32(v[2] * s), float32(-v[1] * s)}
	}
	colonnes := [4][3]float32{
		c(in.Forward, in.Scale[0]),
		c(in.Up, in.Scale[2]),
		c(in.Left, -in.Scale[1]),
		c(in.Position, 1),
	}
	var m [16]float32
	for j, col := range colonnes {
		copy(m[4*j:4*j+3], col[:])
	}
	m[15] = 1
	return &m
}
