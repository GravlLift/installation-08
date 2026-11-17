// Package himap — placements_scenario.go : les objets que le scenario d'une carte native pose
// hors de son sbsp.
//
// Le tag `levl` de la carte porte, a cote des zones nommees et des volumes, des blocs de
// PLACEMENTS : decor (`scen`), machines (`mach` : piliers mobiles, turbines, portes) et objets
// (`bloc` : caisses, cables, accessoires). Un record de placement commence par une reference de
// tag (GlobalID a +0x10, groupe a +0x1c, fourCC ecrit a l'envers), puis la position (+0x28), le
// lacet, le tangage et le roulis en radians (+0x34), une echelle uniforme (+0x40) et le nom de
// la variante de modele (StringID, +0x194 ; variantes_modele.go). Un bloc se reconnait au groupe
// que TOUS ses records referencent, pas a l'offset de son champ dans le root.
//
// Le tag d'objet (dans les modules `any`) mene a son render_model `mode` (dans les modules `pc`)
// par la meme chaine que les vehicules (`RefModeleVehicule`). Une machine est posee dans sa pose
// de placement : le jeu l'anime ensuite (un pilier monte et descend), la vue 3D la montre fixe.
// Les sections que le jeu ne dessine pas a l'ecran (projection d'ombre) vont a la famille ombre.
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"context"
	"fmt"
	"log/slog"
	"math"

	"github.com/JGtm/halo-infinite-files-reader/himodule"
)

// GroupeNiveau : le groupe du tag de scenario d'une carte (`levl`).
const GroupeNiveau = "levl"

// Grammaire d'un record de placement du `levl`.
const (
	placOffTag      = 0x10
	placOffGroupe   = 0x1c
	placOffPosition = 0x28
	placOffRotation = 0x34
	placOffEchelle  = 0x40
	placTailleMin   = placOffEchelle + 4
	placOffVariante = 0x194
	// placTailleMinMJ : la taille minimale d'un record pour porter un bloc `multiplayer data`
	// (le dernier champ, 20 octets : 16 pour le pointeur, 4 pour le compteur).
	placTailleMinMJ = placOffVariante + 4 + 20
)

// groupesPlaces : les groupes d'objet dont le scenario pose la geometrie visible.
var groupesPlaces = map[string]bool{"scen": true, "mach": true, GroupeBloc: true}

// PlacementScenario : un objet pose par le scenario.
type PlacementScenario struct {
	Tag      uint32
	Groupe   string
	Position [3]float64
	// Lacet, Tangage, Roulis : rotations en radians autour de Z, de Y (positif : l'avant monte)
	// et de l'avant.
	Lacet, Tangage, Roulis float64
	Echelle                float64
	// Variante : le nom de la variante de modele ; 0 quand le record est trop court pour la porter.
	Variante uint32
	// DonneesMultiJoueur : le record porte un bloc `multiplayer data` (le jeu ne le pose que
	// dans un mode de jeu qui le porte, ex. un ballon Oddball en partie classée).
	DonneesMultiJoueur bool
}

// LitPlacementsScenario lit les placements de decor, de machines et d'objets du tag `levl` d'un
// module de carte.
func LitPlacementsScenario(m *himodule.Module) ([]PlacementScenario, error) {
	levls := m.Files(GroupeNiveau)
	if len(levls) != 1 {
		return nil, fmt.Errorf("himap: %d tag(s) %s dans le module (attendu 1)", len(levls), GroupeNiveau)
	}
	tag, err := m.Extract(levls[0])
	if err != nil {
		return nil, fmt.Errorf("himap: extraire le %s : %w", GroupeNiveau, err)
	}
	ti, err := meilleurTagInfo(tag)
	if err != nil {
		return nil, fmt.Errorf("himap: en-tete du %s : %w", GroupeNiveau, err)
	}
	root, err := ti.rootBlockIndex()
	if err != nil {
		return nil, err
	}
	var out []PlacementScenario
	for _, l := range liensBlocs(ti) {
		if l.owner != root {
			continue
		}
		n := compteChamp(ti, l)
		abs, taille := ti.blockAbs(l.target)
		if n <= 0 || abs < 0 || taille%n != 0 || abs+taille > len(ti.tag) || taille/n < placTailleMin {
			continue
		}
		out = append(out, lisBlocPlacements(ti.tag[abs:abs+taille], taille/n)...)
	}
	return out, nil
}

