// Package himap — premiere_personne.go : les sources de la vue a la premiere personne du rejeu 3D,
// les bras du Spartan et, par arme, son modele et son graphe d'animation a la premiere personne.
//
// BRAS : un seul modele pour tous les noyaux d'armure. Les globales joueur (`glpa`, module
// `any/globals`) le portent dans leur table de dependances, un `hlmt` qui depend d'un `mode` (les
// bras : chaque piece de bras de chaque noyau en est une permutation, sous les memes regions que le
// Spartan a la troisieme personne) et d'un `jmad` (le graphe des bras seuls). Lus par les tables de
// dependances : le GlobalID du `hlmt` est un petit entier (0x1f) qu'un balayage d'octets confondrait
// avec n'importe quel compte.
//
// ARME : le bloc « first person » du `weap` porte deux references de tag consecutives, le `mode` de
// l'arme (celui de sa vue a la troisieme personne) puis son graphe a la premiere personne (`jmad`).
// Une reference de tag fait refTagPas octets : le groupe (fourcc) en tete, le GlobalID a
// refTagOffID. Le graphe porte les os des bras, ceux de l'arme (sa racine sous `b_r_hand`) et
// quelques os d'appoint, et les animations des deux.
package himap

import (
	"context"
	"errors"
	"fmt"
	"slices"
)

// GroupeGlobalesJoueur : le groupe des globales joueur, qui portent le modele des bras.
const GroupeGlobalesJoueur = "glpa"

// Grammaire d'une reference de tag dans un `weap`.
const (
	refTagPas   = 24
	refTagOffID = 8
)

// ErrSansPremierePersonne : le tag n'est pas une arme qui porte un bloc « first person » lisible, ou
// les bras ne se trouvent pas.
var ErrSansPremierePersonne = errors.New("himap: pas de vue a la premiere personne")

// SourcesBras : les tags des bras a la premiere personne.
type SourcesBras struct {
	// Globales : le `glpa` qui les porte ; Modele : son `hlmt` ; Mode : le maillage ; Graphe : le
	// graphe des bras seuls (les armes portent chacune le leur, SourcesArme.Graphe).
	Globales, Modele, Mode, Graphe uint32
}

// SourcesArme : le bloc « first person » d'une arme.
type SourcesArme struct {
	// Arme : le `weap` ; Mode : son modele ; Graphe : son graphe a la premiere personne.
	Arme, Mode, Graphe uint32
	// Offset : la place de la reference du modele dans le tag decompresse.
	Offset int
}

// SourcesBras lit les tags des bras dans les tables de dependances des globales joueur ; erreur
// quand aucun `glpa` ne depend d'un `hlmt`, quand deux `hlmt` differents se presentent, ou quand le
// `hlmt` ne depend pas d'exactement un `mode` et un `jmad`.
func (a *Arsenal) SourcesBras() (SourcesBras, error) {
	globales := a.geo.EntreesDuGroupe(GroupeGlobalesJoueur)
	slices.Sort(globales)
	var out SourcesBras
	for _, g := range globales {
		raw, err := a.geo.Extract(g)
		if err != nil {
			return SourcesBras{}, fmt.Errorf("%w : %s %08x : %w", ErrSansPremierePersonne, GroupeGlobalesJoueur, g, err)
		}
		for _, h := range dependancesDuGroupe(raw, GroupeHlmt) {
			if out.Modele != 0 && out.Modele != h {
				return SourcesBras{}, fmt.Errorf("%w : deux modeles de bras, hlmt %08x (%s %08x) et %08x (%s %08x)",
					ErrSansPremierePersonne, out.Modele, GroupeGlobalesJoueur, out.Globales, h, GroupeGlobalesJoueur, g)
			}
			out.Globales, out.Modele = g, h
		}
	}
	if out.Modele == 0 {
		return SourcesBras{}, fmt.Errorf("%w : aucun %s des %d indexes ne depend d'un hlmt", ErrSansPremierePersonne, GroupeGlobalesJoueur, len(globales))
	}
	raw, err := a.geo.Extract(out.Modele)
	if err != nil {
		return SourcesBras{}, fmt.Errorf("%w : hlmt %08x : %w", ErrSansPremierePersonne, out.Modele, err)
	}
	if out.Mode, err = dependanceUnique(raw, GroupeMode); err != nil {
		return SourcesBras{}, fmt.Errorf("%w : hlmt %08x : %w", ErrSansPremierePersonne, out.Modele, err)
	}
	if out.Graphe, err = dependanceUnique(raw, GroupeGrapheAnimation); err != nil {
		return SourcesBras{}, fmt.Errorf("%w : hlmt %08x : %w", ErrSansPremierePersonne, out.Modele, err)
	}
	return out, nil
}

// dependanceUnique rend la seule dependance du groupe `grp` d'un tag.
func dependanceUnique(raw []byte, grp string) (uint32, error) {
	ds := dependancesDuGroupe(raw, grp)
	if len(ds) != 1 {
		return 0, fmt.Errorf("%d dependances %q (un seule attendue)", len(ds), grp)
	}
	return ds[0], nil
}

