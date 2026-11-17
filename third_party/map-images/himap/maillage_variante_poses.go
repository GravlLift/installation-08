// Package himap — maillage_variante_poses.go (LOCAL-CHANGE (infinite-theater-3d)): a variant
// layer's objects as SHARED MODELS PLACED BY TRANSFORM.
//
// A Forge map's layer counts thousands of objects that reuse a few hundred models (Fortress:
// 4 644 placed objects, 133 types). Each model's meshes are kept once, in the model's own frame
// (GeometrieVariante), and each object is a placement of them (PoseVariante): its pose, the
// material list its type's palette gives the model's parts, its style tint. The GLB writes each
// geometry once and one node per placement (glb_poses.go). What a placement draws is exactly what
// the earlier world-space soup drew: same meshes, same pose (Instance.LocalToWorld), same
// material per triangle, same tint rule.
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"cmp"
	"fmt"
	"math"
	"slices"
)

// PosesVariante holds a variant layer's shared geometries and their placements.
type PosesVariante struct {
	Geometries []GeometrieVariante
	Poses      []PoseVariante
	parCle     map[cleGeometrie]int
	// teintes: the material id a tinted placement draws instead of a source material
	// (appliqueTeintes); absent, the source material is drawn as it is.
	teintes map[cleTeinte]uint32
}

// GeometrieVariante is the meshes of one model in one group, in the model's own frame. The keys of
// `Maillage.Indices` are not material ids: they are the rank + 1 of the part's material in the
// placement's material list (0: a triangle outside any part, drawn as the unknown material).
type GeometrieVariante struct {
	Maillage GroupeMaillage
	// Ombre: meshes the game does not draw on screen (horsPasseVisible), the `ombre` group.
	Ombre bool
}

// PoseVariante is one placement of a geometry.
type PoseVariante struct {
	// Objet is the object's rank in the `.mvar`: the placements of one object share it.
	Objet     int
	Geometrie int
	// Parent is the object's pose (lifted from its base for the object's own model).
	Parent Instance
	// Locale is a kit piece's pose in the object's frame (lifted from its own base), nil for the
	// object's own model: the piece's world pose is Parent(Locale(v)) (composeInstance).
	Locale *Instance
	// Materiaux is the material list the model's parts index by rank.
	Materiaux []uint32
	// Teinte is the object's style tint, nil without a style or a resolved tint.
	Teinte *TeinteForge
	// Style (LOCAL-CHANGE (infinite-theater-3d)) is the object's Forge style id, when the variant
	// resolved it (OptionsVariante.StylesForge): it repaints the placement's layered materials.
	Style *int32
}

type cleGeometrie struct {
	asset     *RuntimeGeoAsset
	maillages string
}

type cleTeinte struct {
	source uint32
	teinte TeinteForge
	// style, aStyle (LOCAL-CHANGE (infinite-theater-3d)): a source repainted by a Forge style.
	style  int32
	aStyle bool
}

// cleDe (LOCAL-CHANGE (infinite-theater-3d)) returns the key of what placement p draws for source
// material `source`: repainted by its Forge style when the source has style zones, else tinted;
// false when the source is drawn as it is.
func (m *MaillageMonde) cleDe(p PoseVariante, source uint32) (cleTeinte, bool) {
	if p.Style != nil && m.Materiaux[source].Zones != nil {
		return cleTeinte{source: source, style: *p.Style, aStyle: true}, true
	}
	if p.Teinte != nil {
		return cleTeinte{source: source, teinte: *p.Teinte}, true
	}
	return cleTeinte{}, false
}

// Monde returns the placement's world pose.
func (p PoseVariante) Monde() Instance {
	if p.Locale == nil {
		return p.Parent
	}
	return composeInstance(p.Parent, *p.Locale)
}

// pose places model `mv` for object `objet`: one placement per non-empty group of its meshes
// (drawn, then `ombre`), each geometry read once per model.
func (pv *PosesVariante) pose(objet int, mv *modeleVariante, parent Instance, locale *Instance, materiaux []uint32, teinte *TeinteForge) {
	var dessines, ombres []int
	for _, k := range mv.maillages {
		if mv.ombre[k] {
			ombres = append(ombres, k)
		} else {
			dessines = append(dessines, k)
		}
	}
	for _, l := range []struct {
		maillages []int
		ombre     bool
	}{{dessines, false}, {ombres, true}} {
		g, ok := pv.geometrie(mv.asset, l.maillages, l.ombre)
		if !ok {
			continue
		}
		pv.Poses = append(pv.Poses, PoseVariante{
			Objet: objet, Geometrie: g, Parent: parent, Locale: locale, Materiaux: materiaux, Teinte: teinte,
		})
	}
}

