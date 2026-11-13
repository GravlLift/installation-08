package replay

// document_gestes.go — LES GESTES DU JOUEUR QUE LA VUE A ECRIT (schema 108) : rechargement
// (`weapon_reload`, genre 38), lancer amorce (`biped_throw_initiate`, 39) et coup de corps a corps
// (`biped_melee_initiate`, 40), chacun a l instant ou le moteur le declenche.
//
// UNE LISTE D EVENEMENTS, AUCUN CHAMP PAR FRAME : un geste est un instant ; sa duree d animation
// n est pas dans le film.

import (
	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// PlayerAction est UN geste d une vie publiee, sur l axe de frames du document.
type PlayerAction struct {
	// T est l index de frame du paquet qui porte le message, sur le meme axe que Point.T.
	T int `json:"t"`
	// Ms est l instant du geste a la MILLISECONDE, sur l axe des colonnes `fullRate.t` (ms depuis
	// l origine de la grille, schema 111).
	Ms int64 `json:"ms"`
	// Slot designe la Track qui agit (reference 0 du message).
	Slot uint32 `json:"slot"`
	// Kind est le geste, en identifiant stable : `reload`, `throwStart` (le lancer d une grenade
	// commence ; le projectile part plus tard, `grenades`), `melee` (le coup part) ou `jump`
	// (l impulsion du bouton de saut lue dans la vue de controle, schema 111,
	// postures_de_controle.go). Un genre inconnu du client ne doit recevoir AUCUN libelle.
	Kind string `json:"kind"`
}

// gestesPublies nomme les genres de geste que [buildPlayerActions] publie.
var gestesPublies = map[uint8]string{
	types.FilmActionReload:     "reload",
	types.FilmActionThrowStart: "throwStart",
	types.FilmActionMelee:      "melee",
}

// buildPlayerActions projette les gestes sur l axe de frames : rien avant l origine, rien dont la
// vie qui agit n a pas de piste publiee. Les degats (genre 0) sont l affaire de [buildDamages].
func buildPlayerActions(msgs []types.FilmActionMessage, published map[uint32]bool, origin, step uint64,
	cov *PlayerActionsCoverage) []PlayerAction {
	if step == 0 {
		return nil
	}
	var out []PlayerAction
	for _, m := range msgs {
		kind, ok := gestesPublies[m.Genre]
		if !ok {
			continue
		}
		cov.ActionsRead++
		switch {
		case m.TimestampUS < origin:
			cov.ActionsBeforeOrigin++
		case !m.HasActor || !published[m.Actor.Slot]:
			cov.ActionsNoTrack++
		default:
			out = append(out, PlayerAction{T: int((m.TimestampUS - origin) / step), //nolint:gosec // horloge du film
				Ms: int64((m.TimestampUS - origin) / fullRateTimeUnitUS), Slot: m.Actor.Slot, Kind: kind})
			cov.ActionsPublished++
		}
	}
	return out
}
