package replay

// places_de_controle.go — LA PLACE DE CONTROLE DE CHAQUE JOUEUR, LUE DANS SES TIRS.
//
// # LE FAIT
//
// L index R(5) d une entree de la vue de controle et l index de tireur d un record de tir
// (`grammar.FireEvent.FilmIndex`) sont le MEME espace : la PLACE de controle du joueur, que le jeu
// reattribue quand un joueur part et qu un autre arrive. Elle n est PAS l index du roster : sur
// 02eab71d (BTB, arrivees en cours), les arrivants jouent aux places 1, 3, 6, 15 et 16 pendant que le
// roster les numerote 26, 25, 3, 28 et 29 ; la place 15 y passe de RacinGreyson997 a Stickmaster3050.
//
// # LA LECTURE
//
// Un record de tir ecrit, dans le MEME record, la place du tireur et l unite qui tire (reference 0).
// Quand l unite est un bipede dont le registre connait l occupant a l instant
// ([occupantsDesSlots.indexA]), le record lie cette place a ce joueur, a cet instant. Un joueur dont
// toutes les liaisons designent la meme place la tient sur toute sa presence ([viesParJoueur]) ; un
// joueur lu a plusieurs places ne la tient que sur les segments que ses liaisons bornent, d une
// liaison a la derniere qui designe la meme place. Deux joueurs qui tiendraient la meme place au meme
// instant se contredisent : aucun ne la tient sur le recouvrement, et c est compte. Sur un film ou
// l index de tireur n est pas la place ([accordIndexUnite.estLaPlace]), rien n est lu.
//
// PUR : aucune I/O.

import (
	"cmp"
	"slices"

	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar"
)

// tenueDePlace : un joueur (son index de roster) tient une place sur un intervalle de frames.
type tenueDePlace struct {
	joueur int
	de, a  int
	// ext : l etendue que la tenue peut prendre pendant la lecture (cf. [tenuesDeLaPlace]).
	ext [2]int
}

// placesDeControle repond « quel joueur tient cette place a cette frame ».
type placesDeControle struct {
	parPlace map[int][]tenueDePlace
	cov      ControlPlaceCoverage
}

// ControlPlaceCoverage dit ce que la lecture des places de controle a lu (`coverage.controlPlaces`).
type ControlPlaceCoverage struct {
	// Read : la lecture a eu lieu (l index de tireur est la place sur ce film).
	Read bool `json:"read"`
	// Bindings : tirs qui lient une place a un joueur ; Players : joueurs lies ; MultiPlace : ceux lus
	// a plusieurs places ; Overlaps : recouvrements de deux joueurs sur une place, retires.
	Bindings   int `json:"bindings"`
	Players    int `json:"players"`
	MultiPlace int `json:"multiPlace"`
	Overlaps   int `json:"overlaps"`
	// ShotsByPlace / BurstsByPlace : tirs et rafales dont le tireur est le joueur que la place lue
	// designe ; ShotsBySeat / BurstsBySeat : ceux dont la place n est tenue par aucun joueur lu a cet
	// instant, rendus a l occupant du siege du roster (repli `repli_tireur_par_le_siege_de_la_place`).
	ShotsByPlace  int `json:"shotsByPlace"`
	ShotsBySeat   int `json:"shotsBySeat"`
	BurstsByPlace int `json:"burstsByPlace"`
	BurstsBySeat  int `json:"burstsBySeat"`
}

// liaisonDePlace : un tir qui lie une place a un joueur, a sa frame.
type liaisonDePlace struct {
	place, frame int
}

