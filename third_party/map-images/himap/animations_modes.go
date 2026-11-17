// Package himap — animations_modes.go : l'arbre des modes d'un graphe d'animation, aplati en
// chemins mode / classe d'arme / type d'arme / jeu / action -> animation.
//
// Chaque niveau est un TagBlock d'enregistrements qui commencent par leur etiquette (StringID) ; le
// premier TagBlock d'un enregistrement est le niveau suivant (mode -> classes, classe -> types,
// type -> jeux, jeu -> actions ; les surcouches, morts et transitions qui le suivent ne sont pas
// lus). Le pas d'un niveau se lit (taille du bloc / compte), il n'est pas suppose. Une action porte
// a +8 la reference de son animation : graphe i16 (-1 = ce graphe, k = le graphe herite de rang
// k), animation i16.
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"fmt"
	"sort"
)

// NiveauxModes : les niveaux d'un chemin de l'arbre : mode, classe d'arme, type d'arme, jeu, action.
const NiveauxModes = 5

// Grammaire d'une action.
const (
	actionOffGraphe    = 8
	actionOffAnimation = 10
	actionPasMin       = 12
	grapheLocal        = -1
)

// EntreeMode : un chemin de l'arbre des modes et l'animation qu'il designe.
type EntreeMode struct {
	// Etiquettes : mode, classe d'arme, type d'arme, jeu, action (StringID).
	Etiquettes [NiveauxModes]uint32
	// Graphe : -1 pour ce graphe, k pour le graphe herite de rang k (GrapheAnimation.Parents).
	Graphe    int
	Animation int
}

// Chemin rend le chemin en clair (NomEtiquette), niveaux separes par « / ».
func (e EntreeMode) Chemin() string {
	s := ""
	for i, id := range e.Etiquettes {
		if i > 0 {
			s += " / "
		}
		s += NomEtiquette(id)
	}
	return s
}

// litModes aplatit l'arbre des modes.
func (g *GrapheAnimation) litModes(n *navigateurTag, r int) error {
	var chemin [NiveauxModes]uint32
	return g.litNiveau(n, r, jmadOffModes, 0, &chemin)
}

// litNiveau lit les enregistrements du TagBlock (`proprio`, `champ`) au niveau `niv`.
func (g *GrapheAnimation) litNiveau(n *navigateurTag, proprio, champ, niv int, chemin *[NiveauxModes]uint32) error {
	bloc, nb := n.tagBlock(proprio, champ), n.compte(proprio, champ)
	if bloc < 0 || nb == 0 {
		return nil
	}
	b := n.octets(bloc)
	if len(b)%nb != 0 {
		return fmt.Errorf("mode level %d: %d bytes for %d records", niv, len(b), nb)
	}
	pas := len(b) / nb
	if niv == NiveauxModes-1 {
		if pas < actionPasMin {
			return fmt.Errorf("actions of %d bytes", pas)
		}
		for k := 0; k < nb; k++ {
			o := k * pas
			chemin[niv] = uint32(u32(b, o))
			g.Entrees = append(g.Entrees, EntreeMode{Etiquettes: *chemin,
				Graphe: int(int16(u16(b, o+actionOffGraphe))), Animation: int(int16(u16(b, o+actionOffAnimation)))})
		}
		return nil
	}
	premiers := premierChampParEnregistrement(n.blocs[bloc], pas)
	for k := 0; k < nb; k++ {
		chemin[niv] = uint32(u32(b, k*pas))
		c, ok := premiers[k]
		if !ok {
			continue
		}
		if err := g.litNiveau(n, bloc, c, niv+1, chemin); err != nil {
			return err
		}
	}
	return nil
}

// premierChampParEnregistrement rend, par enregistrement, le champ de son premier TagBlock.
func premierChampParEnregistrement(liens []lienTag, pas int) map[int]int {
	interne := -1
	for _, l := range liens {
		if i := l.champ % pas; interne < 0 || i < interne {
			interne = i
		}
	}
	out := map[int]int{}
	for _, l := range liens {
		if l.champ%pas == interne {
			out[l.champ/pas] = l.champ
		}
	}
	return out
}

