// Package himap — materiaux.go : le tag `mat ` (material), ce qu'une part de maillage dessine.
//
// CHAINE :
//
//	instance du sbsp -> per Instance Material Block (Instance.Materiaux)
//	part d'un LOD -> rang dans cette liste (PartMaillage.Materiau) -> tag `mat `
//
// Les offsets du root struct viennent de `Gravemind2401/Reclaimer`
// (`Reclaimer.Blam/Blam/HaloInfinite/MaterialTag.cs`) ; les trois champs tag-block qu'il
// declare (44, 64, 116) sont exactement ceux que la struct-table de nos tags designe. Le mode
// de melange, lui, est a +60 du postprocess et non a +64 comme chez Reclaimer : mesure sur les
// 1 215 materiaux de Recharge, +60 porte un entier de l'enum et +56/+64 le remplissage 0xBC.
package himap

import (
	"fmt"
	"io/fs"
	"log/slog"
	"path/filepath"
)

// GroupeMateriau : le groupe de tag des materiaux.
const GroupeMateriau = "mat "

// Offsets du tag `mat `.
const (
	matOffShader       = 16  // reference de tag du shader de materiau (GlobalID a +8)
	matOffPostprocess  = 64  // tag-block `postprocess definitions`
	postprocessStride  = 160 // un enregistrement de ce bloc
	// postOffMelange (LOCAL-CHANGE (infinite-theater-3d)): `alpha blend mode` is the byte at +84 of
	// the postprocess record (also at +0x68 of the root). +60, read before, is the element count
	// of the `function parameters` block: materials with an animated parameter (the weapon pads'
	// glow) read as additive. The byte at +84 matches Ekur's alpha_blend_mode on all 47,832
	// materials of its export.
	postOffMelange     = 84
	melangeInconnuBrut = -1
	// matOffDrapeaux : drapeaux de rendu du root (u16). Le bit drapeauPasseTransparente marque
	// les materiaux que le moteur dessine dans sa passe transparente : vitres refractives (dont le
	// mode de melange reste opaque, la refraction tenant lieu de transparence) et decalques.
	matOffDrapeaux           = 0x68
	drapeauPasseTransparente = 0x10
	// nomVerre : un parametre du bloc « verre » d'un shader (six noms toujours declares ensemble,
	// une carte liee et trois reglages) ; un shader qui le declare dessine une vitre.
	nomVerre = 0x18947020
)

// ModeMelange est le `alpha blend mode` d'un materiau, enum du moteur (Reclaimer
// `Halo5.AlphaBlendMode`, inchange sur les rangs observes).
type ModeMelange int

// Rangs de l'enum observes sur les cartes. Tout rang non nul se superpose a ce qui est
// derriere : vitre, carte lumineuse, decalque. Seul l'opaque masque.
const (
	MelangeOpaque ModeMelange = iota
	MelangeAdditif
	MelangeMultiplie
	MelangeAlpha
	MelangeDoubleMultiplie
	MelangeAlphaPremultiplie
	MelangeMaximum
)

// Decal ranks of the enum (LOCAL-CHANGE (infinite-theater-3d), names from Ekur's export). Their
// blending is not read: they keep the opaque drawing they had while the blend mode was misread
// as zero.
const (
	melangeDecalAlpha    ModeMelange = 19
	melangeDecalOpaque   ModeMelange = 23
	melangeDecalAoOpaque ModeMelange = 68
	melangeDecalAoAlpha  ModeMelange = 69
)

