// Package himap — glb_animations.go : les animations du jeu dans le GLB d'un modele a peau, une
// animation glTF par animation decodee (animations_codec.go), sous un nom stable choisi par
// l'appelant.
//
//	canaux     : par os qui a une piste, rotation (VEC4, i16 normalises : le quantum des donnees du
//	             jeu), translation (VEC3) et echelle (VEC3 uniforme), interpolation lineaire ; une
//	             piste animee a une cle par image, une piste statique une cle a t = 0 ; un os sans
//	             piste garde sa pose de repos (pas de canal)
//	temps      : image k a k / cadence secondes (ClipGLB.Cadence, ImagesParSecondeAnimation par defaut),
//	             strictement croissants
//	axes       : ceux des os (glb_peau.go) : translation C.t, quaternion (x, z, -y, w), ramene dans
//	             l'hemisphere de la cle precedente (interpolation par le plus court chemin)
//	deplacement: l'animation est ecrite SUR PLACE ; le deplacement de racine par image va dans les
//	             extras de l'animation (CleAnimationGLB), en axes glTF : la vue place le joueur par le
//	             film et n'a besoin du deplacement que pour accorder la cadence a la vitesse
package himap

import (
	"encoding/binary"
	"fmt"
	"io"
	"math"
)

// CleAnimationGLB : la cle des extras d'une animation glTF qui decrit son animation du jeu (graphe,
// rang, codec, cadence, images, deplacement de racine).
const CleAnimationGLB = "levelupAnimation"

// ImagesParSecondeAnimation : la cadence a laquelle s'ecrivent les images d'un clip qui n'en donne
// pas (ClipGLB.Cadence nul) : 30 images par seconde, celle des animations sans le drapeau « creee a
// 60 Hz ». Une animation qui porte le drapeau stocke 60 images par seconde (CadenceAnimation).
const ImagesParSecondeAnimation = 30

// ImagesParSeconde60Hz : la cadence d'une animation qui porte le drapeau « creee a 60 Hz ».
const ImagesParSeconde60Hz = 60

// CadenceAnimation rend la cadence a laquelle les images de l'animation se jouent : 60 images par
// seconde sous le drapeau « creee a 60 Hz », 30 sinon. Aucun champ du tag ne porte de cadence ; la
// regle tient sur les jumeaux mesures (un meme geste dure autant en images a 30 Hz qu'en images a
// 60 Hz divisees par deux : premiere_personne_cadence_gamefiles_test.go).
func CadenceAnimation(a AnimationGraphe) int {
	if a.CreeeA60Hz() {
		return ImagesParSeconde60Hz
	}
	return ImagesParSecondeAnimation
}

// Chemins de canal glTF.
const (
	cheminRotation    = "rotation"
	cheminTranslation = "translation"
	cheminEchelle     = "scale"
	typeVec3          = "VEC3"
	typeScalaire      = "SCALAR"
	interpolationLin  = "LINEAR"
)

// ClipGLB : une animation decodee a ecrire sous le nom `Nom`.
type ClipGLB struct {
	Nom  string
	Clip *ClipAnimation
	// Chemin : le chemin de l'arbre des modes qui l'a designee, recopie dans les extras.
	Chemin string
	// Extras : des cles de l'appelant ajoutees a celles de l'animation (CleAnimationGLB), qu'elles
	// ne remplacent jamais.
	Extras map[string]any
	// Cadence : les images par seconde du clip ; 0 : ImagesParSecondeAnimation.
	Cadence int
}

// cadence rend les images par seconde a ecrire.
func (c ClipGLB) cadence() int {
	if c.Cadence > 0 {
		return c.Cadence
	}
	return ImagesParSecondeAnimation
}

// nomsTypeAnimation : la sorte d'une animation telle que l'ecrivent les extras.
var nomsTypeAnimation = map[TypeAnimation]string{AnimationBase: "base", AnimationSurcouche: "overlay", AnimationRemplacement: "replacement"}

// NomTypeAnimation rend la sorte d'une animation telle que l'ecrivent les extras (`base`, `overlay`,
// `replacement`), `type<n>` pour une sorte inconnue.
func NomTypeAnimation(t TypeAnimation) string {
	if n, ok := nomsTypeAnimation[t]; ok {
		return n
	}
	return fmt.Sprintf("type%d", t)
}

// gltfAnimation, gltfCanal, gltfCible, gltfEchantillonneur : une animation glTF.
type gltfAnimation struct {
	Name     string                `json:"name"`
	Channels []gltfCanal           `json:"channels"`
	Samplers []gltfEchantillonneur `json:"samplers"`
	Extras   map[string]any        `json:"extras,omitempty"`
}

type gltfCanal struct {
	Sampler int       `json:"sampler"`
	Target  gltfCible `json:"target"`
}

type gltfCible struct {
	Node int    `json:"node"`
	Path string `json:"path"`
}

type gltfEchantillonneur struct {
	Input         int    `json:"input"`
	Output        int    `json:"output"`
	Interpolation string `json:"interpolation"`
}

