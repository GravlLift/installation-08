//go:build research

package replay

// postures_de_controle_research_test.go — INSTRUMENT DE MESURE des postures et des sauts lus dans la
// commande (postures_de_controle.go), sur un film entier, par le chemin de production (faits du
// balayage, puis passes de l assemblage). Lecture seule. GARDE : PLEIN_FILM et PLEIN_MAP.
//
// Il rend, par joueur, les accroupis, glissades et sauts et leurs taux par minute de match ; les
// distributions de durees ; la part des glissades qui passent au-dessus de la course sous 800 ms ; la
// part des glissades physiques (vitesse au sol au-dessus de la course, sans montee ni descente)
// couvertes ; le decalage entre la pression en l air et l atterrissage ; la part des sauts suivis
// d une montee. Chaque mesure a son TEMOIN : la meme commande decalee de 30 s.

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/internal/facts/fallback"
	"github.com/JGtm/halo-infinite-film-decoder/internal/profile"
	"github.com/JGtm/halo-infinite-film-decoder/internal/source"
	"github.com/JGtm/halo-infinite-film-decoder/types"
)

const (
	// vitesseGlissadePhysiqueUS : p90 de la vitesse sous sprint lu (2,95) + 0,15.
	vitesseGlissadePhysiqueUS = 3.10
	// decalageDuTemoinUS : la commande du temoin, decalee de 30 s.
	decalageDuTemoinUS = 30_000_000
)

// chargerLesFaitsDeMesure decode le film de PLEIN_FILM et rend ses faits et l entree de carte.
func chargerLesFaitsDeMesure(t *testing.T) (*FilmFactsFile, profile.MapQuantEntry) {
	t.Helper()
	dir, mapName := os.Getenv("PLEIN_FILM"), os.Getenv("PLEIN_MAP")
	if dir == "" || mapName == "" {
		t.Skip("PLEIN_FILM / PLEIN_MAP absents : instrument de mesure saute")
	}
	cat, err := profile.LoadMapQuantCatalog(filepath.Join("..", "..", "..", "data", "titles", "halo_infinite",
		"reference", "map_quant_bounds.json"))
	if err != nil {
		t.Fatalf("catalogue : %v", err)
	}
	entry, err := cat.Lookup(mapName)
	if err != nil {
		t.Fatalf("carte : %v", err)
	}
	film, err := source.LoadDir(dir, nil)
	if err != nil {
		t.Fatalf("chunks : %v", err)
	}
	_, faits, err := BuildFromFilmAvecFaits(context.Background(), "mesure", "halo_infinite", film, Options{MapQuant: &entry})
	if err != nil || faits == nil {
		t.Fatalf("balayage : %v", err)
	}
	return faits, entry
}

// assemblerDepuisLesFaits deroule les passes de production sur les faits, `muter` applique d abord.
func assemblerDepuisLesFaits(f *FilmFactsFile, entry profile.MapQuantEntry, muter func(*FilmInputs)) *assemblage {
	in := f.Facts.FilmInputs
	in.ControlInputs = append([]types.ControlInputChange(nil), in.ControlInputs...)
	if muter != nil {
		muter(&in)
	}
	opt := Options{MapQuant: &entry, Fallbacks: fallback.NouveauCompteur()}
	in.applyTo(&opt)
	return assemblerLeDocument(context.Background(), "mesure", "halo_infinite", in.Positions, in.Fire, opt)
}

// decalerLaCommande decale tous les changements de la commande.
func decalerLaCommande(in *FilmInputs) {
	for i := range in.ControlInputs {
		in.ControlInputs[i].TimestampUS += decalageDuTemoinUS
	}
}

