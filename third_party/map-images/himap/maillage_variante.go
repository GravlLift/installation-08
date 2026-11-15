// Package himap — maillage_variante.go : la couche 3D des objets d'une VARIANTE de carte (`.mvar`).
//
// Une carte native est livree avec sa variante : la couche Forge des caisses, couverts et
// accessoires, que ni son sbsp ni son scenario ne posent. Une carte Forge n'a qu'elle, sur son
// canevas. La couche se collecte a part du maillage de la carte, parce que deux variantes d'une
// meme carte different : meme `MaillageMonde`, meme GLB (`EcritGLB`), sans soleil ni lumiere (ce
// sont ceux de la carte). LOCAL-CHANGE (infinite-theater-3d): its objects are not baked into
// world-space groups but kept as shared models placed by transform (`MaillageMonde.Poses`,
// maillage_variante_poses.go).
//
// LA CHAINE est celle du fond Forge vu du dessus (cuisson_forge.go) : type_id -> `food` -> modele
// (`rtgo` direct, ou saut `bloc`/`scen`/`mach` -> `hlmt` -> `rtgo`/`mode`), pose par
// `InstanceForge`. Ce que la 3D y ajoute :
//   - les MATERIAUX. Un `mode` porte les siens (lisModelePose). Un `rtgo` n'en porte aucun : le
//     `food` reference, a la suite de chaque `rtgo`, ses PALETTES (`rtmp`), chacune une liste de
//     references `mat ` que les parts du maillage indexent par rang, comme la liste d'une
//     instance de sbsp. La premiere palette est retenue : le style que l'objet choisit n'est pas
//     lu, l'objet sort dans le style par defaut de son type. LOCAL-CHANGE (infinite-theater-3d):
//     an object's representation draws the palette its food record names
//     (palettesRepresentations), and its Forge material comes from the game's Forge palette
//     (StylesForgeJeu).
//   - l'ORIGINE (LOCAL-CHANGE (infinite-theater-3d): origine_forge.go) : le `.mvar` donne la
//     position de l'origine du `mode` propre de l'objet ; un `rtgo` est recentre sur la sienne, il
//     se decale donc du coin de la boite du `mode` moins le sien.
//   - les maillages que le jeu ne dessine pas a l'ecran (horsPasseVisible) vont au groupe Ombre,
//     comme ceux de la carte.
//
// CE QUI EST ECARTE : les volumes de mort (TypesVolumesDeMort) et tout objet qui porte une FORME
// (zones d'objectif, declencheurs, limites : des volumes de jeu, pas de la matiere). Un volume
// au modele vide (render_model sans boite) n'est pas lisible et compte « sans modele ». Les
// reperes de reapparition (drapeauRepere) ne sont pas poses non plus, ni les objets que le mode
// de la partie ne cree pas (LOCAL-CHANGE (infinite-theater-3d): filtres_mode.go). Les
// leviers du fond vu du dessus (tranche, plafond de pose, minceur, types et drapeaux exclus par
// carte) ne s'appliquent pas : ils reglent une image vue du dessus, pas ce que le jeu dessine.
package himap

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"sort"
	"strings"

	"github.com/JGtm/halo-infinite-files-reader/himodule"
	"github.com/JGtm/halo-infinite-files-reader/mapvar"
)

// GroupePalette : le groupe d'une palette de materiaux d'un objet Forge.
const GroupePalette = "rtmp"

// CleObjetVariante identifie un type et sa représentation sélectionnée.
type CleObjetVariante struct {
	TypeID             int32
	RepresentationID   int32
	SansRepresentation bool
}

