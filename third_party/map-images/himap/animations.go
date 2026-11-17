// Package himap — animations.go : le graphe d'animation `jmad` (model_animation_graph) d'un
// modele, ses os, ses animations et leurs donnees compressees, pour le rejeu 3D.
//
// Le graphe porte tout en ligne (aucun fichier de ressource) : les ressources des animations y
// sont « eclatees » en data-blocks (animations_tag.go). Champs de l'enregistrement racine, mesures
// sur les graphes du Spartan (6514a7e3) et de son parent (000033ce) :
//
//	+0x10  heritage (104 o)             : reference du graphe parent (GlobalID a +8), ...
//	+0xc0  os (24 o)                    : nom StringID +0, frere i16 +4, enfant i16 +6, parent i16 +8
//	+0x1b0 animations (120 o)           : animationGraphe ci-dessous
//	+0x2d0 modes (52 o)                 : l'arbre mode / classe / type / jeu / action (animations_modes.go)
//	+0x434 groupes de ressources (20 o) : compte de references +0, ressource +4 (struct de type 3)
//	+0x448 / +0x45c / +0x470            : tables partagees de la pose statique (rotation 4 x i16,
//	                                      translation 3 x f32, echelle f32), codec 11
//
// Enregistrement d'animation (120 o) : nom +0, images u16 +4, noeuds u16 +6, type u8 +8 (1 base,
// 2 surcouche, 3 remplacement), mouvement u8 +9 (0 aucun, 1 dx dy, 2 dx dy dlacet, 3 dx dy dz
// dlacet, 4 dx dy dz et angle-axe), suivante i16 +16, image de boucle u16 +24, drapeaux internes u16 +72
// (0x800 « creee a 60 Hz »), cap vec3 +76, groupe de ressource i16 +116, membre i16 +118.
//
// Membre d'un groupe (396 o) : images u16 +8, noeuds u16 +10, 19 tailles de section u32 a +0x128,
// reference de donnees a +0x174 vers le blob, concatenation des sections dans l'ordre des
// emplacements (animations_codec.go).
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"errors"
	"fmt"
	"math"
)

// GroupeGrapheAnimation : le groupe des graphes d'animation.
const GroupeGrapheAnimation = "jmad"

// Grammaire de l'enregistrement racine du `jmad`.
const (
	jmadOffHeritage           = 0x10
	jmadHeritageStride        = 104
	jmadHeritageOffParent     = 8
	jmadOffOs                 = 0xc0
	jmadOsStride              = 24
	jmadOsOffParent           = 8
	jmadOffAnimations         = 0x1b0
	jmadAnimStride            = 120
	jmadOffModes              = 0x2d0
	jmadOffGroupes            = 0x434
	jmadGroupeStride          = 20
	jmadGroupeOffRessource    = 4
	jmadOffRotationsPartagees = 0x448
	jmadOffTranslationsPart   = 0x45c
	jmadOffEchellesPartagees  = 0x470
	jmadRotationPartageeOcts  = 8
	jmadTranslationPartOcts   = 12
	jmadEchellePartageeOcts   = 4
)

// Grammaire de l'enregistrement d'animation et du membre de ressource.
const (
	animOffImages       = 4
	animOffNoeuds       = 6
	animOffType         = 8
	animOffMouvement    = 9
	animOffSuivante     = 16
	animOffBoucle       = 24
	animOffDrapeaux     = 72
	animOffCap          = 76
	animOffGroupe       = 116
	animOffMembre       = 118
	membreStride        = 396
	membreOffImages     = 8
	membreOffNoeuds     = 10
	membreOffSections   = 0x128
	membreOffDonnees    = 0x174
	sectionsParMembre   = 19
	drapeauCreeeA60Hz   = 0x800
	quantumRotation16   = 32767.0
	animationsMaxParTag = 1 << 15
)

// ErrGrapheIllisible : le tag n'est pas un graphe d'animation lisible.
var ErrGrapheIllisible = errors.New("himap: unreadable animation graph")

// TypeAnimation : la sorte d'une animation (champ +8).
type TypeAnimation uint8

// Sortes d'animation.
const (
	AnimationBase         TypeAnimation = 1
	AnimationSurcouche    TypeAnimation = 2
	AnimationRemplacement TypeAnimation = 3
)

// Mouvement : la sorte du deplacement de racine d'une animation (champ +9).
type Mouvement uint8

