//go:build gamefiles

package himap

// LOCAL-CHANGE (infinite-theater-3d): the installed Forge kits of the weapon and equipment
// generators (kits_forge.go).

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/JGtm/halo-infinite-files-reader/himodule"
	"github.com/JGtm/halo-infinite-files-reader/mapvar"
)

// TestKitsDesGenerateurs : les generateurs de Recharge posent les machines de leur kit, avec leurs
// materiaux et sans le decor 0x79 que leurs proprietes nommaient par hasard ; le kit d'une mise en
// scene (sans machine) ne pose rien.
func TestKitsDesGenerateurs(t *testing.T) {
	racine, err := DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	levels, err := LevelsDir("pc")
	if err != nil {
		t.Skip(err)
	}
	chemins, err := GeometrySearchPathMonde(racine, filepath.Join(levels, "sgh_blueprint", "sgh_blueprint-rtx-new.module"))
	if err != nil {
		t.Fatal(err)
	}
	idx, err := NewModuleIndex(chemins...)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = idx.Close() }()
	forge, err := himodule.Open(cheminDefinitionsForge(racine))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = forge.Close() }()
	ctx := context.Background()
	const ratelier, socleArme, miseEnScene = int32(0x6253CFC0), int32(0x5F379533), int32(1006238451)
	objets := []mapvar.Object{{TypeID: ratelier}, {TypeID: socleArme}, {TypeID: miseEnScene}}
	if m := modeleParType(ctx, objets, idx, forge); len(m) != 0 {
		t.Errorf("modele propre a un generateur : %v", m)
	}
	kits := kitsDesTypes(ctx, objets, idx, forge, map[uint32]*RuntimeGeoAsset{})
	veut := map[int32]int{ratelier: 2, socleArme: 1}
	for ty, n := range veut {
		mv := kits[ty]
		if mv == nil || len(mv.pieces) != n {
			t.Fatalf("type %d : %v, attendu %d objet(s) de kit", ty, mv, n)
		}
		for _, p := range mv.pieces {
			if len(p.mv.maillages) == 0 || len(p.mv.materiaux) == 0 {
				t.Errorf("type %d : objet de kit sans maillage ou sans materiau", ty)
			}
		}
	}
	if kits[miseEnScene] != nil {
		t.Error("kit sans machine pose")
	}
}
