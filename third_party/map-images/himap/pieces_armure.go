// Package himap — pieces_armure.go : les PIECES d'armure du Spartan, lues une a une.
//
// Une piece est une permutation d'une region du `mode` du Spartan (spartan.go) : ses sections du
// LOD 0 dessinees a l'ecran (horsPasseVisible), avec leurs influences sur le squelette ENTIER du
// `mode`. Toutes les pieces portent donc les memes 120 noeuds, dans le meme ordre, avec les memes
// matrices inverses de liaison : un lecteur les lie toutes a un seul squelette. Une permutation sans
// section (SectionIndex negatif, ou seulement des copies hors passe visible) n'est pas une piece :
// sa geometrie, quand elle en a une, est un accessoire (accessoires_armure.go).
//
// La selection d'un joueur (region -> permutation) se construit aussi d'un bloc (Selection), par le
// meme chemin que l'armure par defaut, une region que la selection ne nomme pas ne dessinant rien :
// c'est le temoin de l'assemblage des pieces.
package himap

import (
	"context"
	"errors"
	"fmt"
)

// CleArmure : une piece, par les StringID de sa region et de sa permutation.
type CleArmure struct {
	Region, Permutation uint32
}

// String rend la cle `region-permutation` en hexadecimal (8 chiffres chacun).
func (c CleArmure) String() string { return fmt.Sprintf("%08x-%08x", c.Region, c.Permutation) }

// ErrPieceSansGeometrie : la permutation n'existe pas dans le `mode`, ou n'y dessine aucun triangle.
var ErrPieceSansGeometrie = errors.New("himap: piece d'armure sans geometrie")

// Armurerie : le `mode` du Spartan ouvert une fois (son blob de ressources porte toutes les
// permutations), d'ou se lisent les pieces.
type Armurerie struct {
	arsenal *Arsenal
	asset   *RuntimeGeoAsset
	// Mode : le GlobalID du `mode`.
	Mode    uint32
	Regions []Region
	Noeuds  []Noeud
	Noms    []string
	// Marqueurs : les groupes de marqueurs du `mode` (marqueurs.go).
	Marqueurs []GroupeMarqueurs
	Comptes   ComptesMode
	materiaux []uint32
}

// OuvreArmurerie ouvre le `mode` d'un modele a peau ; ErrSansModele quand il manque ou ne se lit pas.
func (a *Arsenal) OuvreArmurerie(mode uint32) (*Armurerie, error) {
	if g, _, ok := a.geo.Lookup(mode); !ok || g != GroupeMode {
		return nil, fmt.Errorf("%w : %08x n'est pas un tag %q des modules", ErrSansModele, mode, GroupeMode)
	}
	tag, blob, err := a.geo.ExtractWithResources(mode)
	if err != nil {
		return nil, fmt.Errorf("%w : %08x : %w", ErrSansModele, mode, err)
	}
	asset, err := NewRenderModelAsset(tag, blob)
	if err != nil {
		return nil, fmt.Errorf("%w : %08x : %w", ErrSansModele, mode, err)
	}
	r := &Armurerie{arsenal: a, asset: asset, Mode: mode}
	if r.Comptes, r.Regions, err = comptesEtRegions(tag); err != nil {
		return nil, fmt.Errorf("%w : regions du %08x : %w", ErrSansModele, mode, err)
	}
	if r.Noeuds, err = ModeNodes(tag); err != nil {
		return nil, fmt.Errorf("%w : squelette du %08x : %w", ErrSansModele, mode, err)
	}
	for _, n := range r.Noeuds {
		r.Noms = append(r.Noms, NomDuNoeud(n.Name))
	}
	if r.Marqueurs, err = MarqueursDuMode(tag); err != nil {
		return nil, fmt.Errorf("%w : %08x : %w", ErrSansModele, mode, err)
	}
	r.materiaux = lisModelePose(asset, GroupeMode, nil).materiaux
	return r, nil
}

