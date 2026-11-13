package grammar

// vue_a_actions.go — LES MESSAGES D ACTION DU JOUEUR DE LA VUE A, GARDES AVEC LEURS REFERENCES.
//
// La lecture de la vue A ([lireLaVueA]) lit deja chaque message jusqu a son terminateur ; ce
// fichier nomme les genres dont elle GARDE le message ([genreDAction]) et l assemble
// ([messageDAction]) : les deux premieres references que [lireUnMessage] vient de lire et la charge que le
// lecteur du genre a gardee (`br.actionLue`). AUCUN BIT N EST LU ICI : le changement est l inverse
// d un oubli, la valeur deja lue est gardee au lieu d etre jetee.

import (
	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar/lecture"
	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// GenreDegatsApres est le genre de `damage_aftermath` (numerotation de `FUN_140e453b4`), nomme pour
// ne plus relire le litteral ailleurs que dans cette grammaire.
const GenreDegatsApres = int(types.FilmActionDamage)

// genreDAction dit que la lecture de la vue A garde les messages du genre `genre` : les degats, et
// les trois gestes dont la reference 0 nomme le bipede qui agit (rechargement, lancer amorce, coup
// de corps a corps).
func genreDAction(genre int) bool {
	switch uint8(genre) { //nolint:gosec // genre R(7)
	case types.FilmActionDamage, types.FilmActionReload, types.FilmActionThrowStart, types.FilmActionMelee:
		return true
	}
	return false
}

// messageDAction assemble le message d action que la lecture de la vue A vient de lire : ses deux
// premieres references, son genre, sa position, et la charge que son lecteur a gardee sur `br.actionLue`
// (genre 0 seul ; les autres genres n en gardent aucune).
func messageDAction(br *Lecteur, genre, debut int) lecture.MessageDAction {
	var m lecture.MessageDAction
	if genre == GenreDegatsApres {
		m = br.actionLue
	}
	m.Debut = uint32(debut) //nolint:gosec // position dans un payload
	m.Genre = uint8(genre)  //nolint:gosec // genre R(7)
	for i, r := range br.refsDuMessage[:len(m.Ref)] {
		if r.presente {
			m.Ref[i], m.Gen[i] = uint16(r.index), uint8(r.gen) //nolint:gosec // index de domaine, 13 bits au plus ; generation 2 bits
			m.Drapeaux |= lecture.ActionRef0 << uint(i)
		}
	}
	return m
}
