// Package himap — maillage_monde.go : la MATIERE 3D d'une carte, en repere monde.
//
// Le rendu vu du dessus (rendu.go) projette chaque triangle dans un z-buffer et le jette.
// Ce fichier garde les triangles eux-memes : meme parcours d'instances (`ParcourtInstances`),
// meme transformation (`Instance.LocalToWorld`), donc le MEME repere que les positions
// publiees par le rejeu — unites monde Halo (1 u = 3,048 m), Z vers le haut.
//
// Ce que la collecte ne fait PAS : tranche d'altitude, frontiere de mort, eau, rognage aux
// zones. Ce sont des operations sur la grille du rendu vu du dessus ; une vue 3D montre la
// carte entiere.
package himap

import (
	"context"
	"fmt"
	"log/slog"
)

// MaillageMonde est la geometrie d'une carte en repere monde, en deux groupes : la STRUCTURE
// (ce que le rendu vu du dessus dessine) et le DECOR grossier qu'il ecarte.
type MaillageMonde struct {
	// BSP : le GlobalID du sbsp collecte, cle de sa lumiere dans le scenario (SourcesLumiereDe).
	BSP       uint32
	Structure GroupeMaillage
	Decor     GroupeMaillage
	// Terrain : hauteur issue du scenario, publiee avec la structure.
	Terrain GroupeMaillage
	// Ombre : les maillages que le jeu ne dessine pas a l'ecran (`horsPasseVisible`). Gardes a
	// part plutot que jetes : la vue les masque, un diagnostic peut les montrer.
	Ombre GroupeMaillage
	// HorsBoite compte les triangles ecartes parce qu'un de leurs sommets sort de la boite
	// monde declaree de leur instance (meme garde que `AddMeshBorne`).
	HorsBoite int
	// HorsCadre compte les instances ecartees par `OptionsCuisson.CadreMaillage`.
	HorsCadre int
	// Materiaux : les materiaux lus, par GlobalID. Un ID de `GroupeMaillage.Indices` absent de
	// la table (illisible, ou 0 = rang hors liste) se dessine comme opaque.
	Materiaux    map[uint32]Materiau
	teintesForge map[uint32]materiauTeinte
	plagesForge  []plageForge
	// MateriauxIllisibles compte les GlobalID references que les modules ne resolvent pas.
	MateriauxIllisibles int
	// Masques : les textures des decoupes des materiaux, par GlobalID de bitmap. Un materiau
	// dont le masque est absent d'ici se dessine plein.
	Masques map[uint32]Texture
	// MasquesIllisibles compte les masques references que la lecture n'a pas rendus.
	MasquesIllisibles int
	// TexturesCouches : les textures des couches et masques macro (couches.go) et celles des
	// surfaces dures (surface_dure.go), par GlobalID de bitmap. Une couche dont la texture est
	// absente d'ici n'est pas dessinee.
	TexturesCouches map[uint32]Texture
	// TexturesCouchesIllisibles compte les textures de couche que la lecture n'a pas rendues.
	TexturesCouchesIllisibles int
	// SurfacesBrutes : les surfaces dures s'ecrivent en images brutes (glb_surfaces_brutes.go), que
	// le lecteur peint du revetement d'un joueur, et non cuites en gris (glb_surface.go).
	SurfacesBrutes bool
	// SurfacesBrutesDe : les materiaux (GlobalID) dont la surface dure s'ecrit en images brutes
	// meme sans SurfacesBrutes (un rig qui porte des bras peints et une arme au rendu cuit).
	SurfacesBrutesDe map[uint32]bool
	// Soleil : le soleil de la carte (LitSoleil), pose par l'appelant ; la collecte ne le lit
	// pas. Nil = carte sans soleil connu, et le GLB n'en publie aucun.
	Soleil *Soleil
	// Sondes : la lumiere cuite de la carte (LitSondes), posee par l'appelant comme le soleil.
	// Nil = le GLB n'en publie aucune.
	Sondes *SondesLumiere
	// Lumieres : les lumieres posees de la carte (LitLumieres), posees par l'appelant.
	Lumieres []Lumiere
	// Objets : les objets poses d'une couche de variante (CollecteMaillageVariante), vide pour une
	// carte. Le GLB les publie (glb_objets.go).
	Objets []ObjetPose
}

