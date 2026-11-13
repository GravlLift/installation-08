// Package himap — couches.go : les couches colorees d'un materiau, de quoi colorer un mur.
//
// Un shader de niveau (`layered level`) empile jusqu'a quatre COUCHES sur une surface ; un
// MASQUE MACRO, lu sur le 2e jeu de coordonnees, dit ou chaque couche recouvre la premiere
// (vert : couche 2, bleu : couche 3, alpha : couche 4). Les textures de couche se repetent sur
// le 3e jeu. Trois sortes de couches :
//
//   - `rohm` : une carte de couleur multipliee par une teinte ;
//   - `rohg` : pas de couleur ; l'alpha de la carte de controle choisit dans un degrade a trois
//     teintes (0 : haut, 0,5 : milieu, 1 : bas) ;
//   - `nnhg` : comme `rohg`, l'alpha de sa carte « packee » portant le degrade.
//
// Les couches se lisent par les noms des parametres du shader (couches_noms.go). Les shaders
// DIFFUS (une seule carte de couleur sur le 1er jeu) n'ont pas ces noms : leur emplacement et
// l'octet de leur teinte viennent de `TheHaloArchive/ekur` (`ekur_materials`).
//
// Relief : chaque couche porte une carte normale tangente (deux canaux R, V ; pour `nnhg`, les
// R, V de sa carte packee) et une carte de controle dont le vert est l'occlusion (`rohm` : carte
// a part ; `rohg` : sa carte de degrade ; `nnhg` : aucune, occlusion 1). Non lus : la hauteur
// (melange par relief) et les cartes « macro » (normale et controle partages entre materiaux,
// des motifs generiques et non un relief cuit par surface).
package himap

import (
	"encoding/binary"
	"math"
)

// SorteCouche dit d'ou vient la couleur d'une couche.
type SorteCouche int

const (
	// CoucheCouleur : carte de couleur x teinte (`rohm`).
	CoucheCouleur SorteCouche = iota
	// CoucheDegrade : degrade haut / milieu / bas choisi par l'alpha d'une carte (`rohg`, `nnhg`).
	CoucheDegrade
)

// Transfo : la transformation des coordonnees d'une texture, uv' = uv * Echelle + Decalage.
type Transfo struct {
	Echelle  [2]float32
	Decalage [2]float32
}

// Couche est une couche lue : la texture qui porte sa couleur (carte de couleur, ou carte dont
// l'alpha choisit dans le degrade) et sa transformation (sur le 3e jeu), ses teintes LINEAIRES,
// son mode de melange (0 : remplace, 1 : superpose), son opacite, et son relief.
type Couche struct {
	Hauteur *HauteurCouche
	Matiere *MatiereCouche
	Sorte   SorteCouche
	Bitmap  uint32
	Transfo Transfo
	// Teinte : multiplicateur de la carte de couleur (CoucheCouleur).
	Teinte [3]float32
	// Haut, Milieu, Bas : le degrade (CoucheDegrade).
	Haut, Milieu, Bas [3]float32
	// IndiceRouge (CoucheDegrade) : l'indice du degrade est le ROUGE de la carte de controle,
	// pas son alpha. Les shaders de vegetation (forme sans carte de couleur de nomsSurfaces)
	// portent le degrade en rouge : leur alpha est constant (carte opaque).
	IndiceRouge bool
	Melange     int
	Opacite     float32
	// Normale : carte normale tangente (X, Y en R, V ; 0 : aucune), son intensite et son mode de
	// melange (0 : remplace le relief des couches dessous, 1 : s'y ajoute).
	Normale          uint32
	TransfoNormale   Transfo
	IntensiteNormale float32
	MelangeNormale   int
	// Controle : carte dont le vert porte l'occlusion (0 : aucune, occlusion 1).
	Controle        uint32
	TransfoControle Transfo
}

// Couches : le masque macro (0 : absent, la premiere couche couvre tout) et les couches dans
// l'ordre du shader.
type Couches struct {
	Masque  uint32
	Couches []Couche
	// JeuUV : le jeu de coordonnees des couches (2 pour un shader de niveau, 0 pour un diffus).
	JeuUV int
}

