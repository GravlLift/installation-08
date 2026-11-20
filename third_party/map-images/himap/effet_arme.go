// Package himap — effet_arme.go (LOCAL-CHANGE (infinite-theater-3d)): the particle effect a weapon
// attaches to its model (the Shock Rifle's electricity around its barrel housing), read from the
// tags down to the numbers a viewer simulates.
//
// CHAIN: the `weap` attachments (read by the caller) name an effect (`effe`) and the weapon function
// that scales it. The effect's first level of detail lists its locations (marker names of the
// weapon's model) and its events; each event's particle systems name a particle (`prt3`), one of the
// locations, a coordinate system and a camera mode (first person only, third person only); each
// system's emitter carries the emission shape and the properties (lifespan, rate, size, alpha...),
// each a mapping function of an input (particle age, effect scale...). The particle names its
// shader (`shdv`), the textures bound in the shader's order, the blend mode, the shader constants
// and, for a model particle, its mesh (`pmdf`, modele_particule.go).
//
// LAYOUT: read off the installed game's tags (the effect 1e471031 of the Shock Rifle and its six
// particles), field names from the community plugin XML of `effe` and `prt3` (not vendored: no
// license); the offsets are measured on the tags and cross-checked against the team banner reader
// (banniere_equipe.go: levels +0x5c, events +0x64, systems +0x48 of 0x78, emitters +0x5c of 0x5a8,
// blend mode at the prt3 root +0x78). Each read checks its block size and refuses rather than
// guessing.
//
// SHADER CONSTANTS: the particle's postprocess record carries the shader's `$Globals` constant
// buffer (16 o registers). The byte offset of each named constant is the shader's own: read from
// the DXIL reflection of the shader's pixel bytecode (`shbc`, disassembled with Microsoft's dxc
// -dumpbin), and cross-checked against the shader's declared parameters (LitParametresShader: the
// StringID of the lowercased name, at the same byte offset), see dispositionsParticules.
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"math"
)

// ErrSansEffet: the effect has no readable particle system.
var ErrSansEffet = errors.New("himap: effect without a readable particle system")

// Layout of the effect (effe), measured (see the header).
const (
	effeTailleNiveau      = 140 // a level of detail
	effeOffNiveauPortee   = 36  // level: camera distance range (2 x f32)
	effeOffNiveauDrapeaux = 74  // level: flags (u16: bit 0 non-rendering, bit 1 events in parallel)
	effeOffEmplacements   = 80  // level: locations (8 o: marker name)
	effeTailleEmplacement = 8   //
	evtOffDrapeaux        = 4   // event: flags (u16: bit 1 particles die when the effect ends)
	evtOffDuree           = 20  // event: duration bounds (2 x f32, seconds)
	sysOffEmplacement     = 32  // system: location index (u32)
	sysOffRepere          = 36  // system: coordinate system (u8: 0 world, 1 local)
	sysOffCamera          = 40  // system: camera mode (u8: 0 independent, 1 first person only, 2 third person only, 3 both)
	sysOffDrapeaux        = 44  // system: flags (u32)
	sysOffEchelleTaille   = 60  // system: size scale (f32)
	emetOffDrapeaux       = 9   // emitter: flags (u8)
	emetOffApparence      = 112 // emitter: particle appearance flags (u32)
	emetOffDrapeauxPart   = 116 // emitter: particle flags (u32)
	emetOffForme          = 121 // emitter: emission shape (u8)
	emetOffEchelleAxes    = 152 // emitter: axis scale (3 x f32)
	emetOffDirection      = 164 // emitter: particle emission direction (3 x f32)
	emetOffBillboard      = 212 // emitter: particle billboard style (u16)
	emetOffInterpolant    = 380 // emitter: starting interpolant (3 x f32)
	emetOffGabarit        = 996 // emitter: particle movement template (pmov GlobalID)
	proprieteOffDonnees   = 4   // property: the mapping function's data reference
	prt3OffApparence      = 16  // particle root: appearance flags (u32: bit 0 double-sided, bit 1 no depth test)
	prt3OffShader         = 40  // particle root: material shader GlobalID (tagref at +32)
	prt3OffPostprocess    = 80  // particle root: postprocess definition (tag block, 160 o)
	prt3OffModele         = 172 // particle root: model GlobalID (pmdf tagref at +164)
	postTaille            = 160 // a postprocess record
	postTailleTexture     = 56  // postprocess textures (decoupe.go postOffTextures): 56 o, bitmap tagref at +0;
	//                                 blend mode at postOffMelange (materiaux.go), constants at postOffConstantes
	tagrefOffID         = 8  // a tag reference: GlobalID
	effeEvenementsMaxi  = 16 // bounds on block counts, against an unreadable tag
	effeSystemesMaxi    = 64 //
	courbeSegmentsMaxi  = 64 //
	codeSegmentCubique  = 7  // a multi-spline segment's code, low byte: cubic (else linear)
	fonctionMultiSpline = 8  //
	fonctionIdentite    = 0  //
	fonctionConstante   = 1  //
	melangeAddSrcAlpha  = 9  // the alpha blend mode add_src_times_srcalpha (prt3 plugin enum)
)