// GroupeMaillage est une soupe indexee : `Sommets` porte x,y,z a la suite, `UV[j]` u,v du jeu
// j pour chaque sommet (0,0 quand son maillage n'a pas ce jeu), `Indices` trois indices par
// triangle, rangés par GlobalID de materiau (0 = materiau inconnu).
type GroupeMaillage struct {
	Sommets []float32
	// Normales : normales des sommets quand elles sont connues, sinon vide.
	Normales  []float32
	UV        [NJeuxUV][]float32
	Indices   map[uint32][]uint32
	Instances int
}

// Triangles rend le nombre de triangles du groupe.
func (g *GroupeMaillage) Triangles() int {
	n := 0
	for _, ix := range g.Indices {
		n += len(ix) / 3
	}
	return n
}

// Borne rend la boite englobante du groupe ; ok=false si le groupe est vide.
func (g *GroupeMaillage) Borne() (lo, hi [3]float32, ok bool) {
	if len(g.Sommets) < 3 {
		return lo, hi, false
	}
	copy(lo[:], g.Sommets[:3])
	copy(hi[:], g.Sommets[:3])
	for i := 3; i+2 < len(g.Sommets); i += 3 {
		for k := 0; k < 3; k++ {
			v := g.Sommets[i+k]
			lo[k] = min(lo[k], v)
			hi[k] = max(hi[k], v)
		}
	}
	return lo, hi, true
}

// CollecteMaillageMonde lit la geometrie d'une carte NATIVE (meme module, meme bsp que
// `CuitCarteNative` avec les memes options) et la rend en repere monde.
func CollecteMaillageMonde(ctx context.Context, opts OptionsCuisson) (*MaillageMonde, BilanCuisson, error) {
	b := BilanCuisson{Ancres: len(opts.Ancres)}
	if len(opts.Ancres) == 0 {
		return nil, b, ErrSansAncre
	}
	chemins, err := GeometrySearchPathMonde(opts.RacineDeploy, opts.CheminModule)
	if err != nil {
		return nil, b, fmt.Errorf("chemins de geometrie : %w", err)
	}
	chemins = append(chemins, opts.modulesCarteDeportee()...)
	idx, bsp, bsps, err := ouvreBSPMonde(&b, opts, chemins)
	if err != nil {
		return nil, b, err
	}
	defer func() { _ = idx.Close() }()
	out := &MaillageMonde{BSP: bsp.GlobalID}
	bsp, out.HorsCadre = bsp.dansCadre(opts.CadreMaillage)
	ajoute := func(m *Mesh, in Instance, estDecor, horsPasse bool) {
		g := &out.Structure
		if horsPasse {
			g = &out.Ombre
		} else if estDecor {
			g = &out.Decor
			b.EcarteesDecor++
		} else {
			b.Dessinees++
		}
		g.Instances++
		out.HorsBoite += g.ajoute(m, in, MargeBornageInstance)
	}
	ParcourtInstances(ctx, idx, bsp, ajoute)
	// Collecter les autres structures nommees par le scenario.
	nommes, err := structuresNommees(ctx, opts)
	if err != nil {
		slog.WarnContext(ctx, "scenarios illisible : un seul bsp collecte", "erreur", err)
		nommes = nil
	}
	for _, autre := range bsps {
		if autre.GlobalID == bsp.GlobalID {
			continue
		}
		if !estNomme(autre.GlobalID, nommes) {
			continue
		}
		autre, _ = autre.dansCadre(opts.CadreMaillage)
		ParcourtInstances(ctx, idx, autre, ajoute)
	}
	out.posePlacements(ctx, idx, opts)
	terrain, matieresTerrain, texturesTerrain, err := collecteTerrains(idx, opts)
	if err != nil {
		return nil, b, fmt.Errorf("terrain : %w", err)
	}
	out.Terrain = terrain
	if out.Structure.Triangles()+out.Terrain.Triangles() == 0 {
		return nil, b, fmt.Errorf("aucun triangle de structure sur %d instances des %d structures", len(bsp.Instances), len(bsps))
	}
	if err := out.resoutMateriaux(opts, idx); err != nil {
		return nil, b, err
	}
	if err := out.resoutTexturesTerrain(ctx, idx, matieresTerrain, texturesTerrain); err != nil {
		return nil, b, err
	}
	slog.InfoContext(ctx, "maillage monde collecte", "instances", b.Dessinees, "decor", b.EcarteesDecor,
		"triangles", out.Structure.Triangles(), "trianglesTerrain", out.Terrain.Triangles(), "tuilesTerrain", out.Terrain.Instances, "trianglesDecor", out.Decor.Triangles(), "trianglesOmbre", out.Ombre.Triangles(),
		"horsBoite", out.HorsBoite, "instancesHorsCadre", out.HorsCadre, "materiaux", len(out.Materiaux), "materiauxIllisibles", out.MateriauxIllisibles,
		"masques", len(out.Masques), "masquesIllisibles", out.MasquesIllisibles,
		"texturesCouches", len(out.TexturesCouches), "texturesCouchesIllisibles", out.TexturesCouchesIllisibles)
	return out, b, nil
}

