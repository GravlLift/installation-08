// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// shield_hit.go — the Spartan's shield impact, read from the game's own effect generator.
//
// The Spartan's model (`hlmt` 09ab2219) names, in its "shield" damage section's rendering block,
// a third-person impact generator: `efge` 70e04608. A generator draws the shielded object's own
// mesh again with a material whose shader (`shdv` a1a016e3) is a GPU particle shader; its pixel
// shader (`shbc` f863791a, DXIL, disassembled with DXC) composes, per pixel, with N.V the facing
// ratio, uv the mesh's texture coordinates, t the game time:
//
//	edge   = saturate(min(edgeScaleOuter*(N.V - edgeOuter), edgeScaleInner*(N.V - edgeInner)))
//	pmask  = saturate(min(plasmaEdgeScaleOuter*(N.V - plasmaOuter), plasmaEdgeScaleInner*(N.V - plasmaInner)))
//	s      = t * plasmaScrollSpeed
//	p1     = noise1(uv*tile*(noise1UScale, noise1VScale) + s*(1/24, 1/26)).r ^ plasma0Sharpness * plasma0Intensity
//	p2     = noise2(uv*tile*(noise2UScale, noise2VScale) + s*(-1/22, 1/34)).r ^ plasma1Sharpness * plasma1Intensity
//	plasma = saturate(1 - |p1 - p2|) ^ mix(plasmaCenterSharpness, plasmaEdgeSharpness, pmask)   (noiseBlendMode 0)
//	hit    = saturate(1 - |p - impact| / hitRadius) * hitColor
//	out    = edge^4 * edgeColor + flatColor + (mix(plasmaCenterColor, plasmaEdgeColor, pmask) + hit) * plasma
//
// drawn with the generator material's blend mode (additive). The shader's parameters are the
// material's constant buffer ($Globals, 448 bytes, layout from the shader's DXIL reflection): this
// file reads them by that layout. Its GPU properties (the intensities, the colors, the hit radius)
// are each a float4 descriptor: a constant when bit 21 of the uint of its y is set (the value in
// x), otherwise a function of one engine input (bits 17..21 of the uint of its w; the inputs are
// the compute shader's: impact time, shield vitality, damage...). The functions' curves sit in the
// tag too (the material's property buffer, the shader's `cbPropertiesConstants`), but their layout
// is NOT decoded here: such a property is published with its input and no value.
package weapons

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"log/slog"
	"math"

	"github.com/JGtm/halo-infinite-map-images/himap"

	"github.com/llampwall/infinite-theater-3d/internal/ekurport"
)

// shieldHitGenerator is the Spartan shield's third-person impact generator (`efge`), named by the
// Spartan model `hlmt` 09ab2219, damage section "shield", rendering[0].
const shieldHitGenerator uint32 = 0x70e04608

// generatorConstantsSize is the byte size of the generator shader's $Globals (DXIL reflection).
const generatorConstantsSize = 448

// The `efge` layout (Z-15 Tag_Structures efge.xml, checked against the live tag: root 80 bytes,
// generator 328): the Generators block in the root, the generator's embedded material (Ekur
// material.rs MaterialTag shifted by its 0x10 tag header to +0x0C), the material's post-process
// (Ekur MaterialPostProcessing: textures at +0x00, material constants at +0x58).
const (
	efgeOffGenerators   = 0x38
	efgeGeneratorStride = 0x148
	genOffPostProcess   = 0x3C
	genOffAlphaBlend    = 0x64
	postStride          = 0xA0
	postOffTextures     = 0x00
	postTextureStride   = 0x38
	postTextureOffReg   = 0x2A // the texture's bindless register offset in $Globals (bytes)
	postOffConstants    = 0x58
	postConstantStride  = 0x10
	alphaBlendAdditive  = 1
)

// The $Globals byte offsets of the generator's three textures' bindless indices (DXIL reflection):
// a material texture lands on the shader texture whose index sits at its register offset.
const (
	regNoise1  = 348
	regNoise2  = 372
	regHitBlob = 436
)

