package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"errors"
	"fmt"
	"math"
)

var errTerrainNoeudAbsent = errors.New("terrain: node without image")

type plageTerrain struct {
	niveau, x0, x1, y0, y1 int
	origine, pas           [2]float64
}

func choisitPlageTerrain(s sourceTerrain, cadre [4]float64) (plageTerrain, error) {
	var p plageTerrain
	p.origine = [2]float64{s.position[0] - s.taille[0]/2, s.position[1] - s.taille[1]/2}
	for niveau := s.niveaux - 1; niveau >= 0; niveau-- {
		cote := 1 << uint(niveau)
		dx, dy := s.taille[0]/float64(cote), s.taille[1]/float64(cote)
		x0 := max(0, int(math.Floor((cadre[0]-p.origine[0])/dx)))
		x1 := min(cote-1, int(math.Floor((cadre[2]-p.origine[0])/dx)))
		y0 := max(0, int(math.Floor((cadre[1]-p.origine[1])/dy)))
		y1 := min(cote-1, int(math.Floor((cadre[3]-p.origine[1])/dy)))
		if x1 < x0 || y1 < y0 {
			p.x1 = -1
			return p, nil
		}
		n := int64(x1-x0+1) * int64(y1-y0+1) * int64(s.resolution) * int64(s.resolution) * 2
		if n <= terrainTrianglesMax {
			p.niveau, p.x0, p.x1, p.y0, p.y1 = niveau, x0, x1, y0, y1
			p.pas = [2]float64{dx / float64(s.resolution), dy / float64(s.resolution)}
			return p, nil
		}
	}
	return p, fmt.Errorf("terrain: triangle budget exceeded")
}

func litTuilesTerrain(idx *ModuleIndex, s sourceTerrain, p plageTerrain) ([]tuileTerrain, []int, error) {
	mod, file, ok := idx.entree(s.bitmap)
	if !ok || file.Group != GroupeBitmap {
		return nil, nil, fmt.Errorf("terrain: bitmap %08x absent", s.bitmap)
	}
	tag, err := mod.Extract(file)
	if err != nil {
		return nil, nil, err
	}
	ent, err := litEnteteBitmap(tag)
	if err != nil {
		return nil, nil, err
	}
	if ent.format != 32 || ent.larg != s.resolution+1 || ent.haut != s.resolution+1 {
		return nil, nil, fmt.Errorf("terrain: bitmap %08x format=%d size=%dx%d", s.bitmap, ent.format, ent.larg, ent.haut)
	}
	resources, err := mod.Ressources(file)
	if err != nil {
		return nil, nil, err
	}
	a, size := s.info.blockAbs(s.blocNoeuds)
	count := size / terrainPasNoeud
	if a < 0 || a+size > len(s.info.tag) {
		return nil, nil, fmt.Errorf("terrain: invalid nodes")
	}
	cote := 1 << uint(p.niveau)
	premier := (cote*cote - 1) / 3
	var out []tuileTerrain
	var nodes []int
	for y := p.y0; y <= p.y1; y++ {
		for x := p.x0; x <= p.x1; x++ {
			node := premier + y*cote + x
			if node >= count {
				return nil, nil, fmt.Errorf("terrain: node %d absent", node)
			}
			b := s.info.subBlockTarget(s.blocNoeuds, node*terrainPasNoeud+terrainChampImages)
			if b < 0 {
				return nil, nil, fmt.Errorf("%w: %d", errTerrainNoeudAbsent, node)
			}
			pos, n := s.info.blockAbs(b)
			if pos < 0 || n < 4 || pos+n > len(s.info.tag) {
				return nil, nil, fmt.Errorf("terrain: node %d images invalid", node)
			}
			k := u32(s.info.tag, pos)
			if k >= len(resources) {
				return nil, nil, fmt.Errorf("terrain: image %d absent", k)
			}
			data, err := mod.Extract(resources[k])
			if err != nil {
				return nil, nil, err
			}
			data = resources[k].Donnees(data)
			out = append(out, tuileTerrain{X: x, Y: y, Hauteurs: data})
			nodes = append(nodes, node)
		}
	}
	return out, nodes, nil
}