// lisBlocPlacements rend les placements d'un bloc dont tous les records referencent un meme
// groupe de `groupesPlaces`, rien sinon.
func lisBlocPlacements(bloc []byte, stride int) []PlacementScenario {
	n := len(bloc) / stride
	groupe := groupeInverse(bloc[placOffGroupe : placOffGroupe+4])
	if !groupesPlaces[groupe] {
		return nil
	}
	out := make([]PlacementScenario, 0, n)
	for i := 0; i < n; i++ {
		r := bloc[i*stride : (i+1)*stride]
		if groupeInverse(r[placOffGroupe:placOffGroupe+4]) != groupe {
			return nil
		}
		p := PlacementScenario{
			Tag:      uint32(u32(r, placOffTag)),
			Groupe:   groupe,
			Position: [3]float64{f32(r, placOffPosition), f32(r, placOffPosition+4), f32(r, placOffPosition+8)},
			Lacet:    f32(r, placOffRotation),
			Tangage:  f32(r, placOffRotation+4),
			Roulis:   f32(r, placOffRotation+8),
			Echelle:  f32(r, placOffEchelle),
		}
		if stride >= placOffVariante+4 {
			p.Variante = uint32(u32(r, placOffVariante))
		}
		// Le compteur du bloc `multiplayer data` est a la fin du record.
		if stride >= placTailleMinMJ {
			p.DonneesMultiJoueur = u32(r, stride-4) > 0
		}
		out = append(out, p)
	}
	return out
}

// groupeInverse lit un fourCC de groupe ecrit a l'envers.
func groupeInverse(b []byte) string { return string([]byte{b[3], b[2], b[1], b[0]}) }

// Instance rend la transformation de pose : base Rz(lacet) . Ry(-tangage) . Rx(roulis), echelle
// uniforme, boite monde illimitee (le maillage d'un objet pose n'a pas de boite declaree a
// laquelle le confronter).
func (p PlacementScenario) Instance() Instance {
	sy, cy := math.Sincos(p.Lacet)
	sp, cp := math.Sincos(p.Tangage)
	sr, cr := math.Sincos(p.Roulis)
	inf := math.Inf(1)
	return Instance{
		Scale:    [3]float64{p.Echelle, p.Echelle, p.Echelle},
		Position: p.Position,
		Forward:  [3]float64{cy * cp, sy * cp, sp},
		Left:     [3]float64{-cy*sp*sr - sy*cr, -sy*sp*sr + cy*cr, cp * sr},
		Up:       [3]float64{-cy*sp*cr + sy*sr, -sy*sp*cr - cy*sr, cp * cr},
		AABBMin:  [3]float64{-inf, -inf, -inf},
		AABBMax:  [3]float64{inf, inf, inf},
	}
}

// modeOffMateriaux : le champ racine du bloc des materiaux d'un `mode`, une reference de tag
// `mat ` par enregistrement (meme forme que le bloc des materiaux d'une instance de sbsp).
const modeOffMateriaux = 0x7c

// modelePose : ce qu'un objet pose dessine de son render_model.
type modelePose struct {
	asset     *RuntimeGeoAsset
	maillages []int
	materiaux []uint32
}

// lisModelePose rend les maillages que la variante `v` dessine (nil : la premiere permutation de
// chaque region, le modele par defaut) et la liste des materiaux du modele, que les parts de ses
// maillages indexent. Un `rtgo`, ou un `mode` sans region lisible : tous les maillages.
func lisModelePose(a *RuntimeGeoAsset, groupe string, v VarianteModele) modelePose {
	mp := modelePose{asset: a}
	if groupe == GroupeMode {
		if offs, cibles, err := a.info.rootBlockRefs(); err == nil {
			for i, o := range offs {
				if o == modeOffMateriaux {
					mp.materiaux = a.info.materiauxInstance(cibles[i])
				}
			}
		}
		mp.maillages = maillagesDuMode(a.info.tag, v)
	}
	if mp.maillages == nil {
		for k := 0; k < a.MeshCount(); k++ {
			mp.maillages = append(mp.maillages, k)
		}
	}
	return mp
}

// maillagesDuMode rend les sections que la variante `v` dessine : par region, la permutation
// qu'elle nomme (aucune quand le `mode` ne la porte pas), la premiere pour une region qu'elle ne
// nomme pas. Une permutation a SectionIndex negatif n'en dessine aucune. nil sans region lisible.
func maillagesDuMode(tag []byte, v VarianteModele) []int {
	regions, err := ModeRegions(tag)
	if err != nil {
		return nil
	}
	var out []int
	for _, r := range regions {
		p, ok := permutationDeLaRegion(r, v)
		for k := 0; ok && p.SectionIndex >= 0 && k < p.SectionCount; k++ {
			out = append(out, p.SectionIndex+k)
		}
	}
	return out
}

