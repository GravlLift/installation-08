//go:build research

package replay

// actions_film_research_test.go — instrument de mesure des actions du film (accroupi, glissade),
// lecture seule, UN film par processus.
//
// DEUX SOURCES, ET L UNE EST MUETTE SUR LES BUILDS RECENTS. Les composants d etat du bipede (`i29`
// accroupi, `i62` glissade) ne sont annonces par aucun masque des records de trame de HI_1_13_0
// (actions_masques_research_test.go : zero record sur 2,25 M) : les LECTURES ci-dessous y sont vides
// pour ces deux genres. Le bouton d accroupi, qui est aussi celui de la glissade, est en revanche
// PRESENT dans la commande de la vue de controle, et le document en tire ses `crouch` et `slide`
// (postures_de_controle.go) : la ligne COMMANDE les compte. a521164d, build plus ancien, porte encore
// `i29` et `i62`.
//
// GARDE : ACTIONS_FILM (repertoire du film) et ACTIONS_MAP (nom de carte du catalogue de bornes).

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/internal/profile"
	"github.com/JGtm/halo-infinite-film-decoder/internal/source"
	"github.com/JGtm/halo-infinite-film-decoder/types"
)

func TestActionsEtatsDeMouvementSurFilmReel(t *testing.T) {
	dir, mapName := os.Getenv("ACTIONS_FILM"), os.Getenv("ACTIONS_MAP")
	if dir == "" || mapName == "" {
		t.Skip("ACTIONS_FILM / ACTIONS_MAP absents : instrument de mesure saute")
	}
	path := filepath.Join("..", "..", "..", "data", "titles", "halo_infinite",
		"reference", "map_quant_bounds.json")
	cat, err := profile.LoadMapQuantCatalog(path)
	if err != nil {
		t.Fatalf("catalogue de bornes : %v", err)
	}
	entry, err := cat.Lookup(mapName)
	if err != nil {
		t.Fatalf("carte %q : %v", mapName, err)
	}
	film, err := source.LoadDir(dir, nil)
	if err != nil {
		t.Fatalf("chunks du film illisibles : %v", err)
	}
	var lus []types.MovementStateRead
	var st types.MovementStateStats
	opt := Options{MapQuant: &entry, Observe: func(step string, v any) {
		switch step {
		case "movementStates":
			lus, _ = v.([]types.MovementStateRead)
		case "movementStates.stats":
			st, _ = v.(types.MovementStateStats)
		}
	}}
	doc, err := BuildFromFilm(context.Background(), "mesure-actions", "halo_infinite", film, opt)
	if err != nil {
		t.Fatalf("assemblage : %v", err)
	}
	type cle struct {
		kind string
		on   bool
	}
	parGenre := map[cle]int{}
	for _, r := range lus {
		parGenre[cle{r.Kind, r.On}]++
	}
	cles := make([]cle, 0, len(parGenre))
	for k := range parGenre {
		cles = append(cles, k)
	}
	sort.Slice(cles, func(i, j int) bool {
		if cles[i].kind != cles[j].kind {
			return cles[i].kind < cles[j].kind
		}
		return !cles[i].on && cles[j].on
	})
	t.Logf("STATS : records=%d desyncs=%d lus=%d slotNonLie=%d doublons=%d absent=%v largeurs=%v",
		st.Records, st.Desyncs, st.Read, st.SlotUnbound, st.Duplicates, st.Absent, st.MapWidths)
	for _, k := range cles {
		t.Logf("LECTURES %-12s on=%-5v %d", k.kind, k.on, parGenre[k])
	}
	if c := doc.Coverage.Stances; c != nil {
		t.Logf("DOCUMENT : stances=%d byKind=%v", len(doc.Stances), c.ByKind)
		if cc := c.Control; cc != nil {
			t.Logf("COMMANDE : pressions=%d accroupis=%d glissades=%d sauts=%d", cc.Presses, cc.Crouches, cc.Slides, cc.Jumps)
		}
	}
}
