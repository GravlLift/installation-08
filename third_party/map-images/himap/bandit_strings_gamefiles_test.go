// LOCAL-CHANGE (infinite-theater-3d): verify the localized Bandit names.
//go:build gamefiles

package himap

import (
	"github.com/JGtm/halo-infinite-files-reader/himodule"
	"testing"
)

func TestBanditLocalizedNames(t *testing.T) {
	root, err := DeployRoot()
	if err != nil {
		t.Fatal(err)
	}
	m, err := himodule.Open(cheminGlobals(root))
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	wanted := map[uint32]map[string]string{
		0xb362330b: {CodeLangueEN: "Bandit Evo", CodeLangueFR: "Bandit Evo"},
		0x14d231bb: {CodeLangueEN: "M392 Bandit", CodeLangueFR: "Bandit M392"},
	}
	for _, f := range m.Files("uslg") {
		lex, err := lexiqueDUnTag(m, f)
		if err != nil {
			continue
		}
		for id, want := range wanted {
			if got, ok := lex[id]; ok {
				for lang, name := range want {
					if got[lang] != name {
						t.Errorf("%08x %s: %q want %q", id, lang, got[lang], name)
					}
				}
				t.Logf("uslg %08x, string %08x", f.GlobalID, id)
				delete(wanted, id)
			}
		}
	}
	if len(wanted) != 0 {
		t.Errorf("missing strings: %v", wanted)
	}
}