// OptionsVariante decrit la couche d'objets d'une variante de carte a collecter.
type OptionsVariante struct {
	// RacineDeploy est la racine `deploy` de l'installation.
	RacineDeploy string
	// CheminModule est le `.module` `pc` de la carte qui porte la variante : il ouvre l'ordre de
	// recherche de la geometrie, et son jumeau `any` porte une part des materiaux.
	CheminModule string
	// Objets sont les objets de la variante (`mapvar.Parse`).
	Objets     []mapvar.Object
	Teintes    map[int32]TeinteForge
	Invisibles map[CleObjetVariante]bool
	// Filtres (LOCAL-CHANGE (infinite-theater-3d)): the labels the match's mode activates
	// (filtres_mode.go); the zero value builds the layer of a match without a known mode.
	Filtres FiltresMode
	// StylesForge (LOCAL-CHANGE (infinite-theater-3d)): the objects' Forge styles by style id
	// (LitStylesForge), which repaint their layered materials; nil draws the materials' own.
	StylesForge map[int32]*StyleForge
	// StylesMvar and SaletesMvar (LOCAL-CHANGE (infinite-theater-3d)): the variant's raw styles
	// (mapvar.Variant.Styles, StyleGrimes). When set, the styles are resolved from the game's own
	// Forge palette (StylesForgeJeu), CatalogueForge filling only the swatches the game does not
	// name, and they replace StylesForge; the flat Teintes gain the styles the game resolves.
	StylesMvar     map[int32][]mapvar.StyleLayer
	SaletesMvar    map[int32]mapvar.StyleGrime
	CatalogueForge []byte
}

// BilanVariante compte le sort des objets d'une variante.
type BilanVariante struct {
	Objets     int
	Poses      int
	Invisibles int
	// SansModele : objets dont le type ne mene a aucun modele lisible (dont les volumes au
	// modele vide).
	SansModele int
	// VolumesDeMort et Volumes : objets ecartes comme volumes de jeu (voir l'en-tete).
	VolumesDeMort int
	Volumes       int
	// Reperes : reperes de reapparition (drapeauRepere), invisibles en partie.
	Reperes int
	// HorsMode : objets que le mode de la partie ne cree pas (ecartHorsMode).
	HorsMode int
	// SansPalette : objets poses dont le modele `rtgo` n'a pas de palette lisible ; ils sortent
	// au materiau inconnu.
	SansPalette int
	// RepliRepresentation : objets posables sans représentation résolue.
	RepliRepresentation int
	// Types : les types d'objet qui ont un modele.
	Types int
}

// modeleVariante : ce qu'un type d'objet pose, et lesquels de ses maillages le jeu ne dessine
// pas a l'ecran.
type modeleVariante struct {
	modelePose
	ombre       map[int]bool
	sansPalette bool
	// origine (LOCAL-CHANGE (infinite-theater-3d)): the model-frame offset that puts the
	// object's pivot on its position (origine_forge.go); zero for a `mode`.
	origine [3]float64
	// pieces (LOCAL-CHANGE (infinite-theater-3d)): the objects of the type's Forge kit, posed
	// in the object's frame (kits_forge.go); empty for a type that has its own model.
	pieces []pieceKit
	// telescopage (LOCAL-CHANGE (infinite-theater-3d)): how a telescoping object of the type
	// sizes its model (telescopage_forge.go).
	telescopage telescopage
}

// ecartVariante dit pourquoi un objet de variante n'est pas pose.
type ecartVariante int

const (
	posable ecartVariante = iota
	ecartVolumeDeMort
	ecartVolume
	ecartRepere
	// ecartHorsMode : les filtres de mode de l'objet l'ecartent du mode de la partie
	// (FiltresMode.ecarte).
	ecartHorsMode
)

// drapeauRepere : le bit des drapeaux d'objet (`.mvar` #7) que portent les seuls reperes de
// reapparition, que le jeu ne dessine pas en partie.
const drapeauRepere = 0x2

// ecartDeVariante rend la raison qui ecarte l'objet d'une partie aux filtres de mode `f`,
// `posable` sinon.
func ecartDeVariante(o mapvar.Object, f FiltresMode) ecartVariante {
	if _, mort := TypesVolumesDeMort[o.TypeID]; mort {
		return ecartVolumeDeMort
	}
	if o.ShapeRaw != nil {
		return ecartVolume
	}
	if o.Flags&drapeauRepere != 0 {
		return ecartRepere
	}
	if f.ecarte(o) {
		return ecartHorsMode
	}
	return posable
}

func objetInvisible(o mapvar.Object, invisibles map[CleObjetVariante]bool) bool {
	k := CleObjetVariante{TypeID: o.TypeID, SansRepresentation: o.RepresentationID == nil}
	if o.RepresentationID != nil {
		k.RepresentationID = *o.RepresentationID
	}
	return invisibles[k]
}