// Emitter properties: name (the JSON key the viewer reads) and offset of the property struct in the
// emitter record (input u8 at +0, range input +1, output modifier +2, modifier input +3, mapping
// function data reference +4).
var proprietesEmetteur = []struct {
	nom string
	off int
}{
	{"emissionRadius", 176}, {"relativeDirection", 248}, {"emissionAngle", 308}, {"translationalOffset", 344},
	{"lifespan", 412}, {"startingCount", 448}, {"maxCount", 484}, {"emissionRate", 520},
	{"emissionPerDistance", 556}, {"size", 592}, {"scale", 628}, {"scaleX", 664}, {"scaleY", 700},
	{"aspectRatio", 736}, {"rotation", 772}, {"rotationRate", 808}, {"velocity", 844},
	{"selfAcceleration", 880}, {"intensity", 1072}, {"tint", 1112}, {"tint2", 1152}, {"alpha", 1188},
	{"alpha2", 1224}, {"alphaBlackPoint", 1260}, {"alphaWhitePoint", 1296}, {"frameIndex", 1336},
	{"animationRate", 1372}, {"paletteAnimation", 1408},
}

// Kinds of a shader constant.
const (
	constFlottant = iota // float
	constEntier          // bool, int, uint (32 bits)
	constVecteur         // float4
)

// constanteShader: a named constant of a particle shader's $Globals.
type constanteShader struct {
	nom   string
	octet int
	sorte int
}

// dispositionShader: a particle shader's bound textures, in the order of the postprocess textures
// block, and its constants.
type dispositionShader struct {
	textures   []string
	constantes []constanteShader
}

// octetDe: the byte of the named constant, -1 when the layout does not name it.
func (d dispositionShader) octetDe(nom string) int {
	for _, c := range d.constantes {
		if c.nom == nom {
			return c.octet
		}
	}
	return -1
}