// lirePlacesDeControle lit les places de controle des tirs du film. `vies` donne, par index de
// joueur, la premiere et la derniere frame de ses vies publiees ([viesParJoueur]).
func lirePlacesDeControle(fire []grammar.FireEvent, occ occupantsDesSlots, horloge replayClock,
	vies map[int][2]int, actif bool) placesDeControle {
	out := placesDeControle{parPlace: map[int][]tenueDePlace{}, cov: ControlPlaceCoverage{Read: actif}}
	if !actif || occ.vide() {
		return out
	}
	parJoueur := map[int][]liaisonDePlace{}
	for _, e := range fire {
		if !e.HasShooter || !e.Unit.Present || e.FilmIndex < 0 {
			continue
		}
		pi, ok := occ.indexA(e.Unit.Slot, int64(e.TimestampUS)) //nolint:gosec // horloge du film
		if !ok {
			continue
		}
		parJoueur[pi] = append(parJoueur[pi], liaisonDePlace{place: e.FilmIndex, frame: horloge.frame(e.TimestampUS)})
		out.cov.Bindings++
	}
	parPlace := map[int][]tenueDePlace{}
	for pi, ls := range parJoueur {
		out.cov.Players++
		if !placeUnanime(ls) {
			out.cov.MultiPlace++
		}
		for _, t := range coeursDuJoueur(pi, ls, vies[pi]) {
			parPlace[t.place] = append(parPlace[t.place], t.tenue)
		}
	}
	for p, ts := range parPlace {
		out.parPlace[p], out.cov.Overlaps = tenuesDeLaPlace(ts, out.cov.Overlaps)
	}
	return out
}

// tenueALaPlace : le coeur d une tenue, sa place et jusqu ou il peut s etendre.
type tenueALaPlace struct {
	place int
	tenue tenueDePlace
}

// tenueDePlace porte, pendant la lecture, le COEUR (de la premiere a la derniere liaison) et
// l ETENDUE permise (la presence du joueur unanime ; le coeur seul sinon).
func coeursDuJoueur(pi int, ls []liaisonDePlace, vie [2]int) []tenueALaPlace {
	slices.SortStableFunc(ls, func(a, b liaisonDePlace) int { return cmp.Compare(a.frame, b.frame) })
	if placeUnanime(ls) {
		de, a := ls[0].frame, ls[len(ls)-1].frame
		ext := [2]int{de, a}
		if vie != [2]int{} {
			ext = [2]int{min(de, vie[0]), max(a, vie[1])}
		}
		return []tenueALaPlace{{place: ls[0].place, tenue: tenueDePlace{joueur: pi, de: de, a: a, ext: ext}}}
	}
	var out []tenueALaPlace
	for i := 0; i < len(ls); {
		j := i
		for j+1 < len(ls) && ls[j+1].place == ls[i].place {
			j++
		}
		de, a := ls[i].frame, ls[j].frame
		out = append(out, tenueALaPlace{place: ls[i].place, tenue: tenueDePlace{joueur: pi, de: de, a: a, ext: [2]int{de, a}}})
		i = j + 1
	}
	return out
}

// placeUnanime dit que toutes les liaisons designent la meme place.
func placeUnanime(ls []liaisonDePlace) bool {
	for _, l := range ls {
		if l.place != ls[0].place {
			return false
		}
	}
	return len(ls) > 0
}

