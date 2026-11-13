//go:build gamefiles

package himap

// sonde_uv_gamefiles_test.go — sonde : tampons de sommets d'un LOD (19 emplacements), format
// et bornes de dequantification des coordonnees de texture.

import (
	"encoding/binary"
	"fmt"
	"math"
	"path/filepath"
	"testing"
)

func TestSondeUV(t *testing.T) {
	root, err := DeployRoot()
	if err != nil {
		t.Skipf("installation absente : %v", err)
	}
	mod := filepath.Join(root, "pc", "levels", "multi", "sgh_blueprint", "sgh_blueprint-rtx-new.module")
	var b BilanCuisson
	idx, bsp, err := ouvreBSPRetenu(&b, OptionsCuisson{RacineDeploy: root, CheminModule: mod})
	if err != nil {
		t.Fatal(err)
	}
	defer func(i *ModuleIndex) { _ = i.Close() }(idx)
	f32 := func(b []byte, o int) float32 { return math.Float32frombits(binary.LittleEndian.Uint32(b[o:])) }
	vus := map[uint32]bool{}
	formats := map[string]int{}
	n := 0
	for _, in := range bsp.Instances {
		id := in.RuntimeGeoID()
		if vus[id] {
			continue
		}
		vus[id] = true
		tag, blob, err := idx.ExtractWithResources(id)
		if err != nil {
			continue
		}
		a, err := NewRuntimeGeoAsset(tag, blob)
		if err != nil {
			continue
		}
		bb := ""
		if c := a.geo.BoundingBoxesTarget; c >= 0 {
			abs, size := a.info.blockAbs(c)
			if abs >= 0 && size >= bboxStride {
				bb = fmt.Sprintf("bbox u[%.3f %.3f] v[%.3f %.3f]", f32(tag, abs+28), f32(tag, abs+32), f32(tag, abs+36), f32(tag, abs+40))
			}
		}
		for mi := 0; mi < a.MeshCount(); mi++ {
			l, ok := a.chooseLOD(mi)
			if !ok {
				continue
			}
			slots := ""
			for s := 0; s < 19; s++ {
				v := int(int16(binary.LittleEndian.Uint16(tag[l.abs+lodOffVertexBuffer+2*s:])))
				if v < 0 || v >= len(a.vertexDescs) {
					continue
				}
				abs := a.info.tag // descripteur brut : usage a +0 (Reclaimer), format a +4
				_ = abs
				d := a.vertexDescs[v]
				slots += fmt.Sprintf(" [%d:fmt%d s%d n%d]", s, d.Usage, d.Stride, d.Count)
				if s == 1 {
					formats[fmt.Sprintf("fmt%d s%d", d.Usage, d.Stride)]++
				}
			}
			if n < 12 {
				pm := a.geo.PerMeshAbs + mi*perMeshStride
				lo, hi := [2]float64{1e9, 1e9}, [2]float64{-1e9, -1e9}
				v1 := int(int16(binary.LittleEndian.Uint16(tag[l.abs+lodOffVertexBuffer+2:])))
				if v1 >= 0 && v1 < len(a.vertexDescs) {
					d := a.vertexDescs[v1]
					for k := 0; k < d.Count && d.Offset+k*d.Stride+4 <= len(blob); k++ {
						for c := 0; c < 2; c++ {
							q := float64(binary.LittleEndian.Uint16(blob[d.Offset+k*d.Stride+2*c:])) / quantMax
							lo[c], hi[c] = min(lo[c], q), max(hi[c], q)
						}
					}
				}
				t.Logf("rtgo %08x maillage %d :%s\n   per-mesh 0x5C.. %.3f %.3f %.3f %.3f | %s | uv brut u[%.3f %.3f] v[%.3f %.3f]",
					id, mi, slots, f32(tag, pm+0x5C), f32(tag, pm+0x60), f32(tag, pm+0x64), f32(tag, pm+0x68), bb, lo[0], hi[0], lo[1], hi[1])
				n++
			}
		}
	}
	t.Logf("formats de l'emplacement UV0 : %v", formats)
}
