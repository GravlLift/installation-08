// Package himap — premiere_personne_actions.go : de l'action du jeu a ses animations, dans le graphe
// a la premiere personne d'une arme.
//
// L'arbre des modes d'un graphe FP n'a que des niveaux `any` hors l'action (sauf une posture
// alternative, non lue ici, et les jeux de l'equipement, lus par ClipsDeLActionDuJeu) : une action se cherche au chemin
// `any / any / any / any / <action>`, par le StringID de son nom, sans dependre du vocabulaire. C'est
// l'arbre qui fait foi : le nom d'une animation n'est pas toujours celui de l'action qui la designe
// (l'action `fire_1` du BR75 designe une animation qui ne s'appelle pas `first_person:fire_1`). Les
// surcouches (`moving`, `jump`, `land_soft`, ...) vivent hors de la partie de l'arbre que le lecteur
// aplatit : elles se trouvent par leur nom `first_person:<action>`.
//
// VARIANTES : le champ « animation suivante » (AnimationGraphe.Suivante) chaine les variantes d'une
// meme action (`moving` -> `moving:var1` -> `moving:var2`) ; l'action designe la premiere.
package himap

import (
	"fmt"
	"strconv"
	"strings"
)

// PrefixeNomPremierePersonne : le nom du jeu d'une animation FP est ce prefixe suivi de l'action.
const PrefixeNomPremierePersonne = "first_person:"

// variantesMax : au-dela, une chaine de variantes est tenue pour une boucle.
const variantesMax = 16

// Sources d'une animation d'action.
const (
	// SourceArbre : l'arbre des modes designe l'animation.
	SourceArbre = "tree"
	// SourceNom : l'animation porte le nom `first_person:<action>` et l'arbre ne designe pas l'action.
	SourceNom = "name"
)

// ClipAction : une animation qu'une action designe.
type ClipAction struct {
	Action string
	// Variante : 0 pour l'animation que l'action designe, k pour la k-ieme de sa chaine de variantes.
	Variante int
	// Source : SourceArbre ou SourceNom.
	Source string
	Graphe *GrapheAnimation
	Rang   int
}

// Animation rend l'enregistrement de l'animation.
func (c ClipAction) Animation() AnimationGraphe { return c.Graphe.Animations[c.Rang] }

// ClipsDeLAction rend les animations de l'action `action` : celle que l'arbre des modes designe et
// ses variantes ; quand l'arbre ne porte pas l'action et que `parNom` est vrai, celle qui porte le nom
// `first_person:<action>` et ses variantes. Vide quand ni l'un ni l'autre ne la trouve ; erreur
// quand l'arbre la designe de facon ambigue ou qu'une entree ne se resout pas.
func (gs *GraphesAnimation) ClipsDeLAction(action string, parNom bool) ([]ClipAction, error) {
	chemin := [NiveauxModes]string{"any", "any", "any", "any", fmt.Sprintf("#%08x", NomAnimation(action))}
	g, rang, err := gs.designeeSurchargee(chemin)
	if err != nil {
		return nil, fmt.Errorf("action %q : %w", action, err)
	}
	source := SourceArbre
	if g == nil && parNom {
		if g, rang, err = gs.Nommee(PrefixeNomPremierePersonne + action); err != nil {
			return nil, fmt.Errorf("action %q : %w", action, err)
		}
		source = SourceNom
	}
	if g == nil {
		return nil, nil
	}
	return chaineDeVariantes(action, source, g, rang), nil
}

// ClipsDeLActionDuJeu rend les animations de l'action `action` sous le jeu `jeu` (chemin
// `any / any / any / <jeu> / <action>`) et leurs variantes ; l'action des clips rendus est
// NomActionDuJeu(jeu, action). Vide quand l'arbre ne la porte pas. `jeu` is a label text or, for a
// label whose text is unknown, its StringID form `#<8 hex digits>` (EtiquetteCherchee).
func (gs *GraphesAnimation) ClipsDeLActionDuJeu(jeu, action string) ([]ClipAction, error) {
	chemin := [NiveauxModes]string{"any", "any", "any", EtiquetteCherchee(jeu), EtiquetteCherchee(action)}
	nom := NomActionDuJeu(jeu, action)
	g, rang, err := gs.designeeSurchargee(chemin)
	if err != nil {
		return nil, fmt.Errorf("action %q : %w", nom, err)
	}
	if g == nil {
		return nil, nil
	}
	return chaineDeVariantes(nom, SourceArbre, g, rang), nil
}

// EtiquetteCherchee (LOCAL-CHANGE) returns the `#<StringID>` form Cherche matches for a mode-tree
// label: `nom` itself when it already is that form (a label whose text no dictionary has found),
// the StringID of its text otherwise.
func EtiquetteCherchee(nom string) string {
	if len(nom) == 9 && nom[0] == '#' {
		if _, err := strconv.ParseUint(nom[1:], 16, 32); err == nil {
			return strings.ToLower(nom)
		}
	}
	return fmt.Sprintf("#%08x", NomAnimation(nom))
}

// NomDuJeuPremierePersonne rend le nom du jeu de l'animation qu'une action d'un jeu designe : les
// cinq niveaux du chemin, `any` compris (`any:any:any:knockback:equipment_activate`, verifie par
// son StringID sur les graphes FP).
func NomDuJeuPremierePersonne(jeu, action string) string {
	return "any:any:any:" + jeu + ":" + action
}

// designeeSurchargee rend l'animation que `chemin` designe dans l'arbre du premier graphe de la chaine
// qui le porte (Tous : le graphe propre d'abord, qui surcharge ceux dont il herite) ; un graphe nil
// quand aucun ne le porte, une erreur quand ce graphe le designe de deux facons.
func (gs *GraphesAnimation) designeeSurchargee(chemin [NiveauxModes]string) (*GrapheAnimation, int, error) {
	for _, depuis := range gs.Tous() {
		var trouve *GrapheAnimation
		rangTrouve := 0
		for _, e := range depuis.Cherche(chemin) {
			g, rang, err := gs.Resout(depuis, e)
			if err != nil {
				return nil, 0, err
			}
			if trouve != nil && (trouve != g || rangTrouve != rang) {
				return nil, 0, fmt.Errorf("chemin %v ambigu dans le graphe %08x", chemin, depuis.ID)
			}
			trouve, rangTrouve = g, rang
		}
		if trouve != nil {
			return trouve, rangTrouve, nil
		}
	}
	return nil, 0, nil
}

// chaineDeVariantes rend l'animation `rang` de `g` et les variantes qui la suivent.
func chaineDeVariantes(action, source string, g *GrapheAnimation, rang int) []ClipAction {
	var out []ClipAction
	vus := map[int]bool{}
	for r := rang; r >= 0 && r < len(g.Animations) && !vus[r] && len(out) < variantesMax; r = g.Animations[r].Suivante {
		vus[r] = true
		out = append(out, ClipAction{Action: action, Variante: len(out), Source: source, Graphe: g, Rang: r})
	}
	return out
}
