// LOCAL-CHANGE (infinite-theater-3d): log and error strings translated to English.
package replay

// document_actions_joueur.go — LES ACTIONS DU JOUEUR QUE LE FILM ECRIT ET QUE LE DECODEUR LISAIT
// DEJA (schema 107) : l arme desiree a chaque changement (`i42`), les degats non letaux
// (`damage_aftermath`, vue A) et la cause de chaque kill (killsource).
//
// TROIS LISTES D EVENEMENTS, AUCUN CHAMP PAR FRAME : un changement d arme, un degat ou un kill est
// un instant, et le client tient l etat entre deux.

import (
	"context"
	"log/slog"

	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// DrawnWeapon est UN changement du jeu d armes desire d une vie, sur l axe de frames du document.
type DrawnWeapon struct {
	// T est l index de frame du paquet delta qui porte la lecture, sur le meme axe que Point.T.
	T int `json:"t"`
	// Slot designe la Track concernee.
	Slot uint32 `json:"slot"`
	// D est l emplacement d arme DESIRE en main principale, la meme grandeur qu `Inventory.D`
	// (index 0..3, egal a l emplacement degaine hors d un changement en cours) ; a la difference de
	// lui, il est lu a CHAQUE changement et non aux seules images-cles. ABSENT = le film ne designe
	// aucun emplacement a cet instant.
	D *int `json:"d,omitempty"`
	// D2 est l emplacement desire en seconde main ; absent hors ambidextrie.
	D2 *int `json:"d2,omitempty"`
}

// Damage est UN message `damage_aftermath` dont l entite touchee est une vie publiee : un degat
// encaisse, letal ou non, sur l axe de frames.
type Damage struct {
	// T est l index de frame du paquet qui porte le message, sur le meme axe que Point.T.
	T int `json:"t"`
	// Slot designe la Track TOUCHEE (reference 0 du message).
	Slot uint32 `json:"slot"`
	// By designe la Track du responsable (reference 1) ; absent quand le message ne le nomme pas ou
	// que sa piste n est pas publiee (`coverage.playerActions.damagesWithoutAuthor`). Egal a Slot
	// sur un degat auto-inflige.
	By *uint32 `json:"by,omitempty"`
	// Src est l identifiant `jpt!` de la source du degat (le `R(32)` de tete de la charge), la meme
	// quantite brute que la source d un kill ; absent quand la porte du message est fermee.
	Src *uint32 `json:"src,omitempty"`
}

// KillCause est la CAUSE d un kill : la nature de la source du degat fatal et son modificateur de
// rapport de degat, lus dans le dead-state de la victime (killsource).
type KillCause struct {
	// FeedMs est l instant du kill SUR L HORLOGE DU FIL, comme `NeutralDeath.FeedMs` : le client
	// applique le meme recalage qu a ses lignes de fil.
	FeedMs int `json:"feedMs"`
	// Killer est le xuid du joueur credite ; Victim celui de la victime, absent pour une victime
	// bot (aucun xuid). La paire (Killer, FeedMs) joint la ligne de fil.
	Killer string `json:"killer"`
	Victim string `json:"victim,omitempty"`
	// Class est la nature de la source, en identifiant stable : `weapon`, `melee`, `grenade`,
	// `vehicle`, `explosive`, `environment`, `unknown`.
	Class string `json:"class"`
	// Category est le modificateur de rapport de degat sous son nom moteur (`Headshot`,
	// `SilentMelee` l assassinat, `CollisionDamage` l ecrasement, `AttachedDamage` le collage...) ;
	// absent quand il vaut `None`.
	Category string `json:"category,omitempty"`
}

// PlayerActionsCoverage dit ce que les quatre calques ont lu et ce qu ils ont ecarte.
//
// L IDENTITE DE LA COUVERTURE : drawnRead = drawnPublished + drawnNoTrack + drawnBeforeOrigin ;
// damagesRead = damagesPublished + damagesNoTrack + damagesBeforeOrigin ; damagesWithoutAuthor est
// une PARTIE de damagesPublished ; actionsRead = actionsPublished + actionsNoTrack +
// actionsBeforeOrigin.
type PlayerActionsCoverage struct {
	// DrawnRead : lectures du jeu d armes desire rendues par la marche ; DrawnSlotUnbound et
	// DrawnDuplicates : celles qu elle a ecartees (slot non lie au bipede, seconde traversee).
	DrawnRead        int `json:"drawnRead"`
	DrawnSlotUnbound int `json:"drawnSlotUnbound,omitempty"`
	DrawnDuplicates  int `json:"drawnDuplicates,omitempty"`
	// DrawnPublished, DrawnNoTrack (slot sans piste publiee), DrawnBeforeOrigin (avant la premiere
	// frame).
	DrawnPublished    int `json:"drawnPublished"`
	DrawnNoTrack      int `json:"drawnNoTrack"`
	DrawnBeforeOrigin int `json:"drawnBeforeOrigin"`
	// DamagesRead : messages `damage_aftermath` lus dans les vues A ; DamagesNoTrack : entite
	// touchee sans piste publiee (vehicule, objet, vie non publiee).
	DamagesRead          int `json:"damagesRead"`
	DamagesPublished     int `json:"damagesPublished"`
	DamagesNoTrack       int `json:"damagesNoTrack"`
	DamagesBeforeOrigin  int `json:"damagesBeforeOrigin"`
	DamagesWithoutAuthor int `json:"damagesWithoutAuthor"`
	// KillCauses : causes publiees.
	KillCauses int `json:"killCauses"`
	// ActionsRead : gestes (rechargement, lancer amorce, coup) lus dans les vues A ; ActionsNoTrack :
	// vie sans piste publiee (schema 108, document_gestes.go).
	ActionsRead         int `json:"actionsRead"`
	ActionsPublished    int `json:"actionsPublished"`
	ActionsNoTrack      int `json:"actionsNoTrack"`
	ActionsBeforeOrigin int `json:"actionsBeforeOrigin"`
}

// buildDrawnWeapons projette les lectures du jeu d armes desire sur l axe de frames : rien avant
// l origine, rien dont le slot n a pas de piste publiee.
func buildDrawnWeapons(reads []types.DrawnWeaponRead, st types.DrawnWeaponStats, published map[uint32]bool,
	origin, step uint64, cov *PlayerActionsCoverage) []DrawnWeapon {
	cov.DrawnRead, cov.DrawnSlotUnbound, cov.DrawnDuplicates = st.Read, st.SlotUnbound, st.Duplicates
	if step == 0 {
		return nil
	}
	var out []DrawnWeapon
	for _, r := range reads {
		switch {
		case r.TimestampUS < origin:
			cov.DrawnBeforeOrigin++
		case !published[r.Slot]:
			cov.DrawnNoTrack++
		default:
			out = append(out, DrawnWeapon{T: int((r.TimestampUS - origin) / step), Slot: r.Slot,
				D: emplacementPublie(r.Principal), D2: emplacementPublie(r.Second)})
			cov.DrawnPublished++
		}
	}
	return out
}

// emplacementPublie rend l emplacement lu, nil pour -1 (aucun emplacement designe).
func emplacementPublie(v int8) *int {
	if v < 0 {
		return nil
	}
	e := int(v)
	return &e
}

// buildDamages projette les messages `damage_aftermath` sur l axe de frames : rien avant l origine,
// rien dont l entite touchee n a pas de piste publiee.
func buildDamages(msgs []types.FilmActionMessage, published map[uint32]bool, origin, step uint64,
	cov *PlayerActionsCoverage) []Damage {
	if step == 0 {
		return nil
	}
	var out []Damage
	for _, m := range msgs {
		if m.Genre != types.FilmActionDamage {
			continue
		}
		cov.DamagesRead++
		switch {
		case m.TimestampUS < origin:
			cov.DamagesBeforeOrigin++
		case !m.HasActor || !published[m.Actor.Slot]:
			cov.DamagesNoTrack++
		default:
			d := Damage{T: int((m.TimestampUS - origin) / step), Slot: m.Actor.Slot}
			if m.HasOther && published[m.Other.Slot] {
				by := m.Other.Slot
				d.By = &by
			} else {
				cov.DamagesWithoutAuthor++
			}
			if m.HasSource {
				src := m.Source
				d.Src = &src
			}
			out = append(out, d)
			cov.DamagesPublished++
		}
	}
	return out
}

// keepKillCausesOfPublishedTracks garde les causes dont le tueur a une trajectoire publiee : une
// cause sans piste ne rencontrerait aucune ligne de fil a decorer (meme regle que les morts sans
// revendication).
func keepKillCausesOfPublishedTracks(causes []KillCause, published map[string]bool) []KillCause {
	var out []KillCause
	for _, c := range causes {
		if published[c.Killer] {
			out = append(out, c)
		}
	}
	return out
}

// logPlayerActionsCoverage sort la couverture des quatre calques.
func logPlayerActionsCoverage(ctx context.Context, cov PlayerActionsCoverage, killCausesIn int) {
	slog.InfoContext(ctx, "replay: player actions",
		"armesLues", cov.DrawnRead, "armesPubliees", cov.DrawnPublished, "armesSansPiste", cov.DrawnNoTrack,
		"armesAvantOrigine", cov.DrawnBeforeOrigin, "armesSlotNonLie", cov.DrawnSlotUnbound,
		"degatsLus", cov.DamagesRead, "degatsPublies", cov.DamagesPublished, "degatsSansPiste", cov.DamagesNoTrack,
		"degatsAvantOrigine", cov.DamagesBeforeOrigin, "degatsSansAuteur", cov.DamagesWithoutAuthor,
		"causesRecues", killCausesIn, "causesPubliees", cov.KillCauses, "gestesLus", cov.ActionsRead,
		"gestesPublies", cov.ActionsPublished, "gestesSansPiste", cov.ActionsNoTrack,
		"gestesAvantOrigine", cov.ActionsBeforeOrigin)
}
