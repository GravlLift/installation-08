// Package himap — spartan.go : un modele a peau (le Spartan), maillage, squelette et influences,
// pour le rejeu 3D.
//
// Le Spartan entier est UN render_model `mode` (ModeSpartan), dans le module `pc/globals/globals`,
// que l'index de geometrie d'une carte installee couvre deja (GeometrySearchPath) : l'arsenal le
// lit comme une arme. Chaque piece d'armure de chaque noyau en est une permutation ; l'armure par
// defaut est la variante de modele du noyau par defaut que nomment les globales de
// personnalisation (armure_defaut.go), choisie AVANT tout decodage de sommets : les permutations
// non retenues ne sont jamais lues. Les accessoires (epaulieres posees sur un marqueur) sont des
// modeles a part, non lus ici.
//
// REPERE : celui du modele en pose de repos, axes Halo, unites du jeu, pieds a z = 0. Les sections
// que le jeu ne dessine pas a l'ecran (horsPasseVisible : ombre, ou hors du LOD 0) ne sont pas gardees.
package himap

import (
	"context"
	"fmt"
	"log/slog"
)

// ModeSpartan : le GlobalID du render_model du Spartan.
const ModeSpartan uint32 = 0x3DB5318C

// modeOffMarqueurs : le champ racine du bloc des marqueurs d'un `mode`.
const modeOffMarqueurs = 104

// ComptesMode : les comptes des blocs d'un `mode`.
type ComptesMode struct {
	Regions, Permutations, Noeuds, Marqueurs, Materiaux, Sections, Boites int
}

// ModeleAPeau : un modele en pose de repos avec son squelette.
type ModeleAPeau struct {
	// Maillage : la geometrie dans son groupe Structure, materiaux et textures resolus.
	Maillage *MaillageMonde
	// Noeuds et Noms : le squelette, dans l'ordre du tag (les rangs des Influences), et le nom en
	// clair de chaque noeud (NomDuNoeud).
	Noeuds []Noeud
	Noms   []string
	// Influences : une par sommet de Maillage.Structure, dans le meme ordre.
	Influences []Influences
	Comptes    ComptesMode
	// Armure : la variante par defaut et les tags qui la nomment.
	Armure ArmureParDefaut
	// PermutationsRetenues : une par region ou l'armure par defaut dessine une permutation du mode.
	PermutationsRetenues int
	// Plages : une par section dessinee, ses sommets dans Maillage.Structure.
	Plages             []PlageSection
	SectionsDessinees  int
	SectionsOmbre      int
	SectionsIllisibles int
	// ShadersInconnus : shader -> nombre de materiaux, pour les materiaux qui n'ont pas de rendu
	// de surface dure (ils sortent gris neutre).
	ShadersInconnus map[uint32]int
}

// PlageSection : les sommets [Debut, Fin) de Maillage.Structure que la section Section du mode a
// ajoutes.
type PlageSection struct {
	Section, Debut, Fin int
}

// LitComptesMode lit les comptes des blocs d'un tag `mode` deja decompresse.
func LitComptesMode(tag []byte) (ComptesMode, error) {
	c, _, err := comptesEtRegions(tag)
	return c, err
}

// comptesEtRegions lit les comptes des blocs du `mode` et ses regions.
func comptesEtRegions(tag []byte) (ComptesMode, []Region, error) {
	ti, err := meilleurTagInfo(tag)
	if err != nil {
		return ComptesMode{}, nil, err
	}
	rb, err := ti.rootBlockIndex()
	if err != nil {
		return ComptesMode{}, nil, err
	}
	rAbs, rSize := ti.blockAbs(rb)
	compte := func(off int) int {
		if rAbs < 0 || off+tagBlockCountOffset+4 > rSize {
			return 0
		}
		return u32(ti.tag, rAbs+off+tagBlockCountOffset)
	}
	c := ComptesMode{
		Regions: compte(modeOffRegions), Noeuds: compte(modeOffNodes), Marqueurs: compte(modeOffMarqueurs),
		Materiaux: compte(modeOffMateriaux), Sections: compte(modeOffSections), Boites: compte(modeOffBoundingBoxes),
	}
	regions, err := ModeRegions(tag)
	if err != nil {
		return c, nil, err
	}
	for _, r := range regions {
		c.Permutations += len(r.Permutations)
	}
	return c, regions, nil
}

