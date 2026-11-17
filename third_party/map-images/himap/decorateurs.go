// Package himap — decorateurs.go : the meshes of a `dcrt` (decorator runtime) tag, the grass
// clumps and small plants a terrain scatters (LOCAL-CHANGE (infinite-theater-3d)).
//
// A `dcrt` carries a render geometry like a `mode` (sections @0x130, bounding boxes @0x158,
// mesh resource groups @0x1B4) and its material list @0x100 (28-byte tag references). It has no
// separate resource: its buffers are the data blocks of the tag's third section, one block per
// buffer, vertex buffers first then index buffers, in descriptor order. Positions are format 13:
// one u32 per vertex, three 10-bit fields (x, y, z) dequantized between the bounding box's bounds.
// Texture coordinates are the usual format 9 (two u16 between the box's UV bounds).
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"encoding/binary"
	"fmt"
)

const (
	GroupeDecorateur          = "dcrt"
	dcrtOffMateriaux          = 0x100
	dcrtOffSections           = 0x130
	dcrtOffBoundingBoxes      = 0x158
	dcrtOffMeshResourceGroups = 0x1b4
	vertexFormatPosition10    = 13
	dcrtMax10Bits             = 1023
)

// MaillageDecorateur is one decorator mesh at its finest level of detail, in its local frame
// (Halo units, z up), with the GlobalIDs of the materials its parts name.
type MaillageDecorateur struct {
	Maillage  *Mesh
	Materiaux []uint32
}

func dcrtGeoFromTagInfo(ti tagInfo) (RuntimeGeo, error) {
	offs, targets, err := ti.rootBlockRefs()
	if err != nil {
		return RuntimeGeo{}, err
	}
	par := map[int]int{}
	for i, o := range offs {
		par[o] = targets[i]
	}
	sections, ok := par[dcrtOffSections]
	if !ok {
		return RuntimeGeo{}, fmt.Errorf("himap: dcrt without sections")
	}
	absS, sizeS := ti.blockAbs(sections)
	if absS < 0 || sizeS <= 0 || sizeS%sectionStride != 0 || absS+sizeS > len(ti.tag) {
		return RuntimeGeo{}, fmt.Errorf("himap: dcrt sections of size %d", sizeS)
	}
	absB, err := premiereBoite(ti, par, dcrtOffBoundingBoxes)
	if err != nil {
		return RuntimeGeo{}, err
	}
	return RuntimeGeo{MeshCount: sizeS / sectionStride, PerMeshAbs: -1, BoundsAbs: absB, SectionsTarget: sections,
		BoundingBoxesTarget: par[dcrtOffBoundingBoxes], ResourceGroupsTarget: par[dcrtOffMeshResourceGroups]}, nil
}

// LitDecorateur decodes the meshes of a `dcrt` tag.
func LitDecorateur(idx *ModuleIndex, id uint32) ([]MaillageDecorateur, error) {
	mod, file, ok := idx.entree(id)
	if !ok || file.Group != GroupeDecorateur {
		return nil, fmt.Errorf("himap: decorator %08x absent", id)
	}
	tag, err := mod.Extract(file)
	if err != nil {
		return nil, err
	}
	return decodeDecorateur(tag)
}

