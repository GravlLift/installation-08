// Package himap — emissif.go : ce qu'un materiau emet de lui-meme (lampes, bandeaux, ecrans).
//
// Comme pour la decoupe et les couches, le sens des constantes du postprocess depend du shader ;
// la table vient de `TheHaloArchive/ekur` (`ekur_materials`), valeurs relues sur Recharge :
//
//	illum_full       couleur (3 f32) a +0, intensite a +12
//	diffuse_emissive teinte d'auto-illumination (3 f32) a +224, quantite a +236, intensite a +240
//	illum            (LOCAL-CHANGE (infinite-theater-3d)) couleur (3 f32) a +32, intensite a +44,
//	                 masquee par sa carte de couleur (emplacement 0)
//
// La force emise est intensite x quantite (diffuse_emissive) ou l'intensite seule (illum_full) :
// des valeurs HDR du jeu, de 1 a plus de 1 000, qu'une visionneuse comprime. La texture
// d'auto-illumination de diffuse_emissive (emplacement 244) n'est pas lue : sur Recharge elle
// designe le plus souvent une texture par defaut du moteur, absente des modules de la carte.
//
// LOCAL-CHANGE (infinite-theater-3d): the other shaders that emit are read by the names of their
// declared parameters (formesEmissives): neon and light strips, screens, holographic signs and
// hologram projectors.
package himap

import (
	"encoding/binary"
	"math"
)

// Emissif : la lumiere propre d'un materiau. Couleur LINEAIRE, Force multiplie la couleur.
type Emissif struct {
	Couleur [3]float32
	Force   float32
	// Bitmap (LOCAL-CHANGE (infinite-theater-3d)): the self-illumination texture that masks the
	// light (diffuse_emissive slot 244, on the color map's coordinates); 0 when none. When the
	// modules do not hold it (an engine default), the light stays uniform.
	Bitmap uint32
	// Transfo (LOCAL-CHANGE (infinite-theater-3d)): the texture's coordinate transform (scale,
	// offset) from its register; nil for the shaders read at fixed offsets (no transform read).
	Transfo *Transfo
	// Image (LOCAL-CHANGE (infinite-theater-3d)): the texture is a picture (a sign, a screen, a
	// hologram's emblem) rather than a light mask: a viewer keeps its brightness readable instead of
	// letting it bloom (formesEmissives).
	Image bool
}

// emplacementEmissif (LOCAL-CHANGE (infinite-theater-3d)): the self-illumination texture slot of
// a shader, from Ekur's handlers: diffuse_emissive's emissive map (slot 244), illum's color map
// (slot 0, `handle_illum` in ekur_materials basic/self_illum.rs).
var emplacementEmissif = map[uint32]int{0x3c7906af: 244, shaderIllum: 0}

// shaderIllum (LOCAL-CHANGE (infinite-theater-3d)): the `illum` shader (GlobalID -79437929),
// Ekur's `handle_illum` (ekur_materials basic/self_illum.rs; process.rs maps -79437929 to it): a
// color map at texture slot 0, its light color at constant +32 (3 f32) and intensity at +44. The
// shader's declared parameters name those two bytes `si_color` (0x687e0d19) and `si_intensity`
// (0x652e3d19). The weapons' light strips and screens are drawn by it (68 materials of the
// weapon library, 303 of the first-person rigs), additive save for 7 opaque ones.
const shaderIllum = 0xfb43df97

// bitmapEmissif rend la texture d'auto-illumination liee du shader, 0 sans elle.
func bitmapEmissif(shader uint32, textures map[int]uint32) uint32 {
	if o, ok := emplacementEmissif[shader]; ok {
		return textures[o]
	}
	return 0
}

// specEmissif : octets des constantes ; quantite < 0 = pas de quantite (force = intensite).
type specEmissif struct{ couleur, intensite, quantite int }

var shadersEmissifs = map[uint32]specEmissif{
	// illum_full
	0x779fc911: {couleur: 0, intensite: 12, quantite: -1},
	// diffuse_emissive
	0x3c7906af: {couleur: 224, intensite: 240, quantite: 236},
	// illum (LOCAL-CHANGE (infinite-theater-3d), see shaderIllum)
	shaderIllum: {couleur: 32, intensite: 44, quantite: -1},
}

