// Package himap — geometry_uv.go : les coordonnees de texture d'un LOD.
package himap

import (
	"encoding/binary"
	"math"
)

// Coordonnees de texture : le LOD porte 19 index de tampons (Reclaimer `VertexBufferIndexArray`,
// un par usage) ; les trois jeux de coordonnees sont les usages 1, 2 et 3. Format mesure sur
// Recharge : deux u16 normalises, pas de 4 octets, dequantifies entre les bornes U/V du jeu dans
// le premier enregistrement BoundingBoxes du tag (ekur `BoundingBoxBlock` : u, v du jeu 0 a +28,
// du jeu 1 a +44, du jeu 2 a +60, chacun min puis max).
//
// Les shaders en couches des cartes lisent le masque macro sur le jeu 1 et les textures de
// couche, repetees, sur le jeu 2 ; le jeu 0 sert aux autres shaders.
const (
	NJeuxUV         = 3
	lodOffUV0       = lodOffVertexBuffer + 2
	vertexFormatUV  = 9
	vertexStrideUV  = 4
	bboxOffUVBornes = 28
	bboxPasJeuUV    = 16
)

// uv lit le jeu de coordonnees `jeu` du LOD ; nil si l'emplacement est vide, d'un autre format,
// d'un autre nombre de sommets que les positions, ou sans bornes.
func (a *RuntimeGeoAsset) uv(l lodEntry, jeu, nVerts int) [][2]float32 {
	k := int(int16(binary.LittleEndian.Uint16(a.info.tag[l.abs+lodOffUV0+2*jeu:])))
	if k < 0 || k >= len(a.vertexDescs) {
		return nil
	}
	d := a.vertexDescs[k]
	if d.Usage != vertexFormatUV || d.Stride != vertexStrideUV || d.Count != nVerts ||
		d.Offset < 0 || d.Offset+d.Size > len(a.blob) {
		return nil
	}
	b, ok := a.uvBornes(jeu)
	if !ok {
		return nil
	}
	out := make([][2]float32, nVerts)
	for i := range out {
		r := a.blob[d.Offset+i*vertexStrideUV:]
		for c := 0; c < 2; c++ {
			q := float32(binary.LittleEndian.Uint16(r[2*c:])) / quantMax
			out[i][c] = b[2*c] + q*(b[2*c+1]-b[2*c])
		}
	}
	return out
}

// uvs lit les trois jeux de coordonnees du LOD.
func (a *RuntimeGeoAsset) uvs(l lodEntry, nVerts int) [NJeuxUV][][2]float32 {
	var out [NJeuxUV][][2]float32
	for j := range out {
		out[j] = a.uv(l, j, nVerts)
	}
	return out
}

// uvBornes rend (u min, u max, v min, v max) du jeu `jeu` dans le premier enregistrement
// BoundingBoxes.
func (a *RuntimeGeoAsset) uvBornes(jeu int) ([4]float32, bool) {
	var b [4]float32
	abs := a.geo.BoundsAbs
	off := bboxOffUVBornes + bboxPasJeuUV*jeu
	if abs < 0 || abs+off+16 > len(a.info.tag) {
		return b, false
	}
	for i := range b {
		v := math.Float32frombits(binary.LittleEndian.Uint32(a.info.tag[abs+off+4*i:]))
		if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
			return b, false
		}
		b[i] = v
	}
	return b, true
}