func TestPosturesDeLaCommande(t *testing.T) {
	faits, entry := chargerLesFaitsDeMesure(t)
	a := assemblerDepuisLesFaits(faits, entry, nil)
	temoin := assemblerDepuisLesFaits(faits, entry, decalerLaCommande)
	cov := a.doc.Coverage.Stances.Control
	t.Logf("places : %+v", a.places.cov)
	occ := a.reg.Occupants()
	vies := viesParJoueur(a.doc.Tracks, a.doc.Roster, occ, a.horloge())
	type lu struct{ de, a int }
	parJoueur := map[int]map[int]*lu{}
	for _, e := range a.fire {
		if !e.HasShooter || !e.Unit.Present || e.FilmIndex < 0 {
			continue
		}
		pi, ok := occ.indexA(e.Unit.Slot, int64(e.TimestampUS))
		if !ok {
			continue
		}
		fr := a.horloge().frame(e.TimestampUS)
		if parJoueur[pi] == nil {
			parJoueur[pi] = map[int]*lu{}
		}
		if l := parJoueur[pi][e.FilmIndex]; l == nil {
			parJoueur[pi][e.FilmIndex] = &lu{fr, fr}
		} else {
			l.a = fr
		}
	}
	for pi, m := range parJoueur {
		s := ""
		for pl, l := range m {
			s += fmt.Sprintf(" place %d [%d,%d]", pl, l.de, l.a)
		}
		t.Logf("  joueur %d presence %v liaisons%s", pi, vies[pi], s)
	}
	for _, r := range a.doc.Roster {
		t.Logf("  roster %d %s seat %d presence %d", r.FilmIndex, r.Name, r.Seat, len(r.Presence))
	}
	t.Logf("commande : %+v", *cov)
	t.Logf("postures par genre : %v (temoin %v)", a.doc.Coverage.Stances.ByKind, temoin.doc.Coverage.Stances.ByKind)
	mesurerParJoueur(t, a)
	mesurerLesDurees(t, a.doc.Stances)
	t.Logf("glissades au-dessus de %.2f u/s sous 800 ms : %s ; temoin %s", vitesseGlissadePhysiqueUS,
		partRapide(a, types.MovementSlide), partRapide(temoin, types.MovementSlide))
	t.Logf("accroupis au-dessus du seuil sous 800 ms : %s ; temoin %s",
		partRapide(a, types.MovementCrouch), partRapide(temoin, types.MovementCrouch))
	t.Logf("glissades physiques couvertes : %s ; temoin %s", glissadesPhysiquesCouvertes(a), glissadesPhysiquesCouvertes(temoin))
	mesurerLAtterrissage(t, a)
	t.Logf("sauts suivis d une montee de 0,3 u sous 500 ms : %s ; temoin %s", sautsSuivisDUneMontee(a), sautsSuivisDUneMontee(temoin))
}

// mesurerParJoueur rend, par joueur, les accroupis, glissades et sauts et leur taux par minute.
func mesurerParJoueur(t *testing.T, a *assemblage) {
	minutes := float64(a.doc.FrameCount*a.doc.FrameIntervalMS) / 60000
	noms := map[string]string{}
	for _, r := range a.doc.Roster {
		noms[r.XUID] = r.Name
	}
	p := a.contexteDesPostures(&ControlStanceCoverage{})
	type compte struct{ accroupis, glissades, sauts int }
	parJoueur := map[string]*compte{}
	de := func(slot uint32, fr int) *compte {
		nom := "?"
		if ti, ok := p.vieDuSlot(slot, fr); ok {
			nom = noms[a.doc.Tracks[ti].XUID] + a.doc.Tracks[ti].Bot
		}
		if parJoueur[nom] == nil {
			parJoueur[nom] = &compte{}
		}
		return parJoueur[nom]
	}
	for _, s := range a.doc.Stances {
		switch {
		case s.Ms0 == nil:
		case s.Kind == types.MovementCrouch:
			de(s.Slot, s.T0).accroupis++
		case s.Kind == types.MovementSlide:
			de(s.Slot, s.T0).glissades++
		}
	}
	for _, act := range a.doc.Actions {
		if act.Kind == genreSaut {
			de(act.Slot, act.T).sauts++
		}
	}
	nomsTries := make([]string, 0, len(parJoueur))
	for n := range parJoueur {
		nomsTries = append(nomsTries, n)
	}
	sort.Strings(nomsTries)
	t.Logf("match : %.1f min", minutes)
	for _, n := range nomsTries {
		c := parJoueur[n]
		t.Logf("  %-22s accroupis %4d (%5.1f/min)  glissades %4d (%5.1f/min)  sauts %4d (%5.1f/min)", n,
			c.accroupis, float64(c.accroupis)/minutes, c.glissades, float64(c.glissades)/minutes, c.sauts, float64(c.sauts)/minutes)
	}
}