// dispositionsParticules: the particle shaders read, by `shdv` GlobalID. Offsets from the DXIL
// reflection of their pixel bytecode (9b1c511e: shbc 526bce05, $Globals of 204 o; 96db07b6: shbc
// a6ee4305, 316 o); the texture order is the order of the `_texture_textureIndex` constants, which
// is the order of the postprocess textures (3 and 4 records on the Shock Rifle's particles).
var dispositionsParticules = map[uint32]dispositionShader{
	// The billboard particle shader (sprites: the arcs and bolts).
	0x9b1c511e: {
		textures: []string{"baseTexture", "alphaMap", "paletteTexture"},
		constantes: []constanteShader{
			{"ConstantScreenSize", 0, constEntier}, {"SphereWarpStrength", 4, constFlottant},
			{"premultiplied_alpha_scale", 8, constFlottant}, {"do_unpremultiply_alpha", 12, constEntier},
			{"DepthFadeAsVCoord", 16, constEntier}, {"texcoordRotation", 32, constEntier},
			{"baseTexture_texture_textureIndex", 36, constEntier}, {"alphaMap_texture_textureIndex", 96, constEntier},
			{"paletteTexture_texture_textureIndex", 160, constEntier}, {"baseTexture_texture_frameCount", 44, constEntier}, {"baseTexture_texture_transform", 48, constVecteur},
			{"baseTextureInvert", 64, constEntier}, {"baseTextureDesaturation", 68, constFlottant},
			{"ALBEDO_BLACK_WHITE_POINT", 72, constEntier}, {"baseTextureBlackPoint", 76, constFlottant},
			{"baseTextureWhitePoint", 80, constFlottant}, {"baseTextureMidPoint", 84, constFlottant},
			{"applyBWPToBaseAlpha", 88, constEntier}, {"SYNC_TEXTURE_ANIM", 92, constEntier},
			{"alphaMap_texture_frameCount", 104, constEntier}, {"alphaMap_texture_transform", 112, constVecteur},
			{"alphaMapFrameIndex", 128, constFlottant}, {"alphaMapAnimationRate", 132, constFlottant},
			{"useAlphaMapRed", 136, constEntier}, {"alphaTextureInvert", 140, constEntier},
			{"ALPHA_BLACK_WHITE_POINT", 144, constEntier}, {"alphaTextureBlackPoint", 148, constFlottant},
			{"alphaTextureWhitePoint", 152, constFlottant}, {"alphaTextureMidPoint", 156, constFlottant},
			{"paletteTexture_texture_frameCount", 168, constEntier},
			{"DepthFadeRange", 192, constFlottant}, {"DepthFadeInvert", 196, constEntier}, {"DepthFadeExponent", 200, constFlottant},
		},
	},
	// LOCAL-CHANGE: the flow-mapped billboard shader (the plasma grenade's flight effect 5740a83d,
	// particle 1fefd7e3). Offsets from the DXIL reflection of its pixel bytecode (shbc 1f861081 and
	// its five sibling permutations, one $Globals of 204 o): no alpha map, a palette, and an
	// optical-flow map (`oflowmap`) the view does not read.
	0x0461c4a7: {
		textures: []string{"baseTexture", "paletteTexture", "oflowmap"},
		constantes: []constanteShader{
			{"ConstantScreenSize", 0, constEntier}, {"SphereWarpStrength", 4, constFlottant},
			{"premultiplied_alpha_scale", 8, constFlottant}, {"do_unpremultiply_alpha", 12, constEntier},
			{"DepthFadeAsVCoord", 16, constEntier}, {"texcoordRotation", 32, constEntier},
			{"baseTexture_texture_textureIndex", 36, constEntier}, {"baseTexture_texture_frameCount", 44, constEntier},
			{"baseTexture_texture_transform", 48, constVecteur},
			{"baseTextureInvert", 64, constEntier}, {"baseTextureDesaturation", 68, constFlottant},
			{"ALBEDO_BLACK_WHITE_POINT", 72, constEntier}, {"baseTextureBlackPoint", 76, constFlottant},
			{"baseTextureWhitePoint", 80, constFlottant}, {"baseTextureMidPoint", 84, constFlottant},
			{"applyBWPToBaseAlpha", 88, constEntier}, {"SYNC_TEXTURE_ANIM", 92, constEntier},
			{"paletteTexture_texture_textureIndex", 96, constEntier}, {"paletteTexture_texture_frameCount", 104, constEntier},
			{"oflowmap_texture_textureIndex", 108, constEntier}, {"oflowmap_texture_frameCount", 116, constEntier},
			{"oflowmap_texture_transform", 128, constVecteur}, {"flowStrength", 164, constFlottant},
			{"DepthFadeRange", 192, constFlottant}, {"DepthFadeInvert", 196, constEntier}, {"DepthFadeExponent", 200, constFlottant},
		},
	},
	// The model particle shader (meshes: the electric shell and its bolts), with a UV distortion map
	// and a fresnel term.
	0x96db07b6: {
		textures: []string{"baseTexture", "uvDistortionMap", "alphaMap", "paletteTexture"},
		constantes: []constanteShader{
			{"SphereWarpStrength", 4, constFlottant},
			{"premultiplied_alpha_scale", 8, constFlottant}, {"do_unpremultiply_alpha", 12, constEntier},
			{"basemapSlideU", 36, constFlottant}, {"basemapSlideV", 40, constFlottant},
			{"basemapScaleU", 44, constFlottant}, {"basemapScaleV", 48, constFlottant},
			{"basemapScaleRateU", 52, constFlottant}, {"basemapScaleRateV", 56, constFlottant},
			{"basemapRotationRate", 60, constFlottant}, {"basemapRandomOffset", 64, constEntier},
			{"uvDistortionMapSlideU", 68, constFlottant}, {"uvDistortionMapSlideV", 72, constFlottant},
			{"uvDistortionRandomOffset", 76, constEntier}, {"baseMapUseScrollingUV", 80, constEntier},
			{"distortionMapIsZeroCentered", 84, constEntier},
			{"baseTexture_texture_textureIndex", 88, constEntier}, {"uvDistortionMap_texture_textureIndex", 132, constEntier},
			{"alphaMap_texture_textureIndex", 196, constEntier}, {"paletteTexture_texture_textureIndex", 260, constEntier},
			{"baseTexture_texture_frameCount", 96, constEntier}, {"baseTexture_texture_transform", 112, constVecteur},
			{"baseMapUVDistortionStrength", 128, constFlottant},
			{"uvDistortionMap_texture_frameCount", 140, constEntier}, {"uvDistortionMap_texture_transform", 144, constVecteur},
			{"baseTextureInvert", 160, constEntier}, {"baseTextureDesaturation", 164, constFlottant},
			{"ALBEDO_BLACK_WHITE_POINT", 168, constEntier}, {"baseTextureBlackPoint", 172, constFlottant},
			{"baseTextureWhitePoint", 176, constFlottant}, {"baseTextureMidPoint", 180, constFlottant},
			{"applyBWPToBaseAlpha", 184, constEntier}, {"SYNC_TEXTURE_ANIM", 188, constEntier},
			{"alphaMapUseScrollingUV", 192, constEntier},
			{"alphaMap_texture_frameCount", 204, constEntier}, {"alphaMap_texture_transform", 208, constVecteur},
			{"alphaMapUVDistortionStrength", 224, constFlottant}, {"alphaMapFrameIndex", 228, constFlottant},
			{"alphaMapAnimationRate", 232, constFlottant}, {"useAlphaMapRed", 236, constEntier},
			{"alphaTextureInvert", 240, constEntier}, {"ALPHA_BLACK_WHITE_POINT", 244, constEntier},
			{"alphaTextureBlackPoint", 248, constFlottant}, {"alphaTextureWhitePoint", 252, constFlottant},
			{"alphaTextureMidPoint", 256, constFlottant}, {"paletteTexture_texture_frameCount", 268, constEntier},
			{"fresnelIntensity", 272, constFlottant}, {"fresnelPower", 276, constFlottant},
			{"opacityMin", 280, constFlottant}, {"fresnelInvert", 284, constEntier},
			{"DepthFadeRange", 304, constFlottant}, {"DepthFadeInvert", 308, constEntier}, {"DepthFadeExponent", 312, constFlottant},
		},
	},
}