// generatorInputs are the compute shader's property inputs, by index: recentDamage, currentDamage,
// their weighted sum (recentDamageIntensity, currentDamageIntensity), shieldVitality, the view's
// game time, impactTime * inverseHitTime, the system's age, the effect scales A and B.
var generatorInputs = [...]string{"recentDamage", "currentDamage", "damage", "shieldVitality", "gameTime",
	"impactTime", "systemAge", "effectScaleA", "effectScaleB"}

// GeneratorProperty is one GPU property of the generator shader: a constant (Constant set), or a
// function of the engine input Input whose curve is not decoded (Constant nil).
type GeneratorProperty struct {
	Constant *float32 `json:"constant,omitempty"`
	Input    string   `json:"input,omitempty"`
}

// GeneratorTexture is one texture of the generator, a library file read as the shader reads it.
type GeneratorTexture struct {
	File string `json:"file"`
	SRGB bool   `json:"srgb"`
}

// ShieldGenerator is a generator's look as the view draws it: its parameters by name (the
// shader's), its blend mode, its textures.
type ShieldGenerator struct {
	Generator string `json:"generator"`
	Additive  bool   `json:"additive"`
	// TintInsteadOfReplace: a color slot tints the property's color instead of replacing it.
	TintInsteadOfReplace bool `json:"tintInsteadOfReplace"`
	// The color slots (0: the property's own color; 1..4: the engine's override colors).
	EdgeColorMode         int `json:"edgeColorMode"`
	PlasmaCenterColorMode int `json:"plasmaCenterColorMode"`
	PlasmaEdgeColorMode   int `json:"plasmaEdgeColorMode"`
	HitColorMode          int `json:"hitColorMode"`
	FlatColorMode         int `json:"flatColorMode"`

	EdgeGlowIntensity         GeneratorProperty `json:"edgeGlowIntensity"`
	PlasmaCenterIntensity     GeneratorProperty `json:"plasmaCenterIntensity"`
	PlasmaEdgeIntensity       GeneratorProperty `json:"plasmaEdgeIntensity"`
	FlatColorIntensity        GeneratorProperty `json:"flatColorIntensity"`
	ExtrusionDistance         GeneratorProperty `json:"extrusionDistance"`
	OscillationAmplitude      GeneratorProperty `json:"oscillationAmplitude"`
	HitIntensity              GeneratorProperty `json:"hitIntensity"`
	HitRadius                 GeneratorProperty `json:"hitRadius"`
	ColorOverrideDesaturation GeneratorProperty `json:"colorOverrideDesaturation"`

	FlatColor [3]float32 `json:"flatColor"`

	EdgeOuterFadeRadius float32 `json:"edgeOuterFadeRadius"`
	EdgeInnerFadeRadius float32 `json:"edgeInnerFadeRadius"`
	EdgeScaleOuter      float32 `json:"edgeScaleOuter"`
	EdgeScaleInner      float32 `json:"edgeScaleInner"`

	NoiseBlendMode        int     `json:"noiseBlendMode"`
	Plasma0Intensity      float32 `json:"plasma0Intensity"`
	Plasma0Sharpness      float32 `json:"plasma0Sharpness"`
	Noise1UScale          float32 `json:"noise1UScale"`
	Noise1VScale          float32 `json:"noise1VScale"`
	Plasma1Intensity      float32 `json:"plasma1Intensity"`
	Plasma1Sharpness      float32 `json:"plasma1Sharpness"`
	Noise2UScale          float32 `json:"noise2UScale"`
	Noise2VScale          float32 `json:"noise2VScale"`
	PlasmaTileScale       float32 `json:"plasmaTileScale"`
	PlasmaScrollSpeed     float32 `json:"plasmaScrollSpeed"`
	PlasmaEdgeSharpness   float32 `json:"plasmaEdgeSharpness"`
	PlasmaCenterSharpness float32 `json:"plasmaCenterSharpness"`
	PlasmaOuterFadeRadius float32 `json:"plasmaOuterFadeRadius"`
	PlasmaInnerFadeRadius float32 `json:"plasmaInnerFadeRadius"`
	PlasmaEdgeScaleInner  float32 `json:"plasmaEdgeScaleInner"`
	PlasmaEdgeScaleOuter  float32 `json:"plasmaEdgeScaleOuter"`

	UseHitBlob     bool    `json:"useHitBlob"`
	ExposureAmount float32 `json:"exposureAmount"`

	Noise1  GeneratorTexture `json:"noise1"`
	Noise2  GeneratorTexture `json:"noise2"`
	HitBlob GeneratorTexture `json:"hitBlob"`
}

