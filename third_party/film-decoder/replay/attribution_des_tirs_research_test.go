//go:build research

package replay

// attribution_des_tirs_research_test.go — INSTRUMENT DE MESURE de l attribution des tirs et des
// rafales par la place de controle. Lecture seule. GARDE : PLEIN_FILM et PLEIN_MAP.
//
// LA VERITE : un record de tir dont l unite qui tire est un bipede dont le registre connait
// l occupant a cet instant nomme son tireur. Sur ces tirs, la mesure confronte ce que chaque lecture
// de la place rendrait : le siege du roster (`tireursParPlace`, la regle d avant) et la place lue
// dans les tirs (`placesDeControle`). Elle compte aussi, par joueur, les tirs et les rafales publies.

import (
	"sort"
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar"
)

// verdictsDePlace : ce qu une lecture de la place rend, confronte au tireur vrai.
type verdictsDePlace struct{ juste, faux, place, aucun int }

func TestAttributionDesTirs(t *testing.T) {
	faits, entry := chargerLesFaitsDeMesure(t)
	a := assemblerDepuisLesFaits(faits, entry, nil)
	occ := a.reg.Occupants()
	sieges := nouveauxTireursParPlace(a.doc.Roster)
	tracks := indexBySlot(a.sorted)
	pose := poseurDeTirs{origin: a.origin, step: a.step, viseur: nouveauViseur(a.sorted, nil, nil)}
	var siege, lue, siegeHorsUnite, lueHorsUnite, publie, publieHorsUnite verdictsDePlace
	tireurs := tireursDesPlaces{lues: a.places, sieges: sieges}
	for _, e := range a.fire {
		if !e.HasShooter || !e.Unit.Present {
			continue
		}
		vrai, ok := occ.indexA(e.Unit.Slot, int64(e.TimestampUS))
		if !ok {
			continue
		}
		fr := a.horloge().frame(e.TimestampUS)
		_, parUnite := tirParLUnite(tracks, e, pose)
		idx, autre := sieges.tireur(e.FilmIndex, fr)
		v := verdictDuSiege(idx, autre, vrai, e.FilmIndex)
		siege.ajouter(v)
		j, tenue := a.places.joueurA(e.FilmIndex, fr)
		w := verdictDeLaPlaceLue(j, tenue, vrai)
		lue.ajouter(w)
		p, pAutre, _ := tireurs.tireur(e.FilmIndex, fr)
		x := verdictDuSiege(p, pAutre, vrai, e.FilmIndex)
		publie.ajouter(x)
		if !parUnite {
			siegeHorsUnite.ajouter(v)
			lueHorsUnite.ajouter(w)
			publieHorsUnite.ajouter(x)
		}
	}
	t.Logf("publie (lue, puis siege) : %+v (hors reference 0 : %+v)", publie, publieHorsUnite)
	validationCroisee(t, a, occ)
	t.Logf("places : %+v ; tirs : %+v", a.places.cov, a.doc.Coverage.Shots)
	t.Logf("siege du roster   : %+v (hors reference 0 : %+v)", siege, siegeHorsUnite)
	t.Logf("place lue (tirs)  : %+v (hors reference 0 : %+v)", lue, lueHorsUnite)
	if c := a.doc.Coverage.ContinuousFire; c != nil {
		t.Logf("rafales : %+v", *c)
	}
	compterParJoueur(t, a)
}

// validationCroisee lit les places sur les tirs pairs seuls (rang dans le flux) et juge la lecture sur
// les tirs impairs, puis l inverse : la lecture ne se juge pas sur les tirs qui l ont construite.
func validationCroisee(t *testing.T, a *assemblage, occ occupantsDesSlots) {
	vies := viesParJoueur(a.doc.Tracks, a.doc.Roster, occ, a.horloge())
	for moitie := 0; moitie < 2; moitie++ {
		var apprend, juge []int
		for i, e := range a.fire {
			if !e.HasShooter || !e.Unit.Present {
				continue
			}
			if i%2 == moitie {
				apprend = append(apprend, i)
			} else {
				juge = append(juge, i)
			}
		}
		sous := make([]grammar.FireEvent, 0, len(apprend))
		for _, i := range apprend {
			sous = append(sous, a.fire[i])
		}
		lues := lirePlacesDeControle(sous, occ, a.horloge(), vies, true)
		var v verdictsDePlace
		for _, i := range juge {
			e := a.fire[i]
			vrai, ok := occ.indexA(e.Unit.Slot, int64(e.TimestampUS))
			if !ok {
				continue
			}
			j, tenue := lues.joueurA(e.FilmIndex, a.horloge().frame(e.TimestampUS))
			v.ajouter(verdictDeLaPlaceLue(j, tenue, vrai))
		}
		t.Logf("validation croisee, moitie %d : %+v (places %+v)", moitie, v, lues.cov)
	}
}

// verdict : juste, faux, place (la lecture rend la place elle-meme, sans occupant), aucun.
type verdict int

const (
	vJuste verdict = iota
	vFaux
	vPlace
	vAucun
)

func (s *verdictsDePlace) ajouter(v verdict) {
	switch v {
	case vJuste:
		s.juste++
	case vFaux:
		s.faux++
	case vPlace:
		s.place++
	default:
		s.aucun++
	}
}

// verdictDuSiege : le siege rend la place elle-meme quand aucun occupant unique ne la tient.
func verdictDuSiege(idx int, autre bool, vrai, place int) verdict {
	switch {
	case idx == vrai:
		return vJuste
	case !autre && idx == place:
		return vPlace
	}
	return vFaux
}

func verdictDeLaPlaceLue(j int, tenue bool, vrai int) verdict {
	switch {
	case !tenue:
		return vAucun
	case j == vrai:
		return vJuste
	}
	return vFaux
}

// compterParJoueur rend, par joueur, les tirs et les rafales publies (nom du roster).
func compterParJoueur(t *testing.T, a *assemblage) {
	occ := a.reg.Occupants()
	noms := map[int]string{}
	for _, r := range a.doc.Roster {
		noms[r.FilmIndex] = r.Name
	}
	tirs, rafales := map[string]int{}, map[string]int{}
	nom := func(slot uint32, fr int) string {
		pi, ok := occ.indexA(slot, int64(a.origin+uint64(fr)*a.step))
		if !ok {
			return "?"
		}
		return noms[pi]
	}
	for _, s := range a.doc.Shots {
		tirs[nom(s.Slot, s.T)]++
	}
	for _, b := range a.doc.Bursts {
		rafales[nom(b.Slot, b.T0)]++
	}
	var tous []string
	for n := range tirs {
		tous = append(tous, n)
	}
	for n := range rafales {
		if _, vu := tirs[n]; !vu {
			tous = append(tous, n)
		}
	}
	sort.Strings(tous)
	for _, n := range tous {
		t.Logf("  %-22s tirs %5d  rafales %4d", n, tirs[n], rafales[n])
	}
}
