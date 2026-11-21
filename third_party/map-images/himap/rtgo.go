// Package himap — rtgo.go : le tag `rtgo` (runtime geo), ou vit la geometrie de rendu.
//
// CHAINE :
//
//	instance du sbsp -> RuntimeGeoMeshReference -> tag rtgo -> PerMeshData -> maillages
//
// Les offsets du root struct de `rtgo` viennent de `Gravemind2401/Reclaimer`
// (`Reclaimer.Blam/Blam/HaloInfinite/RuntimeGeoTag.cs`), une implementation tierce validee
// par l'usage (elle exporte des modeles ouverts dans Blender). Ils sont VERIFIES sur nos
// propres tags par le temoin du pas de 144 (cf. ErrPerMeshStride).
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"encoding/binary"
	"errors"
	"fmt"
)

// Offsets des champs tag-block du root struct de `rtgo`.
const (
	rtgoOffPerMeshData        = 16
	rtgoOffSections           = 64
	rtgoOffBoundingBoxes      = 104
	rtgoOffMeshResourceGroups = 196
)

// Offsets des champs tag-block du root struct de `mode` (render_model), de Reclaimer
// `RenderModelTag.cs` — la meme source tierce, validee par l'usage, que les offsets rtgo.
// Le `mode` porte les MEMES SectionBlock (60 o) et SectionLodBlock (148 o) que le rtgo ;
// ce qui change est leur place au root, et des bornes UNIQUES au modele (BoundingBoxBlock)
// au lieu de bornes par maillage.
const (
	modeOffSections           = 192
	modeOffBoundingBoxes      = 232
	modeOffMeshResourceGroups = 324
)

// bboxStride / bboxOffBounds : un enregistrement `BoundingBoxBlock` (84 o) porte les paires
// (min, max) ENTRELACEES des axes X/Y/Z a partir de +4 — la ou le per-mesh du rtgo range
// les trois minima puis les trois maxima (cf. meshOffBoundsMin/Max).
// ErrSansSections reports a `mode` whose Sections field (root +192) points to no data block: a
// render model with no geometry of its own (no Mesh Resource Groups either, root +324 count 0).
// MEASURED 2026-11-21 (The Library): 11 of the 6076 `mode` tags of the whole installation. What the
// game draws for one is what its model variant attaches, when it attaches anything
// (objets_attaches.go). LOCAL-CHANGE (infinite-theater-3d), ported from The Library.
var ErrSansSections = errors.New("himap: mode without sections")

const (
	bboxStride    = 84
	bboxOffBounds = 4
)

// perMeshStride : un enregistrement `Per Mesh Data` mesure 144 octets. TEMOIN : le bloc
// doit mesurer un multiple ENTIER de ce pas — mesure sur nos tags, 864 = 6 x 144,
// 1 296 = 9 x 144, 720 = 5 x 144. Un offset faux ne donne pas un multiple entier.
const perMeshStride = 144

// refOffGlobalID : dans les 28 octets de `RuntimeGeoMeshReference`, le GlobalID du tag
// `rtgo` est a +8.
//
// MESURE (2026-08-08, ridgeline) : les offsets 0, 4, 20 et 24 sont CONSTANTS sur les
// 10 357 instances (une seule valeur distincte chacun) ; 8, 12 et 16 portent l'identite
// avec 548 valeurs distinctes. A l'offset 8, 525 de ces 548 valeurs (95,8 %) resolvent
// contre les GlobalID des modules — ce qui n'arrive pas par hasard.
const refOffGlobalID = 8

// RuntimeGeoID rend le GlobalID du tag `rtgo` qui porte la geometrie de cette instance.
// GroupeRtgo : le groupe de tag du maillage de rendu (`render_geometry`).
//
// Le litteral etait ecrit a 13 endroits du paquet. Un groupe de tag est un identifiant du
// format, pas une chaine libre : une faute de frappe y rend un `Lookup` toujours faux, et un
// rendu silencieusement vide.
const GroupeRtgo = "rtgo"

func (in Instance) RuntimeGeoID() uint32 {
	return binary.LittleEndian.Uint32(in.MeshRef[refOffGlobalID:])
}

// RuntimeGeo est ce qu'on sait lire d'un tag de geometrie — `rtgo`, ou `mode` depuis le
// lot B Forge (les deux partagent SectionBlock et la mecanique de tampons).
type RuntimeGeo struct {
	// MeshCount est le nombre de maillages : enregistrements `Per Mesh Data` d'un rtgo,
	// enregistrements `Sections` d'un mode.
	MeshCount int
	// PerMeshAbs / PerMeshSize localisent le bloc dans les octets du tag. PerMeshAbs < 0 :
	// pas de bloc per-mesh (tag `mode`). Ses bornes sont celles du RENDU d'un maillage (sa
	// boite serree), pas celles de sa quantification.
	PerMeshAbs  int
	PerMeshSize int
	// BoundsAbs localise le premier enregistrement BoundingBoxBlock, rtgo comme mode : la boite
	// de QUANTIFICATION des positions et des coordonnees de texture de tous les maillages du
	// tag. Sur un rtgo, un maillage plus petit que la boite n'occupe qu'une partie de la plage
	// de 16 bits ; le dequantifier entre ses propres bornes l'etirerait.
	BoundsAbs int
	// Champs reperes mais non encore decodes — leur presence est publiee pour que la
	// suite du portage (T2, T3) parte d'un constat, pas d'une supposition.
	SectionsTarget       int
	BoundingBoxesTarget  int
	ResourceGroupsTarget int
}

