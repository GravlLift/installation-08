//go:build research

package replay

// visees_sans_position_research_test.go — les visees i21 SANS position (`grammar.BipedAim`) d un bipede A
// PIED : combien tombent dans une vie qui replique sa position, et ce qu elles changent a la visee tenue
// d un tir. Lecture seule. GARDE : PLEIN_FILM et PLEIN_MAP.

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar"
	"github.com/JGtm/halo-infinite-film-decoder/internal/profile"
	"github.com/JGtm/halo-infinite-film-decoder/internal/source"
)

func TestViseesSansPositionAPied(t *testing.T) {
	dir, mapName := os.Getenv("PLEIN_FILM"), os.Getenv("PLEIN_MAP")
	if dir == "" || mapName == "" {
		t.Skip("PLEIN_FILM / PLEIN_MAP absents")
	}
	cat, err := profile.LoadMapQuantCatalog(filepath.Join("..", "..", "..", "data", "titles", "halo_infinite",
		"reference", "map_quant_bounds.json"))
	if err != nil {
		t.Fatal(err)
	}
	entry, err := cat.Lookup(mapName)
	if err != nil {
		t.Fatal(err)
	}
	film, err := source.LoadDir(dir, nil)
	if err != nil {
		t.Fatal(err)
	}
	var pos []grammar.BipedPosition
	var fire []grammar.FireEvent
	var veh VehicleScan
	opt := Options{MapQuant: &entry, Observe: func(step string, v any) {
		switch step {
		case "positions":
			pos, _ = v.([]grammar.BipedPosition)
		case "fire":
			fire, _ = v.([]grammar.FireEvent)
		case "vehicles":
			veh, _ = v.(VehicleScan)
		}
	}}
	if _, err := BuildFromFilm(context.Background(), "mesure-visees", "halo_infinite", film, opt); err != nil {
		t.Fatal(err)
	}
	if len(veh.Aims) == 0 {
		veh.Aims, err = grammar.ScanBipedAimOnly(grammar.NewFilmContextForMap(film, &entry, nil))
		if err != nil {
			t.Fatal(err)
		}
	}
	parSlot := map[uint32][]uint64{}
	viseesPos := map[uint32][]uint64{}
	for _, p := range pos {
		parSlot[p.Slot] = append(parSlot[p.Slot], p.TimestampUS)
		if p.HasYaw {
			viseesPos[p.Slot] = append(viseesPos[p.Slot], p.TimestampUS)
		}
	}
	viseesSeules := map[uint32][]uint64{}
	var aPied, aBord int
	for _, a := range veh.Aims {
		ts := parSlot[a.Slot]
		sort.Slice(ts, func(i, j int) bool { return ts[i] < ts[j] })
		i := sort.Search(len(ts), func(i int) bool { return ts[i] >= a.TimestampUS })
		// A PIED : une position du meme slot a moins de 500 ms de part et d autre.
		if i > 0 && i < len(ts) && a.TimestampUS-ts[i-1] < 500_000 && ts[i]-a.TimestampUS < 500_000 {
			aPied++
			viseesSeules[a.Slot] = append(viseesSeules[a.Slot], a.TimestampUS)
		} else {
			aBord++
		}
	}
	for s := range viseesPos {
		sort.Slice(viseesPos[s], func(i, j int) bool { return viseesPos[s][i] < viseesPos[s][j] })
	}
	for s := range viseesSeules {
		sort.Slice(viseesSeules[s], func(i, j int) bool { return viseesSeules[s][i] < viseesSeules[s][j] })
	}
	derniere := func(v []uint64, t uint64) (uint64, bool) {
		i := sort.Search(len(v), func(i int) bool { return v[i] > t }) - 1
		if i < 0 {
			return 0, false
		}
		return v[i], true
	}
	var nTirs, nPlusRecente, nSans int
	var ages []float64
	for _, e := range fire {
		if !e.Unit.Present {
			continue
		}
		nTirs++
		tp, okP := derniere(viseesPos[e.Unit.Slot], e.TimestampUS)
		ts, okS := derniere(viseesSeules[e.Unit.Slot], e.TimestampUS)
		switch {
		case !okP && !okS:
			nSans++
		case okS && (!okP || ts > tp):
			nPlusRecente++
		}
		if okP {
			ages = append(ages, float64(e.TimestampUS-tp)/1000)
		}
	}
	t.Logf("VISEES SANS POSITION : %d lues, %d a pied (position du slot a moins de 500 ms des deux cotes), %d ailleurs",
		len(veh.Aims), aPied, aBord)
	t.Logf("TIRS par unite : %d ; visee sans position plus recente que la derniere visee avec position : %d ; "+
		"aucune visee : %d", nTirs, nPlusRecente, nSans)
	sort.Float64s(ages)
	t.Logf("AGE de la visee tenue (avec position) au tir, ms : p50 %.0f p90 %.0f p99 %.0f max %.0f ; > 5 s : %d",
		quantilePD(ages, 0.5), quantilePD(ages, 0.9), quantilePD(ages, 0.99), quantilePD(ages, 1), compterAuDela(ages, 5000))
}

func compterAuDela(v []float64, seuil float64) int {
	n := 0
	for _, x := range v {
		if x > seuil {
			n++
		}
	}
	return n
}
