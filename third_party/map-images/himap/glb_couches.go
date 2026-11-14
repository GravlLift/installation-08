// Package himap — glb_couches.go : les couches des shaders de niveau dans le GLB.
//
// glTF ne sait pas empiler des couches sous un masque : le materiau porte en `extras.couches`
// de quoi le faire (index de textures du document, transformation, teintes LINEAIRES, mode de
// melange, opacite), et un lecteur qui le connait compose la couleur lui-meme :
//
//	couleur = couche 1 ; puis, pour k = 2..4 : couleur = melange(couleur, couche k, poids k)
//	poids 2, 3, 4 = R, V, B de l'image du masque macro (ses canaux V, B, A d'origine) x opacite
//	(LOCAL-CHANGE (infinite-theater-3d): a layer with `rang` r takes the weight of template
//	layer r + 1 and its height blend index, whatever its position in `couches`)
//	couche couleur = carte (sRGB) x teinte ; couche degrade = haut / milieu / bas selon le
//	rouge de son image (0 : bas, 0,5 : milieu, 1 : haut ; LOCAL-CHANGE (infinite-theater-3d):
//	corrected to Ekur's ColorMixer, the text said 0 : haut)
//	relief : `normale` (image tangente, X, Y, Z en R, V, B, convention DirectX : V vers le bas
//	de l'image), melangee de couche en couche avec les memes poids ; occlusion = vert de
//	l'image `controle` (1 sans controle), multipliee a la couleur
//	matiere : rugosite = bleu de l'image `controle` ; metal = son rouge pour une couche
//	`couleur` (0 pour un degrade, dont le rouge est le degrade)
//
// Image d'une carte de controle (rugosite, occlusion, hauteur, metal ou degrade en R, V, B, A
// d'origine) : R = l'alpha d'origine (ou le ROUGE d'origine pour une couche degrade dont
// l'indiceRouge est pose, les shaders de vegetation), V = l'occlusion, B = la rugosite ; la
// hauteur est dans l'alpha quand les parametres de hauteur sont declares. Une couche `rohg` pointe la meme image en `texture` et en `controle`.
//
// Masque macro sur `TEXCOORD_1`, couches sur le jeu `jeuCouches` (`TEXCOORD_2` pour un shader de
// niveau, `TEXCOORD_0` pour un diffus). Pour un lecteur generique, la
// couleur de base est la premiere couche seule : sa carte et sa teinte, ou le milieu de son
// degrade.
package himap

import (
	"bytes"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"math"
)

const (
	qualiteJPEG   = 85
	jeuUVMacro    = 1
	mimeJPEG      = "image/jpeg"
	mimePNG       = "image/png"
	sorteCouleurG = "couleur"
	sorteDegradeG = "degrade"
)

// roleImage : ce qu'une image tire d'un bitmap.
type roleImage int

const (
	imageCouleur       roleImage = iota // RVB tel quel, sRGB
	imageControle                       // alpha, V, R ranges en R, V, B (format a un canal : R, 1, 0,6)
	imageControleRouge                  // R, V, B tels quels : le rouge porte le degrade, pas l'alpha
	imageNormale                        // R, V tels quels, B = Z reconstruit
	imageMacro                          // canaux V, B, A ranges en R, V, B
	imageControleHauteur
	imageMacroHauteur
)

// pasDeTexture : index de texture d'une carte absente dans `extras.couches`.
const pasDeTexture = -1

type cleImage struct {
	bitmap uint32
	role   roleImage
}

// descImage est l'ecriture d'une image de couche : sa description de couche, l'index de texture de
// sa couleur et, pour une decoupe, l'index de sa carte de decoupe (un de ses canaux, role imageSans).
type descImage struct {
	couche    map[string]any
	tex       int
	masqueTex int
}

// couchesGLB accumule les images de couche d'un export.
type couchesGLB struct {
	images map[cleImage]int
}

