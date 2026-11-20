//go:build gamefiles

package himap

// LOCAL-CHANGE (infinite-theater-3d): geometry_normales.go, on the installed game.

import (
	"context"
	"math"
	"path/filepath"
	"testing"
)

// accordNormales compares a group's normals with the area-weighted normal of the triangles each
// vertex belongs to: the mean dot, and the share of vertices within 30 degrees.
func accordNormales(g *GroupeMaillage) (moyenne, proches float64, n int) {
	geo := make([][3]float64, len(g.Sommets)/3)
	s := func(i uint32) [3]float64 {
		return [3]float64{float64(g.Sommets[3*i]), float64(g.Sommets[3*i+1]), float64(g.Sommets[3*i+2])}
	}
	for _, ix := range g.Indices {
		for t := 0; t+2 < len(ix); t += 3 {
			p0, p1, p2 := s(ix[t]), s(ix[t+1]), s(ix[t+2])
			c := produitVectoriel([3]float64{p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]}, [3]float64{p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]})
			for _, k := range ix[t : t+3] {
				for a := 0; a < 3; a++ {
					geo[k][a] += c[a]
				}
			}
		}
	}
	somme, bons := 0.0, 0
	for k, v := range geo {
		l := math.Sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2])
		if l == 0 {
			continue
		}
		d := (float64(g.Normales[3*k])*v[0] + float64(g.Normales[3*k+1])*v[1] + float64(g.Normales[3*k+2])*v[2]) / l
		somme += d
		if d > math.Cos(math.Pi/6) {
			bons++
		}
		n++
	}
	return somme / float64(n), float64(bons) / float64(n), n
}

// TestNormalesDuJeu: the Spartan's default armor and the BR75 (weap 0x2B1824D5) carry the game's
// normals on every vertex, and they agree with the surfaces (measured 2026-11-19 on the Spartan's
// whole `mode`: mean dot 0.86, 73% within 30 degrees; the rest are authored bends).
func TestNormalesDuJeu(t *testing.T) {
	racine, err := DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	levels, err := LevelsDir("pc")
	if err != nil {
		t.Skip(err)
	}
	a, err := OuvreArsenal(racine, filepath.Join(levels, "sgh_blueprint", "sgh_blueprint-rtx-new.module"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = a.Close() }()
	ctx := context.Background()
	spartan, err := a.ModeleAPeau(ctx, ModeSpartan)
	if err != nil {
		t.Fatal(err)
	}
	arme, err := a.Arme(ctx, 0x2B1824D5)
	if err != nil {
		t.Fatal(err)
	}
	for nom, g := range map[string]*GroupeMaillage{"spartan": &spartan.Maillage.Structure, "br75": &arme.Structure} {
		if len(g.Normales) != len(g.Sommets) {
			t.Errorf("%s: %d normal coordinates for %d vertex coordinates", nom, len(g.Normales), len(g.Sommets))
			continue
		}
		moyenne, proches, n := accordNormales(g)
		t.Logf("%s: %d vertices, mean dot %.3f, %.1f%% within 30 degrees", nom, n, moyenne, 100*proches)
		if moyenne < 0.75 || proches < 0.6 {
			t.Errorf("%s: mean dot %.3f, %.1f%% within 30 degrees: the normals no longer follow the surfaces", nom, moyenne, 100*proches)
		}
	}
}