// Pieces rend, dans l'ordre du tag, les permutations qui dessinent au moins une section visible.
func (r *Armurerie) Pieces() []CleArmure {
	var out []CleArmure
	for _, reg := range r.Regions {
		for _, p := range reg.Permutations {
			if len(r.sectionsVisibles(p)) > 0 {
				out = append(out, CleArmure{Region: reg.Name, Permutation: p.Name})
			}
		}
	}
	return out
}

// sectionsVisibles rend les sections de la permutation que le jeu dessine a l'ecran.
func (r *Armurerie) sectionsVisibles(p Permutation) []int {
	var out []int
	for k := p.SectionIndex; p.SectionIndex >= 0 && k < p.SectionIndex+p.SectionCount; k++ {
		if r.asset.Mesh(k) != nil && !horsPasseVisible(r.asset, k) {
			out = append(out, k)
		}
	}
	return out
}

// permutation rend la permutation de la cle ; faux quand le `mode` ne la porte pas.
func (r *Armurerie) permutation(c CleArmure) (Permutation, bool) {
	for _, reg := range r.Regions {
		if reg.Name != c.Region {
			continue
		}
		for _, p := range reg.Permutations {
			if p.Name == c.Permutation {
				return p, true
			}
		}
	}
	return Permutation{}, false
}

// Piece rend le modele a peau de la piece `c` (squelette entier, materiaux et textures resolus) ;
// ErrPieceSansGeometrie quand le `mode` ne la porte pas ou qu'elle ne dessine rien.
func (r *Armurerie) Piece(ctx context.Context, c CleArmure) (*ModeleAPeau, error) {
	p, ok := r.permutation(c)
	if !ok {
		return nil, fmt.Errorf("%w : %s absente du mode %08x", ErrPieceSansGeometrie, c, r.Mode)
	}
	sections := r.sectionsVisibles(p)
	if len(sections) == 0 {
		return nil, fmt.Errorf("%w : %s sans section visible", ErrPieceSansGeometrie, c)
	}
	return r.modele(ctx, modelePose{asset: r.asset, maillages: sections, materiaux: r.materiaux}, 1)
}

// Selection rend d'un bloc le modele a peau de la selection `sel` (region -> permutation), par le
// chemin de l'armure par defaut (lisModelePose) : une region que `sel` ne nomme pas ne dessine rien.
// `manquantes` liste les pieces que `sel` nomme et que le `mode` ne porte pas.
func (r *Armurerie) Selection(ctx context.Context, sel []CleArmure) (m *ModeleAPeau, manquantes []CleArmure, err error) {
	v := VarianteModele{}
	for _, reg := range r.Regions {
		v[reg.Name] = permutationAucune
	}
	for _, c := range sel {
		v[c.Region] = c.Permutation
		if _, ok := r.permutation(c); !ok {
			manquantes = append(manquantes, c)
		}
	}
	m, err = r.modele(ctx, lisModelePose(r.asset, GroupeMode, v), len(sel)-len(manquantes))
	return m, manquantes, err
}

// permutationAucune : le nom de permutation d'une region que la selection ne nomme pas. Le StringID
// 0 est la chaine vide, qu'aucune permutation ne porte : la region ne dessine rien.
const permutationAucune uint32 = 0

// modele construit le modele a peau des sections de `mp`, sur le squelette entier.
func (r *Armurerie) modele(ctx context.Context, mp modelePose, permutations int) (*ModeleAPeau, error) {
	out := &ModeleAPeau{Maillage: &MaillageMonde{SurfacesBrutes: true}, Noeuds: r.Noeuds, Noms: r.Noms, Comptes: r.Comptes,
		PermutationsRetenues: permutations}
	out.collecte(ctx, r.asset, &mp)
	if out.Maillage.Structure.Triangles() == 0 {
		return nil, fmt.Errorf("%w : %d sections, aucun triangle lisible", ErrPieceSansGeometrie, len(mp.maillages))
	}
	out.Maillage.lisMateriaux(r.arsenal.mats, r.arsenal.geo)
	out.Maillage.resoutTextures(ctx, r.arsenal.geo)
	return out, nil
}