// emissifDuShader : nil si le shader n'emet pas, si ses constantes sont trop courtes, ou si la
// force ou la couleur sont nulles (materiau eteint).
func emissifDuShader(shader uint32, constantes []byte) *Emissif {
	s, ok := shadersEmissifs[shader]
	if !ok {
		return nil
	}
	f := func(o int) (float32, bool) {
		if o < 0 || o+4 > len(constantes) {
			return 0, false
		}
		v := math.Float32frombits(binary.LittleEndian.Uint32(constantes[o:]))
		return v, !math.IsNaN(float64(v)) && !math.IsInf(float64(v), 0)
	}
	var e Emissif
	var allume bool
	for k := 0; k < 3; k++ {
		c, ok := f(s.couleur + 4*k)
		if !ok || c < 0 {
			return nil
		}
		e.Couleur[k] = c
		allume = allume || c > 0
	}
	force, ok := f(s.intensite)
	if !ok {
		return nil
	}
	if s.quantite >= 0 {
		q, ok := f(s.quantite)
		if !ok {
			return nil
		}
		force *= q
	}
	if !allume || force <= 0 {
		return nil
	}
	e.Force = force
	return &e
}

// formeEmissive (LOCAL-CHANGE (infinite-theater-3d)): a family of shaders whose light is read by
// the NAMES of their declared parameters (couches_noms.go explains names and bytes), for shaders
// outside `shadersEmissifs`. `exige`: names the shader must declare for the form to apply (they
// tell the family apart from shaders that share generic names such as `intensity`). The force is
// intensite x quantite (quantite 0: none). `carte`: the name of the texture's sampler entry, the
// type-2 parameter declared just before the texture whose byte is the postprocess slot (the
// texture parameter's own byte is its rank among the textures, not its slot).
type formeEmissive struct {
	exige                        []uint32
	couleur, intensite, quantite uint32
	carte                        uint32
	image                        bool
}

// Parameter names (murmur3 of the text, mapvar.LabelHash), resolved by hashing candidate texts;
// unresolved names are given by hash with what they were recognized by.
const (
	nomEmissiveMapTexture        = 0x1548afe9 // emissive_map_texture
	nomEmissiveMap               = 0x880e2a6e // its sampler entry (byte = slot), unresolved
	nomEmissiveColor             = 0xa9fc2fa7 // emissive_color
	nomEmissiveIntensity         = 0x6d4c7dfd // emissive_intensity
	nomEmissiveAmount            = 0xca053981 // emissive_amount
	nomBaseEmissiveIntensity     = 0xbf71c2d3 // base_emissive_intensity
	nomBaseEmissiveAmount        = 0xd4825134 // base_emissive_amount
	nomBaseEmissiveColorTint     = 0xa9924c1d // base_emissive_color_tint
	nomBaseEmissiveMapTexture    = 0x93e33388 // base_emissive_map_texture
	nomBaseEmissiveMap           = 0x47412ad0 // its sampler entry, unresolved
	nomBaseEmissiveDetailTexture = 0xc8ddb4d2 // base_emissive_detail_map_texture
	nomBaseEmissiveDetailMap     = 0x50863f82 // its sampler entry, unresolved
	nomBaseEmissiveCouleurDetail = 0xf274d4fa // the color right before base_emissive_intensity, unresolved
	nomScanlineMapTexture        = 0xb4383aa2 // scanline_map_texture
	nomParallaxDepth             = 0xbd8353b8 // parallax_depth
	nomColorTint                 = 0xc53790d3 // color_tint
	nomIntensity                 = 0xd01735ba // intensity
	nomOpacity                   = 0x0eb8a077 // opacity
	nomNoiseMapTexture           = 0x287630e5 // noise_map_texture
	nomFresnelColor              = 0x418401b4 // fresnel_color
	nomBaseTint                  = 0xd6a12a3d // base_tint
	nomBaseTintIntensity         = 0x82874d19 // base_tint_intensity
	nomDiffuseMapIntensity       = 0x294286d0 // diffuse_map_intensity
	nomDiffuseMap                = 0xa0a664ea // diffuse_map_texture's sampler entry, unresolved
)