// Sortes de deplacement de racine.
const (
	MouvementAucun     Mouvement = 0
	MouvementDxDy      Mouvement = 1
	MouvementDxDyLacet Mouvement = 2
	MouvementDxDyDzLac Mouvement = 3
	// MouvementDxDyDzAngle : dx dy dz et un vecteur de rotation angle-axe (six flottants par image).
	MouvementDxDyDzAngle Mouvement = 4
)

// OsGraphe : un os du squelette du graphe.
type OsGraphe struct {
	Nom    uint32
	Parent int
}

// AnimationGraphe : un enregistrement d'animation du graphe.
type AnimationGraphe struct {
	Rang      int
	Nom       uint32
	Images    int
	Noeuds    int
	Type      TypeAnimation
	Mouvement Mouvement
	Suivante  int
	Boucle    int
	Drapeaux  uint16
	Cap       [3]float64
	Groupe    int
	Membre    int
}

// CreeeA60Hz dit si l'animation porte le drapeau « creee a 60 Hz ».
func (a AnimationGraphe) CreeeA60Hz() bool { return a.Drapeaux&drapeauCreeeA60Hz != 0 }

// membreRessource : les donnees compressees d'une animation.
type membreRessource struct {
	images, noeuds int
	tailles        [sectionsParMembre]int
	blob           []byte
	// functions: the member's animation function list (LOCAL-CHANGE (infinite-theater-3d),
	// animation_functions.go), nil without one.
	functions []byte
}

// GrapheAnimation : un graphe `jmad` lu.
type GrapheAnimation struct {
	ID uint32
	// Parents : les GlobalID des graphes herites, dans l'ordre du bloc d'heritage (le rang 0 est
	// celui que l'arbre des modes designe par « graphe 0 »).
	Parents    []uint32
	Os         []OsGraphe
	Animations []AnimationGraphe
	// Entrees : l'arbre des modes aplati (animations_modes.go).
	Entrees []EntreeMode

	rotationsPartagees    [][4]float64
	translationsPartagees [][3]float64
	echellesPartagees     []float64
	membres               map[[2]int]membreRessource
}

// LitGrapheAnimation lit un tag `jmad` deja decompresse.
func LitGrapheAnimation(id uint32, tag []byte) (*GrapheAnimation, error) {
	n, err := nouveauNavigateur(tag)
	if err != nil {
		return nil, fmt.Errorf("%w : %08x : %w", ErrGrapheIllisible, id, err)
	}
	r, err := n.racine()
	if err != nil {
		return nil, fmt.Errorf("%w : %08x : %w", ErrGrapheIllisible, id, err)
	}
	g := &GrapheAnimation{ID: id}
	etapes := []func(*navigateurTag, int) error{g.litHeritage, g.litOs, g.litAnimations, g.litPartagees, g.litMembres, g.litModes}
	for _, f := range etapes {
		if err := f(n, r); err != nil {
			return nil, fmt.Errorf("%w : %08x : %w", ErrGrapheIllisible, id, err)
		}
	}
	return g, nil
}

func (g *GrapheAnimation) litHeritage(n *navigateurTag, r int) error {
	b, nb, err := n.enregistrements(r, jmadOffHeritage, jmadHeritageStride)
	if err != nil {
		return fmt.Errorf("inheritance: %w", err)
	}
	for k := 0; k < nb; k++ {
		if id := uint32(u32(b, k*jmadHeritageStride+jmadHeritageOffParent)); id != 0 && id != math.MaxUint32 {
			g.Parents = append(g.Parents, id)
		}
	}
	return nil
}

func (g *GrapheAnimation) litOs(n *navigateurTag, r int) error {
	b, nb, err := n.enregistrements(r, jmadOffOs, jmadOsStride)
	if err != nil {
		return fmt.Errorf("bones: %w", err)
	}
	for k := 0; k < nb; k++ {
		o := k * jmadOsStride
		g.Os = append(g.Os, OsGraphe{Nom: uint32(u32(b, o)), Parent: int(int16(u16(b, o+jmadOsOffParent)))})
	}
	return nil
}

func (g *GrapheAnimation) litAnimations(n *navigateurTag, r int) error {
	b, nb, err := n.enregistrements(r, jmadOffAnimations, jmadAnimStride)
	if err != nil {
		return fmt.Errorf("animations : %w", err)
	}
	if nb > animationsMaxParTag {
		return fmt.Errorf("%d animations: beyond the graph's i16 indices", nb)
	}
	for k := 0; k < nb; k++ {
		o := k * jmadAnimStride
		a := AnimationGraphe{
			Rang: k, Nom: uint32(u32(b, o)), Images: int(u16(b, o+animOffImages)), Noeuds: int(u16(b, o+animOffNoeuds)),
			Type: TypeAnimation(b[o+animOffType]), Mouvement: Mouvement(b[o+animOffMouvement]),
			Suivante: int(int16(u16(b, o+animOffSuivante))), Boucle: int(u16(b, o+animOffBoucle)),
			Drapeaux: u16(b, o+animOffDrapeaux),
			Groupe:   int(int16(u16(b, o+animOffGroupe))), Membre: int(int16(u16(b, o+animOffMembre))),
		}
		for c := 0; c < 3; c++ {
			a.Cap[c] = f32(b, o+animOffCap+4*c)
		}
		g.Animations = append(g.Animations, a)
	}
	return nil
}