// SegmentCourbe is one piece of a multi-spline: the polynomial in the input x (coefficients from
// the highest degree), up to End (the last piece's End is the largest float).
type SegmentCourbe struct {
	End   float32   `json:"end"`
	Coefs []float32 `json:"coefs"`
}

// FonctionParticule is an emitter property: its inputs (the plugin's enum: 0 particle age, 1 system
// age, 2 particle random, 3 system random, 4..7 particle correlations, 13 effect A scale, 14
// effect B scale...) and its mapping function (Min + (Max - Min) x the curve's value; ranged:
// two curves, or the two ends for a constant, mixed by the range input).
type FonctionParticule struct {
	Input         int               `json:"input"`
	RangeInput    int               `json:"rangeInput"`
	Modifier      int               `json:"modifier,omitempty"`
	ModifierInput int               `json:"modifierInput,omitempty"`
	Type          int               `json:"type"`
	Ranged        bool              `json:"ranged,omitempty"`
	Min           float32           `json:"min"`
	Max           float32           `json:"max"`
	Curves        [][]SegmentCourbe `json:"curves,omitempty"`
	// Periodic: a periodic function's sub-functions (type 3; two when ranged), each
	// wave(frequency x input + phase) brought into its [min, max] (emissif_fonctions.go Periodique).
	Periodic []Periodique `json:"periodic,omitempty"`
	// Color: a color function's first color (linear RGB), its header's first word.
	Color *[3]float32 `json:"color,omitempty"`
}

// EmetteurParticules is an emitter of a particle system.
type EmetteurParticules struct {
	Flags          int                          `json:"flags"`
	Appearance     uint32                       `json:"appearance"`
	ParticleFlags  uint32                       `json:"particleFlags"`
	Shape          int                          `json:"shape"`
	AxisScale      [3]float32                   `json:"axisScale"`
	Direction      [3]float32                   `json:"direction"`
	StartingOffset [3]float32                   `json:"startingInterpolant"`
	Billboard      int                          `json:"billboard"`
	Movement       uint32                       `json:"-"`
	Properties     map[string]FonctionParticule `json:"properties"`
}

// TextureParticule is a texture bound to a particle's shader.
type TextureParticule struct {
	Name   string `json:"name"`
	Bitmap uint32 `json:"-"`
}

// RenduParticule is how a particle draws.
type RenduParticule struct {
	Particle   uint32             `json:"-"`
	Shader     uint32             `json:"-"`
	Appearance uint32             `json:"appearance"`
	BlendMode  int                `json:"blendMode"`
	Textures   []TextureParticule `json:"textures"`
	// Constants: the shader's named constants (one value, or four for a float4).
	Constants map[string][]float64 `json:"constants"`
	// Model: the particle's mesh (pmdf), 0 for a sprite.
	Model uint32 `json:"-"`
}

// SystemeParticules is one particle system of the effect.
type SystemeParticules struct {
	// Event: the rank of the event that holds it, its flags and duration bounds (seconds).
	Event         int        `json:"event"`
	EventFlags    int        `json:"eventFlags"`
	EventDuration [2]float32 `json:"eventDuration"`
	// Location: the marker of the weapon's model it is emitted at (StringID).
	Location   uint32             `json:"-"`
	Coordinate int                `json:"coordinateSystem"`
	CameraMode int                `json:"cameraMode"`
	Flags      uint32             `json:"flags"`
	SizeScale  float32            `json:"sizeScale"`
	Emitter    EmetteurParticules `json:"emitter"`
	Render     RenduParticule     `json:"render"`
}

// EffetParticules is the effect's first level of detail: its particle systems, every event.
type EffetParticules struct {
	Effect      uint32
	CameraRange [2]float32
	Systems     []SystemeParticules
	// Skipped: the systems left out, and why (an unreadable property or particle).
	Skipped []string
}

