// Package himap — glb_masques.go : les masques de decoupe dans le GLB.
//
// Un materiau a decoupe devient un materiau glTF `MASK` : sa texture de couleur de base porte
// un gris uniforme et, en alpha, le masque du jeu deja regle (a^Puissance + Ajout) ; le seuil
// est `alphaCutoff`, la transformation des coordonnees passe par `KHR_texture_transform`.
// Un lecteur generique montre donc les trous, et un lancer de rayon peut les lire.
package himap

import (
	"bytes"
	"image"
	"image/png"
	"math"
)

const (
	glRepeat            = 10497
	glLinear            = 9729
	glLinearMipmapLin   = 9987
	extTextureTransform = "KHR_texture_transform"
	grisMasque          = 179 // 0,7 en octet : le meme gris que les materiaux opaques
)

type gltfTexture struct {
	Sampler int `json:"sampler"`
	Source  int `json:"source"`
}

type gltfImage struct {
	BufferView int    `json:"bufferView"`
	MimeType   string `json:"mimeType"`
}

type gltfSampler struct {
	MagFilter int `json:"magFilter"`
	MinFilter int `json:"minFilter"`
	WrapS     int `json:"wrapS"`
	WrapT     int `json:"wrapT"`
}

type gltfTextureInfo struct {
	Index      int            `json:"index"`
	TexCoord   int            `json:"texCoord,omitempty"`
	Extensions map[string]any `json:"extensions,omitempty"`
}

// cleMasque : une image par couple (bitmap, reglage) ; deux materiaux qui partagent les deux
// partagent l'image.
type cleMasque struct {
	bitmap           uint32
	puissance, ajout float32
}

// masquesGLB accumule les images de masque d'un export.
type masquesGLB struct {
	images map[cleMasque]int
}

// applique fait de g un materiau `MASK` lisant le masque t avec le reglage de d.
func (mg *masquesGLB) applique(doc *gltfDoc, bin *tamponGLB, g *gltfMaterial, d *Decoupe, t Texture) error {
	if mg.images == nil {
		mg.images = map[cleMasque]int{}
	}
	cle := cleMasque{d.Bitmap, d.Puissance, d.Ajout}
	tex, ok := mg.images[cle]
	if !ok {
		var png bytes.Buffer
		if err := encodeMasque(&png, t, d); err != nil {
			return err
		}
		tex = ajouteImage(doc, bin, png.Bytes(), mimePNG)
		mg.images[cle] = tex
	}
	seuil := d.Seuil
	g.AlphaMode, g.AlphaCutoff = "MASK", &seuil
	g.PBR.BaseColorFactor = [4]float32{1, 1, 1, 1}
	g.PBR.BaseColorTexture = &gltfTextureInfo{Index: tex, Extensions: map[string]any{
		extTextureTransform: map[string]any{"offset": d.Decalage, "scale": d.Echelle},
	}}
	g.Extras["decoupe"] = map[string]any{"bitmap": d.Bitmap, "seuil": d.Seuil}
	return nil
}

// encodeMasque ecrit le masque en PNG : gris uniforme, alpha = valeur reglee du masque. La
// valeur est R pour un format a un canal ou une texture sans alpha, A sinon.
func encodeMasque(w *bytes.Buffer, t Texture, d *Decoupe) error {
	src := t.Image
	canal := 3
	if t.Monocanal || alphaPlein(src) {
		canal = 0
	}
	dst := image.NewNRGBA(src.Rect)
	for i := 0; i+3 < len(src.Pix); i += 4 {
		a := float64(src.Pix[i+canal]) / 255
		a = math.Pow(a, float64(d.Puissance)) + float64(d.Ajout)
		dst.Pix[i], dst.Pix[i+1], dst.Pix[i+2] = grisMasque, grisMasque, grisMasque
		dst.Pix[i+3] = uint8(math.Round(255 * min(max(a, 0), 1)))
	}
	return png.Encode(w, dst)
}

// alphaNul (LOCAL-CHANGE (infinite-theater-3d)) : every pixel of img has a zero alpha.
func alphaNul(img *image.NRGBA) bool {
	for i := 3; i < len(img.Pix); i += 4 {
		if img.Pix[i] != 0 {
			return false
		}
	}
	return true
}

func alphaPlein(img *image.NRGBA) bool {
	for i := 3; i < len(img.Pix); i += 4 {
		if img.Pix[i] != 255 {
			return false
		}
	}
	return true
}