// mesurerLesDurees rend les centiles et la ventilation des durees des postures de la commande.
func mesurerLesDurees(t *testing.T, stances []Stance) {
	for _, kind := range []string{types.MovementCrouch, types.MovementSlide} {
		var d []int64
		for _, s := range stances {
			if s.Kind == kind && s.Ms0 != nil {
				d = append(d, *s.Ms1-*s.Ms0)
			}
		}
		if len(d) == 0 {
			continue
		}
		sort.Slice(d, func(i, j int) bool { return d[i] < d[j] })
		bornes := []int64{100, 200, 400, 1000, 2000, 5000}
		cases := make([]int, len(bornes)+1)
		for _, v := range d {
			k := sort.Search(len(bornes), func(i int) bool { return v < bornes[i] })
			cases[k]++
		}
		t.Logf("%s : n %d, p10 %d ms, p50 %d ms, p90 %d ms ; <0,1 s %d, 0,1-0,2 %d, 0,2-0,4 %d, 0,4-1 %d, 1-2 %d, 2-5 %d, >5 %d",
			kind, len(d), d[len(d)/10], d[len(d)/2], d[len(d)*9/10], cases[0], cases[1], cases[2], cases[3], cases[4], cases[5], cases[6])
	}
}

// partRapide rend la part des postures `kind` de la commande dont la vitesse au sol passe au-dessus
// de [vitesseGlissadePhysiqueUS] dans les 800 ms qui suivent leur debut.
func partRapide(a *assemblage, kind string) string {
	p := a.contexteDesPostures(&ControlStanceCoverage{})
	n, rapides := 0, 0
	for _, s := range a.doc.Stances {
		if s.Kind != kind || s.Ms0 == nil {
			continue
		}
		ti, ok := p.vieDuSlot(s.Slot, s.T0)
		if !ok {
			continue
		}
		n++
		c := p.cinematiqueDe(ti)
		for i := c.aPartirDe(*s.Ms0); i < len(c.t) && c.t[i] <= *s.Ms0+800; i++ {
			if sol, _, ok := c.vitesse(i); ok && sol > vitesseGlissadePhysiqueUS {
				rapides++
				break
			}
		}
	}
	return partSur(rapides, n)
}

// glissadesPhysiques rend, par vie, les debuts (ms) des passages d au moins 150 ms au-dessus de la
// course sans montee ni descente.
func glissadesPhysiques(c cinematique) []int64 {
	var out []int64
	debut, dedans := int64(0), false
	for i := range c.t {
		sol, vz, ok := c.vitesse(i)
		rapide := ok && sol > vitesseGlissadePhysiqueUS && vz < 0.25 && vz > -0.25
		switch {
		case rapide && !dedans:
			debut, dedans = c.t[i], true
		case !rapide && dedans:
			if c.t[i]-debut >= 150 {
				out = append(out, debut)
			}
			dedans = false
		}
	}
	return out
}

// glissadesPhysiquesCouvertes rend la part des glissades physiques dont une glissade publiee de la
// meme vie commence dans [-400, +200] ms.
func glissadesPhysiquesCouvertes(a *assemblage) string {
	p := a.contexteDesPostures(&ControlStanceCoverage{})
	parVie := map[int][]int64{}
	for _, s := range a.doc.Stances {
		if s.Kind == types.MovementSlide && s.Ms0 != nil {
			if ti, ok := p.vieDuSlot(s.Slot, s.T0); ok {
				parVie[ti] = append(parVie[ti], *s.Ms0)
			}
		}
	}
	n, couvertes := 0, 0
	raisons := map[string]int{}
	cmds := lireLesCommandes(a.opt.ControlInputs)
	for ti := range a.doc.Tracks {
		for _, g := range glissadesPhysiques(p.cinematiqueDe(ti)) {
			n++
			couverte := false
			for _, s := range parVie[ti] {
				if s >= g-400 && s <= g+200 {
					couverte = true
					break
				}
			}
			if couverte {
				couvertes++
				continue
			}
			raisons[raisonNonCouverte(p, cmds, ti, g)]++
		}
	}
	return fmt.Sprintf("%s, non couvertes par raison %v", partSur(couvertes, n), raisons)
}