// EffetDeParticules reads the effect `id`: the particle systems of its first level of detail.
// The levels all carry the same camera range on the Shock Rifle ([1, 120]); the first is the
// fullest (the second keeps three third-person systems, the third is non-rendering).
func (a *Arsenal) EffetDeParticules(id uint32) (*EffetParticules, error) {
	raw, err := a.geo.Extract(id)
	if err != nil {
		return nil, err
	}
	ti, err := meilleurTagInfo(raw)
	if err != nil {
		return nil, err
	}
	rb, err := ti.rootBlockIndex()
	if err != nil {
		return nil, err
	}
	niveaux := ti.subBlockTarget(rb, effeOffNiveaux)
	nAbs, nTaille := ti.blockAbs(niveaux)
	if niveaux < 0 || nTaille < effeTailleNiveau || nAbs+effeTailleNiveau > len(ti.tag) {
		return nil, fmt.Errorf("%w: %08x without a level of detail", ErrSansEffet, id)
	}
	out := &EffetParticules{Effect: id,
		CameraRange: [2]float32{f32Brut(ti.tag, nAbs+effeOffNiveauPortee), f32Brut(ti.tag, nAbs+effeOffNiveauPortee+4)}}
	var lieux []uint32
	if b := ti.subBlockTarget(niveaux, effeOffEmplacements); b >= 0 {
		abs, taille := ti.blockAbs(b)
		for k := 0; k+effeTailleEmplacement <= taille && abs+k+4 <= len(ti.tag); k += effeTailleEmplacement {
			lieux = append(lieux, uint32(u32(ti.tag, abs+k)))
		}
	}
	evts := ti.subBlockTarget(niveaux, effeOffEvenements)
	_, eTaille := ti.blockAbs(evts)
	for e := 0; evts >= 0 && e < eTaille/effeTailleEvenement && e < effeEvenementsMaxi; e++ {
		sys := ti.subBlockTarget(evts, e*effeTailleEvenement+effeOffSystemes)
		if sys < 0 {
			continue
		}
		sAbs, sTaille := ti.blockAbs(sys)
		eAbs, _ := ti.blockAbs(evts)
		ev := eAbs + e*effeTailleEvenement
		for s := 0; s < sTaille/effeTailleSysteme && s < effeSystemesMaxi; s++ {
			r := sAbs + s*effeTailleSysteme
			sp, err := a.litSysteme(ti, sys, s, r, lieux)
			if err != nil {
				out.Skipped = append(out.Skipped, fmt.Sprintf("event %d system %d: %v", e, s, err))
				continue
			}
			sp.Event = e
			sp.EventFlags = int(u16(ti.tag, ev+evtOffDrapeaux))
			sp.EventDuration = [2]float32{f32Brut(ti.tag, ev+evtOffDuree), f32Brut(ti.tag, ev+evtOffDuree+4)}
			out.Systems = append(out.Systems, sp)
		}
	}
	if len(out.Systems) == 0 {
		return nil, fmt.Errorf("%w: %08x (%v)", ErrSansEffet, id, out.Skipped)
	}
	return out, nil
}

// litSysteme reads system `s` (record at r) of the systems block `sys`.
func (a *Arsenal) litSysteme(ti tagInfo, sys, s, r int, lieux []uint32) (SystemeParticules, error) {
	lieu := int(u32(ti.tag, r+sysOffEmplacement))
	if lieu < 0 || lieu >= len(lieux) {
		return SystemeParticules{}, fmt.Errorf("location %d outside the %d locations", lieu, len(lieux))
	}
	sp := SystemeParticules{
		Location:   lieux[lieu],
		Coordinate: int(ti.tag[r+sysOffRepere]),
		CameraMode: int(ti.tag[r+sysOffCamera]),
		Flags:      uint32(u32(ti.tag, r+sysOffDrapeaux)),
		SizeScale:  f32Brut(ti.tag, r+sysOffEchelleTaille),
	}
	em := ti.subBlockTarget(sys, s*effeTailleSysteme+effeOffEmetteurs)
	eAbs, eTaille := ti.blockAbs(em)
	if em < 0 || eTaille < effeTailleEmetteur || eAbs+effeTailleEmetteur > len(ti.tag) {
		return SystemeParticules{}, fmt.Errorf("unreadable emitter (%d bytes)", eTaille)
	}
	if eTaille != effeTailleEmetteur {
		return SystemeParticules{}, fmt.Errorf("%d emitters: only one is read", eTaille/effeTailleEmetteur)
	}
	var err error
	if sp.Emitter, err = litEmetteur(ti, em, eAbs); err != nil {
		return SystemeParticules{}, err
	}
	if sp.Render, err = a.litRendu(uint32(u32(ti.tag, r+effeOffParticule))); err != nil {
		return SystemeParticules{}, err
	}
	return sp, nil
}

