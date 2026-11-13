package himap

import (
	"fmt"
	"math"
)

type tuileTerrain struct {
	X, Y     int
	Hauteurs []byte
}
type parametresTerrain struct {
	Resolution int
	Pas        [2]float64
	Origine    [3]float64
	Amplitude  float64
	Materiau   uint32
}

// assembleTerrain partage les sommets des bords entre les tuiles adjacentes.
func assembleTerrain(tuiles []tuileTerrain, p parametresTerrain) (GroupeMaillage, error) {
	g := GroupeMaillage{Indices: map[uint32][]uint32{}}
	if p.Resolution < 1 || p.Pas[0] <= 0 || p.Pas[1] <= 0 {
		return g, fmt.Errorf("terrain : grille invalide")
	}
	sommets := map[[2]int]uint32{}
	for _, tuile := range tuiles {
		n := p.Resolution + 1
		if len(tuile.Hauteurs) != n*n*2 {
			return g, fmt.Errorf("terrain : tuile %d,%d de %d octets", tuile.X, tuile.Y, len(tuile.Hauteurs))
		}
		for y := 0; y < n; y++ {
			for x := 0; x < n; x++ {
				cle := [2]int{tuile.X*p.Resolution + x, tuile.Y*p.Resolution + y}
				if _, ok := sommets[cle]; ok {
					continue
				}
				ix := uint32(len(g.Sommets) / 3)
				sommets[cle] = ix
				z := p.Origine[2] + p.Amplitude*float64(u16(tuile.Hauteurs, 2*((p.Resolution-y)*n+x)))/65535
				wx, wy := p.Origine[0]+float64(cle[0])*p.Pas[0], p.Origine[1]+float64(cle[1])*p.Pas[1]
				g.Sommets = append(g.Sommets, float32(wx), float32(wy), float32(z))
				for j := range g.UV {
					g.UV[j] = append(g.UV[j], float32(wx), float32(wy))
				}
			}
		}
		// shortcut: masque de trous non decode, lire son format pour decouper le terrain.
		for y := 0; y < p.Resolution; y++ {
			for x := 0; x < p.Resolution; x++ {
				gx, gy := tuile.X*p.Resolution+x, tuile.Y*p.Resolution+y
				a, b, c, d := sommets[[2]int{gx, gy}], sommets[[2]int{gx + 1, gy}], sommets[[2]int{gx, gy + 1}], sommets[[2]int{gx + 1, gy + 1}]
				g.Indices[p.Materiau] = append(g.Indices[p.Materiau], a, b, d, a, d, c)
			}
		}
	}
	g.Normales = normalesTerrain(g.Sommets, g.Indices[p.Materiau])
	return g, nil
}

func normalesTerrain(s []float32, indices []uint32) []float32 {
	n := make([]float32, len(s))
	for i := 0; i+2 < len(indices); i += 3 {
		a, b, c := int(indices[i])*3, int(indices[i+1])*3, int(indices[i+2])*3
		ux, uy, uz := s[b]-s[a], s[b+1]-s[a+1], s[b+2]-s[a+2]
		vx, vy, vz := s[c]-s[a], s[c+1]-s[a+1], s[c+2]-s[a+2]
		x, y, z := uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx
		for _, j := range []int{a, b, c} {
			n[j] += x
			n[j+1] += y
			n[j+2] += z
		}
	}
	for i := 0; i < len(n); i += 3 {
		d := float32(math.Sqrt(float64(n[i]*n[i] + n[i+1]*n[i+1] + n[i+2]*n[i+2])))
		if d > 0 {
			n[i] /= d
			n[i+1] /= d
			n[i+2] /= d
		}
	}
	return n
}