// applique ajoute a g les couches c. Une couche dont la texture n'a pas ete lue est omise ;
// sans aucune couche lisible, g reste inchange. Quand le materiau porte une decoupe, l'alpha de
// son masque est ecrit dans l'image de couleur de base : le lecteur applique un alpha test sur
// cette image au lieu de changer de materiau MASK.
func (cg *couchesGLB) applique(doc *gltfDoc, bin *tamponGLB, g *gltfMaterial, c *Couches, textures map[uint32]Texture, d decoupeCouches) error {
	if cg.images == nil {
		cg.images = map[cleImage]int{}
	}
	var descs []descImage
	if len(c.Couches) == 0 {
		return nil
	}
	for _, k := range c.Couches {
		if _, ok := textures[k.Bitmap]; !ok {
			continue
		}
		desc, err := cg.couche(doc, bin, k, textures, d, len(descs) == 0)
		if err != nil {
			return err
		}
		if len(descs) == 0 {
			baseGenerique(g, k, desc.tex, c.JeuUV)
		}
		// LOCAL-CHANGE (infinite-theater-3d): a layer after a skipped one keeps its template rank
		// (mask channel and height blend index), written only when it differs from its position.
		if k.Rang > len(descs) {
			desc.couche["rang"] = k.Rang
		}
		descs = append(descs, desc)
	}
	if len(descs) == 0 {
		return nil
	}
	roleMasque := imageMacro
	if c.Couches[0].Hauteur != nil && c.Couches[0].Controle != 0 {
		roleMasque = imageMacroHauteur
	}
	masqueMacro, err := cg.texture(doc, bin, cleImage{c.Masque, roleMasque}, textures)
	if err != nil {
		return err
	}
	// La couleur de base porte la decoupe : les vues qui lisaient l'image d'origine lisent la
	// copie avec masque (les images du tampon ne sont jamais reecrites, uniquement ajoutees).
	first := descs[0]
	if first.masqueTex >= 0 {
		first.couche["texture"] = first.masqueTex
		g.PBR.BaseColorTexture = &gltfTextureInfo{Index: first.masqueTex, TexCoord: c.JeuUV, Extensions: map[string]any{
			extTextureTransform: map[string]any{"offset": c.Couches[0].Transfo.Decalage, "scale": c.Couches[0].Transfo.Echelle},
		}}
	}
	couches := make([]map[string]any, len(descs))
	for i, desc := range descs {
		couches[i] = desc.couche
	}
	g.Extras["couches"] = map[string]any{"masque": masqueMacro, "couches": couches,
		"jeuMasque": jeuUVMacro, "jeuCouches": c.JeuUV}
	return nil
}

// couche ecrit les images d'une couche et rend sa description. Pour une premiere couche a decoupe,
// elle ecrit aussi la copie de son image de couleur avec l'alpha du masque (un canal du masque,
// ecrit une fois) dans `masqueTex` ; l'index de texture de la couleur reste celui de l'image
// d'origine, que le lecteur remplacera quand la decoupe est posee.
func (cg *couchesGLB) couche(doc *gltfDoc, bin *tamponGLB, k Couche, textures map[uint32]Texture, d decoupeCouches, premier bool) (descImage, error) {
	role, sorte, roleControle := imageCouleur, sorteCouleurG, imageControle
	if k.Sorte == CoucheDegrade {
		sorte = sorteDegradeG
		role = imageControle
		if k.IndiceRouge {
			role, roleControle = imageControleRouge, imageControleRouge
		}
	}
	if k.Hauteur != nil && k.Controle != 0 && !k.IndiceRouge {
		roleControle = imageControleHauteur
		if k.Sorte == CoucheDegrade {
			role = imageControleHauteur
		}
	}
	tex, err := cg.texture(doc, bin, cleImage{k.Bitmap, role}, textures)
	if err != nil {
		return descImage{}, err
	}
	normale, err := cg.texture(doc, bin, cleImage{k.Normale, imageNormale}, textures)
	if err != nil {
		return descImage{}, err
	}
	controle, err := cg.texture(doc, bin, cleImage{k.Controle, roleControle}, textures)
	if err != nil {
		return descImage{}, err
	}
	out := map[string]any{
		"sorte": sorte, "texture": tex, "echelle": k.Transfo.Echelle, "decalage": k.Transfo.Decalage,
		"teinte": k.Teinte, "haut": k.Haut, "milieu": k.Milieu, "bas": k.Bas,
		"melange": k.Melange, "opacite": k.Opacite,
		"normale": normale, "echelleNormale": k.TransfoNormale.Echelle, "decalageNormale": k.TransfoNormale.Decalage,
		"intensiteNormale": k.IntensiteNormale, "melangeNormale": k.MelangeNormale,
		"controle": controle, "echelleControle": k.TransfoControle.Echelle, "decalageControle": k.TransfoControle.Decalage,
	}
	if k.Hauteur != nil {
		out["hauteur"] = []float32{k.Hauteur.Echelle, k.Hauteur.Plage, k.Hauteur.Accumulation}
	}
	if k.Matiere != nil {
		out["matiere"] = []float32{k.Matiere.Blanc, k.Matiere.Noir, k.Matiere.Metal}
	}
	masqueTex := pasDeTexture
	if premier {
		if dp, ok := d.(decoupePose); ok {
			masqueTex = couleurMasque(doc, bin, textures, k, dp)
		}
	}
	return descImage{couche: out, tex: tex, masqueTex: masqueTex}, nil
}