// litEmetteur reads the emitter record of block em (at abs).
func litEmetteur(ti tagInfo, em, abs int) (EmetteurParticules, error) {
	vec := func(o int) [3]float32 {
		return [3]float32{f32Brut(ti.tag, abs+o), f32Brut(ti.tag, abs+o+4), f32Brut(ti.tag, abs+o+8)}
	}
	e := EmetteurParticules{
		Flags:          int(ti.tag[abs+emetOffDrapeaux]),
		Appearance:     uint32(u32(ti.tag, abs+emetOffApparence)),
		ParticleFlags:  uint32(u32(ti.tag, abs+emetOffDrapeauxPart)),
		Shape:          int(ti.tag[abs+emetOffForme]),
		AxisScale:      vec(emetOffEchelleAxes),
		Direction:      vec(emetOffDirection),
		StartingOffset: vec(emetOffInterpolant),
		Billboard:      int(u16(ti.tag, abs+emetOffBillboard)),
		Movement:       uint32(u32(ti.tag, abs+emetOffGabarit)),
		Properties:     map[string]FonctionParticule{},
	}
	donnees := ti.donneesDuChamp(em)
	for _, p := range proprietesEmetteur {
		f, err := litProprieteParticule(ti.tag[abs+p.off:abs+p.off+4], donnees[p.off+proprieteOffDonnees])
		if err != nil {
			return EmetteurParticules{}, fmt.Errorf("%s: %w", p.nom, err)
		}
		e.Properties[p.nom] = f
	}
	return e, nil
}

// DecodeMappingFunction (LOCAL-CHANGE (infinite-theater-3d)) decodes a bare mapping function's bytes
// (an object function's `default function`, the same codec as a particle property's) into a
// FonctionParticule without inputs: identity, constant or multi-spline, else an error.
func DecodeMappingFunction(b []byte) (FonctionParticule, error) {
	return litProprieteParticule(make([]byte, 4), b)
}

// litProprieteParticule decodes a property: its four input bytes and its function's bytes.
func litProprieteParticule(entrees, b []byte) (FonctionParticule, error) {
	fj, ok := litFonctionJeu(b)
	if !ok {
		return FonctionParticule{}, fmt.Errorf("unreadable function (%d bytes)", len(b))
	}
	f := FonctionParticule{
		Input: int(entrees[0]), RangeInput: int(entrees[1]), Modifier: int(entrees[2]), ModifierInput: int(entrees[3]),
		Type: fj.Type, Ranged: fj.Plage, Min: fj.Min, Max: fj.Max,
	}
	switch fj.Type {
	case fonctionIdentite, fonctionConstante:
	case fonctionMultiSpline:
		n := 1
		if fj.Plage {
			n = 2
		}
		courbes, ok := courbesMultiSpline(b[32:32+int(binary.LittleEndian.Uint32(b[28:]))], n)
		if !ok {
			return FonctionParticule{}, fmt.Errorf("unreadable multi-spline")
		}
		f.Curves = courbes
	case fonctionPeriodique:
		// LOCAL-CHANGE (infinite-theater-3d): periodic particle properties. The sub-functions are the material functions' periodic records (litFonctionJeu: 20 bytes
		// each, wave u8, frequency, phase, min, max); a ranged function carries two.
		n := 1
		if fj.Plage {
			n = 2
		}
		if len(fj.Periodiques) != n {
			return FonctionParticule{}, fmt.Errorf("periodic function with %d sub-functions, %d expected", len(fj.Periodiques), n)
		}
		f.Periodic = fj.Periodiques
	default:
		return FonctionParticule{}, fmt.Errorf("function of type %d not read", fj.Type)
	}
	if fj.nCouleurs == 1 {
		m := fj.entete[0]
		c := [3]float32{srgbVersLineaire(uint8(m >> 16)), srgbVersLineaire(uint8(m >> 8)), srgbVersLineaire(uint8(m))}
		f.Color = &c
	}
	return f, nil
}

// courbesMultiSpline decodes the sub-function bytes of a multi-spline (function type 8): `n`
// curves back to back, each a u32 piece count then, per piece, a u32 code, the f32 end of the
// piece on the input, and its coefficients from the highest degree (four for a cubic piece, code
// low byte 7; two otherwise, a line). Validated on the Shock Rifle's emitters: the pieces meet at
// their ends (alpha 0 up to 0.898 then 9.836 x - 8.836, which is 0 there and 1 at x = 1), and a
// curve reads 1 at x = 1 where it scales a whole range (the emission rate 0.0625 x^3 - 1.125 x^2
// + 2.0625 x). The bytes must be consumed exactly and each curve must end at the largest float,
// or the function is refused.
func courbesMultiSpline(b []byte, n int) ([][]SegmentCourbe, bool) {
	o := 0
	lis := func() (uint32, bool) {
		if o+4 > len(b) {
			return 0, false
		}
		v := binary.LittleEndian.Uint32(b[o:])
		o += 4
		return v, true
	}
	var out [][]SegmentCourbe
	for k := 0; k < n; k++ {
		nb, ok := lis()
		if !ok || nb == 0 || nb > courbeSegmentsMaxi {
			return nil, false
		}
		var segs []SegmentCourbe
		for s := uint32(0); s < nb; s++ {
			code, ok1 := lis()
			fin, ok2 := lis()
			if !ok1 || !ok2 {
				return nil, false
			}
			nc := 2
			if code&0xff == codeSegmentCubique {
				nc = 4
			}
			seg := SegmentCourbe{End: math.Float32frombits(fin)}
			for c := 0; c < nc; c++ {
				v, ok := lis()
				if !ok {
					return nil, false
				}
				seg.Coefs = append(seg.Coefs, fini(math.Float32frombits(v)))
			}
			segs = append(segs, seg)
		}
		if segs[len(segs)-1].End != math.MaxFloat32 {
			return nil, false
		}
		out = append(out, segs)
	}
	return out, o == len(b)
}

