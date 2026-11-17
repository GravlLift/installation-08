// Package himap — glb_surface.go : le rendu neutre d'une surface dure (surface_dure.go) dans le GLB.
//
// Sans les revetements du jeu (couleurs vraies, non lues), une arme se peint d'une palette neutre :
// chaque zone de revetement prend son gris (masques A et B), l'occlusion assombrit les creux, les
// rayures d'usure eclaircissent les aretes vers le metal nu, la salissure fonce. La couleur est cuite
// en une image de couleur de base (JPEG, sRGB) ; rugosite et metal en une image `metallicRoughness`
// (V = rugosite, B = metal, convention glTF) ; la normale est publiee en `normalTexture`, Y retourne
// (glTF attend Y vers le haut de l'image, le jeu l'ecrit vers le bas). Toutes sur `TEXCOORD_0`.
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"bytes"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"math"
)

// grisZones : le gris neutre de chaque zone de revetement (octet sRGB / 255) : zone de base, puis
// R, V, B du masque A, puis R, V, B du masque B. Des gris distincts separent les pieces de l'arme.
var grisZones = [7]float64{0.14, 0.26, 0.08, 0.19, 0.11, 0.32, 0.05}

const (
	// grisMetalNu : la teinte d'une arete usee jusqu'au metal.
	grisMetalNu = 0.5
	// Parts de l'occlusion, de l'usure et de la salissure dans la couleur.
	partOcclusion = 0.7
	partUsure     = 0.85
	partSalissure = 0.4
	// Rugosite et metal : peinture mate, metal nu plus lisse, salissure plus rugueuse.
	rugositePeinture = 0.62
	rugositeMetalNu  = 0.3
	partRugositeSale = 0.3
	metalPeinture    = 0.25
	metalNu          = 0.9
	// coteSurfaceVide : le cote d'une image cuite sans aucune image source (teinte de base unie).
	coteSurfaceVide = 4
)

// surfacesGLB accumule les images des surfaces dures d'un export : une couleur et une matiere par
// triplet (masque A, masque B, ASG), une normale par bitmap.
type surfacesGLB struct {
	cuites   map[[3]uint32][2]int
	normales map[uint32]int
}

// applique peint g de la surface s, textures lues dans `textures` (absente = zone de base, sans
// usure).
func (sg *surfacesGLB) applique(doc *gltfDoc, bin *tamponGLB, g *gltfMaterial, s *SurfaceDure, textures map[uint32]Texture) error {
	if sg.cuites == nil {
		sg.cuites, sg.normales = map[[3]uint32][2]int{}, map[uint32]int{}
	}
	cle := [3]uint32{s.MasqueA, s.MasqueB, s.ASG}
	tex, ok := sg.cuites[cle]
	if !ok {
		base, matiere := cuitSurface(lue(textures, s.MasqueA), lue(textures, s.MasqueB), lue(textures, s.ASG))
		var jb, pm bytes.Buffer
		if err := jpeg.Encode(&jb, base, &jpeg.Options{Quality: qualiteJPEG}); err != nil {
			return fmt.Errorf("color of surface %08x: %w", s.ASG, err)
		}
		if err := png.Encode(&pm, matiere); err != nil {
			return fmt.Errorf("material of surface %08x: %w", s.ASG, err)
		}
		tex = [2]int{ajouteImage(doc, bin, jb.Bytes(), mimeJPEG), ajouteImage(doc, bin, pm.Bytes(), mimePNG)}
		sg.cuites[cle] = tex
	}
	g.PBR.BaseColorFactor = [4]float32{1, 1, 1, 1}
	g.PBR.MetallicFactor, g.PBR.RoughnessFactor = 1, 1
	g.PBR.BaseColorTexture = &gltfTextureInfo{Index: tex[0]}
	g.PBR.MetallicRoughnessTexture = &gltfTextureInfo{Index: tex[1]}
	g.Extras["surfaceDure"] = true
	t, ok := textures[s.Normale]
	if !ok || s.Normale == 0 {
		return nil
	}
	n, deja := sg.normales[s.Normale]
	if !deja {
		var buf bytes.Buffer
		if err := png.Encode(&buf, normaleGLTF(t.Image)); err != nil {
			return fmt.Errorf("normal %08x: %w", s.Normale, err)
		}
		n = ajouteImage(doc, bin, buf.Bytes(), mimePNG)
		sg.normales[s.Normale] = n
	}
	g.NormalTexture = &gltfTextureInfo{Index: n}
	return nil
}