// formesEmissives (LOCAL-CHANGE (infinite-theater-3d)): measured on Streets (sgh_streets), a night
// map whose signs, screens, neon and hologram were drawn unlit or as glass.
var formesEmissives = []formeEmissive{
	// Screens and lit panels (170fd0e8): a picture lit by base_emissive_color_tint.
	{exige: []uint32{nomBaseEmissiveMapTexture}, couleur: nomBaseEmissiveColorTint, intensite: nomBaseEmissiveIntensity,
		quantite: nomBaseEmissiveAmount, carte: nomBaseEmissiveMap, image: true},
	// Neon tubes and light strips (14f680a0, fa04e237, 25a877f0): the light color sits where
	// diffuse_emissive keeps its own (+224, before the intensity at +236), masked by the detail map
	// (the same tube mask ec18d5b4 that diffuse_emissive's neon binds as its emissive map).
	{exige: []uint32{nomBaseEmissiveDetailTexture}, couleur: nomBaseEmissiveCouleurDetail, intensite: nomBaseEmissiveIntensity,
		quantite: nomBaseEmissiveAmount, carte: nomBaseEmissiveDetailMap},
	// Holographic signs and billboards (6eb5a1b6, 67a9c589, additive or maximum blend): the
	// picture times color_tint, intensity and opacity (a multiplier: values up to 3 occur). Its
	// scanlines, parallax echo and panning are not read.
	{exige: []uint32{nomScanlineMapTexture, nomParallaxDepth}, couleur: nomColorTint, intensite: nomIntensity,
		quantite: nomOpacity, carte: nomEmissiveMap, image: true},
	// Hologram projectors (0dfb07c3, a5b19db2, additive): the emblem (diffuse map) times base_tint,
	// base_tint_intensity and diffuse_map_intensity. Its noise, fresnel and scanlines are not read.
	{exige: []uint32{nomNoiseMapTexture, nomFresnelColor}, couleur: nomBaseTint, intensite: nomBaseTintIntensity,
		quantite: nomDiffuseMapIntensity, carte: nomDiffuseMap, image: true},
	// The emissive_* block (diffuse_emissive's, also in surface shaders such as 18d8a691): a
	// colored light masked by its emissive map. Last: the signs declare emissive_map_texture too.
	{exige: []uint32{nomEmissiveMapTexture}, couleur: nomEmissiveColor, intensite: nomEmissiveIntensity,
		quantite: nomEmissiveAmount, carte: nomEmissiveMap},
}

// emissifParNoms (LOCAL-CHANGE (infinite-theater-3d)): the light of a shader outside
// `shadersEmissifs`, by the first form of formesEmissives its declared parameters match; nil when
// none matches, when its constants are too short, or when it is dark.
func emissifParNoms(params ParametresShader, pp postprocessLu) *Emissif {
	for _, f := range formesEmissives {
		if !declareTous(params, f.exige) {
			continue
		}
		oc, ok1 := octetParam(params, f.couleur)
		oi, ok2 := octetParam(params, f.intensite)
		if !ok1 || !ok2 {
			continue // another family sharing the required names (signs declare emissive_map_texture)
		}
		if oc+12 > len(pp.constantes) || oi+4 > len(pp.constantes) {
			return nil
		}
		c := lecteurConstantes(pp.constantes)
		var e Emissif
		allume := false
		for k := range 3 {
			e.Couleur[k] = max(c.f(oc+4*k), 0)
			allume = allume || e.Couleur[k] > 0
		}
		e.Force = c.f(oi)
		if o, ok := octetParam(params, f.quantite); ok && o+4 <= len(pp.constantes) {
			e.Force *= c.f(o)
		}
		if !allume || !(e.Force > 0) {
			return nil
		}
		if o, ok := octetParam(params, f.carte); ok {
			if id, lie := pp.textures[o]; lie {
				e.Bitmap = id
				t := pp.transfo(o, c)
				e.Transfo = &t
			}
		}
		e.Image = f.image
		return &e
	}
	return nil
}

// declareTous: the shader declares every name of `noms` (and at least one parameter).
func declareTous(params ParametresShader, noms []uint32) bool {
	if len(params) == 0 {
		return false
	}
	for _, n := range noms {
		if _, ok := params[n]; !ok {
			return false
		}
	}
	return true
}

// Pochoir : couleur RVB lineaire et opacite d'un decalque pochoir.
type Pochoir struct {
	Couleur [3]float32 `json:"couleur"`
	Opacite float32    `json:"opacite"`
}

// pochoirDuShader lit les constantes declarees du shader de decalque pochoir.
func pochoirDuShader(shader uint32, params ParametresShader, constantes []byte) *Pochoir {
	const shaderPochoir = 0xc0b84a6a
	const nomCouleurPochoir = 0x9d5cd716 // Nom non resolu, couleur reconnue aux valeurs.
	const nomOpacitePochoir = 0xb4d4ff02 // decal_opacity
	if shader != shaderPochoir {
		return nil
	}
	o, ok := params[nomCouleurPochoir]
	if !ok || o < 0 || o+12 > len(constantes) {
		return nil
	}
	c := lecteurConstantes(constantes)
	p := &Pochoir{Couleur: c.rgb(o), Opacite: 1}
	if o, ok := params[nomOpacitePochoir]; ok && o >= 0 && o+4 <= len(constantes) {
		p.Opacite = min(max(c.f(o), 0), 1)
	}
	return p
}
