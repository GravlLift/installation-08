package replay

// tirs_par_place.go — LE TIREUR D UN TIR EST L OCCUPANT DE SA PLACE (lot M4b.4 de la campagne
// « retours rejeu », 2026-09-24 ; regle des places de l utilisateur du 2026-09-23).
//
// # LE FAIT
//
// L index de tireur d un record de tir (`grammar.FireEvent.FilmIndex`, cinq bits depuis M4b) et
// l index de controle d une rafale (`types.ContinuousFireBurst.PlayerIndex`) ne sont pas l index
// de participant : c est la PLACE, et le remplacant en herite (sonde P4, `sieges_tirs.go` : 3
// remplacements sur 3). Le rattachement d avant cherchait les slots du JOUEUR de cet index — ceux
// du partant — et perdait les tirs du remplacant (sans slot) ou les rendait a un absent.
//
// # LA REGLE
//
// Un tir de la place P a la frame F appartient d abord au joueur qui tient P a F selon la lecture des
// places dans les tirs ([tireursDesPlaces], places_de_controle.go). A defaut, il appartient a l entree
// du roster dont un INTERVALLE de presence
// est tenu a P (`PresenceInterval.Seat`, sinon `RosterEntry.Seat`) et couvre F — jusqu a `toMax`, la borne d affichage : deux occupants successifs
// d une place ne se recouvrent pas (`sieges_places.go`). Sans occupant unique a cet instant, la
// place reste l index : c est exactement le rattachement d avant, juste pour tout joueur sans
// relais. Le compte des tirs rendus a un AUTRE index que la place est publie (`coverage.seats`
// pour les tirs, `coverage.continuousFire.byPlace` pour les rafales).
//
// PUR : aucune I/O.

import (
	"github.com/JGtm/halo-infinite-film-decoder/internal/facts/fallback"
	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar"
)

// occupantDePlace est un INTERVALLE de presence d'une entree, tenu a une place : l'index de joueur de
// l'entree et cet intervalle seul.
type occupantDePlace struct {
	index    int
	presence []PresenceInterval
}

// tireursParPlace indexe les occupants du roster par place.
type tireursParPlace map[int][]occupantDePlace

// nouveauxTireursParPlace indexe le roster POSE (apres `poserLesSieges`), PAR INTERVALLE : un joueur
// qui revient peut tenir une autre fiche que la premiere, et la place se publie alors par intervalle
// (`PresenceInterval.Seat`, sinon `RosterEntry.Seat`). Chaque intervalle n'est range que sous SA place.
func nouveauxTireursParPlace(roster []RosterEntry) tireursParPlace {
	out := tireursParPlace{}
	for _, e := range roster {
		for _, iv := range e.Presence { // aucune presence : rien ne dit quand cette entree tient sa place
			place := e.Seat
			if iv.Seat != nil {
				place = *iv.Seat
			}
			out[place] = append(out[place], occupantDePlace{index: e.FilmIndex, presence: []PresenceInterval{iv}})
		}
	}
	return out
}

// tireur rend l index de joueur de l occupant de la place a la frame, et vrai quand il differe de
// la place. Sans occupant UNIQUE qui couvre la frame, la place elle-meme.
func (t tireursParPlace) tireur(place, fr int) (int, bool) {
	trouve, n := place, 0
	for _, o := range t[place] {
		if presenceCouvre(o.presence, fr) {
			trouve = o.index
			n++
		}
	}
	if n != 1 {
		return place, false
	}
	return trouve, trouve != place
}

// presenceCouvre dit si une presence couvre la frame, jusqu a sa borne d affichage.
func presenceCouvre(ivs []PresenceInterval, fr int) bool {
	for _, iv := range ivs {
		fin := iv.To
		if iv.ToMax != nil {
			fin = *iv.ToMax
		}
		if fr >= iv.From && fr <= fin {
			return true
		}
	}
	return false
}

// tireursDesPlaces rend le tireur d une place a une frame : le joueur qui la tient selon la lecture des
// places dans les tirs (places_de_controle.go), sinon l occupant du siege du roster (le repli
// `repli_tireur_par_le_siege_de_la_place`), sinon la place elle-meme. La lecture prime parce qu elle
// date la place joueur par joueur depuis les tirs dont l unite nomme le tireur, la ou le siege suit la
// fiche affichee, qui ne couvre pas toujours l instant du tir (un arrivant en cours de match). Les tirs
// et les rafales sont comptes par source dans `coverage.controlPlaces`.
type tireursDesPlaces struct {
	lues   placesDeControle
	sieges tireursParPlace
	// cov recoit les comptes par source (`coverage.controlPlaces`) ; nil ne compte rien.
	cov *ControlPlaceCoverage
}

// tireur rend l index de joueur du tireur de la place a la frame, vrai quand il differe de la place,
// et vrai quand il vient du siege (le repli).
func (t tireursDesPlaces) tireur(place, fr int) (idx int, autre, parLeSiege bool) {
	if j, ok := t.lues.joueurA(place, fr); ok {
		return j, j != place, false
	}
	idx, autre = t.sieges.tireur(place, fr)
	return idx, autre, true
}

// tirsParPlace rend une COPIE des evenements de tir dont l index est celui du tireur de la place a
// l instant du tir, et le nombre de tirs rendus a un autre index. Les evenements de l appelant ne
// sont pas modifies (le registre et la lecture des places les relisent tels que le film les ecrit).
func (t tireursDesPlaces) tirsParPlace(fire []grammar.FireEvent, horloge replayClock) ([]grammar.FireEvent, int) {
	if len(fire) == 0 {
		return fire, 0
	}
	out := make([]grammar.FireEvent, len(fire))
	copy(out, fire)
	autres, parLesSieges := 0, 0
	for i := range out {
		if !out[i].HasShooter {
			continue
		}
		idx, autre, parLeSiege := t.tireur(out[i].FilmIndex, horloge.frame(out[i].TimestampUS))
		t.compter(parLeSiege, false)
		if parLeSiege {
			parLesSieges++
		}
		if autre {
			out[i].FilmIndex = idx
			autres++
		}
	}
	horloge.fb.DeclencheN(fallback.NomTireurParLeSiegeDeLaPlace, parLesSieges)
	return out, autres
}

// compter range un tir (ou une rafale) sous sa source.
func (t tireursDesPlaces) compter(parLeSiege, rafale bool) {
	if t.cov == nil {
		return
	}
	switch {
	case rafale && parLeSiege:
		t.cov.BurstsBySeat++
	case rafale:
		t.cov.BurstsByPlace++
	case parLeSiege:
		t.cov.ShotsBySeat++
	default:
		t.cov.ShotsByPlace++
	}
}
