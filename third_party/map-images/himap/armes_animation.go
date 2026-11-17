// Package himap — armes_animation.go : la classe et le type d'animation d'une arme, lus dans son `weap`.
//
// Le nom d'une animation du Spartan a la troisieme personne est `mode:classe[:type]:action` : la
// classe (`rifle`, `pistol`, `missile`, ...) et le type (`br`, `strk`, `mlrs`, ...) sont ceux de
// l'arme tenue. Le `weap` les porte dans un meme enregistrement : l'etiquette de la classe (StringID),
// puis celle du type deux fois, a +24 et a +28. L'enregistrement se trouve en balayant le tag, aligne
// sur 4 octets, jusqu'au premier mot qui est une classe de l'arbre des modes du graphe (niveau 1,
// `any` exclu) suivi du meme type aux deux places. Un type nul : l'arme n'a pas de type, ses clips sont
// ceux de sa classe.
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"fmt"
)

// Grammaire de l'enregistrement d'animation d'un `weap`.
const (
	armeOffType       = 24
	armeOffTypeDouble = 28
)

// EtiquettesArme : la classe et le type d'animation d'une arme (StringID, NomEtiquette pour le texte) ;
// Type nul pour une arme sans type.
type EtiquettesArme struct {
	Classe, Type uint32
}

// EtiquettesAnimationArme lit la classe et le type d'animation du `weap` `weap`, les classes etant
// celles des arbres des modes de `gs` (les graphes du Spartan) ; erreur quand le tag n'est pas un
// `weap` lisible ou ne porte pas l'enregistrement.
func (a *Arsenal) EtiquettesAnimationArme(weap uint32, gs *GraphesAnimation) (EtiquettesArme, error) {
	if !a.estDuGroupe(weap, GroupeArme) {
		return EtiquettesArme{}, fmt.Errorf("%08x is not a %q tag", weap, GroupeArme)
	}
	raw, err := a.geo.Extract(weap)
	if err != nil {
		return EtiquettesArme{}, fmt.Errorf("%08x : %w", weap, err)
	}
	classes := classesDesModes(gs)
	for o := 0; o+armeOffTypeDouble+4 <= len(raw); o += 4 {
		c, t := uint32(u32(raw, o)), uint32(u32(raw, o+armeOffType))
		if classes[c] && t == uint32(u32(raw, o+armeOffTypeDouble)) {
			return EtiquettesArme{Classe: c, Type: t}, nil
		}
	}
	return EtiquettesArme{}, fmt.Errorf("%08x: no class-then-animation-type record", weap)
}

// classesDesModes rend les etiquettes de classe d'arme (niveau 1 de l'arbre des modes, `any` exclu)
// des graphes de la chaine.
func classesDesModes(gs *GraphesAnimation) map[uint32]bool {
	tout := NomAnimation("any")
	out := map[uint32]bool{}
	for _, g := range gs.Tous() {
		for _, e := range g.Entrees {
			if e.Etiquettes[1] != tout {
				out[e.Etiquettes[1]] = true
			}
		}
	}
	return out
}