func objetsVisibles(objets []mapvar.Object, invisibles map[CleObjetVariante]bool, b *BilanVariante) []mapvar.Object {
	visibles := make([]mapvar.Object, 0, len(objets))
	for _, o := range objets {
		if objetInvisible(o, invisibles) {
			b.Invisibles++
			continue
		}
		visibles = append(visibles, o)
	}
	return visibles
}

// CollecteMaillageVariante rend en repere monde les objets d'une variante de carte, materiaux
// et textures resolus comme ceux de la carte.
func CollecteMaillageVariante(ctx context.Context, opts OptionsVariante) (*MaillageMonde, BilanVariante, error) {
	b := BilanVariante{Objets: len(opts.Objets)}
	if len(opts.Objets) == 0 {
		return nil, b, ErrSansObjetForge
	}
	chemins, err := GeometrySearchPathMonde(opts.RacineDeploy, opts.CheminModule)
	if err != nil {
		return nil, b, fmt.Errorf("chemins de geometrie : %w", err)
	}
	idx, err := NewModuleIndex(chemins...)
	if err != nil {
		return nil, b, fmt.Errorf("index des modules : %w", err)
	}
	defer func() { _ = idx.Close() }()
	forge, err := himodule.Open(cheminDefinitionsForge(opts.RacineDeploy))
	if err != nil {
		return nil, b, fmt.Errorf("module des objets Forge : %w", err)
	}
	defer func() { _ = forge.Close() }()
	// LOCAL-CHANGE (infinite-theater-3d): the objects' Forge styles from the game's own palette.
	if opts.StylesMvar != nil {
		styles := lecteurStyles(idx)
		jeu, err := StylesForgeJeu(styles, opts.CatalogueForge, opts.StylesMvar, opts.SaletesMvar)
		if err != nil {
			return nil, b, err
		}
		slog.InfoContext(ctx, "styles Forge resolus", "styles", len(opts.StylesMvar), "jeu", len(jeu), "catalogue", len(opts.StylesForge))
		opts.StylesForge = jeu
		opts.Teintes = completeTeintesForge(opts.Teintes, echantillonsPaletteJeu(styles), opts.StylesMvar)
	}

	objets := objetsVisibles(opts.Objets, opts.Invisibles, &b)
	assets := map[uint32]*RuntimeGeoAsset{}
	modeles := modelesDesTypes(ctx, objets, idx, forge, assets)
	representations := modelesDesRepresentations(ctx, objets, idx, forge, assets)
	b.Types = len(modeles)
	out := &MaillageMonde{Poses: &PosesVariante{}}
	poses := out.poseVarianteTeinte(opts, modeles, representations, &b)
	trianglesPoses, trianglesUniques := out.Poses.Triangles()
	if trianglesPoses == 0 {
		return nil, b, fmt.Errorf("aucun triangle pose sur %d objets de variante", len(opts.Objets))
	}
	if err := out.resoutMateriauxPoses(OptionsCuisson{RacineDeploy: opts.RacineDeploy, CheminModule: opts.CheminModule}, idx); err != nil {
		return nil, b, err
	}
	out.stylesForge = opts.StylesForge // LOCAL-CHANGE (infinite-theater-3d)
	out.resoutTextures(ctx, idx)
	out.appliqueTeintes()
	slog.InfoContext(ctx, "objets de la variante poses", "objets", b.Objets, "poses", b.Poses,
		"invisibles", b.Invisibles, "sansModele", b.SansModele, "volumesDeMort", b.VolumesDeMort, "volumes", b.Volumes, "reperes", b.Reperes, "horsMode", b.HorsMode,
		"sansPalette", b.SansPalette, "repliRepresentation", b.RepliRepresentation, "types", b.Types,
		"triangles", trianglesPoses, "trianglesUniques", trianglesUniques,
		"geometries", len(out.Poses.Geometries), "placements", len(out.Poses.Poses),
		"materiaux", len(out.Materiaux), "materiauxIllisibles", out.MateriauxIllisibles,
		"masques", len(out.Masques), "masquesIllisibles", out.MasquesIllisibles,
		"texturesCouches", len(out.TexturesCouches), "texturesCouchesIllisibles", out.TexturesCouchesIllisibles,
		"typesPoses", resumeTypesPoses(poses))
	return out, b, nil
}