// raisonNonCouverte dit pourquoi une glissade physique de la vie `ti` a l instant `g` (ms) n est pas
// couverte par une glissade publiee.
func raisonNonCouverte(p *posturesDeControle, cmds map[int]*commandesDUnePlace, ti int, g int64) string {
	ts := p.horloge.origin + uint64(g)*fullRateTimeUnitUS //nolint:gosec // horloge du film
	fr := p.horloge.frame(ts)
	if p.enVehicule(p.tracks[ti].Slot, fr) {
		return "vehicule"
	}
	pi, ok := p.occ.indexA(p.tracks[ti].Slot, int64(ts)) //nolint:gosec // horloge du film
	if !ok {
		return "vieSansJoueur"
	}
	place, ok := p.places.placeDe(pi, fr)
	if !ok {
		tenues := ""
		for pl, ts := range p.places.parPlace {
			for _, t := range ts {
				if t.joueur == pi {
					tenues += fmt.Sprintf("%d:[%d,%d]", pl, t.de, t.a)
				}
			}
		}
		return fmt.Sprintf("joueurSansPlace(pi=%d,%s)", pi, tenues)
	}
	cmd := cmds[place]
	if cmd == nil {
		return "placeSansCommande"
	}
	if !cmd.connuA(ts) {
		return "commandeInconnue"
	}
	for _, pr := range cmd.pressions {
		if pr.de+400_000 >= ts && pr.de <= ts+200_000 {
			return "pressionClasseeAccroupi"
		}
		if pr.de < ts && pr.a >= ts {
			return "pressionTenueAvant"
		}
	}
	c := p.cinematiqueDe(ti)
	vmax := 0.0
	for i := c.aPartirDe(g); i < len(c.t) && c.t[i] <= g+500; i++ {
		if sol, _, ok := c.vitesse(i); ok {
			vmax = max(vmax, sol)
		}
	}
	if vmax > 6 {
		return "aucunePression(plus de 6 u/s)"
	}
	return "aucunePression"
}

// mesurerLAtterrissage rend le decalage entre la pression en l air et l atterrissage des glissades
// ouvertes au contact (negatif : pression avant le contact).
func mesurerLAtterrissage(t *testing.T, a *assemblage) {
	cov := &ControlStanceCoverage{Read: true}
	p := a.contexteDesPostures(cov)
	var d []int64
	for place, cmd := range lireLesCommandes(a.opt.ControlInputs) {
		for _, pr := range cmd.pressions {
			ti, ok := p.resoudre(place, pr.de)
			if !ok || p.lues[ti] {
				continue
			}
			recent, proche := p.etatDuSprint(p.tracks[ti].Slot, pr.de)
			de := p.ms(pr.de)
			c := p.cinematiqueDe(ti)
			if recent || !proche || !c.chuteA(de) {
				continue
			}
			if contact, ok := c.contactAuSol(de, de+contactAuSolMaxMS); ok {
				d = append(d, de-contact)
			}
		}
	}
	if len(d) == 0 {
		t.Logf("atterrissage : aucune glissade ouverte au contact")
		return
	}
	sort.Slice(d, func(i, j int) bool { return d[i] < d[j] })
	t.Logf("pression moins atterrissage : n %d, p10 %d ms, p50 %d ms, p90 %d ms", len(d), d[len(d)/10], d[len(d)/2], d[len(d)*9/10])
}

// sautsSuivisDUneMontee rend la part des sauts publies dont la vie monte de 0,3 u dans les 500 ms.
func sautsSuivisDUneMontee(a *assemblage) string {
	p := a.contexteDesPostures(&ControlStanceCoverage{})
	n, montes := 0, 0
	for _, act := range a.doc.Actions {
		if act.Kind != genreSaut {
			continue
		}
		ti, ok := p.vieDuSlot(act.Slot, act.T)
		if !ok {
			continue
		}
		c := p.cinematiqueDe(ti)
		i := c.aPartirDe(act.Ms)
		if i >= len(c.t) {
			continue
		}
		n++
		for j := i; j < len(c.t) && c.t[j] <= act.Ms+500; j++ {
			if c.z[j]-c.z[i] > 0.3 {
				montes++
				break
			}
		}
	}
	return partSur(montes, n)
}

func partSur(k, n int) string {
	if n == 0 {
		return "0 / 0"
	}
	return fmt.Sprintf("%d / %d (%.1f %%)", k, n, 100*float64(k)/float64(n))
}