// baseGenerique : la couleur de base glTF d'un materiau en couches, sa premiere couche seule.
func baseGenerique(g *gltfMaterial, k Couche, tex, jeu int) {
	if k.Sorte == CoucheDegrade {
		g.PBR.BaseColorFactor = [4]float32{k.Milieu[0], k.Milieu[1], k.Milieu[2], 1}
		return
	}
	g.PBR.BaseColorFactor = [4]float32{k.Teinte[0], k.Teinte[1], k.Teinte[2], 1}
	g.PBR.BaseColorTexture = &gltfTextureInfo{Index: tex, TexCoord: jeu, Extensions: map[string]any{
		extTextureTransform: map[string]any{"offset": k.Transfo.Decalage, "scale": k.Transfo.Echelle},
	}}
}

// texture rend l'index de texture glTF de (bitmap, role), en ecrivant l'image la premiere fois ;
// pasDeTexture pour un bitmap absent ou non lu.
func (cg *couchesGLB) texture(doc *gltfDoc, bin *tamponGLB, cle cleImage, textures map[uint32]Texture) (int, error) {
	if tex, ok := cg.images[cle]; ok {
		return tex, nil
	}
	t, ok := textures[cle.bitmap]
	if !ok || cle.bitmap == 0 {
		return pasDeTexture, nil
	}
	var buf bytes.Buffer
	mime := mimePNG
	var err error
	switch cle.role {
	case imageCouleur:
		mime = mimeJPEG
		err = jpeg.Encode(&buf, t.Image, &jpeg.Options{Quality: qualiteJPEG})
	case imageControle:
		err = png.Encode(&buf, canauxControle(t))
	case imageControleHauteur:
		img := canauxControle(t)
		for i := 0; i+3 < len(img.Pix); i += 4 {
			img.Pix[i+3] = t.Image.Pix[i+2]
		}
		err = png.Encode(&buf, img)
	case imageControleRouge:
		err = png.Encode(&buf, canauxControleRouge(t))
	case imageNormale:
		err = png.Encode(&buf, canauxNormale(t.Image))
	case imageMacroHauteur:
		img := canauxMacro(t.Image)
		for i := 0; i+3 < len(img.Pix); i += 4 {
			img.Pix[i+3] = t.Image.Pix[i]
		}
		err = png.Encode(&buf, img)
	case imageMacro:
		err = png.Encode(&buf, canauxMacro(t.Image))
	}
	if err != nil {
		return 0, fmt.Errorf("image du bitmap %08x : %w", cle.bitmap, err)
	}
	tex := ajouteImage(doc, bin, buf.Bytes(), mime)
	cg.images[cle] = tex
	return tex, nil
}

// rugositeMonocanal : la rugosite d'une carte de controle a un canal, qui n'en porte pas.
const rugositeMonocanal = 153

// canauxControle : l'alpha (degrade ou metal), l'occlusion (V) et la rugosite (R) d'une carte
// de controle dans une image opaque ; un format a un canal donne son canal, occlusion 1 et une
// rugosite moyenne.
func canauxControle(t Texture) *image.NRGBA {
	src := t.Image
	dst := image.NewNRGBA(src.Rect)
	for i := 0; i+3 < len(src.Pix); i += 4 {
		p := src.Pix[i : i+4 : i+4]
		if t.Monocanal {
			copy(dst.Pix[i:i+4], []uint8{p[0], 255, rugositeMonocanal, 255})
			continue
		}
		copy(dst.Pix[i:i+4], []uint8{p[3], p[1], p[0], 255})
	}
	return dst
}

// canauxControleRouge : comme canauxControle, mais le ROUGE porte l'indice du degrade (le rouge
// de la carte), pas son alpha : les shaders de vegetation ont un alpha constant et portent le
// degrade en rouge. V reste l'occlusion, B la rugosite.
func canauxControleRouge(t Texture) *image.NRGBA {
	src := t.Image
	dst := image.NewNRGBA(src.Rect)
	for i := 0; i+3 < len(src.Pix); i += 4 {
		p := src.Pix[i : i+4 : i+4]
		if t.Monocanal {
			copy(dst.Pix[i:i+4], []uint8{p[0], 255, rugositeMonocanal, 255})
			continue
		}
		copy(dst.Pix[i:i+4], []uint8{p[0], p[1], p[2], 255})
	}
	return dst
}

