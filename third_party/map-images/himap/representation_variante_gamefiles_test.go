//go:build gamefiles

package himap

// LOCAL-CHANGE (infinite-theater-3d): the model variant a Forge object's dynamic representation
// names (variantesRepresentations), measured on the AIMBOTZ V2 floor rectangle.

import (
	"io/fs"
	"path/filepath"
	"strings"
	"testing"
)

func TestVarianteRepresentationDynamique(t *testing.T) {
	racine, err := DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	var mods []string
	_ = filepath.WalkDir(racine, func(p string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() && strings.Contains(p, "forge_objects") && filepath.Ext(p) == ".module" {
			mods = append(mods, p)
		}
		return nil
	})
	idx, err := NewModuleIndex(mods...)
	if err != nil {
		t.Skip(err)
	}
	defer idx.Close()
	const (
		rectangle = 0x2f7d8192 // food: the floor rectangle
		dynamique = 0x0bf1df9c // its dynamic representation (bloc c7001178)
		variante  = 0x1f7947cf // the model variant that representation names
	)
	food, err := idx.Extract(rectangle)
	if err != nil {
		t.Skip(err)
	}
	if got := variantesRepresentations(food)[int32(dynamique)]; got != variante {
		t.Fatalf("variant of the dynamic representation = %08x, want %08x", got, variante)
	}
	bloc, err := idx.Extract(refsRepresentations(food)[int32(dynamique)])
	if err != nil {
		t.Fatal(err)
	}
	v := varianteDuPlacement(t.Context(), idx, bloc, variante)
	// The bloc's hlmt (4a137f08) maps its single region (42c9679f) to the permutation of the same
	// name: the one drawn with the Forge style material, where permutation 0 is a fixed orange.
	if v[0x42c9679f] != variante {
		t.Fatalf("variant regions = %v, want region 42c9679f -> %08x", v, variante)
	}
}