// litRendu reads the particle `id`: its shader, textures, blend mode, constants and model.
func (a *Arsenal) litRendu(id uint32) (RenduParticule, error) {
	raw, err := a.geo.Extract(id)
	if err != nil {
		return RenduParticule{}, fmt.Errorf("particle %08x: %w", id, err)
	}
	ti, err := meilleurTagInfo(raw)
	if err != nil {
		return RenduParticule{}, fmt.Errorf("particle %08x: %w", id, err)
	}
	rb, err := ti.rootBlockIndex()
	if err != nil {
		return RenduParticule{}, err
	}
	abs, taille := ti.blockAbs(rb)
	if taille < prt3OffModele+4 {
		return RenduParticule{}, fmt.Errorf("particle %08x: root of %d bytes", id, taille)
	}
	r := RenduParticule{
		Particle:   id,
		Shader:     uint32(u32(ti.tag, abs+prt3OffShader)),
		Appearance: uint32(u32(ti.tag, abs+prt3OffApparence)),
		Model:      uint32(u32(ti.tag, abs+prt3OffModele)),
		Constants:  map[string][]float64{},
	}
	if r.Model == math.MaxUint32 {
		r.Model = 0
	}
	disp, ok := dispositionsParticules[r.Shader]
	if !ok {
		return RenduParticule{}, fmt.Errorf("particle %08x: shader %08x without a read layout", id, r.Shader)
	}
	post := ti.subBlockTarget(rb, prt3OffPostprocess)
	pAbs, pTaille := ti.blockAbs(post)
	if post < 0 || pTaille != postTaille || pAbs+postTaille > len(ti.tag) {
		return RenduParticule{}, fmt.Errorf("particle %08x: postprocess of %d bytes", id, pTaille)
	}
	r.BlendMode = int(ti.tag[pAbs+postOffMelange])
	sous := ti.sousBlocsParOffset(post)
	tAbs, tTaille, ok := ti.blocValide(sous, postOffTextures)
	if !ok || tTaille != len(disp.textures)*postTailleTexture {
		return RenduParticule{}, fmt.Errorf("particle %08x: %d bytes of textures for %d expected", id, tTaille, len(disp.textures))
	}
	// Each texture record names its slot, the byte of its `_texture_textureIndex` constant
	// (decoupe.go textureOffEmplace): the slot is checked against the shader's layout.
	for k, nom := range disp.textures {
		o := tAbs + k*postTailleTexture
		if slot := int(u16(ti.tag, o+textureOffEmplace)); slot != disp.octetDe(nom+"_texture_textureIndex") {
			return RenduParticule{}, fmt.Errorf("particle %08x: texture %d at slot %d, %s expected", id, k, slot, nom)
		}
		r.Textures = append(r.Textures, TextureParticule{Name: nom, Bitmap: uint32(u32(ti.tag, o+tagrefOffID))})
	}
	cAbs, cTaille, ok := ti.blocValide(sous, postOffConstantes)
	if !ok {
		return RenduParticule{}, fmt.Errorf("particle %08x: without constants", id)
	}
	for _, c := range disp.constantes {
		n := 1
		if c.sorte == constVecteur {
			n = 4
		}
		if c.octet+4*n > cTaille {
			return RenduParticule{}, fmt.Errorf("particle %08x: constant %s outside the %d bytes", id, c.nom, cTaille)
		}
		vals := make([]float64, n)
		for i := range vals {
			o := cAbs + c.octet + 4*i
			if c.sorte == constEntier {
				vals[i] = float64(i32(ti.tag, o))
			} else {
				vals[i] = float64(fini(f32Brut(ti.tag, o)))
			}
		}
		r.Constants[c.nom] = vals
	}
	return r, nil
}

// MarqueurArme is a marker instance of a weapon's model: its node, and its position and rotation in
// that node's frame (Halo axes; the markers the effects name carry an identity rotation on the Shock
// Rifle, a quarter turn about up on the Heatwave's fins). Model: the marker's frame in model space at
// the model's rest pose (its node's chain, then the marker).
type MarqueurArme struct {
	Nom         uint32
	Noeud       int
	NomNoeud    string
	Translation [3]float64
	Rotation    [4]float64
	Model       Transforme
}

