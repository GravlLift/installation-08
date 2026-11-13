//go:build gamefiles

package himap

// quantification_gamefiles_test.go — temoin : les sommets d'un rtgo se dequantifient dans la
// boite du tag (premier BoundingBoxBlock), pas dans les bornes de rendu de chaque maillage.

import (
	"context"
	"math"
	"path/filepath"
	"testing"
)

// TestQuantificationDansLaBoite : sur Recharge, le sol du fond de l'hydro (instance 2900,
// maillage visible) doit tomber a la hauteur de son projecteur d'ombre (instance 2899), la ou
// les joueurs du film marchent (z 0,07) ; dequantifie dans ses bornes de rendu, il sortait a
// 0,48. Et chaque instance visible doit tenir dans la boite monde que le sbsp lui declare.
func TestQuantificationDansLaBoite(t *testing.T) {
	root, err := DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	mod := filepath.Join(root, "pc", "levels", "multi", "sgh_blueprint", "sgh_blueprint-rtx-new.module")
	chemins, err := GeometrySearchPathMonde(root, mod)
	if err != nil {
		t.Fatal(err)
	}
	var b BilanCuisson
	idx, bsp, err := ouvreBSPDans(&b, OptionsCuisson{RacineDeploy: root, CheminModule: mod}, chemins)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = idx.Close() }()
	sol := map[int]float64{}
	debordantes := 0
	ParcourtInstances(context.Background(), idx, bsp, func(m *Mesh, in Instance, decor, _ bool) {
		if in.Index == 2900 {
			if z := verticaleZ(m, in, [2]float64{15.2, 13.3}); len(z) > 0 {
				sol[in.Index] = z[0]
			}
		}
		if !decor && debordeDeSaBoite(m, in, 0.1) {
			debordantes++
		}
	})
	if z, ok := sol[2900]; !ok || math.Abs(z-0.063) > 0.02 {
		t.Errorf("sol du fond de l'hydro : z=%.3f (lu=%v), attendu 0,063", z, ok)
	}
	if debordantes > 0 {
		t.Errorf("%d instances visibles debordent de leur boite declaree", debordantes)
	}
}

// debordeDeSaBoite dit si un sommet du maillage pose sort de la boite monde declaree de
// l'instance de plus de `marge`.
func debordeDeSaBoite(m *Mesh, in Instance, marge float64) bool {
	for _, v := range m.Vertices {
		w := in.LocalToWorld(v)
		for a := 0; a < 3; a++ {
			if w[a] < in.AABBMin[a]-marge || w[a] > in.AABBMax[a]+marge {
				return true
			}
		}
	}
	return false
}

// verticaleZ rend les hauteurs ou la verticale de p traverse les triangles du maillage pose.
func verticaleZ(m *Mesh, in Instance, p [2]float64) []float64 {
	w := make([][3]float64, len(m.Vertices))
	for i, v := range m.Vertices {
		w[i] = in.LocalToWorld(v)
	}
	var out []float64
	for _, tr := range m.Triangles {
		a, b, c := w[tr[0]], w[tr[1]], w[tr[2]]
		d := (b[1]-c[1])*(a[0]-c[0]) + (c[0]-b[0])*(a[1]-c[1])
		if math.Abs(d) < 1e-12 {
			continue
		}
		l1 := ((b[1]-c[1])*(p[0]-c[0]) + (c[0]-b[0])*(p[1]-c[1])) / d
		l2 := ((c[1]-a[1])*(p[0]-c[0]) + (a[0]-c[0])*(p[1]-c[1])) / d
		if l3 := 1 - l1 - l2; l1 >= 0 && l2 >= 0 && l3 >= 0 {
			out = append(out, l1*a[2]+l2*b[2]+l3*c[2])
		}
	}
	return out
}
