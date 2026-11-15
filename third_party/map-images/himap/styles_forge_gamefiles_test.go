//go:build gamefiles

package himap

// LOCAL-CHANGE (infinite-theater-3d): the game's Forge palette resolves the swatches the
// reference catalog lost (styles_forge.go).

import (
	"path/filepath"
	"testing"
)

// TestPaletteForgeJeu : the Forge palette (mwpl 0x4FD73754) names Fortress's sandstone swatch
// (-1773215225) and moss swatch (-422696516), which the catalog export dropped, and resolves the
// catalog's own Mud swatch to the catalog's colors.
func TestPaletteForgeJeu(t *testing.T) {
	racine, err := DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	mod := filepath.Join(racine, "pc", "levels", "multi", "fo09_academy", "fo09_academy-rtx-new.module")
	mats, err := CheminsMateriaux(racine, mod)
	if err != nil {
		t.Skip(err)
	}
	idx, err := NewModuleIndex(mats...)
	if err != nil {
		t.Skip(err)
	}
	defer idx.Close()
	ech := echantillonsPaletteJeu(lecteurStyles(idx))
	if ech == nil {
		t.Fatal("Forge palette 0x4FD73754 not read")
	}
	for _, nom := range []int32{-1773215225, -422696516} {
		if k, ok := ech(nom); !ok || k == nil || k.Bitmap == 0 {
			t.Errorf("swatch %d = %+v, %v", nom, k, ok)
		}
	}
	// Sandstone is warm: red over green over blue.
	if k, _ := ech(-1773215225); k != nil && !(k.Haut[0] > k.Haut[1] && k.Haut[1] > k.Haut[2]) {
		t.Errorf("sandstone top color %v, want warm", k.Haut)
	}
	// Mud, as the catalog exports it (forge_materials.json).
	k, ok := ech(1018029936)
	if !ok || k == nil || !procheRGB(k.Haut, [3]float32{0.1119324, 0.184475, 0.02624124}) || int32(k.Bitmap) != -571202423 {
		t.Errorf("Mud = %+v", k)
	}
}