// Materiau est ce qu'on sait lire d'un tag `mat `.
type Materiau struct {
	ID uint32
	// Shader est le GlobalID du shader de materiau : deux materiaux qui le partagent sont
	// dessines par le meme programme (verre, metal, terrain...).
	Shader uint32
	// Melange vaut melangeInconnuBrut quand le tag n'a pas de postprocess lisible.
	Melange ModeMelange
	// PasseTransparente : le moteur le dessine dans sa passe transparente (matOffDrapeaux).
	PasseTransparente bool
	// Verre : son shader declare le bloc verre (nomVerre).
	Verre bool
	// Decoupe : le masque dont les pixels sous le seuil ne sont pas dessines (grilles, toles
	// perforees). nil quand le shader n'en a pas, ou n'est pas dans `rolesShaders`.
	Decoupe *Decoupe
	// Couches : les couches colorees du materiau (couches.go, couches_noms.go). nil quand son
	// shader n'en declare aucune que le materiau lie.
	Couches *Couches
	// Emissif : la lumiere propre du materiau (emissif.go). nil quand le shader n'est pas dans
	// `shadersEmissifs` ou que le materiau est eteint.
	Emissif *Emissif
	// Pochoir : couleur lineaire et opacite d'un decalque pochoir, nil sans constantes lisibles.
	Pochoir *Pochoir
	// Surface : les images d'un materiau de surface dure (surface_dure.go). nil pour un autre shader.
	Surface *SurfaceDure
}

// Decoupe est un masque de decoupe alpha : la texture, sa transformation de coordonnees
// (uv' = uv * echelle + decalage), le reglage de la valeur lue (a' = a^Puissance + Ajout) et
// le seuil sous lequel un pixel est jete.
type Decoupe struct {
	Bitmap    uint32
	Echelle   [2]float32
	Decalage  [2]float32
	Puissance float32
	Ajout     float32
	Seuil     float32
}

// Opaque dit si le materiau masque ce qui est derriere lui. Un materiau illisible compte
// comme opaque : c'est l'hypothese qui ne fait pas disparaitre de mur.
func (m Materiau) Opaque() bool {
	switch m.Melange {
	case MelangeOpaque, melangeInconnuBrut,
		melangeDecalAlpha, melangeDecalOpaque, melangeDecalAoOpaque, melangeDecalAoAlpha: // LOCAL-CHANGE (infinite-theater-3d)
		return true
	}
	return false
}

// melangeEcrit (LOCAL-CHANGE (infinite-theater-3d)): the blend mode the GLB carries, where a
// viewer draws any non-zero mode as see-through; a decal writes 0, as when the mode was misread.
func (m Materiau) melangeEcrit() int {
	if m.Melange != melangeInconnuBrut && m.Opaque() {
		return 0
	}
	return int(m.Melange)
}

// Vitre dit si le materiau est une vitre : le constat en jeu s'il y en a un
// (`vitresConstatees`), sinon son shader est une vitre constatee (`shadersVitres`) ou declare
// le bloc verre, ou il est dessine dans la passe transparente sans couche coloree lisible. Un decalque de cette passe porte ses couches et
// reste dessine par elles.
func (m Materiau) Vitre() bool {
	if v, ok := vitresConstatees[m.ID]; ok {
		return v
	}
	return shadersVitres[m.Shader] || m.Verre || m.PasseTransparente && m.Couches == nil
}

// LecteurShaders rend les parametres declares d'un shader (couches_noms.go), nil quand il est
// illisible ou absent des modules.
type LecteurShaders func(shader uint32) ParametresShader

// LitMateriau decode un tag `mat ` deja decompresse.
func LitMateriau(id uint32, tag []byte, shaders LecteurShaders) (Materiau, error) {
	for _, ti := range tagCandidates(tag) {
		offs, targets, err := ti.rootBlockRefs()
		if err != nil {
			continue
		}
		rb, err := ti.rootBlockIndex()
		if err != nil {
			continue
		}
		rAbs, rSize := ti.blockAbs(rb)
		if rAbs < 0 || matOffShader+refOffGlobalID+4 > rSize || rAbs+rSize > len(tag) {
			continue
		}
		m := Materiau{ID: id, Shader: uint32(u32(tag, rAbs+matOffShader+refOffGlobalID)), Melange: melangeInconnuBrut}
		if matOffDrapeaux+2 <= rSize {
			m.PasseTransparente = u16(tag, rAbs+matOffDrapeaux)&drapeauPasseTransparente != 0
		}
		_, m.Verre = shaders(m.Shader)[nomVerre]
		for i, o := range offs {
			if o == matOffPostprocess {
				litPostprocess(&m, ti, tag, targets[i], shaders)
			}
		}
		return m, nil
	}
	return Materiau{}, fmt.Errorf("himap: tag %s %#x illisible", GroupeMateriau, id)
}