// ajouteAnimations ecrit chaque clip ; les os du modele sont les noeuds base..base+n-1.
func ajouteAnimations(doc *gltfDoc, bin *tamponGLB, base int, m *ModeleAPeau, clips []ClipGLB) error {
	vus := map[string]bool{}
	for _, c := range clips {
		switch {
		case c.Nom == "" || vus[c.Nom]:
			return fmt.Errorf("animation au nom vide ou en double : %q", c.Nom)
		case c.Clip == nil || c.Clip.Images < 1:
			return fmt.Errorf("animation %q sans image", c.Nom)
		case len(c.Clip.Os) != len(m.Noeuds):
			return fmt.Errorf("animation %q : %d pistes pour %d os", c.Nom, len(c.Clip.Os), len(m.Noeuds))
		}
		vus[c.Nom] = true
		a, err := animationGLTF(doc, bin, base, c)
		if err != nil {
			return fmt.Errorf("animation %q : %w", c.Nom, err)
		}
		doc.Animations = append(doc.Animations, a)
	}
	return nil
}

// ecrivainAnimation : les temps d'une animation, ecrits une fois, et ses canaux.
type ecrivainAnimation struct {
	doc        *gltfDoc
	bin        *tamponGLB
	images     int
	cadence    int
	tempsAnime int
	tempsFixe  int
	a          gltfAnimation
}

// animationGLTF ecrit les canaux d'un clip et rend son animation glTF.
func animationGLTF(doc *gltfDoc, bin *tamponGLB, base int, c ClipGLB) (gltfAnimation, error) {
	e := &ecrivainAnimation{doc: doc, bin: bin, images: c.Clip.Images, cadence: c.cadence(), tempsAnime: -1, tempsFixe: -1,
		a: gltfAnimation{Name: c.Nom, Extras: map[string]any{CleAnimationGLB: extrasAnimation(c)}}}
	for i, p := range c.Clip.Os {
		if len(p.Rotations) > 0 {
			sortie := make([]float32, 0, 4*len(p.Rotations))
			prec := [4]float32{0, 0, 0, 1}
			for _, q := range p.Rotations {
				g := quatGLTF(q)
				if g[0]*prec[0]+g[1]*prec[1]+g[2]*prec[2]+g[3]*prec[3] < 0 {
					g = [4]float32{-g[0], -g[1], -g[2], -g[3]}
				}
				prec = g
				sortie = append(sortie, g[:]...)
			}
			acc := e.ecritCourtsNormalises(sortie, typeVec4, len(p.Rotations))
			if err := e.canal(base+i, cheminRotation, len(p.Rotations), acc); err != nil {
				return gltfAnimation{}, err
			}
		}
		if len(p.Translations) > 0 {
			sortie := make([]float32, 0, 3*len(p.Translations))
			for _, t := range p.Translations {
				g := versGLTF(t)
				sortie = append(sortie, g[:]...)
			}
			acc := e.ecritFlottants(sortie, typeVec3, len(p.Translations), nil, nil)
			if err := e.canal(base+i, cheminTranslation, len(p.Translations), acc); err != nil {
				return gltfAnimation{}, err
			}
		}
		if len(p.Echelles) > 0 {
			sortie := make([]float32, 0, 3*len(p.Echelles))
			for _, s := range p.Echelles {
				sortie = append(sortie, float32(s), float32(s), float32(s))
			}
			acc := e.ecritFlottants(sortie, typeVec3, len(p.Echelles), nil, nil)
			if err := e.canal(base+i, cheminEchelle, len(p.Echelles), acc); err != nil {
				return gltfAnimation{}, err
			}
		}
	}
	if len(e.a.Channels) == 0 {
		return gltfAnimation{}, fmt.Errorf("aucune piste")
	}
	return e.a, nil
}

// canal ajoute l'echantillonneur et le canal d'une piste de `cles` cles (une par image, ou une
// seule pour une piste statique), dont les valeurs sont l'accesseur `sortieAcc`.
func (e *ecrivainAnimation) canal(noeud int, chemin string, cles, sortieAcc int) error {
	var entree int
	switch cles {
	case 1:
		if e.tempsFixe < 0 {
			e.tempsFixe = e.ecritTemps(1)
		}
		entree = e.tempsFixe
	case e.images:
		if e.tempsAnime < 0 {
			e.tempsAnime = e.ecritTemps(e.images)
		}
		entree = e.tempsAnime
	default:
		return fmt.Errorf("piste %s du noeud %d : %d cles pour %d images", chemin, noeud, cles, e.images)
	}
	e.a.Samplers = append(e.a.Samplers, gltfEchantillonneur{Input: entree, Output: sortieAcc, Interpolation: interpolationLin})
	e.a.Channels = append(e.a.Channels, gltfCanal{Sampler: len(e.a.Samplers) - 1, Target: gltfCible{Node: noeud, Path: chemin}})
	return nil
}