// Cherche rend les entrees dont le chemin est `chemin` (mode, classe, type, jeu, action), chaque
// niveau donne par son nom en clair, par sa forme `#<StringID>` (etiquette hors vocabulaire, qui
// reste juste quand le vocabulaire s'etend), ou par « * » (toute etiquette) ; triees par chemin.
func (g *GrapheAnimation) Cherche(chemin [NiveauxModes]string) []EntreeMode {
	var out []EntreeMode
	for _, e := range g.Entrees {
		ok := true
		for i, s := range chemin {
			if s != "*" && s != NomEtiquette(e.Etiquettes[i]) && s != fmt.Sprintf("#%08x", e.Etiquettes[i]) {
				ok = false
				break
			}
		}
		if ok {
			out = append(out, e)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Chemin() < out[j].Chemin() })
	return out
}

// Clip decode l'animation que `chemin` (Cherche) designe dans les arbres des graphes de la chaine ;
// erreur quand le chemin n'en designe aucune ou en designe plusieurs distinctes.
func (gs *GraphesAnimation) Clip(chemin [NiveauxModes]string) (*ClipAnimation, EntreeMode, error) {
	g, rang, entree, err := gs.Designee(chemin)
	if err != nil {
		return nil, entree, err
	}
	if g == nil {
		return nil, entree, fmt.Errorf("path %v absent from the mode trees", chemin)
	}
	c, err := g.Decode(rang)
	return c, entree, err
}

// Designee rend le graphe et le rang de l'animation que `chemin` (Cherche) designe dans les arbres
// des graphes de la chaine, sans la decoder ; un graphe nil quand le chemin n'en designe aucune,
// une erreur quand il en designe plusieurs distinctes ou qu'une entree ne se resout pas.
func (gs *GraphesAnimation) Designee(chemin [NiveauxModes]string) (*GrapheAnimation, int, EntreeMode, error) {
	var trouve *GrapheAnimation
	var rangTrouve int
	var entree EntreeMode
	for _, depuis := range gs.Tous() {
		for _, e := range depuis.Cherche(chemin) {
			g, rang, err := gs.Resout(depuis, e)
			if err != nil {
				return nil, 0, e, err
			}
			if trouve != nil && (trouve != g || rangTrouve != rang) {
				return nil, 0, e, fmt.Errorf("path %v ambiguous: animations %d of %08x and %d of %08x", chemin, rangTrouve, trouve.ID, rang, g.ID)
			}
			trouve, rangTrouve, entree = g, rang, e
		}
	}
	return trouve, rangTrouve, entree, nil
}

// ClipNomme decode l'animation dont le nom du jeu est `nom` : `mode:classe[:type]:action`, niveaux
// `any` omis (NomAnimation), ce qui atteint aussi les animations que l'arbre des modes ne designe
// pas (rechargement, corps a corps, lancer, rangement, degainage). Le graphe propre passe avant ceux
// dont il herite, qu'il surcharge ; erreur quand aucun graphe ne porte ce nom ou qu'un graphe le
// porte deux fois.
func (gs *GraphesAnimation) ClipNomme(nom string) (*ClipAnimation, error) {
	g, rang, err := gs.Nommee(nom)
	if err != nil {
		return nil, err
	}
	if g == nil {
		return nil, fmt.Errorf("name %q (%08x) absent from the graphs", nom, NomAnimation(nom))
	}
	return g.Decode(rang)
}

// Nommee rend le graphe et le rang de l'animation dont le nom du jeu est `nom` (ClipNomme), sans la
// decoder ; un graphe nil quand aucun graphe ne porte ce nom.
func (gs *GraphesAnimation) Nommee(nom string) (*GrapheAnimation, int, error) {
	id := NomAnimation(nom)
	for _, g := range gs.Tous() {
		rang := -1
		for _, a := range g.Animations {
			if a.Nom != id {
				continue
			}
			if rang >= 0 {
				return nil, 0, fmt.Errorf("name %q carried by animations %d and %d of graph %08x", nom, rang, a.Rang, g.ID)
			}
			rang = a.Rang
		}
		if rang >= 0 {
			return g, rang, nil
		}
	}
	return nil, 0, nil
}