func decodeDecorateur(tag []byte) ([]MaillageDecorateur, error) {
	a, err := nouvelAsset(tag, nil, dcrtGeoFromTagInfo, GroupeDecorateur)
	if err != nil {
		return nil, err
	}
	// The buffers are the third section's blocks in descriptor order: rebuild the blob and the
	// descriptors' offsets from them.
	var blocs [][]byte
	for b := 0; b < a.info.dataBlocks; b++ {
		if u16(tag, a.info.blockTab+b*blockEntrySize+6) != sectionRessource {
			continue
		}
		abs, size := a.info.blockAbsSection(b)
		if abs < 0 || abs+size > len(tag) {
			return nil, fmt.Errorf("himap: dcrt buffer outside the tag")
		}
		blocs = append(blocs, tag[abs:abs+size])
	}
	if len(blocs) < len(a.vertexDescs)+len(a.indexDescs) {
		return nil, fmt.Errorf("himap: dcrt %d buffers for %d descriptors", len(blocs), len(a.vertexDescs)+len(a.indexDescs))
	}
	var blob []byte
	place := func(d *bufferDesc, bloc []byte) error {
		if len(bloc) != d.Size {
			return fmt.Errorf("himap: dcrt buffer of %d bytes for %d", len(bloc), d.Size)
		}
		d.Offset = len(blob)
		blob = append(blob, bloc...)
		return nil
	}
	for i := range a.vertexDescs {
		if err := place(&a.vertexDescs[i], blocs[i]); err != nil {
			return nil, err
		}
	}
	for j := range a.indexDescs {
		if err := place(&a.indexDescs[j], blocs[len(a.vertexDescs)+j]); err != nil {
			return nil, err
		}
	}
	a.blob = blob
	materiaux := a.info.materiauxDecorateur()
	var out []MaillageDecorateur
	for k := 0; k < a.geo.MeshCount; k++ {
		if m := a.maillageDecorateur(k, trianglesMaxDecorateur); m != nil {
			out = append(out, MaillageDecorateur{Maillage: m, Materiaux: materiaux})
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("himap: dcrt without a readable mesh")
	}
	return out, nil
}

// trianglesMaxDecorateur : a scattered clump is drawn tens of thousands of times; the finest
// level of detail at or under this many triangles is kept (the coarsest when none is).
const trianglesMaxDecorateur = 48

// maillageDecorateur decodes a mesh with 10-bit positions at the finest level of detail with at
// most maxTris triangles.
func (a *RuntimeGeoAsset) maillageDecorateur(k, maxTris int) *Mesh {
	lods := a.lods(k)
	if len(lods) == 0 {
		return nil
	}
	l := lods[len(lods)-1]
	for _, c := range lods {
		if c.indexBuf >= 0 && c.indexBuf < len(a.indexDescs) && a.indexDescs[c.indexBuf].Count/3 <= maxTris {
			l = c
			break
		}
	}
	if l.vertexBuf < 0 || l.vertexBuf >= len(a.vertexDescs) || l.indexBuf < 0 || l.indexBuf >= len(a.indexDescs) {
		return nil
	}
	vd, id := a.vertexDescs[l.vertexBuf], a.indexDescs[l.indexBuf]
	if vd.Usage != vertexFormatPosition10 || vd.Stride != 4 || vd.Offset+vd.Size > len(a.blob) || id.Offset+id.Size > len(a.blob) {
		return nil
	}
	mn, mx, ok := a.bounds(k)
	if !ok {
		return nil
	}
	verts := make([][3]float64, vd.Count)
	for i := range verts {
		v := binary.LittleEndian.Uint32(a.blob[vd.Offset+4*i:])
		for ax := 0; ax < 3; ax++ {
			q := float64((v >> (10 * ax)) & dcrtMax10Bits)
			verts[i][ax] = mn[ax] + q/dcrtMax10Bits*(mx[ax]-mn[ax])
		}
	}
	tris, gardes := a.triangles(id, len(verts))
	return &Mesh{Vertices: verts, Triangles: tris, Parts: a.parts(l, gardes, len(tris)), UV: a.uvs(l, len(verts))}
}

// materiauxDecorateur reads the material list (28-byte tag references).
func (ti tagInfo) materiauxDecorateur() []uint32 {
	rb, err := ti.rootBlockIndex()
	if err != nil {
		return nil
	}
	b := ti.subBlockTarget(rb, dcrtOffMateriaux)
	if b < 0 {
		return nil
	}
	a, n := ti.blockAbs(b)
	if a < 0 || a+n > len(ti.tag) {
		return nil
	}
	var out []uint32
	for o := 0; o+28 <= n; o += 28 {
		out = append(out, idReference(ti.tag, a+o))
	}
	return out
}
