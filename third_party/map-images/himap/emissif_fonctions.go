// Package himap — emissif_fonctions.go (LOCAL-CHANGE (infinite-theater-3d)): the animated
// parameters of a material, how the game moves its light over time.
//
// A material's postprocess record carries two blocks besides its textures and constants:
//
//	+24  function parameters, 48 o each: type (u32: 0 value, 1 color, 2 scale uniform, 3 scale x,
//	     4 scale y, 5 translation x, 6 translation y, 7 frame index, 8 alpha), input name (+4,
//	     string id; 0 = time), range name (+8), time period (+20, f32), and a data reference
//	     (+24, its size at +44) to the function's bytes
//	+44  routing, 8 o each: function rank (u8), the constant it drives as a float index (u8,
//	     byte = 4 x index)
//
// The function's bytes are the engine's mapping function (the Halo 3 layout): type (u8: 0
// identity, 1 constant, 2 transition, 3 periodic, 4 linear, 5 linear key, 6 multi-linear key,
// 7 spline, 8 multi-spline, 9 exponent, 10 spline2), flags (u8, bit 0: ranged, two sub-functions),
// output min and max (+4, +8, f32), the size of the sub-function bytes (+28, u32), then those
// bytes from +32. A periodic sub-function is 20 o: its wave (u8: 0 one, 1 zero, 2 cosine,
// 3 cosine with variable period, 4 diagonal wave, 5 diagonal wave with variable period, 6 slide,
// 7 slide with variable period, 8 noise, 9 jitter, 10 wander, 11 spark), frequency, phase, min,
// max (f32 at +4..+16). The value replaces the constant: on Streets a sign's opacity of 0.31 is
// animated between 0.15 and 0.4, a neon amount of 1 between 1 and 0.33. Measured on Streets'
// holographic signs, hologram projectors, screens and neon; the layout of the records was read
// off the tag, the field meanings follow the engine's earlier animated parameters.
package himap

import (
	"encoding/binary"
	"math"
)

// Offsets of the postprocess record's animation blocks.
const (
	postOffFonctions   = 24
	postOffRoutage     = 44
	fonctionStride     = 48
	routageStride      = 8
	fonctionOffDonnees = 24
)

// Kinds of an animated parameter (its record's type).
const (
	AnimeValeur        = 0
	AnimeCouleur       = 1
	AnimeEchelle       = 2
	AnimeEchelleX      = 3
	AnimeEchelleY      = 4
	AnimeDecalageX     = 5
	AnimeDecalageY     = 6
	AnimeImage         = 7
	AnimeAlpha         = 8
	fonctionPeriodique = 3
)

// Periodique is a periodic sub-function: wave(frequency x input + phase), brought into [Min, Max].
type Periodique struct {
	Onde      int     `json:"onde"`
	Frequence float32 `json:"frequence"`
	Phase     float32 `json:"phase"`
	Min       float32 `json:"min"`
	Max       float32 `json:"max"`
}

// FonctionJeu is a mapping function: Min + (Max - Min) x its sub-function's value. `Periodiques`
// for a periodic function (two when ranged), `Valeurs` the raw floats of any other kind.
type FonctionJeu struct {
	Type        int          `json:"type"`
	Plage       bool         `json:"plage,omitempty"`
	Min         float32      `json:"min"`
	Max         float32      `json:"max"`
	Periodiques []Periodique `json:"periodiques,omitempty"`
	Valeurs     []float32    `json:"valeurs,omitempty"`
	// entete: the header's four words at +4..+16, which a color function fills with its colors
	// (ARGB, 8 bits each; byte 2 of the header counts them).
	entete    [4]uint32
	nCouleurs int
}

// ParametreAnime is one animated parameter: what it drives (Sorte, Octet: the constant's byte) and
// how (Entree 0: over time, divided by Periode).
type ParametreAnime struct {
	Sorte    int
	Octet    int
	Entree   uint32
	Plage    uint32
	Periode  float32
	Fonction FonctionJeu
}

// SurTemps: the parameter follows time (no object input such as a weapon's power).
func (p ParametreAnime) SurTemps() bool { return p.Entree == 0 }

// cibleEmissive: the constants a light was read from: its color, intensity and amount bytes
// (-1: none) and its texture's slot (-1: none).
type cibleEmissive struct{ couleur, intensite, quantite, emplacement int }

// Targets of an AnimationEmissive.
const (
	// CibleForce: the function multiplies the light (its intensity, amount or opacity moves; the
	// function is divided by that constant's still value, so it reads as a factor).
	CibleForce = "force"
	// CibleUV: the function sets one component of the light texture's transform.
	CibleUV = "uv"
	// CibleCouleur: the function picks the light's color along the gradient `Couleurs`.
	CibleCouleur = "couleur"
)