// structuresNommees lit le scenario (levl) de la carte et rend l'ensemble des GlobalID des
// structures qu'il nomme. Nil quand le scenario est illisible ou ne nomme aucune structure.
func structuresNommees(ctx context.Context, opts OptionsCuisson) (map[uint32]bool, error) {
	// Le scenario vit dans le module de la carte, qui n'est pas celui de la geometrie quand
	// celle-ci est deportee dans un module commun.
	chemin := opts.CheminModuleCarte
	if chemin == "" {
		chemin = opts.CheminModule
	}
	n, err := LitNiveau(chemin)
	if err != nil {
		return nil, err
	}
	if len(n.Structures) == 0 {
		return nil, nil
	}
	out := make(map[uint32]bool, len(n.Structures))
	for _, s := range n.Structures {
		if s.BSP != 0 {
			out[s.BSP] = true
		}
	}
	return out, nil
}

// estNomme dit si la structure `id` est dans l'ensemble des structures nommees par le scenario.
// Un ensemble nil (scenario illisible ou vide) ne nomme aucune structure : on ne collecte
// que le bsp joue.
func estNomme(id uint32, nommes map[uint32]bool) bool {
	if nommes == nil {
		return false
	}
	return nommes[id]
}

// resoutMateriaux lit les tags `mat ` de tous les materiaux references par les groupes ; leurs
// shaders se lisent dans l'index de geometrie `idxGeo`.
func (m *MaillageMonde) resoutMateriaux(opts OptionsCuisson, idxGeo *ModuleIndex) error {
	chemins, err := CheminsMateriaux(opts.RacineDeploy, opts.CheminModule)
	if err != nil {
		return err
	}
	idx, err := NewModuleIndex(append(chemins, opts.modulesCarteDeportee()...)...)
	if err != nil {
		return fmt.Errorf("index des modules de materiaux : %w", err)
	}
	defer func() { _ = idx.Close() }()
	m.lisMateriaux(idx, idxGeo)
	return nil
}

// lisMateriaux lit dans `idxMat` les materiaux references par les groupes, leurs shaders dans `idxGeo`.
func (m *MaillageMonde) lisMateriaux(idxMat, idxGeo *ModuleIndex) {
	vus := map[uint32]bool{}
	var ids []uint32
	for _, g := range []*GroupeMaillage{&m.Structure, &m.Decor, &m.Ombre} {
		for id := range g.Indices {
			if id != 0 && !vus[id] {
				vus[id] = true
				ids = append(ids, id)
			}
		}
	}
	m.Materiaux, m.MateriauxIllisibles = LitMateriaux(idxMat, idxGeo, ids)
}

