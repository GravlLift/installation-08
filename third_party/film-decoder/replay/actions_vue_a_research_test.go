//go:build research

package replay

// actions_vue_a_research_test.go — instrument de mesure des messages d action de la vue A
// (degats 0, rechargement 38, lancer amorce 39, coup de corps a corps 40) : base de domaine,
// vies designees, recoupement des coups avec les kills de melee et des rechargements avec les
// tirs. Lecture seule, UN film par processus.
//
// GARDE : ACTIONS_FILM et ACTIONS_MAP (comme actions_film_research_test.go).

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/damagetag"
	"github.com/JGtm/halo-infinite-film-decoder/internal/facts/killsource"
	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar"
	"github.com/JGtm/halo-infinite-film-decoder/internal/profile"
	"github.com/JGtm/halo-infinite-film-decoder/internal/source"
	"github.com/JGtm/halo-infinite-film-decoder/types"
)

type mesureActions struct {
	slotsVus  map[uint32]bool
	vivants   map[uint32][]uint64 // slot -> horodatages de position, tries
	origine   uint64
	pas       uint64
	trames    func(ts uint64) int
	doc       *ReplayDocument
	xuidSlots map[string][]Track
}

func (m *mesureActions) vivant(slot uint32, ts uint64) bool {
	v := m.vivants[slot]
	i := sort.Search(len(v), func(i int) bool { return v[i] >= ts })
	const fen = 1_000_000
	return (i < len(v) && v[i]-ts <= fen) || (i > 0 && ts-v[i-1] <= fen)
}

func TestActionsMessagesDeLaVueA(t *testing.T) {
	dir, mapName := os.Getenv("ACTIONS_FILM"), os.Getenv("ACTIONS_MAP")
	if dir == "" || mapName == "" {
		t.Skip("ACTIONS_FILM / ACTIONS_MAP absents : instrument de mesure saute")
	}
	cat, err := profile.LoadMapQuantCatalog(filepath.Join("..", "..", "..", "data", "titles", "halo_infinite",
		"reference", "map_quant_bounds.json"))
	if err != nil {
		t.Fatalf("catalogue de bornes : %v", err)
	}
	entry, err := cat.Lookup(mapName)
	if err != nil {
		t.Fatalf("carte %q : %v", mapName, err)
	}
	film, err := source.LoadDir(dir, nil)
	if err != nil {
		t.Fatalf("chunks : %v", err)
	}
	var pos []grammar.BipedPosition
	var morts []types.Death
	opt := Options{MapQuant: &entry, Observe: func(step string, v any) {
		switch step {
		case "positions":
			pos, _ = v.([]grammar.BipedPosition)
		case "deaths":
			morts, _ = v.([]types.Death)
		}
	}}
	doc, err := BuildFromFilm(context.Background(), "mesure-actions", "halo_infinite", film, opt)
	if err != nil {
		t.Fatalf("assemblage : %v", err)
	}
	m := &mesureActions{slotsVus: map[uint32]bool{}, vivants: map[uint32][]uint64{}, doc: &doc,
		xuidSlots: map[string][]Track{}}
	m.origine = ^uint64(0)
	for _, p := range pos {
		m.slotsVus[p.Slot] = true
		m.vivants[p.Slot] = append(m.vivants[p.Slot], p.TimestampUS)
		m.origine = min(m.origine, p.TimestampUS)
	}
	for s := range m.vivants {
		sort.Slice(m.vivants[s], func(i, j int) bool { return m.vivants[s][i] < m.vivants[s][j] })
	}
	m.pas = uint64(doc.FrameIntervalMS) * 1000
	for _, tr := range doc.Tracks {
		if tr.XUID != "" {
			m.xuidSlots[tr.XUID] = append(m.xuidSlots[tr.XUID], tr)
		}
	}
	fc := grammar.NewFilmContextForMap(film, opt.MapQuant, decoupageForce(opt))
	poserProfilPuisCarte(context.Background(), fc, "sonde", Options{MapQuant: &entry})
	actions := grammar.ScanFilmActions(fc)
	m.bases(t, actions)
	ko := killsource.DefaultOptions()
	ko.Carte = &entry
	ks, err := killsource.Decode(context.Background(), "sonde", film, &ko)
	if err != nil {
		t.Fatalf("killsource : %v", err)
	}
	m.melee(t, actions, ks, morts)
	m.rechargements(t, actions)
	m.degats(t, actions, ks)
	if c := doc.Coverage.PlayerActions; c != nil {
		t.Logf("DOCUMENT : drawnWeapons=%d damages=%d couverture=%+v", len(doc.DrawnWeapons), len(doc.Damages), *c)
	}
}