// generatorTag is what a generator tag holds for the view: its blend mode, its material constants
// (the shader's $Globals), its textures by the register they bind.
type generatorTag struct {
	additive  bool
	constants []byte
	textures  map[int]uint32 // $Globals register offset -> bitm id
}

// readGeneratorTag walks an `efge` tag down to its first generator's material.
func readGeneratorTag(raw []byte) (generatorTag, error) {
	t, err := ekurport.ParseTag(raw)
	if err != nil {
		return generatorTag{}, err
	}
	root, err := t.Root()
	if err != nil {
		return generatorTag{}, err
	}
	gens, err := root.Block(efgeOffGenerators, efgeGeneratorStride)
	if err != nil {
		return generatorTag{}, err
	}
	if gens.Len() < 1 {
		return generatorTag{}, errors.New("efge: no generator")
	}
	g := gens.At(0)
	alpha, err := g.U8(genOffAlphaBlend)
	if err != nil {
		return generatorTag{}, err
	}
	posts, err := g.Block(genOffPostProcess, postStride)
	if err != nil {
		return generatorTag{}, err
	}
	if posts.Len() < 1 {
		return generatorTag{}, errors.New("efge: no post-process definition")
	}
	p := posts.At(0)
	consts, err := p.Block(postOffConstants, postConstantStride)
	if err != nil {
		return generatorTag{}, err
	}
	if consts.Len()*postConstantStride != generatorConstantsSize {
		return generatorTag{}, fmt.Errorf("efge: %d material constants, want %d", consts.Len(), generatorConstantsSize/postConstantStride)
	}
	c, err := consts.At(0).Bytes(0, generatorConstantsSize)
	if err != nil {
		return generatorTag{}, err
	}
	out := generatorTag{additive: alpha == alphaBlendAdditive, constants: c, textures: map[int]uint32{}}
	texs, err := p.Block(postOffTextures, postTextureStride)
	if err != nil {
		return generatorTag{}, err
	}
	for i := 0; i < texs.Len(); i++ {
		e := texs.At(i)
		id, group, ok := e.TagRef(0)
		reg, err := e.U16(postTextureOffReg)
		if !ok || group != himap.GroupeBitmap || err != nil {
			continue
		}
		out.textures[int(reg)] = uint32(id)
	}
	return out, nil
}