// ModeleAPeau lit le render_model `mode` dans son armure par defaut, avec son squelette et les
// influences de chaque sommet ; ErrSansModele quand le tag manque ou ne se decode pas.
func (a *Arsenal) ModeleAPeau(ctx context.Context, mode uint32) (*ModeleAPeau, error) {
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
	out := &ModeleAPeau{Maillage: &MaillageMonde{}}
	var regions []Region
	if out.Comptes, regions, err = comptesEtRegions(tag); err != nil {
		return nil, fmt.Errorf("%w : comptes du %08x : %w", ErrSansModele, mode, err)
	}
	if out.Noeuds, err = ModeNodes(tag); err != nil {
		return nil, fmt.Errorf("%w : squelette du %08x : %w", ErrSansModele, mode, err)
	}
	for _, n := range out.Noeuds {
		out.Noms = append(out.Noms, NomDuNoeud(n.Name))
	}
	if out.Armure, err = armureParDefaut(ctx, a.geo, mode); err != nil {
		return nil, fmt.Errorf("%w : armure par defaut du %08x : %w", ErrSansModele, mode, err)
	}
	for _, r := range regions {
		if _, ok := permutationDeLaRegion(r, out.Armure.Variante); ok {
			out.PermutationsRetenues++
		}
	}
	sel := lisModelePose(asset, GroupeMode, out.Armure.Variante)
	out.collecte(ctx, asset, &sel)
	if out.Maillage.Structure.Triangles() == 0 {
		return nil, fmt.Errorf("%w : %08x sans triangle visible", ErrSansModele, mode)
	}
	out.Maillage.lisMateriaux(a.mats, a.geo)
	out.Maillage.resoutTextures(ctx, a.geo)
	out.ShadersInconnus = shadersHorsSurfaceDure(ctx, out.Maillage.Materiaux)
	lo, hi, _ := out.Maillage.Structure.Borne()
	slog.InfoContext(ctx, "modele a peau lu", "id", fmt.Sprintf("%08x", mode), "noeuds", len(out.Noeuds),
		"variante", fmt.Sprintf("%08x", out.Armure.NomVariante), "hlmt", fmt.Sprintf("%08x", out.Armure.Modele),
		"permutations", out.PermutationsRetenues, "sections", out.SectionsDessinees, "ombre", out.SectionsOmbre,
		"illisibles", out.SectionsIllisibles, "triangles", out.Maillage.Structure.Triangles(),
		"materiaux", len(out.Maillage.Materiaux), "shadersInconnus", len(out.ShadersInconnus),
		"textures", len(out.Maillage.TexturesCouches), "hauteur", hi[2]-lo[2])
	return out, nil
}

// collecte ajoute a la structure les sections retenues et leurs influences ; une section illisible
// est journalisee, comptee et sautee.
func (m *ModeleAPeau) collecte(ctx context.Context, asset *RuntimeGeoAsset, sel *modelePose) {
	in := PlacementScenario{Echelle: 1}.Instance()
	in.Materiaux = sel.materiaux
	for _, k := range sel.maillages {
		if horsPasseVisible(asset, k) {
			m.SectionsOmbre++
			continue
		}
		mesh := asset.Mesh(k)
		inf, err := asset.PeauDeSection(k, len(m.Noeuds))
		if err == nil && (mesh == nil || len(inf) != len(mesh.Vertices)) {
			err = fmt.Errorf("%w : section %d, maillage illisible ou de taille differente", ErrPeauIllisible, k)
		}
		if err != nil {
			slog.WarnContext(ctx, "section du modele a peau sautee", "section", k, "err", err)
			m.SectionsIllisibles++
			continue
		}
		debut := len(m.Maillage.Structure.Sommets) / 3
		m.Maillage.Structure.ajoute(mesh, in, 0)
		m.Plages = append(m.Plages, PlageSection{Section: k, Debut: debut, Fin: len(m.Maillage.Structure.Sommets) / 3})
		m.Influences = append(m.Influences, inf...)
		m.SectionsDessinees++
	}
}

// shadersHorsSurfaceDure compte, par shader, les materiaux lus sans rendu de surface dure, et
// journalise chacun de ces shaders.
func shadersHorsSurfaceDure(ctx context.Context, mats map[uint32]Materiau) map[uint32]int {
	out := map[uint32]int{}
	for _, m := range mats {
		if m.Surface == nil {
			out[m.Shader]++
		}
	}
	for s, n := range out {
		slog.InfoContext(ctx, "shader sans rendu de surface dure : materiaux gris neutre", "shader", fmt.Sprintf("%08x", s), "materiaux", n)
	}
	return out
}