// permutationDeLaRegion choisit la permutation que la variante dessine dans la region r.
func permutationDeLaRegion(r Region, v VarianteModele) (Permutation, bool) {
	nom, nommee := v[r.Name]
	if !nommee {
		if len(r.Permutations) == 0 {
			return Permutation{}, false
		}
		return r.Permutations[0], true
	}
	for _, p := range r.Permutations {
		if p.Name == nom {
			return p, true
		}
	}
	return Permutation{}, false
}

// posePlacements ajoute a la structure les objets poses par le scenario du module de carte.
// `idx` resout les tags d'objet (modules `any`) et leurs render_models (modules `pc`).
func (m *MaillageMonde) posePlacements(ctx context.Context, idx *ModuleIndex, opts OptionsCuisson) {
	mod, err := himodule.Open(opts.moduleScenario())
	if err != nil {
		slog.WarnContext(ctx, "unreadable map module: scenario objects not placed", "err", err)
		return
	}
	defer func() { _ = mod.Close() }()
	placements, err := LitPlacementsScenario(mod)
	if err != nil {
		slog.WarnContext(ctx, "unreadable scenario: scenario objects not placed", "err", err)
		return
	}
	modeles := map[[2]uint32]*modelePose{}
	poses, sansModele, horsCadre, multiJoueur := 0, 0, 0, 0
	for _, p := range placements {
		if p.DonneesMultiJoueur {
			multiJoueur++
			continue
		}
		if !dansCadre2D(p.Position, opts.CadreMaillage) {
			horsCadre++
			continue
		}
		cle := [2]uint32{p.Tag, p.Variante}
		mp, vu := modeles[cle]
		if !vu {
			mp = modeleDuPlacement(ctx, idx, p.Tag, p.Variante)
			modeles[cle] = mp
		}
		if mp == nil {
			sansModele++
			continue
		}
		m.poseModele(mp, p.Instance())
		m.Structure.Instances++
		poses++
	}
	m.HorsCadre += horsCadre
	slog.InfoContext(ctx, "scenario objects placed", "placements", len(placements), "placed", poses,
		"sansModele", sansModele, "horsCadre", horsCadre, "multiJoueur", multiJoueur, "modeles", len(modeles))
}

// poseModele ajoute les maillages du modele a l'instance `in` : a la structure, ou aux ombres pour
// une section que le jeu ne dessine pas a l'ecran.
func (m *MaillageMonde) poseModele(mp *modelePose, in Instance) {
	in.Materiaux = mp.materiaux
	for _, k := range mp.maillages {
		mesh := mp.asset.Mesh(k)
		if mesh == nil {
			continue
		}
		g := &m.Structure
		if horsPasseVisible(mp.asset, k) {
			g = &m.Ombre
		}
		g.ajoute(mesh, in, 0)
	}
}

// modeleDuPlacement resout et ouvre le render_model d'un tag d'objet, dans sa variante `variante`
// (0 : modele par defaut) ; nil (logge) s'il manque.
func modeleDuPlacement(ctx context.Context, idx *ModuleIndex, tag, variante uint32) *modelePose {
	octets, err := idx.Extract(tag)
	if err != nil {
		slog.DebugContext(ctx, "unreadable scenario object tag", "id", fmt.Sprintf("%08x", tag), "err", err)
		return nil
	}
	id, groupe, ok := RefModeleVehicule(ctx, idx, octets)
	if !ok {
		slog.DebugContext(ctx, "scenario object without model", "id", fmt.Sprintf("%08x", tag))
		return nil
	}
	a := ouvreAsset(ctx, idx, id, groupe)
	if a == nil {
		return nil
	}
	mp := lisModelePose(a, groupe, varianteDuPlacement(ctx, idx, octets, variante))
	return &mp
}

// dansCadre2D dit si un point tombe dans le rectangle (minX, minY, maxX, maxY) ; un cadre vide
// accepte tout (meme convention que `dansCadre`).
func dansCadre2D(p [3]float64, cadre [4]float64) bool {
	if cadre[2] <= cadre[0] || cadre[3] <= cadre[1] {
		return true
	}
	return p[0] >= cadre[0] && p[0] <= cadre[2] && p[1] >= cadre[1] && p[1] <= cadre[3]
}