// modelesDesTypes ouvre une fois le modele de chaque type d'objet, avec ses materiaux. Un type
// sans modele lisible est absent de la table. `assets` met les modeles ouverts en commun (avec
// les representations : un modele partage n'a qu'une geometrie, PosesVariante).
func modelesDesTypes(ctx context.Context, objets []mapvar.Object,
	idx *ModuleIndex, forge *himodule.Module, assets map[uint32]*RuntimeGeoAsset) map[int32]*modeleVariante {
	foodParID := map[uint32]himodule.File{}
	for _, f := range forge.Files("food") {
		foodParID[f.GlobalID] = f
	}
	out := map[int32]*modeleVariante{}
	telescopiques := typesTelescopiques(objets)
	for ty, ref := range modeleParType(ctx, objets, idx, forge) {
		a, deja := assets[ref.id]
		if !deja {
			a = ouvreAsset(ctx, idx, ref.id, ref.groupe)
			assets[ref.id] = a
		}
		if a == nil {
			continue
		}
		mv := &modeleVariante{modelePose: lisModelePose(a, ref.groupe, nil), ombre: map[int]bool{}}
		for _, k := range mv.maillages {
			mv.ombre[k] = horsPasseVisible(a, k)
		}
		if ref.groupe == GroupeRtgo {
			mv.materiaux, mv.sansPalette = paletteDuType(ctx, idx, forge, foodParID[uint32(ty)], ref.id)
			mv.origine = origineDuRtgo(a, mv.maillages, modesDuType(ctx, idx, forge, foodParID[uint32(ty)], assets))
		}
		// LOCAL-CHANGE (infinite-theater-3d): how a telescoping type sizes its model.
		mv.telescopage.rapport = [3]float64{1, 1, 1}
		if telescopiques[ty] {
			if tag, err := forge.Extract(foodParID[uint32(ty)]); err == nil {
				mv.telescopage = telescopageDuFood(ctx, idx, tag, assets, a, mv.maillages)
				for k := range 3 {
					mv.telescopage.centre[k] += mv.origine[k]
				}
			}
		}
		out[ty] = mv
	}
	// LOCAL-CHANGE (infinite-theater-3d): a type without a model of its own poses its kit.
	for ty, mv := range kitsDesTypes(ctx, objets, idx, forge, assets) {
		if out[ty] == nil {
			out[ty] = mv
		}
	}
	return out
}

// typePose : ce qu'un type d'objet a pose, pour le journal.
type typePose struct {
	typeID    int32
	objets    int
	triangles int
}

// poseVarianteTeinte pose les objets de la variante que ni leur visibilite ni ecartDeVariante
// n'ecartent, teintes par leur style, et rend, par type, ce qui a ete pose.
func (m *MaillageMonde) poseVarianteTeinte(opts OptionsVariante, modeles map[int32]*modeleVariante, representations map[cleRepresentation]*modeleVariante, b *BilanVariante) map[int32]*typePose {
	poses := map[int32]*typePose{}
	for i, o := range opts.Objets {
		if objetInvisible(o, opts.Invisibles) {
			continue
		}
		if !compteEcart(ecartDeVariante(o, opts.Filtres), b) {
			continue
		}
		// LOCAL-CHANGE (infinite-theater-3d): a telescoping object's model is sized from its
		// type's reference dimensions, about the model's box centre on the axes the reference
		// resizes (telescopage_forge.go).
		// A representation's own model keeps only the fixed axes.
		var decalage [3]float64
		d := modeles[o.TypeID]
		mv, repli := selectionRepresentation(o, d, representations)
		if d != nil && mv == d {
			o, decalage = echelleTelescopique(o, d.telescopage)
		} else if d != nil {
			o, _ = echelleTelescopique(o, telescopage{fixes: d.telescopage.fixes})
		}
		if repli {
			b.RepliRepresentation++
		}
		if mv == nil {
			b.SansModele++
			continue
		}
		if mv.sansPalette {
			b.SansPalette++
		}
		var teinte *TeinteForge
		if o.StyleID != nil {
			if t, colore := opts.Teintes[*o.StyleID]; colore {
				teinte = &t
			}
		}
		debut := len(m.Poses.Poses)
		triangles := m.poseObjet(i, o, mv, teinte, decalage)
		// LOCAL-CHANGE (infinite-theater-3d): the object's Forge style, for its layered materials.
		if o.StyleID != nil && opts.StylesForge[*o.StyleID] != nil {
			for p := debut; p < len(m.Poses.Poses); p++ {
				m.Poses.Poses[p].Style = o.StyleID
			}
		}
		b.Poses++
		tp := poses[o.TypeID]
		if tp == nil {
			tp = &typePose{typeID: o.TypeID}
			poses[o.TypeID] = tp
		}
		tp.objets++
		tp.triangles += triangles
	}
	return poses
}

