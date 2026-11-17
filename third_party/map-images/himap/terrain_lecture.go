package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"fmt"
	"math"

	"github.com/JGtm/halo-infinite-files-reader/himodule"
)

// Schema : https://github.com/Z-15/Halo-Infinite-Tag-Editor/blob/master/Halo-Infinite-Tag-Editor/Tag_Structures/rtrn.xml
const (
	terrainChampScenario = 0x664
	terrainPasScenario   = 164
	terrainChampNoeuds   = 0x98
	terrainPasNoeud      = 112
	terrainChampImages   = 60
	terrainTrianglesMax  = 1500000
)

type referenceTerrain struct {
	ID    uint32
	Cadre [4]float64
}
type sourceTerrain struct {
	info                tagInfo
	blocNoeuds          int
	resolution, niveaux int
	position, taille    [3]float64
	bitmap              uint32
}

func terrainsDuScenario(chemin string) ([]referenceTerrain, error) {
	m, err := himodule.Open(chemin)
	if err != nil {
		return nil, err
	}
	defer m.Close()
	fs := m.Files(GroupeNiveau)
	if len(fs) == 0 {
		return nil, nil
	}
	if len(fs) != 1 {
		return nil, fmt.Errorf("terrain: %d scenarios", len(fs))
	}
	tag, err := m.Extract(fs[0])
	if err != nil {
		return nil, err
	}
	ti, err := meilleurTagInfo(tag)
	if err != nil {
		return nil, err
	}
	root, err := ti.rootBlockIndex()
	if err != nil {
		return nil, err
	}
	a, n := ti.blockAbs(root)
	if n < terrainChampScenario+20 {
		return nil, nil
	}
	count := u32(tag, a+terrainChampScenario+16)
	if count == 0 {
		return nil, nil
	}
	target := ti.subBlockTarget(root, terrainChampScenario)
	if target < 0 {
		return nil, fmt.Errorf("terrain: scenario block absent")
	}
	b, size := ti.blockAbs(target)
	if b < 0 || count > size/terrainPasScenario || b+size > len(tag) {
		return nil, fmt.Errorf("terrain: invalid scenario block")
	}
	out := make([]referenceTerrain, 0, count)
	for i := 0; i < count; i++ {
		o := b + i*terrainPasScenario
		id := idReference(tag, o+0x74)
		if id == 0 {
			continue
		}
		cx, cy := f32(tag, o+0x48), f32(tag, o+0x4c)
		ex, ey := f32(tag, o+0x54), f32(tag, o+0x58)
		out = append(out, referenceTerrain{ID: id, Cadre: [4]float64{cx - ex, cy - ey, cx + ex, cy + ey}})
	}
	return out, nil
}

func ouvreTerrain(idx *ModuleIndex, id uint32) (sourceTerrain, error) {
	var s sourceTerrain
	group, _, ok := idx.Lookup(id)
	if !ok || group != "rtrn" {
		return s, fmt.Errorf("terrain %08x absent", id)
	}
	tag, err := idx.Extract(id)
	if err != nil {
		return s, err
	}
	ti, err := meilleurTagInfo(tag)
	if err != nil {
		return s, err
	}
	root, err := ti.rootBlockIndex()
	if err != nil {
		return s, err
	}
	a, n := ti.blockAbs(root)
	if n < 0xac {
		return s, fmt.Errorf("terrain %08x short root", id)
	}
	s.info = ti
	s.blocNoeuds = ti.subBlockTarget(root, terrainChampNoeuds)
	s.bitmap = idReference(tag, a+0x10)
	s.resolution = u32(tag, a+0x78)
	s.niveaux = int(u16(tag, a+0x7c))
	for i := 0; i < 3; i++ {
		s.position[i] = f32(tag, a+0x80+i*4)
		s.taille[i] = f32(tag, a+0x8c+i*4)
	}
	if s.blocNoeuds < 0 || s.bitmap == 0 || s.resolution < 1 || s.resolution > 1024 || s.niveaux < 1 || s.niveaux > 10 || s.taille[0] <= 0 || s.taille[1] <= 0 || s.taille[2] <= 0 {
		return s, fmt.Errorf("terrain %08x invalid parameters", id)
	}
	return s, nil
}

func cadreTerrain(ref, frame [4]float64) ([4]float64, error) {
	c := ref
	if frame[2] > frame[0] && frame[3] > frame[1] {
		c = [4]float64{math.Max(c[0], frame[0]), math.Max(c[1], frame[1]), math.Min(c[2], frame[2]), math.Min(c[3], frame[3])}
	}
	if c[2] <= c[0] || c[3] <= c[1] {
		return c, nil
	}
	for _, v := range c {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return c, fmt.Errorf("terrain: invalid frame")
		}
	}
	return c, nil
}
