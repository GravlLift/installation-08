//go:build gamefiles

package himap

import (
	"context"
	"testing"

	"github.com/JGtm/halo-infinite-files-reader/himodule"
)

func TestRepresentationsFoodGamefiles(t *testing.T) {
	deploy, err := DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	m, err := himodule.Open(deploy + `\any\globals\forge\forge_objects-rtx-new.module`)
	if err != nil {
		t.Skip(err)
	}
	defer m.Close()
	for _, f := range m.Files("food") {
		if f.GlobalID != 471557513 {
			continue
		}
		tag, err := m.Extract(f)
		if err != nil {
			t.Fatal(err)
		}
		refs := refsRepresentations(tag)
		for nom, id := range map[int32]uint32{-1136393292: 3277759960, 1120495519: 1826042820, 528041935: 1788284281} {
			got, ok := refs[nom]
			if !ok || (id != 0 && got != id) {
				t.Errorf("representation %d: %d, presente=%v, attendu %d", nom, got, ok, id)
			}
		}
		return
	}
	t.Fatal("food absent")
}

// TestPalettesRepresentationsGamefiles (LOCAL-CHANGE (infinite-theater-3d)): Eroded Terrain E
// (food -329379567) names a palette per representation on one shared rtgo; Fortress's choice
// (-437051236) draws palette b80dd738, whose empty first slot keeps the default palette's.
func TestPalettesRepresentationsGamefiles(t *testing.T) {
	deploy, err := DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	chemins, err := GeometrySearchPathMonde(deploy, deploy+`\pc\levels\multi\fo09_academy\fo09_academy-rtx-new.module`)
	if err != nil {
		t.Skip(err)
	}
	idx, err := NewModuleIndex(chemins...)
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	m, err := himodule.Open(cheminDefinitionsForge(deploy))
	if err != nil {
		t.Skip(err)
	}
	defer m.Close()
	for _, f := range m.Files("food") {
		if int32(f.GlobalID) != -329379567 {
			continue
		}
		tag, err := m.Extract(f)
		if err != nil {
			t.Fatal(err)
		}
		pals := palettesRepresentations(tag)
		if pals[1120495519] != 0xe08b9f42 || pals[-437051236] != 0xb80dd738 || pals[528041935] != 0x826876d9 {
			t.Fatalf("palettes %x", pals)
		}
		defaut, _ := paletteDuType(context.Background(), idx, m, f, 0x98c04a0d)
		got := paletteDeRepresentation(context.Background(), idx, 0xb80dd738, defaut)
		if len(defaut) != 3 || len(got) != 3 || got[0] != defaut[0] || got[1] != 0x58c9bf17 || got[2] != 0x5c4e80ac {
			t.Fatalf("palette b80dd738 = %x (default %x)", got, defaut)
		}
		return
	}
	t.Fatal("food absent")
}

func TestRepresentationModeGamefiles(t *testing.T) {
	deploy, err := DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	chemins, err := GeometrySearchPathMonde(deploy, deploy+`\pc\levels\multi\fo09_academy\fo09_academy-rtx-new.module`)
	if err != nil {
		t.Skip(err)
	}
	idx, err := NewModuleIndex(chemins...)
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	groupe, _, ok := idx.Lookup(1235970979)
	if !ok || groupe != GroupeBloc {
		t.Fatalf("référence bloc: %s %v", groupe, ok)
	}
	tag, err := idx.Extract(1235970979)
	if err != nil {
		t.Fatal(err)
	}
	ref, ok := modeleDuHlmt(context.Background(), idx, tag)
	if !ok || ref.groupe != GroupeMode {
		t.Fatalf("modèle: %+v %v", ref, ok)
	}
	if ouvreAsset(context.Background(), idx, ref.id, ref.groupe) == nil {
		t.Fatal("modèle illisible")
	}
}
