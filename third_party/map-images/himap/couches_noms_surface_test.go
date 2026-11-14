// Package himap — couches_noms_surface_test.go : reconnaissance des surfaces par noms,
// familles de shaders partageant les memes cartes de normale et de controle.
package himap

import (
	"encoding/binary"
	"math"
	"testing"
)

// Noms des familles surface_* (couleur teinte par constante) et de sa variante sans teinte :
// meme normale et meme carte de controle, seule la carte de couleur distingue les familles.
const (
	surfNomCouleurTeinte = 0x9d92f94d
	surfNomTeinte        = 0xf6746e7b
	surfNomCouleur       = 0x82303557
	surfNomNormale       = 0xd014dac9
	surfNomControle      = 0x255bb2ea
)

// TestSurfaceCouleurSansTeinte : un shader dont la famille porte une carte de couleur SANS
// teinte ne doit pas etre reconnu par la carte de controle partagee avec la famille teinte,
// qui le classait degrade aux couleurs nulles. C'est une couche couleur : la carte de
// couleur porte la teinte (blanc), normale et controle suivent en secondaires.
func TestSurfaceCouleurSansTeinte(t *testing.T) {
	params := ParametresShader{surfNomCouleur: 16, surfNomNormale: 48, surfNomControle: 80}
	pp := postprocessLu{textures: map[int]uint32{16: 0x100, 48: 0x101, 80: 0x102}}
	got := couchesParNoms(params, pp)
	if got == nil || got.JeuUV != jeuUVDiffus || len(got.Couches) != 1 {
		t.Fatalf("surface %+v", got)
	}
	k := got.Couches[0]
	if k.Sorte != CoucheCouleur || k.Bitmap != 0x100 || k.Transfo != transfoNeutre {
		t.Fatalf("couche couleur %+v", k)
	}
	if k.Teinte != [3]float32{1, 1, 1} {
		t.Fatalf("teinte %+v", k.Teinte)
	}
	if k.Normale != 0x101 || k.Controle != 0x102 {
		t.Fatalf("secondaires %+v", k)
	}
}

// TestSurfaceCouleurAvecTeinte : la famille teinte est reconnue par sa propre carte de
// couleur, teinte lue dans les constantes, normale et controle en secondaires.
func TestSurfaceCouleurAvecTeinte(t *testing.T) {
	params := ParametresShader{surfNomCouleurTeinte: 0, surfNomTeinte: 4, surfNomNormale: 44, surfNomControle: 84}
	c := make([]byte, 68)
	for i, f := range []float32{0.5, 0.6, 0.7} {
		binary.LittleEndian.PutUint32(c[4+4*i:], math.Float32bits(f))
	}
	pp := postprocessLu{textures: map[int]uint32{0: 0x200, 44: 0x201, 84: 0x202}, constantes: c}
	got := couchesParNoms(params, pp)
	if got == nil || got.JeuUV != jeuUVDiffus || len(got.Couches) != 1 {
		t.Fatalf("surface %+v", got)
	}
	k := got.Couches[0]
	if k.Sorte != CoucheCouleur || k.Bitmap != 0x200 {
		t.Fatalf("couche couleur %+v", k)
	}
	if k.Teinte != [3]float32{0.5, 0.6, 0.7} {
		t.Fatalf("teinte %+v", k.Teinte)
	}
	if k.Normale != 0x201 || k.Controle != 0x202 {
		t.Fatalf("secondaires %+v", k)
	}
}
