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