// geometrie returns the index of the geometry of `maillages` of `a`, reading it the first time;
// false when the meshes carry no triangle.
func (pv *PosesVariante) geometrie(a *RuntimeGeoAsset, maillages []int, ombre bool) (int, bool) {
	if a == nil || len(maillages) == 0 {
		return 0, false
	}
	cle := cleGeometrie{asset: a, maillages: fmt.Sprint(ombre, maillages)}
	if i, ok := pv.parCle[cle]; ok {
		return i, i >= 0
	}
	if pv.parCle == nil {
		pv.parCle = map[cleGeometrie]int{}
	}
	g := geometrieLocale(a, maillages)
	if g.Triangles() == 0 {
		pv.parCle[cle] = -1
		return 0, false
	}
	pv.parCle[cle] = len(pv.Geometries)
	pv.Geometries = append(pv.Geometries, GeometrieVariante{Maillage: g, Ombre: ombre})
	return len(pv.Geometries) - 1, true
}

// avecJeuMacro (LOCAL-CHANGE (infinite-theater-3d)) returns m, or a copy of it whose missing UV1 is its UV0. A Forge material reads
// its style mask, ASG and normal on UV1 (glb_couches.go), but Ekur keeps the active map when a
// mesh has no UV1; foliage cards (Fortress's ivy, plants and shrubs) have none, and a zero-filled
// UV1 read their cut and maps at one texel.
func avecJeuMacro(m *Mesh) *Mesh {
	if m.UV[jeuUVMacro] != nil || m.UV[0] == nil {
		return m
	}
	c := *m
	c.UV[jeuUVMacro] = c.UV[0]
	return &c
}

// geometrieLocale reads meshes `maillages` of `a` in the model's own frame, each triangle filed
// under its part's material rank + 1 (see GeometrieVariante).
func geometrieLocale(a *RuntimeGeoAsset, maillages []int) GroupeMaillage {
	meshes := make([]*Mesh, 0, len(maillages))
	rangs := 0
	for _, k := range maillages {
		mesh := a.Mesh(k)
		if mesh == nil {
			continue
		}
		meshes = append(meshes, avecJeuMacro(mesh))
		for _, p := range mesh.Parts {
			rangs = max(rangs, p.Materiau+1)
		}
	}
	inf := math.Inf(1)
	identite := Instance{
		Scale: [3]float64{1, 1, 1}, Forward: [3]float64{1, 0, 0}, Left: [3]float64{0, 1, 0}, Up: [3]float64{0, 0, 1},
		AABBMin: [3]float64{-inf, -inf, -inf}, AABBMax: [3]float64{inf, inf, inf},
		Materiaux: make([]uint32, rangs),
	}
	for r := range identite.Materiaux {
		identite.Materiaux[r] = uint32(r + 1)
	}
	var g GroupeMaillage
	for _, mesh := range meshes {
		g.ajoute(mesh, identite, 0)
	}
	return g
}

// boite returns the world box of the placements' vertices; false without a vertex.
func (pv *PosesVariante) boite(poses []PoseVariante) (mn, mx [3]float64, ok bool) {
	for _, p := range poses {
		monde := p.Monde()
		s := pv.Geometries[p.Geometrie].Maillage.Sommets
		for i := 0; i+2 < len(s); i += 3 {
			w := monde.LocalToWorld([3]float64{float64(s[i]), float64(s[i+1]), float64(s[i+2])})
			for a := range 3 {
				v := float64(float32(w[a]))
				if !ok {
					mn[a], mx[a] = v, v
				}
				mn[a], mx[a] = min(mn[a], v), max(mx[a], v)
			}
			ok = true
		}
	}
	return mn, mx, ok
}

// Triangles returns the drawn triangles the placements put in the world (`ombre` excluded) and
// the triangles of the shared geometries, written once (`ombre` included).
func (pv *PosesVariante) Triangles() (poses, uniques int) {
	if pv == nil {
		return 0, 0
	}
	for _, p := range pv.Poses {
		if g := pv.Geometries[p.Geometrie]; !g.Ombre {
			poses += g.Maillage.Triangles()
		}
	}
	for _, g := range pv.Geometries {
		uniques += g.Maillage.Triangles()
	}
	return poses, uniques
}

// sourceDe returns the material a placement's triangles of key `cle` (GeometrieVariante) draw
// before tinting: the rank's entry of its list, 0 outside the list.
func (p PoseVariante) sourceDe(cle uint32) uint32 {
	if cle == 0 || int(cle) > len(p.Materiaux) {
		return 0
	}
	return p.Materiaux[cle-1]
}