// compteEcart compte l'objet ecarte dans le bilan ; vrai quand il est posable.
func compteEcart(e ecartVariante, b *BilanVariante) bool {
	switch e {
	case ecartVolumeDeMort:
		b.VolumesDeMort++
	case ecartVolume:
		b.Volumes++
	case ecartRepere:
		b.Reperes++
	case ecartHorsMode:
		b.HorsMode++
	default:
		return true
	}
	return false
}

// poseObjet place les modeles de l'objet de rang i (LOCAL-CHANGE (infinite-theater-3d): en
// placements de geometries partagees, PosesVariante), range sa boite monde dans `Objets` et rend
// les triangles dessines qu'il pose. LOCAL-CHANGE (infinite-theater-3d): `decalage` is added to
// the model's origin (a telescoping object's centre offset, echelleTelescopique).
func (m *MaillageMonde) poseObjet(i int, o mapvar.Object, mv *modeleVariante, teinte *TeinteForge, decalage [3]float64) int {
	if m.Poses == nil {
		m.Poses = &PosesVariante{}
	}
	debut := len(m.Poses.Poses)
	origine := [3]float64{mv.origine[0] + decalage[0], mv.origine[1] + decalage[1], mv.origine[2] + decalage[2]}
	m.Poses.pose(i, mv, instanceVariante(o, mv.materiaux, origine), nil, mv.materiaux, teinte)
	// LOCAL-CHANGE (infinite-theater-3d): the kit's objects, each placed by its own pivot.
	for _, p := range mv.pieces {
		local := p.pose.decale(p.mv.origine)
		m.Poses.pose(i, p.mv, instanceVariante(o, nil, [3]float64{}), &local, p.mv.materiaux, teinte)
	}
	poses := m.Poses.Poses[debut:]
	triangles := 0
	for _, p := range poses {
		if g := m.Poses.Geometries[p.Geometrie]; !g.Ombre {
			triangles += g.Maillage.Triangles()
		}
	}
	if mn, mx, ok := m.Poses.boite(poses); ok {
		m.Objets = append(m.Objets, ObjetPose{Index: i, Type: o.TypeID, Min: mn, Max: mx})
	}
	return triangles
}

// instanceVariante rend la pose d'un objet de variante (InstanceForge) decalee de l'origine de son
// modele (LOCAL-CHANGE (infinite-theater-3d): origine_forge.go), sa liste de materiaux et une
// boite monde illimitee : le maillage d'un objet pose n'a pas de boite declaree a laquelle le
// confronter (meme regle que PlacementScenario.Instance).
func instanceVariante(o mapvar.Object, materiaux []uint32, origine [3]float64) Instance {
	in := InstanceForge(o).decale(origine)
	inf := math.Inf(1)
	in.AABBMin = [3]float64{-inf, -inf, -inf}
	in.AABBMax = [3]float64{inf, inf, inf}
	in.Materiaux = materiaux
	return in
}

// resumeTypesPoses rend les dix types qui posent le plus de triangles, « type:xN:triangles » :
// le seul moyen de designer un type d'objet, qui n'a pas de nom.
func resumeTypesPoses(poses map[int32]*typePose) string {
	l := make([]*typePose, 0, len(poses))
	for _, tp := range poses {
		l = append(l, tp)
	}
	sort.Slice(l, func(i, j int) bool {
		if l[i].triangles != l[j].triangles {
			return l[i].triangles > l[j].triangles
		}
		return l[i].typeID < l[j].typeID
	})
	if len(l) > 10 {
		l = l[:10]
	}
	parts := make([]string, 0, len(l))
	for _, tp := range l {
		parts = append(parts, fmt.Sprintf("%d:x%d:%d", tp.typeID, tp.objets, tp.triangles))
	}
	return strings.Join(parts, " ")
}
