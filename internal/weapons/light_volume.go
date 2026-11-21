// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// light_volume.go — the game's light volumes (a generator drawing a beam as a stack of soft
// camera-facing "profiles"), read from their effect generator (`efge`): the equipment pad's
// upward cone (`efge` 48e03d70, created by the pad effect cf098056's event 0).
//
// The generator's shaders (`shdv` e11fafc2; bytecode `shbc` 58e41c61 compute, 3e7f4d6d vertex,
// 2f12843a pixel, disassembled with DXC 1.9) draw, per generator:
//
//	count     = min(uint(length * profileDensity), max_count)
//	profile i = emitterPosition + forward * (profileOffset + i / profileDensity)   (forward: the
//	            emitter's local +X, the quaternion's first column)
//	t         = i / (count - 1)              (compute input 0, "profile position")
//	thickness = profileThickness(t); color = profileColor(age) or (t); light = color *
//	            profileIntensity(t) * profileAlpha
//	quad      = camera-facing; width thickness across the axis; length lerp(thickness,
//	            profileLength, sin(angle between the view ray and the axis)) along the axis's
//	            screen direction
//	pixel     = light * saturate(centerOffset * (1 - r^2)) ^ volumeFalloff, r the distance from
//	            the quad's center (uv in -1..1); soft against the scene over DepthFadeRange;
//	            blended additively (mode 8, add_src_times_dstalpha)
//
// The $Globals layout (248 bytes, padded to 16 registers in the tag) is the shaders' DXIL
// reflection. The compute stage's property inputs, by index: the profile position, the game time,
// the system's age (seconds), a per-profile random, two state values, the normalized camera
// distance, the effect scales A and B.
package weapons

import (
	"encoding/binary"
	"fmt"
	"math"
)

// lightVolumeConstantsSize is the byte size of the light volume generator material's constant
// block in the tag (16 registers; the shader's $Globals uses 248 of them).
const lightVolumeConstantsSize = 256

// lightVolumeInputs are the light volume compute shader's property inputs, by index.
var lightVolumeInputs = []string{"profilePosition", "gameTime", "systemAge", "random", "state0", "state1",
	"cameraDistance", "effectScaleA", "effectScaleB"}

// LightVolume is one light volume generator, as the view draws it.
type LightVolume struct {
	MaxCount         int               `json:"maxCount"`
	Length           GeneratorProperty `json:"length"`
	ProfileLength    GeneratorProperty `json:"profileLength"`
	ProfileDensity   GeneratorProperty `json:"profileDensity"`
	ProfileThickness GeneratorProperty `json:"profileThickness"`
	ProfileColor     GeneratorColor    `json:"profileColor"`
	ProfileAlpha     GeneratorProperty `json:"profileAlpha"`
	ProfileIntensity GeneratorProperty `json:"profileIntensity"`
	ProfileOffset    GeneratorProperty `json:"profileOffset"`
	DepthFadeRange   float32           `json:"depthFadeRange"`
	CenterOffset     float32           `json:"centerOffset"`
	VolumeFalloff    float32           `json:"volumeFalloff"`
	BrightnessRatio  float32           `json:"brightnessRatio"`
	FarFade          [2]float32        `json:"farFade"`
	Additive         bool              `json:"additive"`
}

// GeneratorColor is a color GPU property: a function of one input blending the property buffer's
// two colors (linear RGB) from From at 0 to To at 1.
type GeneratorColor struct {
	GeneratorProperty
	From [3]float32 `json:"from"`
	To   [3]float32 `json:"to"`
}

// The light volume $Globals offsets (DXIL reflection).
const (
	lvOffMaxCount      = 8
	lvOffLength        = 16
	lvOffProfileLength = 32
	lvOffDensity       = 48
	lvOffThickness     = 64
	lvOffColor         = 96
	lvOffAlpha         = 112
	lvOffIntensity     = 128
	lvOffOffset        = 144
	lvOffDepthFade     = 160
	lvOffCenterOffset  = 200
	lvOffFalloff       = 204
	lvOffBrightness    = 208
	lvOffFarFade       = 240
	alphaBlendAddDst   = 8 // add_src_times_dstalpha
)

// readLightVolumes reads every generator of the light volume `efge` tag `raw`.
func readLightVolumes(raw []byte) ([]LightVolume, error) {
	var out []LightVolume
	for k := 0; ; k++ {
		gt, err := readGeneratorAt(raw, k, lightVolumeConstantsSize)
		if err != nil {
			if k > 0 {
				return out, nil
			}
			return nil, err
		}
		lv, err := decodeLightVolume(gt)
		if err != nil {
			return nil, fmt.Errorf("generator %d: %w", k, err)
		}
		out = append(out, lv)
	}
}

func decodeLightVolume(gt generatorTag) (LightVolume, error) {
	c, props := gt.constants, gt.properties
	if len(c) != lightVolumeConstantsSize {
		return LightVolume{}, fmt.Errorf("light volume constants: %d bytes", len(c))
	}
	u := func(off int) uint32 { return binary.LittleEndian.Uint32(c[off:]) }
	f := func(off int) float32 { return math.Float32frombits(u(off)) }
	prop := func(off int) GeneratorProperty { return generatorProperty(c, off, props, lightVolumeInputs) }
	color, err := propertyColors(props)
	if err != nil {
		return LightVolume{}, err
	}
	color.GeneratorProperty = prop(lvOffColor)
	return LightVolume{
		MaxCount:         int(int32(u(lvOffMaxCount))),
		Length:           prop(lvOffLength),
		ProfileLength:    prop(lvOffProfileLength),
		ProfileDensity:   prop(lvOffDensity),
		ProfileThickness: prop(lvOffThickness),
		ProfileColor:     color,
		ProfileAlpha:     prop(lvOffAlpha),
		ProfileIntensity: prop(lvOffIntensity),
		ProfileOffset:    prop(lvOffOffset),
		DepthFadeRange:   f(lvOffDepthFade),
		CenterOffset:     f(lvOffCenterOffset),
		VolumeFalloff:    f(lvOffFalloff),
		BrightnessRatio:  f(lvOffBrightness),
		FarFade:          [2]float32{f(lvOffFarFade), f(lvOffFarFade + 4)},
		Additive:         gt.additive || gt.alphaMode == alphaBlendAddDst,
	}, nil
}

// propertyColors reads the two colors of the property buffer: register 0's x is the register
// before them (12 in the pad cone: the colors sit at registers 13 and 14, RGBA, linear).
func propertyColors(props []byte) (GeneratorColor, error) {
	if len(props) < 16 {
		return GeneratorColor{}, fmt.Errorf("property buffer of %d bytes", len(props))
	}
	at := int(binary.LittleEndian.Uint32(props)) + 1
	if (at+2)*postConstantStride > len(props) {
		return GeneratorColor{}, fmt.Errorf("property colors at register %d past %d bytes", at, len(props))
	}
	rgb := func(r int) [3]float32 {
		var v [3]float32
		for k := range v {
			v[k] = math.Float32frombits(binary.LittleEndian.Uint32(props[r*postConstantStride+4*k:]))
		}
		return v
	}
	return GeneratorColor{From: rgb(at), To: rgb(at + 1)}, nil
}