// ecritTemps ecrit les `n` premiers temps d'image (k / cadence) et rend leur accesseur, bornes
// comprises (glTF les exige sur l'entree d'un echantillonneur).
func (e *ecrivainAnimation) ecritTemps(n int) int {
	temps := make([]float32, n)
	for k := range temps {
		temps[k] = float32(k) / float32(e.cadence)
	}
	return e.ecritFlottants(temps, typeScalaire, n, []float32{0}, []float32{temps[n-1]})
}

// ecritFlottants verse des flottants dans le tampon, dans leur propre vue, et rend leur accesseur.
func (e *ecrivainAnimation) ecritFlottants(v []float32, typ string, n int, lo, hi []float32) int {
	off := e.bin.Len()
	b := make([]byte, 4*len(v))
	for i, x := range v {
		binary.LittleEndian.PutUint32(b[4*i:], math.Float32bits(x))
	}
	e.bin.ajoute(b)
	e.doc.BufferViews = append(e.doc.BufferViews, gltfBufferView{ByteOffset: off, ByteLength: len(b)})
	e.doc.Accessors = append(e.doc.Accessors, gltfAccessor{BufferView: len(e.doc.BufferViews) - 1,
		ComponentType: glComponentF32, Count: n, Type: typ, Min: lo, Max: hi})
	return len(e.doc.Accessors) - 1
}

// ecritCourtsNormalises verse des composantes de [-1, 1] en i16 normalises (x 32767, arrondi) et
// rend leur accesseur ; 8 octets par quaternion, la vue reste alignee sur 4.
func (e *ecrivainAnimation) ecritCourtsNormalises(v []float32, typ string, n int) int {
	off := e.bin.Len()
	b := make([]byte, 2*len(v))
	for i, x := range v {
		q := math.Round(math.Max(-1, math.Min(1, float64(x))) * quantumRotation16)
		binary.LittleEndian.PutUint16(b[2*i:], uint16(int16(q)))
	}
	e.bin.ajoute(b)
	e.bin.aligne4()
	e.doc.BufferViews = append(e.doc.BufferViews, gltfBufferView{ByteOffset: off, ByteLength: len(b)})
	e.doc.Accessors = append(e.doc.Accessors, gltfAccessor{BufferView: len(e.doc.BufferViews) - 1,
		ComponentType: glComponentI16, Count: n, Type: typ, Normalized: true})
	return len(e.doc.Accessors) - 1
}

// quatGLTF : un quaternion (x, y, z, w) Halo en axes glTF, normalise (nul -> identite).
func quatGLTF(q [4]float64) [4]float32 {
	_, g, _ := trsGLTF(Noeud{Quat: q, Scale: 1})
	return g
}

// extrasAnimation decrit l'animation du jeu d'un clip : graphe, rang, codec, cadence, images,
// image de boucle, cap et deplacement de racine (axes glTF ; le lacet tourne autour de +Y).
func extrasAnimation(c ClipGLB) map[string]any {
	a := c.Clip.Animation
	capGLTF := versGLTF(a.Cap)
	out := map[string]any{
		"graph": fmt.Sprintf("%08x", c.Clip.Graphe), "index": a.Rang, "codec": c.Clip.Codec,
		"frameRate": c.cadence(), "frameCount": c.Clip.Images,
		"durationSeconds": float64(c.Clip.Images) / float64(c.cadence()), "loopFrame": a.Boucle,
		"heading": capGLTF, "authoredAt60Hz": a.CreeeA60Hz(), "type": NomTypeAnimation(a.Type),
		"overlay": a.Type == AnimationSurcouche,
	}
	if c.Chemin != "" {
		out["path"] = c.Chemin
	}
	for k, v := range c.Extras {
		if _, pris := out[k]; !pris {
			out[k] = v
		}
	}
	if len(c.Clip.Deplacement) == 0 {
		return out
	}
	dep := make([][3]float32, len(c.Clip.Deplacement))
	lacet := make([]float32, len(c.Clip.Deplacement))
	for k, d := range c.Clip.Deplacement {
		dep[k] = versGLTF([3]float64{d[0], d[1], d[2]})
		lacet[k] = float32(d[3])
	}
	out["rootMotion"] = dep
	if a.Mouvement == MouvementDxDyLacet || a.Mouvement == MouvementDxDyDzLac {
		out["rootYaw"] = lacet
	}
	return out
}

// EcritGLBPeauAnime ecrit le modele a peau en GLB avec les animations `clips` (EcritGLBPeau sans
// animation).
func EcritGLBPeauAnime(w io.Writer, m *ModeleAPeau, clips []ClipGLB, generateur string, extras map[string]any) error {
	doc, bin, base, racine, err := documentPeau(m, generateur, extras)
	if err != nil {
		return err
	}
	if err := ajouteAnimations(doc, bin, base, m, clips); err != nil {
		return err
	}
	return termineGLB(w, doc, bin, []int{0, racine})
}