// tenuesDeLaPlace rend les tenues d une place. Les COEURS sont prouves : deux coeurs de joueurs
// differents qui se recouvrent se contredisent, chacun perd le recouvrement (compte dans `n`). Puis
// chaque coeur s etend dans son etendue sans atteindre le coeur voisin d un autre joueur, et la part
// d un ecart que les deux etendues se disputent n est tenue par personne.
func tenuesDeLaPlace(ts []tenueDePlace, n int) ([]tenueDePlace, int) {
	slices.SortFunc(ts, func(a, b tenueDePlace) int {
		return cmp.Or(cmp.Compare(a.de, b.de), cmp.Compare(a.joueur, b.joueur), cmp.Compare(a.a, b.a))
	})
	coeurs := slices.Clone(ts)
	for i := range ts {
		for j := i + 1; j < len(ts) && ts[j].de <= ts[i].a; j++ {
			if ts[j].joueur != ts[i].joueur {
				n++
				coeurs[i].a = min(coeurs[i].a, ts[j].de-1)
				coeurs[j].de = max(coeurs[j].de, min(ts[i].a, ts[j].a)+1)
				// L ETENDUE NE REPASSE PAS LA CONTRADICTION : elle s arrete ou le coeur s arrete.
				coeurs[i].ext[1] = min(coeurs[i].ext[1], coeurs[i].a)
				coeurs[j].ext[0] = max(coeurs[j].ext[0], coeurs[j].de)
			}
		}
	}
	garde := coeurs[:0]
	for _, t := range coeurs {
		if t.de <= t.a {
			garde = append(garde, t)
		}
	}
	out := slices.Clone(garde)
	for i := range out {
		out[i].de, out[i].a = min(out[i].ext[0], out[i].de), max(out[i].ext[1], out[i].a)
	}
	for i := 0; i+1 < len(garde); i++ {
		if garde[i].joueur == garde[i+1].joueur {
			continue
		}
		// L ECART ENTRE DEUX COEURS : chacun s y etend jusqu au coeur de l autre ; la part ou les deux
		// etendues se recouvrent n est a personne.
		finAvant := min(out[i].a, garde[i+1].de-1)
		debutApres := max(out[i+1].de, garde[i].a+1)
		if finAvant >= debutApres {
			finAvant, debutApres = debutApres-1, finAvant+1
		}
		out[i].a, out[i+1].de = max(finAvant, garde[i].a), min(debutApres, garde[i+1].de)
	}
	return out, n
}

// joueurA rend le joueur (index de roster) qui tient la place `place` a la frame `fr`.
func (p placesDeControle) joueurA(place, fr int) (int, bool) {
	for _, t := range p.parPlace[place] {
		if fr >= t.de && fr <= t.a {
			return t.joueur, true
		}
	}
	return 0, false
}

// placeDe rend la place que le joueur `pi` tient a la frame `fr` ; la plus petite s il en tenait deux,
// pour que la reponse ne depende pas du parcours de la map.
func (p placesDeControle) placeDe(pi, fr int) (int, bool) {
	trouve, ok := 0, false
	for place, ts := range p.parPlace {
		for _, t := range ts {
			if t.joueur == pi && fr >= t.de && fr <= t.a && (!ok || place < trouve) {
				trouve, ok = place, true
			}
		}
	}
	return trouve, ok
}

// viesParJoueur rend, par index de joueur, la premiere et la derniere frame ou il est present : ses
// intervalles de presence au roster (`RosterEntry.Presence`, jusqu a `toMax`) et ses vies publiees
// (une vie appartient au joueur que le registre lit sur son slot a son debut, a son milieu ou a sa fin).
func viesParJoueur(tracks []Track, roster []RosterEntry, occ occupantsDesSlots, horloge replayClock) map[int][2]int {
	out := map[int][2]int{}
	etendre := func(pi, de, a int) {
		if v, vu := out[pi]; vu {
			de, a = min(v[0], de), max(v[1], a)
		}
		out[pi] = [2]int{de, a}
	}
	for _, r := range roster {
		for _, iv := range r.Presence {
			fin := iv.To
			if iv.ToMax != nil {
				fin = max(fin, *iv.ToMax)
			}
			etendre(r.FilmIndex, iv.From, max(fin, iv.From))
		}
	}
	for _, tr := range tracks {
		for _, fr := range [...]int{tr.StartFrame, (tr.StartFrame + tr.EndFrame) / 2, tr.EndFrame} {
			if pi, ok := occ.indexA(tr.Slot, int64(horloge.origin+uint64(fr)*horloge.step)); ok { //nolint:gosec // horloge du film
				etendre(pi, tr.StartFrame, tr.EndFrame)
			}
		}
	}
	return out
}