// ErrPerMeshStride signale que le bloc designe n'est pas un tableau d'enregistrements de
// 144 octets : l'offset de champ ne designe pas `Per Mesh Data` dans ce tag.
var ErrPerMeshStride = fmt.Errorf("himap: Per Mesh Data block of size not a multiple of %d", perMeshStride)

// ReadRuntimeGeoTag decode ce qu'on sait lire d'un tag `rtgo` deja decompresse.
func ReadRuntimeGeoTag(tag []byte) (RuntimeGeo, error) {
	cands := tagCandidates(tag)
	if len(cands) == 0 {
		return RuntimeGeo{}, fmt.Errorf("himap: unrecognized rtgo tag header")
	}
	var last error
	for _, ti := range cands {
		rg, err := runtimeGeoFromTagInfo(ti)
		if err == nil {
			return rg, nil
		}
		last = err
	}
	return RuntimeGeo{}, last
}

func runtimeGeoFromTagInfo(ti tagInfo) (RuntimeGeo, error) {
	offs, targets, err := ti.rootBlockRefs()
	if err != nil {
		return RuntimeGeo{}, err
	}
	parOffset := map[int]int{}
	for i, o := range offs {
		parOffset[o] = targets[i]
	}
	cible, ok := parOffset[rtgoOffPerMeshData]
	if !ok {
		return RuntimeGeo{}, fmt.Errorf("himap: no tag-block at offset %d (offsets seen: %v)",
			rtgoOffPerMeshData, offs)
	}
	abs, size := ti.blockAbs(cible)
	if abs < 0 || size < 0 || abs+size > len(ti.tag) {
		return RuntimeGeo{}, fmt.Errorf("himap: Per Mesh Data block out of bounds")
	}
	if size%perMeshStride != 0 {
		return RuntimeGeo{}, fmt.Errorf("%w (taille %d)", ErrPerMeshStride, size)
	}
	absB, err := premiereBoite(ti, parOffset, rtgoOffBoundingBoxes)
	if err != nil {
		return RuntimeGeo{}, err
	}
	return RuntimeGeo{
		MeshCount:            size / perMeshStride,
		PerMeshAbs:           abs,
		PerMeshSize:          size,
		BoundsAbs:            absB,
		SectionsTarget:       parOffset[rtgoOffSections],
		BoundingBoxesTarget:  parOffset[rtgoOffBoundingBoxes],
		ResourceGroupsTarget: parOffset[rtgoOffMeshResourceGroups],
	}, nil
}

// modeGeoFromTagInfo decode le root struct d'un tag `mode` (render_model) : les Sections
// donnent les maillages, le BoundingBoxBlock donne les bornes uniques du modele.
func modeGeoFromTagInfo(ti tagInfo) (RuntimeGeo, error) {
	offs, targets, err := ti.rootBlockRefs()
	if err != nil {
		return RuntimeGeo{}, err
	}
	parOffset := map[int]int{}
	for i, o := range offs {
		parOffset[o] = targets[i]
	}
	sections, ok := parOffset[modeOffSections]
	if !ok {
		return RuntimeGeo{}, fmt.Errorf("himap: no Sections tag-block at offset %d (offsets seen: %v)",
			modeOffSections, offs)
	}
	if sections < 0 {
		return RuntimeGeo{}, ErrSansSections
	}
	absS, sizeS := ti.blockAbs(sections)
	if absS < 0 || sizeS <= 0 || sizeS%sectionStride != 0 || absS+sizeS > len(ti.tag) {
		return RuntimeGeo{}, fmt.Errorf("himap: Sections block of size %d not a multiple of %d", sizeS, sectionStride)
	}
	absB, err := premiereBoite(ti, parOffset, modeOffBoundingBoxes)
	if err != nil {
		return RuntimeGeo{}, err
	}
	return RuntimeGeo{
		MeshCount:            sizeS / sectionStride,
		PerMeshAbs:           -1,
		BoundsAbs:            absB,
		SectionsTarget:       sections,
		BoundingBoxesTarget:  parOffset[modeOffBoundingBoxes],
		ResourceGroupsTarget: parOffset[modeOffMeshResourceGroups],
	}, nil
}

// premiereBoite rend la position du premier enregistrement du bloc BoundingBoxes, au champ
// racine `off`. Reclaimer documente des modes SANS boite (attaches) : sans elle, aucune
// dequantification possible, le tag est declare illisible, jamais devine.
func premiereBoite(ti tagInfo, parOffset map[int]int, off int) (int, error) {
	cible, ok := parOffset[off]
	if !ok {
		return -1, fmt.Errorf("himap: no BoundingBoxes tag-block at offset %d", off)
	}
	abs, size := ti.blockAbs(cible)
	if abs < 0 || size < bboxStride || size%bboxStride != 0 || abs+bboxStride > len(ti.tag) {
		return -1, fmt.Errorf("himap: BoundingBoxes block of size %d not a multiple of %d", size, bboxStride)
	}
	return abs, nil
}
