// Package himap — glb_surfaces_brutes.go : les images BRUTES d'une surface dure dans le GLB, pour
// un lecteur qui la peint lui-meme d'un revetement (pieces d'armure du Spartan).
//
// Le rendu neutre (glb_surface.go) cuit masques et ASG en une couleur grise : l'information des zones
// est perdue. Ici chaque image passe telle quelle, une fois par bitmap, sur `TEXCOORD_0`, sans espace
// colorimetrique (des donnees, pas une couleur) :
//
//	asg     : occlusion (R), rayures d'usure (V), salissure (B)
//	masque0 : zones 2, 3, 4 du revetement (R, V, B) ; noir = zone de base
//	masque1 : zones 5, 6, 7 (R, V, B)
//
// Une image a un canal porte sa valeur en R, V et B a 0 : un masque a un canal ne pose que sa
// premiere zone, un ASG a un canal n'a ni usure ni salissure. Une image d'un seul pixel est l'image
// vide que le jeu lie a un emplacement sans masque (blanche) : elle n'est pas publiee, le lecteur la
// traite en absente (masque noir, ASG sans usure). Le materiau glTF reste blanc, sans
// metal, la normale en `normalTexture` comme le rendu neutre ; `extras.surfaceBrute` nomme les trois
// textures (rang glTF, -1 : absente) et leurs bitmaps du jeu.
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"bytes"
	"fmt"
	"image"
	"image/png"
)

// CleSurfaceBrute : la cle des extras d'un materiau peint par le lecteur.
const CleSurfaceBrute = "surfaceBrute"

// surfacesBrutesGLB accumule les images brutes d'un export : une texture glTF par bitmap.
type surfacesBrutesGLB struct {
	images   map[uint32]int
	normales map[uint32]int
}

// applique publie dans g les images brutes de la surface s, lues dans `textures` (absente : -1).
func (sb *surfacesBrutesGLB) applique(doc *gltfDoc, bin *tamponGLB, g *gltfMaterial, s *SurfaceDure, textures map[uint32]Texture) error {
	if sb.images == nil {
		sb.images, sb.normales = map[uint32]int{}, map[uint32]int{}
	}
	rangs := map[string]any{}
	bitmaps := map[string]any{}
	for _, im := range []struct {
		cle string
		id  uint32
	}{{"asg", s.ASG}, {"masque0", s.MasqueA}, {"masque1", s.MasqueB}} {
		bitmaps[im.cle] = im.id
		r, err := sb.image(doc, bin, im.id, textures)
		if err != nil {
			return err
		}
		rangs[im.cle] = r
	}
	rangs["bitmaps"] = bitmaps
	g.PBR.BaseColorFactor = [4]float32{1, 1, 1, 1}
	g.PBR.MetallicFactor, g.PBR.RoughnessFactor = 0, 1
	g.Extras[CleSurfaceBrute] = rangs
	t, ok := textures[s.Normale]
	if !ok || s.Normale == 0 {
		return nil
	}
	n, deja := sb.normales[s.Normale]
	if !deja {
		var buf bytes.Buffer
		if err := png.Encode(&buf, normaleGLTF(t.Image)); err != nil {
			return fmt.Errorf("normal %08x: %w", s.Normale, err)
		}
		n = ajouteImage(doc, bin, buf.Bytes(), mimePNG)
		sb.normales[s.Normale] = n
	}
	g.NormalTexture = &gltfTextureInfo{Index: n}
	return nil
}

// image rend le rang glTF de la texture brute du bitmap `id` (-1 : absent ou non lu).
func (sb *surfacesBrutesGLB) image(doc *gltfDoc, bin *tamponGLB, id uint32, textures map[uint32]Texture) (int, error) {
	t, ok := textures[id]
	if !ok || id == 0 || imageVide(t) {
		return -1, nil
	}
	if r, deja := sb.images[id]; deja {
		return r, nil
	}
	octets, err := PNGBrut(t)
	if err != nil {
		return -1, fmt.Errorf("raw image %08x: %w", id, err)
	}
	r := ajouteImage(doc, bin, octets, mimePNG)
	sb.images[id] = r
	return r, nil
}

// imageVide dit si t est l'image vide du jeu (un seul pixel).
func imageVide(t Texture) bool { return t.Image.Rect.Dx() <= 1 && t.Image.Rect.Dy() <= 1 }

// PNGBrut encode les canaux R, V, B de t en PNG opaque (V et B a 0 pour une image a un canal).
func PNGBrut(t Texture) ([]byte, error) {
	src := t.Image
	dst := image.NewNRGBA(src.Rect)
	for i := 0; i+3 < len(src.Pix); i += 4 {
		dst.Pix[i], dst.Pix[i+1], dst.Pix[i+2], dst.Pix[i+3] = src.Pix[i], src.Pix[i+1], src.Pix[i+2], 255
		if t.Monocanal {
			dst.Pix[i+1], dst.Pix[i+2] = 0, 0
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, dst); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// coteNuancier : le plus grand cote lu d'une image de nuancier (degrade d'une couche de revetement).
// Elle se repete sur la piece (densite de texels du materiau) : 256 suffit a une vue de rejeu.
const coteNuancier = 256

// Nuancier rend en PNG brut (PNGBrut) l'image `id` d'un nuancier de revetement, au plus `coteNuancier`
// de cote ; une erreur quand les modules ne la portent pas ou qu'elle ne se decode pas.
func (a *Arsenal) Nuancier(id uint32) ([]byte, error) {
	t, err := LitBitmap(a.geo, id, coteNuancier)
	if err != nil {
		return nil, fmt.Errorf("color chart %08x: %w", id, err)
	}
	return PNGBrut(t)
}