// decodeGeneratorConstants reads the generator shader's $Globals `c` by the shader's layout. The
// textures are left to the caller.
func decodeGeneratorConstants(c []byte) (ShieldGenerator, error) {
	if len(c) != generatorConstantsSize {
		return ShieldGenerator{}, fmt.Errorf("generator constants: %d bytes, want %d", len(c), generatorConstantsSize)
	}
	u := func(off int) uint32 { return binary.LittleEndian.Uint32(c[off:]) }
	f := func(off int) float32 { return math.Float32frombits(u(off)) }
	i := func(off int) int { return int(int32(u(off))) }
	prop := func(off int) GeneratorProperty {
		// The compute shader converts y and w from float to uint before testing their bits.
		if uint32(f(off+4))&(1<<21) != 0 {
			v := f(off)
			return GeneratorProperty{Constant: &v}
		}
		in := int(uint32(f(off+12))>>17) & 31
		if in < len(generatorInputs) {
			return GeneratorProperty{Input: generatorInputs[in]}
		}
		return GeneratorProperty{Input: fmt.Sprintf("#%d", in)}
	}
	return ShieldGenerator{
		TintInsteadOfReplace:      u(12) != 0,
		EdgeColorMode:             i(16),
		PlasmaCenterColorMode:     i(48),
		PlasmaEdgeColorMode:       i(80),
		HitColorMode:              i(112),
		EdgeGlowIntensity:         prop(144),
		PlasmaCenterIntensity:     prop(160),
		PlasmaEdgeIntensity:       prop(176),
		FlatColorIntensity:        prop(192),
		ExtrusionDistance:         prop(208),
		OscillationAmplitude:      prop(224),
		HitIntensity:              prop(240),
		HitRadius:                 prop(256),
		ColorOverrideDesaturation: prop(272),
		EdgeOuterFadeRadius:       f(300),
		EdgeInnerFadeRadius:       f(308),
		EdgeScaleOuter:            f(312),
		EdgeScaleInner:            f(316),
		FlatColorMode:             i(320),
		FlatColor:                 [3]float32{f(324), f(328), f(332)},
		NoiseBlendMode:            i(336),
		Plasma0Intensity:          f(340),
		Plasma0Sharpness:          f(344),
		Noise1UScale:              f(356),
		Noise1VScale:              f(360),
		Plasma1Intensity:          f(364),
		Plasma1Sharpness:          f(368),
		Noise2UScale:              f(380),
		Noise2VScale:              f(384),
		PlasmaTileScale:           f(388),
		PlasmaScrollSpeed:         f(392),
		PlasmaEdgeSharpness:       f(396),
		PlasmaCenterSharpness:     f(400),
		PlasmaOuterFadeRadius:     f(404),
		PlasmaInnerFadeRadius:     f(412),
		PlasmaEdgeScaleInner:      f(416),
		PlasmaEdgeScaleOuter:      f(420),
		UseHitBlob:                u(432) != 0,
		ExposureAmount:            f(444),
	}, nil
}

// readShieldHit reads the Spartan's shield impact generator and writes its textures into dir. It
// answers nil (logged) when the game holds no readable generator: the view then draws no hit.
func readShieldHit(ctx context.Context, a *himap.Arsenal, gameRoot, module, dir string) (*ShieldGenerator, error) {
	paths, err := himap.GeometrySearchPathMonde(gameRoot, module)
	if err != nil {
		return nil, err
	}
	ix, err := himap.NewModuleIndex(paths...)
	if err != nil {
		return nil, fmt.Errorf("shield tag index: %w", err)
	}
	defer func() {
		if err := ix.Close(); err != nil {
			slog.WarnContext(ctx, "closing shield tag index", "err", err)
		}
	}()
	raw, err := ix.Extract(shieldHitGenerator)
	if err != nil {
		slog.WarnContext(ctx, "shield impact generator absent", "efge", fmt.Sprintf("%08x", shieldHitGenerator), "err", err)
		return nil, nil
	}
	gt, err := readGeneratorTag(raw)
	if err != nil {
		slog.WarnContext(ctx, "shield impact generator unreadable", "err", err)
		return nil, nil
	}
	g, err := decodeGeneratorConstants(gt.constants)
	if err != nil {
		return nil, err
	}
	g.Generator = fmt.Sprintf("%08x", shieldHitGenerator)
	g.Additive = gt.additive
	w := effectWriter{a: a, dir: dir, written: map[string]bool{}}
	for reg, slot := range map[int]*GeneratorTexture{regNoise1: &g.Noise1, regNoise2: &g.Noise2, regHitBlob: &g.HitBlob} {
		id, ok := gt.textures[reg]
		if !ok {
			slog.WarnContext(ctx, "shield impact generator texture missing", "register", reg)
			return nil, nil
		}
		file, _, err := w.texture(id)
		if err != nil {
			slog.WarnContext(ctx, "shield impact texture unreadable", "bitm", fmt.Sprintf("%08x", id), "err", err)
			return nil, nil
		}
		srgb, _, err := a.EspaceBitmap(id)
		if err != nil {
			return nil, err
		}
		*slot = GeneratorTexture{File: file, SRGB: srgb}
	}
	return &g, nil
}