// ajoute place un maillage par son instance et rend le nombre de triangles ecartes hors de la
// boite monde declaree de l'instance (elargie de `marge`).
//
// Garde PAR TRIANGLE ENTIER, pas par pixel comme le rendu vu du dessus : quelques instances des
// modules globaux debordent de leur boite d'un facteur ~40 (cf. `AddMeshBorne`) ; en 3D, un
// triangle a moitie dehors est un triangle aberrant.
func (g *GroupeMaillage) ajoute(m *Mesh, in Instance, marge float64) int {
	lo := [3]float64{in.AABBMin[0] - marge, in.AABBMin[1] - marge, in.AABBMin[2] - marge}
	hi := [3]float64{in.AABBMax[0] + marge, in.AABBMax[1] + marge, in.AABBMax[2] + marge}
	base := uint32(len(g.Sommets) / 3)
	dedans := make([]bool, len(m.Vertices))
	for i, s := range m.Vertices {
		w := in.LocalToWorld(s)
		dedans[i] = dansBoite(w, lo, hi)
		g.Sommets = append(g.Sommets, float32(w[0]), float32(w[1]), float32(w[2]))
		for j, jeu := range m.UV {
			if jeu != nil {
				g.UV[j] = append(g.UV[j], jeu[i][0], jeu[i][1])
			} else {
				g.UV[j] = append(g.UV[j], 0, 0)
			}
		}
	}
	if g.Indices == nil {
		g.Indices = map[uint32][]uint32{}
	}
	mats := materiauxDesTriangles(m, in)
	// Une pose miroir (determinant negatif) retourne les faces : l'ordre des sommets est inverse
	// pour qu'une face vue de face le reste dans le maillage monde.
	b, c := 1, 2
	if in.miroir() {
		b, c = 2, 1
	}
	ecartes := 0
	for k, t := range m.Triangles {
		if !dedans[t[0]] || !dedans[t[1]] || !dedans[t[2]] {
			ecartes++
			continue
		}
		g.Indices[mats[k]] = append(g.Indices[mats[k]], base+uint32(t[0]), base+uint32(t[b]), base+uint32(t[c]))
	}
	return ecartes
}

// miroir dit si la pose retourne l'espace : determinant de (avant.sx, gauche.sy, haut.sz) negatif.
func (in Instance) miroir() bool {
	f, l, u := in.Forward, in.Left, in.Up
	det := f[0]*(l[1]*u[2]-l[2]*u[1]) - f[1]*(l[0]*u[2]-l[2]*u[0]) + f[2]*(l[0]*u[1]-l[1]*u[0])
	return det*in.Scale[0]*in.Scale[1]*in.Scale[2] < 0
}

// materiauxDesTriangles rend le GlobalID de materiau de chaque triangle : celui de sa part, 0
// hors de toute part ou pour un rang hors de la liste de l'instance.
func materiauxDesTriangles(m *Mesh, in Instance) []uint32 {
	out := make([]uint32, len(m.Triangles))
	for _, p := range m.Parts {
		if p.Materiau < 0 || p.Materiau >= len(in.Materiaux) {
			continue
		}
		id := in.Materiaux[p.Materiau]
		for k := p.Debut; k < p.Debut+p.Compte && k < len(out); k++ {
			out[k] = id
		}
	}
	return out
}

// dansCadre rend le bsp reduit aux instances dont la boite monde touche le rectangle `cadre`
// (minX, minY, maxX, maxY), et le nombre d'instances ecartees. Un cadre vide (zero, ou max <= min)
// rend le bsp entier.
func (b BSPInstances) dansCadre(cadre [4]float64) (BSPInstances, int) {
	if cadre[2] <= cadre[0] || cadre[3] <= cadre[1] {
		return b, 0
	}
	gardees := make([]Instance, 0, len(b.Instances))
	for _, in := range b.Instances {
		if in.AABBMax[0] >= cadre[0] && in.AABBMin[0] <= cadre[2] && in.AABBMax[1] >= cadre[1] && in.AABBMin[1] <= cadre[3] {
			gardees = append(gardees, in)
		}
	}
	ecartees := len(b.Instances) - len(gardees)
	b.Instances = gardees
	return b, ecartees
}

func dansBoite(p, lo, hi [3]float64) bool {
	for k := 0; k < 3; k++ {
		if p[k] < lo[k] || p[k] > hi[k] {
			return false
		}
	}
	return true
}
