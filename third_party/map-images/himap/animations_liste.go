// Package himap — animations_liste.go : la fiche de chaque animation d'une chaine de graphes
// (rang, nom, chemins de l'arbre des modes qui la designent, images, codecs, deplacement) et le
// bilan de decodage d'un graphe.
package himap

import (
	"errors"
	"sort"
)

// FicheAnimation : ce que la liste dit d'une animation sans la decoder.
type FicheAnimation struct {
	Graphe uint32
	AnimationGraphe
	// NomClair : le nom en clair (NomEtiquette), `#<StringID>` hors vocabulaire.
	NomClair string
	// Chemins : les chemins en clair de l'arbre des modes de la chaine qui la designent, tries.
	Chemins []string
	// CodecAnime, CodecStatique : les codecs des flux (CodecAucun quand le flux est vide) ; -1
	// quand le membre de ressource manque.
	CodecAnime, CodecStatique int
}

// Deplacee dit si l'animation porte un deplacement de racine.
func (f FicheAnimation) Deplacee() bool { return f.Mouvement != MouvementAucun }

// Fiches rend la fiche de chaque animation du graphe `g` de la chaine.
func (gs *GraphesAnimation) Fiches(g *GrapheAnimation) []FicheAnimation {
	chemins := map[int][]string{}
	for _, depuis := range gs.Tous() {
		for _, e := range depuis.Entrees {
			if cible, rang, err := gs.Resout(depuis, e); err == nil && cible == g {
				chemins[rang] = append(chemins[rang], e.Chemin())
			}
		}
	}
	out := make([]FicheAnimation, 0, len(g.Animations))
	for _, a := range g.Animations {
		f := FicheAnimation{Graphe: g.ID, AnimationGraphe: a, NomClair: NomEtiquette(a.Nom), Chemins: chemins[a.Rang],
			CodecAnime: -1, CodecStatique: -1}
		sort.Strings(f.Chemins)
		if m, ok := g.membres[[2]int{a.Groupe, a.Membre}]; ok {
			sec := sectionsDuMembre(m)
			f.CodecAnime = codecDuFlux(sec[sectionAnimee])
			f.CodecStatique = max(codecDuFlux(sec[sectionStatique]), codecDuFlux(sec[sectionStatiquePartage]))
		}
		out = append(out, f)
	}
	return out
}

// codecDuFlux rend l'octet de codec d'un flux, CodecAucun pour un flux vide.
func codecDuFlux(b []byte) int {
	if len(b) == 0 {
		return CodecAucun
	}
	return int(b[0])
}

// BilanDecodage : le resultat du decodage de toutes les animations d'un graphe.
type BilanDecodage struct {
	Decodees int
	// NonDecodees : par codec refuse (CodecNonDecodeError) ; les sortes de deplacement non lues
	// (MouvementNonLuError) sont comptees sous la cle -1 - sorte.
	NonDecodees map[int]int
	// CourbesNonLues : par raison (CourbeNonLueError), les variantes du codec 10 refusees ; elles
	// ne sont pas dans NonDecodees.
	CourbesNonLues map[string]int
	// Illisibles : les erreurs d'animations dont le codec est decode mais les donnees fausses.
	Illisibles []error
}

// Bilan decode chaque animation du graphe et compte les refus ; aucune erreur n'est avalee :
// une animation hors codec est comptee, une animation illisible est rendue.
func (g *GrapheAnimation) Bilan() BilanDecodage {
	b := BilanDecodage{NonDecodees: map[int]int{}, CourbesNonLues: map[string]int{}}
	for i := range g.Animations {
		_, err := g.Decode(i)
		var ce CodecNonDecodeError
		var me MouvementNonLuError
		var ve CourbeNonLueError
		switch {
		case err == nil:
			b.Decodees++
		case errors.As(err, &ve):
			b.CourbesNonLues[ve.Raison]++
		case errors.As(err, &ce):
			b.NonDecodees[ce.Codec]++
		case errors.As(err, &me):
			b.NonDecodees[-1-int(me.Mouvement)]++
		default:
			b.Illisibles = append(b.Illisibles, err)
		}
	}
	return b
}
