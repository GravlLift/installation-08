//go:build gamefiles

package himap

import (
	"math"
	"path/filepath"
	"testing"
)

// TestCouchesStyle : un materiau du shader « Layered » (0xdb8cbebb), sans aucune couche declaree
// par le shader, lit sa couche de base dans ses styles (mwsy -> mwpl -> mwsw) : la carte de
// degrade et les couleurs du variant. Les valeurs attendues sont celles du tag `mat `
// 0x405bf642 de fo09_academy.
func TestCouchesStyle(t *testing.T) {
	racine, err := DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	mod := filepath.Join(racine, "pc", "levels", "multi", "fo09_academy", "fo09_academy-rtx-new.module")
	mats, err := CheminsMateriaux(racine, mod)
	if err != nil {
		t.Skip(err)
	}
	idxMat, err := NewModuleIndex(mats...)
	if err != nil {
		t.Skip(err)
	}
	defer idxMat.Close()
	geo, err := GeometrySearchPathMonde(racine, mod)
	if err != nil {
		t.Skip(err)
	}
	idxGeo, err := NewModuleIndex(geo...)
	if err != nil {
		t.Skip(err)
	}
	defer idxGeo.Close()
	table, _ := LitMateriaux(idxMat, idxGeo, []uint32{0x405bf642, 0x2ea6fc43, 0xc805c55e, 0x47d8ec6c})
	m, ok := table[0x405bf642]
	if !ok {
		t.Fatal("0x405bf642 absent des modules")
	}
	if m.Shader != 0xdb8cbebb {
		t.Fatalf("shader = %#x, attendu 0xdb8cbebb", m.Shader)
	}
	// LOCAL-CHANGE (infinite-theater-3d): the base zone first, then the zones and grime its style
	// lays with the composed mask.
	if m.Couches == nil || len(m.Couches.Couches) == 0 {
		t.Fatalf("couches = %v, attendu une couche de base", m.Couches)
	}
	if len(m.Couches.Couches) > 1 && (m.Couches.Style == nil || m.Couches.Couches[1].Rang != 1) {
		t.Fatalf("couches = %+v, attendu le masque de style", m.Couches)
	}
	c := m.Couches.Couches[0]
	if c.Bitmap == 0 {
		t.Fatal("carte de degrade absente")
	}
	veut := struct {
		haut, milieu, bas [3]float32
	}{
		haut:   [3]float32{0.5088814, 0.4910209, 0.4564112},
		milieu: [3]float32{0.4125427, 0.3762623, 0.3277782},
		bas:    [3]float32{0.3324516, 0.2874409, 0.2622508},
	}
	proche := func(got, veut [3]float32) bool {
		for i := range got {
			if math.Abs(float64(got[i]-veut[i])) > 1e-6 {
				return false
			}
		}
		return true
	}
	if !proche(c.Haut, veut.haut) || !proche(c.Milieu, veut.milieu) || !proche(c.Bas, veut.bas) {
		t.Errorf("variant = haut %v milieu %v bas %v, attendu %v %v %v",
			c.Haut, c.Milieu, c.Bas, veut.haut, veut.milieu, veut.bas)
	}
	// Les materiaux sans couche du shader partagent la meme cheminee.
	for _, id := range []uint32{0x2ea6fc43, 0xc805c55e, 0x47d8ec6c} {
		if m, ok := table[id]; !ok || m.Couches == nil || m.Couches.Couches[0].Bitmap == 0 {
			t.Errorf("0x%08x : couche de base absente", id)
		}
	}
}