// AnimationEmissive is an animated parameter of a light, in a form a viewer draws: a periodic
// function of time (seconds / Periode) that multiplies the light (CibleForce) or sets one
// component of its texture's transform (CibleUV; Composante 0 scale x, 1 scale y, 2 offset x,
// 3 offset y, as KHR_texture_transform's scale and offset).
type AnimationEmissive struct {
	Cible      string      `json:"cible"`
	Composante int         `json:"composante,omitempty"`
	Periode    float32     `json:"periode"`
	Fonction   FonctionJeu `json:"fonction"`
	// Couleurs (CibleCouleur): the gradient's colors, linear RGB; the function's periodic value
	// (clamped to [0, 1]) is the position along them.
	Couleurs [][3]float32 `json:"couleurs,omitempty"`
}

// roleAnimation names what an animated parameter of a light drives, for the survey of what is
// drawn: "force", "uv", "couleur" (the light's color along a gradient), or why it is not drawn
// ("objet": an object input, not time; "teinte": a color function on another constant or
// without a readable gradient; "image": a flipbook frame; "fonction": a function other than
// periodic; "autre": a constant that is not the light's, such as a scanline or noise texture's
// transform).
func roleAnimation(c cibleEmissive, registre int, p ParametreAnime) string {
	switch {
	case !p.SurTemps():
		return "objet"
	case p.Fonction.Type != fonctionPeriodique:
		return "fonction"
	case p.Sorte == AnimeValeur && (p.Octet == c.intensite || p.Octet == c.quantite):
		return CibleForce
	case p.Sorte == AnimeCouleur && p.Octet == c.couleur && p.Fonction.nCouleurs >= 2:
		return CibleCouleur
	case p.Sorte == AnimeCouleur:
		return "teinte"
	case p.Sorte == AnimeImage:
		return "image"
	case p.Sorte >= AnimeEchelle && p.Sorte <= AnimeDecalageY && registre >= 0 && p.Octet == registre*tailleRegistre:
		return CibleUV
	}
	return "autre"
}

// animationsEmissives turns a light's animated parameters into what a viewer draws
// (roleAnimation's "force", "uv" and "couleur"); the others are left out. A force function is
// divided by its constant's still value (a zero or unreadable value leaves it out).
func animationsEmissives(e *Emissif, pp postprocessLu) []AnimationEmissive {
	registre := -1
	if r, ok := pp.transfos[e.octets.emplacement]; ok && e.octets.emplacement >= 0 {
		registre = r
	}
	c := lecteurConstantes(pp.constantes)
	var out []AnimationEmissive
	for _, p := range pp.animes {
		switch roleAnimation(e.octets, registre, p) {
		case CibleForce:
			statique := c.f(p.Octet)
			if !(statique > 0) {
				continue
			}
			f := p.Fonction
			f.Min, f.Max = f.Min/statique, f.Max/statique
			out = append(out, AnimationEmissive{Cible: CibleForce, Periode: p.Periode, Fonction: f})
		case CibleUV:
			comps := map[int][]int{AnimeEchelle: {0, 1}, AnimeEchelleX: {0}, AnimeEchelleY: {1}, AnimeDecalageX: {2}, AnimeDecalageY: {3}}[p.Sorte]
			for _, k := range comps {
				out = append(out, AnimationEmissive{Cible: CibleUV, Composante: k, Periode: p.Periode, Fonction: p.Fonction})
			}
		case CibleCouleur:
			f := p.Fonction
			f.Min, f.Max = 0, 1 // the header holds colors, not an output range
			out = append(out, AnimationEmissive{Cible: CibleCouleur, Periode: p.Periode, Fonction: f, Couleurs: f.couleurs()})
		}
	}
	return out
}

// couleurs: a color function's colors, linear RGB: two at +4 and +16 (the words between hold
// the output range), three or four at +4, +8, +12 (+16). Measured on Streets' FREE sign: white
// and a pale blue (c8d8ff), around its color_tint of 0.69, 0.77, 1.
func (f FonctionJeu) couleurs() [][3]float32 {
	var mots []uint32
	switch {
	case f.nCouleurs == 2:
		mots = []uint32{f.entete[0], f.entete[3]}
	case f.nCouleurs == 3 || f.nCouleurs == 4:
		mots = f.entete[:f.nCouleurs]
	default:
		return nil
	}
	out := make([][3]float32, len(mots))
	for i, m := range mots {
		out[i] = [3]float32{srgbVersLineaire(uint8(m >> 16)), srgbVersLineaire(uint8(m >> 8)), srgbVersLineaire(uint8(m))}
	}
	return out
}

