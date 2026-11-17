// Package himap — modele_particule.go (LOCAL-CHANGE (infinite-theater-3d)): the geometry of a
// particle model (`pmdf`), the mesh a model particle draws (the Shock Rifle's electric shell).
//
// A `pmdf` root carries the same render geometry struct as a `mode` (Sections of 60 o, their
// SectionLodBlock of 148 o, a compression-info record of bounds, mesh resource groups), 152 o
// earlier: Sections at +40, compression info at +80, resource groups at +172 (the mode's 192,
// 232 and 324). Measured on the Shock Rifle's particle models 3c8e80bc, 1338bc59 and 1ed87b61:
// the block map of 1338bc59 hangs its resource groups on +172 and its five vertex buffers in
// the resource section.
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"context"
	"encoding/binary"
	"fmt"
)

// GroupeModeleParticule: the particle model tag group.
const GroupeModeleParticule = "pmdf"

// Offsets of the render geometry fields in a `pmdf` root.
const (
	pmdfOffSections           = 40
	pmdfOffBoundingBoxes      = 80
	pmdfOffMeshResourceGroups = 172
)

// pmdfGeoFromTagInfo decodes a `pmdf` root the way modeGeoFromTagInfo decodes a `mode` one.
func pmdfGeoFromTagInfo(ti tagInfo) (RuntimeGeo, error) {
	offs, targets, err := ti.rootBlockRefs()
	if err != nil {
		return RuntimeGeo{}, err
	}
	parOffset := map[int]int{}
	for i, o := range offs {
		parOffset[o] = targets[i]
	}
	sections, ok := parOffset[pmdfOffSections]
	if !ok {
		return RuntimeGeo{}, fmt.Errorf("himap: pmdf without Sections at offset %d (offsets seen: %v)", pmdfOffSections, offs)
	}
	absS, sizeS := ti.blockAbs(sections)
	if absS < 0 || sizeS <= 0 || sizeS%sectionStride != 0 || absS+sizeS > len(ti.tag) {
		return RuntimeGeo{}, fmt.Errorf("himap: pmdf, Sections block of size %d not a multiple of %d", sizeS, sectionStride)
	}
	absB, err := premiereBoite(ti, parOffset, pmdfOffBoundingBoxes)
	if err != nil {
		return RuntimeGeo{}, err
	}
	return RuntimeGeo{
		MeshCount:            sizeS / sectionStride,
		PerMeshAbs:           -1,
		BoundsAbs:            absB,
		SectionsTarget:       sections,
		BoundingBoxesTarget:  parOffset[pmdfOffBoundingBoxes],
		ResourceGroupsTarget: parOffset[pmdfOffMeshResourceGroups],
	}, nil
}

// vertexDescOffDonnees: in a vertex descriptor record (vertexDescStride), the data reference
// to its buffer when the buffer lives in the tag itself (a `pmdf` has no external resource: its
// descriptor table, 5 records, points at +36 + 80 k to its five buffers in the tag's resource
// section).
const vertexDescOffDonnees = 36

// NewParticleModelAsset assembles the meshes of a `pmdf` tag. Without an external resource blob,
// the vertex buffers the descriptor table references inside the tag are laid end to end into
// one, and the descriptors are pointed at it.
func NewParticleModelAsset(tag, resourceBlob []byte) (*RuntimeGeoAsset, error) {
	a, err := nouvelAsset(tag, resourceBlob, pmdfGeoFromTagInfo, GroupeModeleParticule)
	if err != nil || len(resourceBlob) > 0 || len(a.vertexDescs) == 0 {
		return a, err
	}
	for bi := 0; bi < a.info.dataBlocks; bi++ {
		_, size := a.info.blockAbs(bi)
		if size != len(a.vertexDescs)*vertexDescStride {
			continue
		}
		donnees := a.info.donneesDuChamp(bi)
		var blob []byte
		descs := append([]bufferDesc(nil), a.vertexDescs...)
		ok := true
		for k := range descs {
			b, lu := donnees[k*vertexDescStride+vertexDescOffDonnees]
			if !lu || len(b) != descs[k].Size {
				ok = false
				break
			}
			descs[k].Offset = len(blob)
			blob = append(blob, b...)
		}
		if ok {
			a.blob, a.vertexDescs = blob, descs
			return a, nil
		}
	}
	return a, nil
}

// ModeleParticule is a particle model's mesh, in its own axes (Halo: X forward, Z up).
type ModeleParticule struct {
	Sommets   [][3]float64
	UV        [][2]float32
	Triangles [][3]int
}

// ModeleDeParticule reads the particle model `id`: every mesh of it, merged.
func (a *Arsenal) ModeleDeParticule(ctx context.Context, id uint32) (*ModeleParticule, error) {
	if g, _, ok := a.geo.Lookup(id); !ok || g != GroupeModeleParticule {
		return nil, fmt.Errorf("himap: %08x is not a pmdf", id)
	}
	tag, blob, err := a.geo.ExtractWithResources(id)
	if err != nil {
		return nil, err
	}
	asset, err := NewParticleModelAsset(tag, blob)
	if err != nil {
		return nil, err
	}
	out := &ModeleParticule{}
	for k := 0; k < asset.MeshCount(); k++ {
		lods := asset.lods(k)
		if len(lods) == 0 {
			continue
		}
		l := lods[0]
		if l.vertexBuf < 0 || l.vertexBuf >= len(asset.vertexDescs) {
			continue
		}
		vd := asset.vertexDescs[l.vertexBuf]
		mn, mx, okB := asset.bounds(k)
		if vd.Usage != vertexUsagePosition || vd.Stride != vertexStridePosition || !okB || vd.Offset+vd.Size > len(asset.blob) {
			continue
		}
		base := len(out.Sommets)
		for i := 0; i < vd.Count; i++ {
			r := asset.blob[vd.Offset+i*vertexStridePosition:]
			var p [3]float64
			for ax := 0; ax < 3; ax++ {
				p[ax] = DequantBrut(binary.LittleEndian.Uint16(r[ax*2:]), mn[ax], mx[ax])
			}
			out.Sommets = append(out.Sommets, p)
		}
		uv := asset.uv(l, 0, vd.Count)
		for i := 0; i < vd.Count; i++ {
			if i < len(uv) {
				out.UV = append(out.UV, uv[i])
			} else {
				out.UV = append(out.UV, [2]float32{})
			}
		}
		// No index buffer and an index buffer type of 3 (triangle list): the vertices in order,
		// three per triangle.
		for i := 0; i+2 < vd.Count; i += 3 {
			out.Triangles = append(out.Triangles, [3]int{base + i, base + i + 1, base + i + 2})
		}
	}
	if len(out.Triangles) == 0 {
		return nil, fmt.Errorf("himap: pmdf %08x without a readable triangle", id)
	}
	_ = ctx
	return out, nil
}
