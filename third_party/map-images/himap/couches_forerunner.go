package himap

// couches_forerunner.go (LOCAL-CHANGE (infinite-theater-3d)): the base layer of the Forerunner
// level shaders, which name it outside the level template (nomsCouches).
//
// MEASURED on Origin (fo08_wetland's Forge pieces, 2026-11-15): the shaders 9e8651c8, 55e97350,
// 71c12c90, 49342bc1, e2962795, f6cd60e6, 8e805aa4 and 3a387535 (the Forerunner "MP" pieces: hex
// pillars, supports, platforms, beams) declare the template's layers 2 to 4 by its names but none
// of layer 1's. Each declares, outside the template, a per-material control map (0x8fd3629f, slot
// 132: occlusion in green, a middle red with the panel lines), a per-material normal map
// (0xfe080e52, slot 84) and three blue-grey colors, darkest to lightest 0x0a1b7f9b, 0xaf44c1b5,
// 0x16855291 (gunmetal 0.112/0.136/0.209, 0.125/0.150/0.191, 0.138/0.159/0.220 on most, a lighter
// 0.28 to 0.50 blue-grey on the others). Without a base the next layer covered the whole surface:
// layer 2 is a sand dust at 31.6% under its mask (0.42/0.38/0.29), and Origin's pieces drew as sand
// stone where the game shows dark Forerunner metal with panel lines. The colors' order and the red
// index are inferred (the three stops sort by luminance the same way on every material; the red is
// the map's middle, the alpha is constant); the shaders' own roughness and metal for the base are
// not identified, so the base is a plain gradient (roughness from the control's blue, no metal).
const (
	forerunnerControle = 0x8fd3629f
	forerunnerNormale  = 0xfe080e52
	forerunnerBas      = 0x0a1b7f9b
	forerunnerMilieu   = 0xaf44c1b5
	forerunnerHaut     = 0x16855291
)

var nomsBaseForerunner = nomsCouche{controle: forerunnerControle, normale: forerunnerNormale,
	haut: forerunnerHaut, milieu: forerunnerMilieu, bas: forerunnerBas, indiceRouge: true}

// baseForerunner reads a Forerunner level shader's base layer (see the file comment); ok=false
// when the shader does not declare all three colors or the material binds no control map.
func baseForerunner(params ParametresShader, pp postprocessLu, c lecteurConstantes) (Couche, bool) {
	for _, nom := range []uint32{forerunnerBas, forerunnerMilieu, forerunnerHaut} {
		if _, ok := params[nom]; !ok {
			return Couche{}, false
		}
	}
	return nomsBaseForerunner.lit(params, pp, c, true, false)
}