// Jeux de coordonnees des couches : shaders de niveau sur le 3e, diffus sur le 1er (ekur ne
// nomme aucun jeu pour eux, Blender prend alors le premier).
const (
	jeuUVNiveau         = 2
	jeuUVDiffus         = 0
	sansTeinte          = -1
	intensiteNormaleMax = 4
)

// diffus : l'emplacement de la carte de couleur et l'octet de sa teinte (sansTeinte : aucune).
type diffus struct{ emplacement, teinte int }

// shadersDiffus : les shaders diffus lus. Les commentaires portent le nom ekur.
var shadersDiffus = map[uint32]diffus{
	// diffuse
	0x41bbd6ad: {0, sansTeinte},
	0x0325d014: {0, sansTeinte},
	0x14499d29: {0, sansTeinte},
	0x5a4ba711: {0, sansTeinte},
	0x9337a7cc: {0, sansTeinte},
	// diffuse_billboard
	0x7a8173f8: {96, sansTeinte},
	// diffuse_emissive
	0x3c7906af: {96, 84},
	// diffuse_decal
	0x9dc21e00: {96, 0},
	0x62bacd30: {96, 0},
	0xa7109630: {96, 0},
	0xa9187cb5: {96, 0},
	0x7c525e14: {96, 0},
	// diffuse_si
	0xc1505561: {20, 48},
	0x9d1387c5: {20, 48},
}

// couchesDuMateriau : un shader diffus par la table, tout autre par les noms de ses parametres.
// nil quand le materiau ne lie aucune texture de couche.
func couchesDuMateriau(shader uint32, shaders LecteurShaders, pp postprocessLu) *Couches {
	if d, ok := shadersDiffus[shader]; ok {
		return d.couches(pp)
	}
	params := shaders(shader)
	if params == nil {
		return nil
	}
	return couchesParNoms(params, pp)
}

func (d diffus) couches(pp postprocessLu) *Couches {
	id, ok := pp.textures[d.emplacement]
	if !ok {
		return nil
	}
	k := Couche{Sorte: CoucheCouleur, Bitmap: id, Transfo: transfoNeutre, Teinte: [3]float32{1, 1, 1}, Opacite: 1}
	if d.teinte != sansTeinte {
		k.Teinte = lecteurConstantes(pp.constantes).rgb(d.teinte)
	}
	return &Couches{JeuUV: jeuUVDiffus, Couches: []Couche{k}}
}

// lecteurConstantes lit le tableau de constantes du postprocess ; hors du tableau, zero.
type lecteurConstantes []byte

func (c lecteurConstantes) u32(o int) uint32 {
	if o < 0 || o+4 > len(c) {
		return 0
	}
	return binary.LittleEndian.Uint32(c[o:])
}

func (c lecteurConstantes) f(o int) float32 {
	v := math.Float32frombits(c.u32(o))
	if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
		return 0
	}
	return v
}

// rgb lit une teinte lineaire, bornee a [0, 1].
func (c lecteurConstantes) rgb(o int) [3]float32 {
	var out [3]float32
	for i := range out {
		out[i] = min(max(c.f(o+4*i), 0), 1)
	}
	return out
}

// mode lit un mode de melange : 0 (remplace) ou 1 (superpose, ou s'ajoute pour une normale).
func (c lecteurConstantes) mode(o int) int {
	return min(max(int(int32(c.u32(o))), 0), 1)
}

var transfoNeutre = Transfo{Echelle: [2]float32{1, 1}}

// transfo lit (echelle x, echelle y, decalage x, decalage y) ; une echelle nulle vaut 1.
func (c lecteurConstantes) transfo(o int) Transfo {
	t := Transfo{Echelle: [2]float32{c.f(o), c.f(o + 4)}, Decalage: [2]float32{c.f(o + 8), c.f(o + 12)}}
	for i, v := range t.Echelle {
		if v == 0 {
			t.Echelle[i] = 1
		}
	}
	return t
}
