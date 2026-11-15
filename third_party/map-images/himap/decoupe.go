// Package himap — decoupe.go : quel masque de decoupe alpha un materiau applique.
//
// Les materiaux des cartes n'ont plus leur bloc de parametres nommes : seul le postprocess
// reste, des textures rangees par EMPLACEMENT (l'octet ou le shader compile les lit) et un
// tableau de constantes. Le sens d'un emplacement depend donc du shader. La table vient de
// `TheHaloArchive/ekur` (`ekur_materials`, faits lus : identifiant de shader, emplacement du
// masque, octet du bloc `AlphaInfo` : transformation sur 4 flottants puis puissance, ajout,
// seuil) ; un shader absent de la table n'a pas de decoupe connue et reste plein.
package himap

import (
	"encoding/binary"
	"math"
)

// Disposition du postprocess (premier enregistrement) : le bloc des textures a +0 (56 o :
// reference du bitmap, registre de sa transformation a +0x28, emplacement a +0x2A), le bloc des
// constantes a +0x58 (16 o).
const (
	postOffTextures    = 0x00
	postOffConstantes  = 0x58
	textureStride      = 56
	textureOffTransfo  = 0x28
	textureOffEmplace  = 0x2A
	constanteStride    = 16
	seuilDecoupeDefaut = 0.5
)

// roleDecoupe : l'emplacement du masque et l'octet des constantes ou commence son `AlphaInfo`
// (-1 : pas d'`AlphaInfo`, transformation identite et seuil par defaut).
type roleDecoupe struct{ emplacement, infos int }

const (
	infoOffPuissance = 16 // apres la transformation (4 flottants)
	infoOffAjout     = 20
	infoOffSeuil     = 24
)

var rolesDecoupe = map[uint32]roleDecoupe{
	// rohm_1_mm_cone_alpha
	0xb125c3cf: {240, 256},
	// rohm_1_alpha
	0x4a13c07c: {192, 208},
	0x70d10617: {192, 208},
	// diffuse
	0x41bbd6ad: {196, -1},
	0x0325d014: {196, -1},
	0x14499d29: {196, -1},
	0x5a4ba711: {196, -1},
	0x9337a7cc: {196, -1},
	// LOCAL-CHANGE (infinite-theater-3d): terrain decorators (grass clumps, couches_noms.go):
	// the cutout is the alpha of the map at slot 76 (`surface_normal_map`).
	0xbd7bb1c4: {76, -1},
	0xd313108e: {76, -1},
}

// nomAtlasFeuillage (LOCAL-CHANGE (infinite-theater-3d)) : the name of a foliage shader's leaf
// atlas color map (couches_noms.go, "Atlas de feuillage"). Its alpha is the leaves' coverage
// (measured on Fortress's bush, pine and branch atlases), so a shader that binds it is cut by
// that alpha.
const nomAtlasFeuillage = 0xca775400

// atlasFeuillageParShader (LOCAL-CHANGE (infinite-theater-3d)) : foliage shaders that bind their
// leaf atlas under another name, by slot. 669c3e5e binds the bush atlas under the panel atlas's
// name (`0xdaef076c`, slot 4): Fortress's Snow Covered Pine Bush Cluster A MP.
var atlasFeuillageParShader = map[uint32]int{0x669c3e5e: 4}

// decoupeAtlasFeuillage (LOCAL-CHANGE (infinite-theater-3d)) : the cut by the alpha of the leaf
// atlas the shader binds (nomAtlasFeuillage, atlasFeuillageParShader); nil when it binds none.
// An alpha-only cut: an atlas without transparency stays opaque (glb.go).
func decoupeAtlasFeuillage(shader uint32, params ParametresShader, textures map[int]uint32) *Decoupe {
	o, ok := atlasFeuillageParShader[shader]
	if !ok {
		o, ok = params[nomAtlasFeuillage]
	}
	if !ok {
		return nil
	}
	id, ok := textures[o]
	if !ok {
		return nil
	}
	return &Decoupe{Bitmap: id, Echelle: [2]float32{1, 1}, Puissance: 1, Seuil: seuilDecoupeDefaut, AlphaSeul: true}
}

// postprocessLu : le premier enregistrement d'un bloc postprocess. `textures` : emplacement ->
// GlobalID de bitmap ; `transfos` : emplacement -> registre de sa transformation (-1 : aucune).
type postprocessLu struct {
	textures   map[int]uint32
	transfos   map[int]int
	constantes []byte
}

func (ti tagInfo) postprocess(bloc int) postprocessLu {
	sous := ti.sousBlocsParOffset(bloc)
	pp := postprocessLu{textures: map[int]uint32{}, transfos: map[int]int{}}
	if abs, size, ok := ti.blocValide(sous, postOffTextures); ok {
		for k := 0; k+textureStride <= size; k += textureStride {
			id := uint32(u32(ti.tag, abs+k+refOffGlobalID))
			if id != 0 && id != math.MaxUint32 {
				o := int(u16(ti.tag, abs+k+textureOffEmplace))
				pp.textures[o] = id
				pp.transfos[o] = int(int16(u16(ti.tag, abs+k+textureOffTransfo)))
			}
		}
	}
	if abs, size, ok := ti.blocValide(sous, postOffConstantes); ok {
		pp.constantes = ti.tag[abs : abs+size-size%constanteStride]
	}
	return pp
}

// blocValide resout un sous-bloc par son offset de champ et verifie qu'il tient dans le tag.
func (ti tagInfo) blocValide(sous map[int]int, champ int) (abs, size int, ok bool) {
	c, ok := sous[champ]
	if !ok || c < 0 || c >= ti.dataBlocks {
		return 0, 0, false
	}
	abs, size = ti.blockAbsSection(c)
	return abs, size, abs >= 0 && size > 0 && abs+size <= len(ti.tag)
}

// decoupeDuShader applique la table : nil si le shader n'a pas de masque connu ou si le
// materiau ne fournit pas la texture de son emplacement.
func decoupeDuShader(shader uint32, textures map[int]uint32, constantes []byte) *Decoupe {
	r, ok := rolesDecoupe[shader]
	if !ok {
		return nil
	}
	id, ok := textures[r.emplacement]
	if !ok {
		return nil
	}
	d := &Decoupe{Bitmap: id, Echelle: [2]float32{1, 1}, Puissance: 1, Seuil: seuilDecoupeDefaut}
	if r.infos < 0 || r.infos+infoOffSeuil+4 > len(constantes) {
		return d
	}
	f := func(o int) float32 { return math.Float32frombits(binary.LittleEndian.Uint32(constantes[r.infos+o:])) }
	if sx, sy := f(0), f(4); sx != 0 && sy != 0 && !math.IsNaN(float64(sx)) && !math.IsNaN(float64(sy)) {
		d.Echelle = [2]float32{sx, sy}
		d.Decalage = [2]float32{f(8), f(12)}
	}
	if p := f(infoOffPuissance); p > 0 && !math.IsInf(float64(p), 0) {
		d.Puissance = p
	}
	if a := f(infoOffAjout); a > -1 && a < 1 {
		d.Ajout = a
	}
	if s := f(infoOffSeuil); s > 0 && s <= 1 {
		d.Seuil = s
	}
	return d
}