// litPartagees lit les tables partagees de la pose statique (rotations, translations, echelles).
func (g *GrapheAnimation) litPartagees(n *navigateurTag, r int) error {
	b, nb, err := n.enregistrements(r, jmadOffRotationsPartagees, jmadRotationPartageeOcts)
	if err != nil {
		return fmt.Errorf("shared rotations: %w", err)
	}
	for k := 0; k < nb; k++ {
		g.rotationsPartagees = append(g.rotationsPartagees, quatI16(b, k*jmadRotationPartageeOcts))
	}
	if b, nb, err = n.enregistrements(r, jmadOffTranslationsPart, jmadTranslationPartOcts); err != nil {
		return fmt.Errorf("shared translations: %w", err)
	}
	for k := 0; k < nb; k++ {
		g.translationsPartagees = append(g.translationsPartagees, vec3F32(b, k*jmadTranslationPartOcts))
	}
	if b, nb, err = n.enregistrements(r, jmadOffEchellesPartagees, jmadEchellePartageeOcts); err != nil {
		return fmt.Errorf("shared scales: %w", err)
	}
	for k := 0; k < nb; k++ {
		g.echellesPartagees = append(g.echellesPartagees, f32(b, k*jmadEchellePartageeOcts))
	}
	return nil
}

// litMembres lit, pour chaque groupe de ressources, ses membres et leur blob.
func (g *GrapheAnimation) litMembres(n *navigateurTag, r int) error {
	g.membres = map[[2]int]membreRessource{}
	groupes := n.tagBlock(r, jmadOffGroupes)
	for _, res := range n.ressources[groupes] {
		if (res.champ-jmadGroupeOffRessource)%jmadGroupeStride != 0 {
			return fmt.Errorf("resource at field %#x: not a group", res.champ)
		}
		k := (res.champ - jmadGroupeOffRessource) / jmadGroupeStride
		if err := g.litGroupe(n, k, res.cible); err != nil {
			return fmt.Errorf("group %d: %w", k, err)
		}
	}
	return nil
}

// litGroupe lit les membres du groupe `k`, dont la ressource eclatee a pour racine le bloc `rac`.
func (g *GrapheAnimation) litGroupe(n *navigateurTag, k, rac int) error {
	for _, l := range n.blocs[rac] {
		b := n.octets(l.cible)
		if len(b) == 0 || len(b)%membreStride != 0 {
			continue
		}
		blobs := map[int]int{}
		for _, d := range n.donnees[l.cible] {
			if d.champ%membreStride == membreOffDonnees {
				blobs[d.champ/membreStride] = d.cible
			}
		}
		for m := 0; m < len(b)/membreStride; m++ {
			o := m * membreStride
			mr := membreRessource{images: int(u16(b, o+membreOffImages)), noeuds: int(u16(b, o+membreOffNoeuds))}
			somme := 0
			for s := 0; s < sectionsParMembre; s++ {
				mr.tailles[s] = u32(b, o+membreOffSections+4*s)
				somme += mr.tailles[s]
			}
			if bloc, ok := blobs[m]; ok {
				mr.blob = n.octets(bloc)
			}
			mr.functions = memberFunctions(n, l.cible, o)
			if len(mr.blob) != somme {
				return fmt.Errorf("member %d: blob of %d bytes for %d of sections", m, len(mr.blob), somme)
			}
			g.membres[[2]int{k, m}] = mr
		}
	}
	return nil
}

// quatI16 lit un quaternion de quatre entiers 16 bits (i, j, k, w) / 32767.
func quatI16(b []byte, o int) [4]float64 {
	var q [4]float64
	for c := 0; c < 4; c++ {
		q[c] = float64(int16(u16(b, o+2*c))) / quantumRotation16
	}
	return q
}

// vec3F32 lit trois flottants.
func vec3F32(b []byte, o int) [3]float64 {
	return [3]float64{f32(b, o), f32(b, o+4), f32(b, o+8)}
}
