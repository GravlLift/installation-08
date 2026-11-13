//go:build research

package replay

// actions_registre_research_test.go — le dictionnaire du bipede (ti=35) des films du cache :
// les composants d etat de mouvement que l archetype declare, film par film. Lecture seule.
//
// GARDE : ACTIONS_CACHE (racine des film_chunks).

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar"
)

func TestActionsRegistreDuBipede(t *testing.T) {
	cache := os.Getenv("ACTIONS_CACHE")
	if cache == "" {
		t.Skip("ACTIONS_CACHE absent : instrument de mesure saute")
	}
	dirs, err := os.ReadDir(cache)
	if err != nil {
		t.Fatalf("cache : %v", err)
	}
	for _, d := range dirs {
		raw, err := grammar.ReadFilmChunk(filepath.Join(cache, d.Name()), 0)
		if err != nil {
			t.Logf("%s : chunk_00 illisible : %v", d.Name(), err)
			continue
		}
		reg, err := grammar.ParseRegistryChunk(raw)
		if err != nil {
			t.Logf("%s : registre invalide : %v", d.Name(), err)
			continue
		}
		arch, ok := reg.Archetype(grammar.BipedTypeIndex)
		if !ok {
			t.Logf("%s : pas d archetype bipede", d.Name())
			continue
		}
		var noms []string
		for i, n := range arch.Components {
			b := strings.ToLower(n)
			if strings.Contains(b, "crouch") || strings.Contains(b, "slide") ||
				strings.Contains(b, "mobility") || strings.Contains(b, "ability") ||
				strings.Contains(b, "weapon-set") || strings.Contains(b, "action") {
				noms = append(noms, fmt.Sprintf("i%d=%s", i, n))
			}
		}
		id, _ := grammar.ReadFilmIdentity(raw)
		t.Logf("%s : build=%s format=%d ; %d composants ; %s", d.Name(), id.Build, id.FormatVersion, len(arch.Components), strings.Join(noms, " "))
	}
}
