package grammar

// actions_du_film.go — LES MESSAGES D ACTION DU JOUEUR D UN FILM : l instant et la vie de chaque
// message de la vue A que [genreDAction] garde ([messageDAction], vue_a_actions.go).
//
// LECTURE SEULE, sans seuil : ce balayage rend ce que la vue A ecrit. Une liste arretee avant son
// message ne le rend pas. La vie d une reference porte la BASE DE SON DOMAINE ([baseDuDomaine]) :
// l index brut plus cette base est le slot de l entite, comparable a [BipedPosition.Slot].

import (
	"cmp"
	"slices"

	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar/lecture"
	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// ScanFilmActions lit les messages d action du joueur d un film DEJA CHARGE, dans la passe des
// tetes, tries par instant.
func ScanFilmActions(fc *FilmContext) []types.FilmActionMessage {
	c := &canalDesActions{}
	distribuerLesTetesSeules(fc, []Canal{c})
	return c.out
}

// canalDesActions recueille les messages d action de la vue A de chaque trame.
type canalDesActions struct{ out []types.FilmActionMessage }

func (*canalDesActions) Interets() []Interet { return nil }

func (c *canalDesActions) Tete(p *lecture.Paquet) {
	for _, m := range p.VueA.Actions {
		c.out = append(c.out, actionDuMessage(p.TS, m))
	}
}

func (c *canalDesActions) Clore(BilanDeMarche) {
	slices.SortStableFunc(c.out, func(a, b types.FilmActionMessage) int {
		return cmp.Compare(a.TimestampUS, b.TimestampUS)
	})
}

// actionDuMessage traduit un message d action lu en message publie : ses references 0 et 1 en vies,
// sous la base de leur domaine, et la charge gardee du genre 0.
func actionDuMessage(ts uint64, m lecture.MessageDAction) types.FilmActionMessage {
	domaines, _ := descripteurDuGenre(int(m.Genre))
	out := types.FilmActionMessage{TimestampUS: ts, Genre: m.Genre}
	if m.ADrapeau(lecture.ActionRef0) {
		out.Actor, out.HasActor = vieDeReference(domaines[0], m.Ref[0], m.Gen[0]), true
	}
	if m.Genre == types.FilmActionDamage {
		if m.ADrapeau(lecture.ActionRef1) {
			out.Other, out.HasOther = vieDeReference(domaines[1], m.Ref[1], m.Gen[1]), true
		}
		out.Source, out.HasSource = m.Source, m.ADrapeau(lecture.ActionSourceLue)
	}
	return out
}

// vieDeReference rend la vie d une reference de domaine `dom` : son index brut plus la base du
// domaine, et sa generation.
func vieDeReference(dom int, index uint16, gen uint8) types.LifeKey {
	return types.LifeKey{Slot: uint32(index) + baseDuDomaine(dom), Gen: uint32(gen)}
}

// baseDuDomaine est la BASE que `FUN_1406d3140` ajoute a l index d une reference de categorie `dom`,
// telle que l initialiseur `FUN_140d10bb0` l ecrit (varwidth.go) : 0x200 pour les categories 0, 1,
// 2 et 4 (la sonde de la categorie 1 bascule sur l entree 4, de meme base), 0x300 pour la 3, 0x400
// pour la 5, zero pour les autres.
func baseDuDomaine(dom int) uint32 {
	switch dom {
	case 0, 1, 2, 4:
		return 0x200
	case 3:
		return 0x300
	case 5:
		return 0x400
	}
	return 0
}