// canauxNormale : X, Y d'une carte normale a deux canaux et Z = sqrt(1 - X^2 - Y^2).
func canauxNormale(src *image.NRGBA) *image.NRGBA {
	dst := image.NewNRGBA(src.Rect)
	for i := 0; i+3 < len(src.Pix); i += 4 {
		x, y := float64(src.Pix[i])/127.5-1, float64(src.Pix[i+1])/127.5-1
		z := math.Sqrt(max(0, 1-x*x-y*y))
		copy(dst.Pix[i:i+4], []uint8{src.Pix[i], src.Pix[i+1], uint8(math.Round((z + 1) * 127.5)), 255})
	}
	return dst
}

// canauxMacro : les poids des couches 2, 3, 4 (V, B, A du masque) dans une image opaque, pour
// qu'aucun navigateur ne premultiplie l'alpha.
func canauxMacro(src *image.NRGBA) *image.NRGBA {
	dst := image.NewNRGBA(src.Rect)
	for i := 0; i+3 < len(src.Pix); i += 4 {
		dst.Pix[i], dst.Pix[i+1], dst.Pix[i+2], dst.Pix[i+3] = src.Pix[i+1], src.Pix[i+2], src.Pix[i+3], 255
	}
	return dst
}

// decoupeCouches est la decoupe d'un materiau en couches, regroupee pour que `couche` et
// `applique` ne portent que deux arguments de decoupe. Le lecteur applique un alpha test sur la
// couleur de base au lieu de changer de materiau MASK.
type decoupeCouches interface{ decoupeCouches() }

type sansDecoupe struct{}

func (sansDecoupe) decoupeCouches() {}

type decoupePose struct {
	masque  Texture
	decoupe *Decoupe
}

func (decoupePose) decoupeCouches() {}

func nouveauDecoupe(masque *Texture, decoupe *Decoupe) decoupeCouches {
	if masque == nil || decoupe == nil {
		return sansDecoupe{}
	}
	return decoupePose{masque: *masque, decoupe: decoupe}
}

// couleurMasque ecrit, une fois, la copie de l'image de couleur de la premiere couche avec l'alpha
// du masque de decoupe et rend l'index de texture qui la lit. Les images du tampon ne sont jamais
// reecrites sur place (un reecrit ferait defiler les vues qui suivent) : la copie est ajoutee a la
// suite, et seules les vues qui lisaient l'image d'origine sont remplacees par le lecteur.
func couleurMasque(doc *gltfDoc, bin *tamponGLB, textures map[uint32]Texture, k Couche, d decoupePose) int {
	can := 3
	if d.masque.Monocanal || alphaPlein(d.masque.Image) {
		can = 0
	}
	src := k.Bitmap
	if src == 0 {
		return pasDeTexture
	}
	t, ok := textures[src]
	if !ok || t.Image == nil {
		return pasDeTexture
	}
	// Copie des canaux couleur : l'alpha est remplace par le masque, sans toucher l'image d'origine.
	nrgba := image.NewNRGBA(t.Image.Rect)
	copy(nrgba.Pix, t.Image.Pix)
	for i := 0; i+3 < len(nrgba.Pix) && i+3 < len(d.masque.Image.Pix); i += 4 {
		a := float64(d.masque.Image.Pix[i+can]) / 255
		a = math.Pow(a, float64(d.decoupe.Puissance)) + float64(d.decoupe.Ajout)
		nrgba.Pix[i+3] = uint8(math.Round(255 * min(max(a, 0), 1)))
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, nrgba); err != nil {
		return pasDeTexture
	}
	return ajouteImage(doc, bin, buf.Bytes(), mimePNG)
}

// ajouteImage ecrit une image encodee dans le tampon (alignee sur 4 octets) et rend l'index de
// la texture qui la lit avec l'echantillonneur repete du document.
func ajouteImage(doc *gltfDoc, bin *tamponGLB, data []byte, mime string) int {
	if len(doc.Samplers) == 0 {
		doc.Samplers = []gltfSampler{{MagFilter: glLinear, MinFilter: glLinearMipmapLin, WrapS: glRepeat, WrapT: glRepeat}}
		doc.ExtUsed = append(doc.ExtUsed, extTextureTransform)
	}
	off := bin.Len()
	bin.ajoute(data)
	bin.aligne4()
	doc.BufferViews = append(doc.BufferViews, gltfBufferView{ByteOffset: off, ByteLength: len(data)})
	doc.Images = append(doc.Images, gltfImage{BufferView: len(doc.BufferViews) - 1, MimeType: mime})
	doc.Textures = append(doc.Textures, gltfTexture{Sampler: 0, Source: len(doc.Images) - 1})
	return len(doc.Textures) - 1
}
