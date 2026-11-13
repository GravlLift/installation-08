// Package himap — emissif.go : ce qu'un materiau emet de lui-meme (lampes, bandeaux, ecrans).
//
// Comme pour la decoupe et les couches, le sens des constantes du postprocess depend du shader ;
// la table vient de `TheHaloArchive/ekur` (`ekur_materials`), valeurs relues sur Recharge :
//
//	illum_full       couleur (3 f32) a +0, intensite a +12
//	diffuse_emissive teinte d'auto-illumination (3 f32) a +224, quantite a +236, intensite a +240
//
// La force emise est intensite x quantite (diffuse_emissive) ou l'intensite seule (illum_full) :
// des valeurs HDR du jeu, de 1 a plus de 1 000, qu'une visionneuse comprime. La texture
// d'auto-illumination de diffuse_emissive (emplacement 244) n'est pas lue : sur Recharge elle
// designe le plus souvent une texture par defaut du moteur, absente des modules de la carte.
package himap

import (
	"encoding/binary"
	"math"
)

// Emissif : la lumiere propre d'un materiau. Couleur LINEAIRE, Force multiplie la couleur.
type Emissif struct {
	Couleur [3]float32
	Force   float32
}

// specEmissif : octets des constantes ; quantite < 0 = pas de quantite (force = intensite).
type specEmissif struct{ couleur, intensite, quantite int }

var shadersEmissifs = map[uint32]specEmissif{
	// illum_full
	0x779fc911: {couleur: 0, intensite: 12, quantite: -1},
	// diffuse_emissive
	0x3c7906af: {couleur: 224, intensite: 240, quantite: 236},
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