// lue rend la texture `id` de la table, nil quand elle n'y est pas.
func lue(textures map[uint32]Texture, id uint32) *Texture {
	if t, ok := textures[id]; ok && id != 0 {
		return &t
	}
	return nil
}

// cuitSurface rend la couleur de base et la matiere (V = rugosite, B = metal) d'une surface dure, a
// la taille de la plus grande image source. Une image absente (nil) vaut : masque vide, ASG sans
// occlusion ni usure ni salissure.
func cuitSurface(masqueA, masqueB, asg *Texture) (base, matiere *image.NRGBA) {
	l, h := coteSurfaceVide, coteSurfaceVide
	for _, t := range []*Texture{masqueA, masqueB, asg} {
		if t != nil {
			l, h = max(l, t.Image.Rect.Dx()), max(h, t.Image.Rect.Dy())
		}
	}
	base, matiere = image.NewNRGBA(image.Rect(0, 0, l, h)), image.NewNRGBA(image.Rect(0, 0, l, h))
	for y := 0; y < h; y++ {
		for x := 0; x < l; x++ {
			u, v := (float64(x)+0.5)/float64(l), (float64(y)+0.5)/float64(h)
			a, b, s := canaux(masqueA, u, v, 0), canaux(masqueB, u, v, 0), canaux(asg, u, v, 1)
			// L'ASG absent vaut une occlusion pleine (1) : sans usure ni salissure (0).
			if asg == nil {
				s = [3]float64{1, 0, 0}
			}
			c, rug, met := pixelSurface(a, b, s)
			i := base.PixOffset(x, y)
			gris := octet(c)
			copy(base.Pix[i:i+4], []uint8{gris, gris, gris, 255})
			copy(matiere.Pix[i:i+4], []uint8{0, octet(rug), octet(met), 255})
		}
	}
	return base, matiere
}

// pixelSurface compose un pixel : gris de la zone, puis occlusion, usure et salissure de l'ASG
// (R, V, B). Rend la couleur, la rugosite et le metal, entre 0 et 1.
func pixelSurface(a, b, asg [3]float64) (c, rugosite, metal float64) {
	c = grisZones[0]
	for k := 0; k < 3; k++ {
		c += (grisZones[1+k] - c) * a[k]
	}
	for k := 0; k < 3; k++ {
		c += (grisZones[4+k] - c) * b[k]
	}
	ao, usure, sale := asg[0], asg[1], asg[2]
	c *= 1 - partOcclusion*(1-ao)
	c += (grisMetalNu - c) * usure * partUsure
	c *= 1 - partSalissure*sale
	rugosite = rugositePeinture + (rugositeMetalNu-rugositePeinture)*usure + partRugositeSale*sale
	metal = metalPeinture + (metalNu-metalPeinture)*usure
	return c, min(1, rugosite), metal
}

// canaux lit R, V, B (0..1) de t au plus proche de (u, v) ; `defaut` pour une image absente. Une
// image a un canal porte sa valeur en R, les deux autres canaux valent 0.
func canaux(t *Texture, u, v, defaut float64) [3]float64 {
	if t == nil {
		return [3]float64{defaut, defaut, defaut}
	}
	r := t.Image.Rect
	x := r.Min.X + min(r.Dx()-1, int(u*float64(r.Dx())))
	y := r.Min.Y + min(r.Dy()-1, int(v*float64(r.Dy())))
	p := t.Image.Pix[t.Image.PixOffset(x, y):]
	if t.Monocanal {
		return [3]float64{float64(p[0]) / 255, 0, 0}
	}
	return [3]float64{float64(p[0]) / 255, float64(p[1]) / 255, float64(p[2]) / 255}
}

func octet(f float64) uint8 {
	return uint8(math.Round(max(0, min(1, f)) * 255))
}

// normaleGLTF : X, Y de la normale du jeu, Y retourne pour glTF, Z reconstruit.
func normaleGLTF(src *image.NRGBA) *image.NRGBA {
	dst := canauxNormale(src)
	for i := 1; i < len(dst.Pix); i += 4 {
		dst.Pix[i] = 255 - dst.Pix[i]
	}
	return dst
}