func srgbVersLineaire(v uint8) float32 {
	c := float64(v) / 255
	if c <= 0.04045 {
		return float32(c / 12.92)
	}
	return float32(math.Pow((c+0.055)/1.055, 2.4))
}

// fini: the value, or 0 when it is not a finite number (JSON has no NaN).
func fini(v float32) float32 {
	if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
		return 0
	}
	return v
}

// litFonctionJeu decodes a mapping function; ok=false for bytes too short for their header.
func litFonctionJeu(b []byte) (FonctionJeu, bool) {
	if len(b) < 32 {
		return FonctionJeu{}, false
	}
	f32 := func(o int) float32 { return fini(math.Float32frombits(binary.LittleEndian.Uint32(b[o:]))) }
	f := FonctionJeu{Type: int(b[0]), Plage: b[1]&1 != 0, Min: f32(4), Max: f32(8), nCouleurs: int(b[2])}
	for k := range f.entete {
		f.entete[k] = binary.LittleEndian.Uint32(b[4+4*k:])
	}
	n := int(binary.LittleEndian.Uint32(b[28:]))
	if n < 0 || 32+n > len(b) {
		return FonctionJeu{}, false
	}
	sous := b[32 : 32+n]
	if f.Type == fonctionPeriodique {
		for o := 0; o+20 <= len(sous); o += 20 {
			s := func(k int) float32 { return fini(math.Float32frombits(binary.LittleEndian.Uint32(sous[o+k:]))) }
			f.Periodiques = append(f.Periodiques, Periodique{Onde: int(sous[o]), Frequence: s(4), Phase: s(8), Min: s(12), Max: s(16)})
		}
		if len(f.Periodiques) == 0 {
			return FonctionJeu{}, false
		}
		return f, true
	}
	for o := 0; o+4 <= len(sous); o += 4 {
		f.Valeurs = append(f.Valeurs, fini(math.Float32frombits(binary.LittleEndian.Uint32(sous[o:]))))
	}
	return f, true
}

// donneesDuChamp rend, for the block `bloc`, its data references: field offset (from the block's
// start, record included) -> the bytes they point to.
func (ti tagInfo) donneesDuChamp(bloc int) map[int][]byte {
	out := map[int][]byte{}
	tab := ti.structTab + ti.structs*structEntrySize
	for i := 0; i < ti.dataRefs && tab+(i+1)*0x14 <= len(ti.tag); i++ {
		e := tab + i*0x14
		if i32(ti.tag, e+12) != bloc {
			continue
		}
		c := i32(ti.tag, e+8)
		if c < 0 || c >= ti.dataBlocks {
			continue
		}
		abs, size := ti.blockAbsSection(c)
		if abs < 0 || abs+size > len(ti.tag) {
			continue
		}
		out[u32(ti.tag, e+16)] = ti.tag[abs : abs+size]
	}
	return out
}

// parametresAnimes reads the animated parameters of the postprocess block `bloc`, in routing
// order; nil without them. A parameter whose function is unreadable or whose routing names no
// function is left out.
func (ti tagInfo) parametresAnimes(bloc int) []ParametreAnime {
	sous := ti.sousBlocsParOffset(bloc)
	fAbs, fSize, ok := ti.blocValide(sous, postOffFonctions)
	if !ok || fSize < fonctionStride || fSize%fonctionStride != 0 {
		return nil
	}
	rAbs, rSize, ok := ti.blocValide(sous, postOffRoutage)
	if !ok || rSize%routageStride != 0 {
		return nil
	}
	donnees := ti.donneesDuChamp(sous[postOffFonctions])
	n := fSize / fonctionStride
	var out []ParametreAnime
	for r := 0; r+routageStride <= rSize; r += routageStride {
		k := int(ti.tag[rAbs+r])
		if k >= n {
			continue
		}
		rec := fAbs + k*fonctionStride
		f, ok := litFonctionJeu(donnees[k*fonctionStride+fonctionOffDonnees])
		if !ok {
			continue
		}
		out = append(out, ParametreAnime{
			Sorte:    u32(ti.tag, rec),
			Octet:    4 * int(ti.tag[rAbs+r+1]),
			Entree:   uint32(u32(ti.tag, rec+4)),
			Plage:    uint32(u32(ti.tag, rec+8)),
			Periode:  fini(math.Float32frombits(uint32(u32(ti.tag, rec+20)))),
			Fonction: f,
		})
	}
	return out
}