// materiauDe returns the material a placement's triangles of key `cle` draw: the source material,
// or the tinted material appliqueTeintes allocated for it.
func (pv *PosesVariante) materiauDe(p PoseVariante, cle uint32) uint32 {
	id := p.sourceDe(cle)
	if pv.Geometries[p.Geometrie].Ombre {
		return id
	}
	// LOCAL-CHANGE (infinite-theater-3d): a style-repainted source first, then a tinted one.
	if p.Style != nil {
		if t, ok := pv.teintes[cleTeinte{source: id, style: *p.Style, aStyle: true}]; ok {
			return t
		}
	}
	if p.Teinte != nil {
		if t, ok := pv.teintes[cleTeinte{source: id, teinte: *p.Teinte}]; ok {
			return t
		}
	}
	return id
}

// idsSources returns every source material the placements draw, sorted (0 excluded).
func (pv *PosesVariante) idsSources() []uint32 {
	vus := map[uint32]bool{}
	for _, p := range pv.Poses {
		for cle := range pv.Geometries[p.Geometrie].Maillage.Indices {
			if id := p.sourceDe(cle); id != 0 {
				vus[id] = true
			}
		}
	}
	ids := make([]uint32, 0, len(vus))
	for id := range vus {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	return ids
}

// resoutMateriauxPoses reads the `mat ` tags of the materials the placements draw, as
// resoutMateriaux does for a map's groups.
func (m *MaillageMonde) resoutMateriauxPoses(opts OptionsCuisson, idxGeo *ModuleIndex) error {
	chemins, err := CheminsMateriaux(opts.RacineDeploy, opts.CheminModule)
	if err != nil {
		return err
	}
	idx, err := NewModuleIndex(append(chemins, opts.modulesCarteDeportee()...)...)
	if err != nil {
		return fmt.Errorf("material module index: %w", err)
	}
	defer func() { _ = idx.Close() }()
	m.Materiaux, m.MateriauxIllisibles = LitMateriaux(idx, idxGeo, m.Poses.idsSources())
	return nil
}

// appliqueTeintes gives each tinted placement's drawn triangles a material of their own per
// (source material, tint): the tint is the material's flat color, written by the GLB's material
// writer (teintesForge). A source material whose layers carry a published texture keeps its
// layers and takes no tint. LOCAL-CHANGE (infinite-theater-3d): a source with Forge style zones
// drawn by a placement with a Forge style gets a material per (source, style) instead: its
// layers repainted by the style (ZonesStyle.couches). Needs the materials and their textures
// resolved.
func (m *MaillageMonde) appliqueTeintes() {
	pv := m.Poses
	var cles []cleTeinte
	vues := map[cleTeinte]bool{}
	reserves := map[uint32]bool{}
	for _, p := range pv.Poses {
		g := pv.Geometries[p.Geometrie]
		for cle := range g.Maillage.Indices {
			source := p.sourceDe(cle)
			reserves[source] = true
			k, ok := m.cleDe(p, source)
			if !ok || g.Ombre || vues[k] || (!k.aStyle && m.garderCouches(source)) {
				continue
			}
			vues[k] = true
			cles = append(cles, k)
		}
	}
	slices.SortStableFunc(cles, func(a, b cleTeinte) int {
		if c := cmp.Compare(a.source, b.source); c != 0 {
			return c
		}
		return cmp.Compare(a.style, b.style)
	})
	pv.teintes = map[cleTeinte]uint32{}
	m.teintesForge = map[uint32]materiauTeinte{}
	prochain := ^uint32(0)
	for _, k := range cles {
		t := materiauTeinte{source: k.source, teinte: k.teinte}
		if k.aStyle {
			t.couches = m.Materiaux[k.source].Zones.couches(m.stylesForge[k.style])
			if t.couches == nil {
				continue // nothing lit: the source is drawn as it is
			}
		}
		for reserves[prochain] {
			prochain--
		}
		reserves[prochain] = true
		pv.teintes[k] = prochain
		m.teintesForge[prochain] = t
	}
}

// garderCouches reports whether the material `id` draws opaque layers one of whose textures was
// read: such a material keeps its layers instead of a flat tint.
func (m *MaillageMonde) garderCouches(id uint32) bool {
	mat := m.Materiaux[id]
	if mat.Couches == nil || !mat.Opaque() {
		return false
	}
	for _, c := range mat.Couches.Couches {
		if _, ok := m.TexturesCouches[c.Bitmap]; ok {
			return true
		}
	}
	return false
}