// MarqueursDuModele reads the markers `noms` of the render model `mode`, every instance.
func (a *Arsenal) MarqueursDuModele(mode uint32, noms map[uint32]bool) ([]MarqueurArme, error) {
	raw, err := a.geo.Extract(mode)
	if err != nil {
		return nil, err
	}
	groupes, err := MarqueursDuMode(raw)
	if err != nil {
		return nil, err
	}
	noeuds, _ := ModeNodes(raw)
	var out []MarqueurArme
	for _, g := range groupes {
		if !noms[g.Nom] {
			continue
		}
		for _, in := range g.Instances {
			m := MarqueurArme{Nom: g.Nom, Noeud: in.Noeud, Translation: in.Translation, Rotation: in.Rotation,
				Model: Compose(NodeModelTransform(noeuds, in.Noeud), Transforme{Scale: 1, Rot: quatVersRot(in.Rotation), Trans: in.Translation})}
			if in.Noeud >= 0 && in.Noeud < len(noeuds) {
				m.NomNoeud = NomDuNoeud(noeuds[in.Noeud].Name)
			}
			out = append(out, m)
		}
	}
	return out, nil
}

// TagArme returns the decompressed `weap` tag `weap` (for the readers of its attachments).
func (a *Arsenal) TagArme(weap uint32) ([]byte, error) {
	if g, _, ok := a.geo.Lookup(weap); !ok || g != GroupeArme {
		return nil, fmt.Errorf("himap: %08x is not a weap", weap)
	}
	return a.geo.Extract(weap)
}

// EmplacementsDesEffets returns the locations (marker names) the readable particle systems of the
// effects `effets` emit at.
func (a *Arsenal) EmplacementsDesEffets(effets []uint32) map[uint32]bool {
	out := map[uint32]bool{}
	for _, id := range effets {
		fx, err := a.EffetDeParticules(id)
		if err != nil {
			continue
		}
		for _, s := range fx.Systems {
			out[s.Location] = true
		}
	}
	return out
}

// ModeleDeLArme rend the render model (`mode`) of the weapon `weap`'s third-person view.
func (a *Arsenal) ModeleDeLArme(weap uint32) (uint32, bool) {
	raw, err := a.geo.Extract(weap)
	if err != nil {
		return 0, false
	}
	id, groupe, ok := RefModeleVehicule(context.Background(), a.geo, raw)
	return id, ok && groupe == GroupeMode
}

// BitmapParticule reads layer `couche` of the bitmap `id` at most `cote` texels on a side, and its
// layer count.
func (a *Arsenal) BitmapParticule(id uint32, couche, cote int) (Texture, int, error) {
	prof, _, ok := a.profondeurBitmap(id)
	if !ok {
		return Texture{}, 0, fmt.Errorf("himap: unreadable bitmap %08x", id)
	}
	if prof <= 1 {
		t, err := LitBitmap(a.geo, id, cote)
		return t, 1, err
	}
	t, err := LitCoucheBitmap(a.geo, id, couche, cote)
	return t, prof, err
}

// bitmapOffCourbe: the `curve` enum of a bitmaps record (plugin: width, height, depth shorts, type
// byte, pad, format short at +8, flags word at +10, mipmap count at +12, curve byte at +13). 5 is
// sRGB: the shader samples it through an sRGB view, linear values.
const (
	bitmapOffCourbe = 0x0D
	courbeSRGB      = 5
)

// formatsSignes: the pixel formats sampled as signed normalized values (-1..1); the decoder writes
// them as (v + 1) / 2.
var formatsSignes = map[int]bool{22: true, 37: true, 39: true, 46: true, 48: true}

// EspaceBitmap says how the shader reads the bitmap `id`: through an sRGB view (its curve), and as
// signed values (its format).
func (a *Arsenal) EspaceBitmap(id uint32) (srgb, signe bool, err error) {
	m, f, ok := a.geo.entree(id)
	if !ok || f.Group != GroupeBitmap {
		return false, false, fmt.Errorf("himap: bitmap %#x absent from the indexed modules", id)
	}
	tag, err := m.Extract(f)
	if err != nil {
		return false, false, err
	}
	if n := f.HeaderSize + f.TagDataSize; n > 0 && n <= len(tag) {
		tag = tag[:n]
	}
	for _, ti := range tagCandidates(tag) {
		rb, err := ti.rootBlockIndex()
		if err != nil {
			continue
		}
		c := ti.subBlockTarget(rb, bitmOffBitmaps)
		if c < 0 || c >= ti.dataBlocks {
			continue
		}
		abs, size := ti.blockAbs(c)
		if abs < 0 || size < bitmapStride || abs+size > len(tag) {
			continue
		}
		return tag[abs+bitmapOffCourbe] == courbeSRGB, formatsSignes[int(u16(tag, abs+bitmapOffFormat))], nil
	}
	return false, false, fmt.Errorf("himap: unreadable tag %s", GroupeBitmap)
}