// bases compte, par genre, les references posees sur un slot bipede vu, sous plusieurs bases.
func (m *mesureActions) bases(t *testing.T, actions []types.FilmActionMessage) {
	type cle struct {
		genre uint8
		base  int
	}
	tot, avec, vivant := map[uint8]int{}, map[uint8]int{}, map[uint8]int{}
	sur := map[cle]int{}
	autre := map[uint8]int{}
	for _, a := range actions {
		tot[a.Genre]++
		if !a.HasActor {
			continue
		}
		avec[a.Genre]++
		brut := int(a.Actor.Slot) - 512
		for _, b := range []int{0, 256, 512, 768, 1024} {
			if m.slotsVus[uint32(brut+b)] {
				sur[cle{a.Genre, b}]++
			}
		}
		if m.vivant(a.Actor.Slot, a.TimestampUS) {
			vivant[a.Genre]++
		}
		if a.HasOther && m.slotsVus[a.Other.Slot] {
			autre[a.Genre]++
		}
	}
	for _, g := range []uint8{0, 38, 39, 40} {
		t.Logf("genre %-3d lus=%-6d avecActeur=%-6d base0=%-5d base256=%-5d base512=%-6d base768=%-5d base1024=%-5d vivantA1s=%-6d autreSurBipede=%d",
			g, tot[g], avec[g], sur[cle{g, 0}], sur[cle{g, 256}], sur[cle{g, 512}], sur[cle{g, 768}], sur[cle{g, 1024}],
			vivant[g], autre[g])
	}
}

func (m *mesureActions) trameDuPaquet(ts uint64) int { return int((ts - m.origine) / m.pas) }

func (m *mesureActions) trameDuKill(timeMS int) int {
	if m.doc.OriginMs == nil || m.doc.FrameIntervalMS == 0 {
		return -1
	}
	return int((int64(timeMS) - *m.doc.OriginMs) / int64(m.doc.FrameIntervalMS))
}

func (m *mesureActions) slotALaTrame(xuid string, f int) (uint32, bool) {
	for _, tr := range m.xuidSlots[xuid] {
		if f >= tr.StartFrame && f <= tr.EndFrame+2 {
			return tr.Slot, true
		}
	}
	return 0, false
}

// melee recoupe chaque kill de classe MELEE avec un coup (genre 40) du tueur dans les 2 s qui
// precedent ; temoin : le meme recoupement decale de 30 s.
func (m *mesureActions) melee(t *testing.T, actions []types.FilmActionMessage, ks *killsource.Result, morts []types.Death) {
	gt := map[string]string{}
	for _, d := range morts {
		if d.Gamertag != "" {
			gt[d.Gamertag] = strconv.FormatUint(d.XUID, 10)
		}
	}
	coups := map[uint32][]int{}
	for _, a := range actions {
		if a.Genre == 40 && a.HasActor {
			coups[a.Actor.Slot] = append(coups[a.Actor.Slot], m.trameDuPaquet(a.TimestampUS))
		}
	}
	var meleeKills, resolus, couverts, temoin int
	var ecarts []int
	for _, k := range ks.Kills {
		if k.Source.Class != damagetag.ClassMelee {
			continue
		}
		meleeKills++
		f := m.trameDuKill(k.TimeMS)
		slot, ok := m.slotALaTrame(gt[k.Feed.Killer], f)
		if !ok || f < 0 {
			continue
		}
		resolus++
		best := 1 << 30
		for _, c := range coups[slot] {
			if d := f - c; d >= -2 && d <= 20 && d < best {
				best = d
			}
		}
		if best != 1<<30 {
			couverts++
			ecarts = append(ecarts, best)
		}
		for _, c := range coups[slot] {
			if d := f + 300 - c; d >= -2 && d <= 20 {
				temoin++
				break
			}
		}
	}
	sort.Ints(ecarts)
	classes := map[string]int{}
	var resolubles int
	for _, k := range ks.Kills {
		classes[string(k.Source.Class)+"/"+k.Source.Category.Name()]++
		if gt[k.Feed.Killer] != "" {
			resolubles++
		}
	}
	t.Logf("CAUSES : kills=%d tueurAvecXuid=%d classes=%v", len(ks.Kills), resolubles, classes)
	t.Logf("MELEE : kills=%d tueurResolu=%d couvertsPar40=%d temoinDecale30s=%d coups40=%d ecartsTrames=%v",
		meleeKills, resolus, couverts, temoin, len(coups), ecarts)
}