// SourcesArme lit le bloc « first person » de l'arme `weap` ; ErrSansPremierePersonne quand le tag
// n'est pas un `weap` ou ne porte pas exactement un couple de references `mode` puis `jmad`
// presentes dans l'index et dans sa table de dependances.
func (a *Arsenal) SourcesArme(weap uint32) (SourcesArme, error) {
	if g, _, ok := a.geo.Lookup(weap); !ok || g != GroupeArme {
		return SourcesArme{}, fmt.Errorf("%w : %08x n'est pas un tag %q", ErrSansPremierePersonne, weap, GroupeArme)
	}
	raw, err := a.geo.Extract(weap)
	if err != nil {
		return SourcesArme{}, fmt.Errorf("%w : %08x : %w", ErrSansPremierePersonne, weap, err)
	}
	modes := dependancesDuGroupe(raw, GroupeMode)
	graphes := dependancesDuGroupe(raw, GroupeGrapheAnimation)
	var trouves []SourcesArme
	fMode, fGraphe := fourcc(GroupeMode), fourcc(GroupeGrapheAnimation)
	for o := 0; o+refTagPas+refTagOffID+4 <= len(raw); o += 4 {
		if uint32(u32(raw, o)) != fMode || uint32(u32(raw, o+refTagPas)) != fGraphe {
			continue
		}
		s := SourcesArme{Arme: weap, Mode: uint32(u32(raw, o+refTagOffID)), Graphe: uint32(u32(raw, o+refTagPas+refTagOffID)), Offset: o}
		if slices.Contains(modes, s.Mode) && slices.Contains(graphes, s.Graphe) && a.estDuGroupe(s.Mode, GroupeMode) &&
			a.estDuGroupe(s.Graphe, GroupeGrapheAnimation) {
			trouves = append(trouves, s)
		}
	}
	if len(trouves) == 0 {
		trouves = couplesAuGrapheDesDependances(a, weap, raw, modes, graphes)
	}
	if len(trouves) != 1 {
		return SourcesArme{}, fmt.Errorf("%w : %08x porte %d couples de references mode puis jmad", ErrSansPremierePersonne, weap, len(trouves))
	}
	return trouves[0], nil
}

// couplesAuGrapheDesDependances [LOCAL-CHANGE (infinite-theater-3d)]: the first-person block of a
// weapon whose inline `jmad` reference names a GlobalID no installed module indexes (the Vestige
// Carbine, weap 3e070217: inline 78912884, absent from every map's index) while its dependency
// table lists exactly one indexed `jmad` (d7292132: the arm bones and the weapon root under
// `b_r_hand`, 76 animations, the shape of every other FP graph). The block's `mode` must still
// resolve; the graph is the one the dependency table carries. Nil otherwise.
func couplesAuGrapheDesDependances(a *Arsenal, weap uint32, raw []byte, modes, graphes []uint32) []SourcesArme {
	var indexes []uint32
	for _, g := range graphes {
		if a.estDuGroupe(g, GroupeGrapheAnimation) {
			indexes = append(indexes, g)
		}
	}
	if len(indexes) != 1 {
		return nil
	}
	var out []SourcesArme
	fMode, fGraphe := fourcc(GroupeMode), fourcc(GroupeGrapheAnimation)
	for o := 0; o+refTagPas+refTagOffID+4 <= len(raw); o += 4 {
		if uint32(u32(raw, o)) != fMode || uint32(u32(raw, o+refTagPas)) != fGraphe {
			continue
		}
		mode, inline := uint32(u32(raw, o+refTagOffID)), uint32(u32(raw, o+refTagPas+refTagOffID))
		if _, _, ok := a.geo.Lookup(inline); ok || !slices.Contains(modes, mode) || !a.estDuGroupe(mode, GroupeMode) {
			continue
		}
		out = append(out, SourcesArme{Arme: weap, Mode: mode, Graphe: indexes[0], Offset: o})
	}
	return out
}

// estDuGroupe dit si le tag `id` est indexe sous le groupe `grp`.
func (a *Arsenal) estDuGroupe(id uint32, grp string) bool {
	g, _, ok := a.geo.Lookup(id)
	return ok && g == grp
}

// fourcc rend le groupe `grp` (4 caracteres) tel qu'un tag l'ecrit, en u32 petit-boutiste : le
// premier caractere dans l'octet de poids fort.
func fourcc(grp string) uint32 {
	var v uint32
	for i := 0; i < 4 && i < len(grp); i++ {
		v = v<<8 | uint32(grp[i])
	}
	return v
}

// ArmesPremierePersonne rend, triees par GlobalID, les sources de chaque `weap` de l'index qui porte
// un bloc « first person », et le nombre de `weap` qui n'en portent pas.
func (a *Arsenal) ArmesPremierePersonne() ([]SourcesArme, int) {
	ids := a.geo.EntreesDuGroupe(GroupeArme)
	slices.Sort(ids)
	var out []SourcesArme
	sans := 0
	for _, id := range ids {
		s, err := a.SourcesArme(id)
		if err != nil {
			sans++
			continue
		}
		out = append(out, s)
	}
	return out, sans
}

// GraphesDepuis lit le graphe d'animation `jmad` et ceux dont il herite (un graphe a la premiere
// personne n'est reference par aucun `hlmt` : GraphesDuModele ne s'y applique pas).
func (a *Arsenal) GraphesDepuis(ctx context.Context, jmad uint32) (*GraphesAnimation, error) {
	gs := &GraphesAnimation{parID: map[uint32]*GrapheAnimation{}}
	var err error
	if gs.Propre, err = a.litChaine(ctx, gs, jmad, 0); err != nil {
		return nil, err
	}
	return gs, nil
}