// litPostprocess verse dans m le bloc postprocess `cible` du tag (melange, decoupe, couches,
// emission, surface dure) ; un bloc hors bornes ou de taille incoherente est ignore.
func litPostprocess(m *Materiau, ti tagInfo, tag []byte, cible int, shaders LecteurShaders) {
	if cible < 0 || cible >= ti.dataBlocks {
		return
	}
	abs, size := ti.blockAbs(cible)
	if abs < 0 || size < postprocessStride || size%postprocessStride != 0 || abs+size > len(tag) {
		return
	}
	m.Melange = ModeMelange(tag[abs+postOffMelange]) // LOCAL-CHANGE (infinite-theater-3d): one byte
	pp := ti.postprocess(cible)
	m.Decoupe = decoupeDuShader(m.Shader, pp.textures, pp.constantes)
	m.Couches = couchesDuMateriau(m.Shader, shaders, pp)
	m.Emissif = emissifDuShader(m.Shader, pp.constantes)
	m.Pochoir = pochoirDuShader(m.Shader, shaders(m.Shader), pp.constantes)
	m.Surface = surfaceDureDuShader(m.Shader, pp.textures)
}

// CheminsMateriaux rend les modules ou chercher les materiaux d'une carte. Ils ne sont PAS
// dans les modules de geometrie (`GeometrySearchPath`, sous `pc/`) : ils vivent sous `any/`,
// dans le module jumeau de la carte et dans `any/globals` (sous-dossiers compris).
func CheminsMateriaux(deployRoot, moduleCarte string) ([]string, error) {
	var out []string
	if jumeau, ok := jumeauAny(deployRoot, moduleCarte); ok {
		out = append(out, jumeau)
	}
	err := filepath.WalkDir(filepath.Join(deployRoot, "any", "globals"), func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() && filepath.Ext(p) == ".module" {
			out = append(out, p)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("modules de materiaux : %w", err)
	}
	return out, nil
}

// LitMateriaux resout une liste de GlobalID `mat ` dans `idx`, leurs shaders dans `idxShaders`
// (les `shdv` vivent sous `pc/globals`). Un ID absent des modules ou illisible est compte dans
// `illisibles` et laisse hors de la table (l'appelant le traite comme opaque).
func LitMateriaux(idx, idxShaders *ModuleIndex, ids []uint32) (table map[uint32]Materiau, illisibles int) {
	table = make(map[uint32]Materiau, len(ids))
	shaders := lecteurShaders(idxShaders)
	for _, id := range ids {
		if g, _, ok := idx.Lookup(id); !ok || g != GroupeMateriau {
			illisibles++
			continue
		}
		tag, err := idx.Extract(id)
		if err != nil {
			illisibles++
			continue
		}
		m, err := LitMateriau(id, tag, shaders)
		if err != nil {
			illisibles++
			continue
		}
		table[id] = m
	}
	return table, illisibles
}

// lecteurShaders lit chaque shader une fois.
func lecteurShaders(idx *ModuleIndex) LecteurShaders {
	lus := map[uint32]ParametresShader{}
	return func(id uint32) ParametresShader {
		if p, deja := lus[id]; deja {
			return p
		}
		var p ParametresShader
		if g, _, ok := idx.Lookup(id); ok && g == GroupeShader {
			tag, err := idx.Extract(id)
			if err == nil {
				p, err = LitParametresShader(tag)
			}
			if err != nil {
				slog.Warn("shader illisible : materiaux sans couches", "shader", fmt.Sprintf("%08x", id), "err", err)
			}
		}
		lus[id] = p
		return p
	}
}