// rechargements : un rechargement (38) pendant un tir continu de la meme vie est une incoherence ;
// entre deux tirs, l arme d avant et l arme d apres doivent etre la meme.
func (m *mesureActions) rechargements(t *testing.T, actions []types.FilmActionMessage) {
	tirs := map[uint32][]Shot{}
	for _, s := range m.doc.Shots {
		tirs[s.Slot] = append(tirs[s.Slot], s)
	}
	var n, pendantRafale, entre, memeArme, autreArme, sansTir, tirMemeTrame int
	var ecartSuivant []int // trames entre un rechargement et le tir suivant de la meme vie
	for _, a := range actions {
		if a.Genre != 38 || !a.HasActor {
			continue
		}
		n++
		f := m.trameDuPaquet(a.TimestampUS)
		for _, b := range m.doc.Bursts {
			if b.Slot == a.Actor.Slot && f > b.T0 && f < b.T1 {
				pendantRafale++
				break
			}
		}
		ts := tirs[a.Actor.Slot]
		i := sort.Search(len(ts), func(i int) bool { return ts[i].T >= f })
		if i < len(ts) && ts[i].T == f {
			tirMemeTrame++
		}
		j := i
		for j < len(ts) && ts[j].T == f {
			j++
		}
		if j < len(ts) {
			ecartSuivant = append(ecartSuivant, ts[j].T-f)
		}
		if i == 0 || i >= len(ts) {
			sansTir++
			continue
		}
		entre++
		if ts[i-1].Weapon != "" && ts[i-1].Weapon == ts[i].Weapon {
			memeArme++
		} else {
			autreArme++
		}
	}
	sort.Ints(ecartSuivant)
	sous := func(k int) int { return sort.SearchInts(ecartSuivant, k) }
	t.Logf("RECHARGEMENTS, tir suivant (trames de %d ms) : n=%d <5=%d <10=%d <15=%d <20=%d mediane=%d",
		m.doc.FrameIntervalMS, len(ecartSuivant), sous(5), sous(10), sous(15), sous(20), ecartSuivant[len(ecartSuivant)/2])
	t.Logf("RECHARGEMENTS : lus=%d pendantRafale=%d tirALaMemeTrame=%d entreDeuxTirs=%d memeArme=%d autreArme=%d sansTirAvantOuApres=%d tirs=%d rafales=%d",
		n, pendantRafale, tirMemeTrame, entre, memeArme, autreArme, sansTir, len(m.doc.Shots), len(m.doc.Bursts))
}

// degats : la source, le responsable, les degats auto-infliges.
func (m *mesureActions) degats(t *testing.T, actions []types.FilmActionMessage, ks *killsource.Result) {
	var n, src, other, self int
	for _, a := range actions {
		if a.Genre != 0 {
			continue
		}
		n++
		if a.HasSource {
			src++
		}
		if a.HasOther {
			other++
			if a.HasActor && a.Other.Slot == a.Actor.Slot {
				self++
			}
		}
	}
	t.Logf("DEGATS : lus=%d avecSource=%d avecResponsable=%d autoInfliges=%d kills=%d",
		n, src, other, self, len(ks.Kills))
}
