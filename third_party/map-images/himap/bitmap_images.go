// Package himap — bitmap_images.go (LOCAL-CHANGE (infinite-theater-3d)): every image of a
// multi-image `bitm` tag, side by side in one strip.
//
// A tag whose `bitmaps` block holds several records (40 o each) keeps one resource per image, each
// carrying its own mip levels (LitBitmap reads the first only). The BR75's, the Bandit's and the
// Commando's ammo counters bind such a bitmap: the ten digits 0..9, one per image, which a frame
// index picks (ImagesEmissives).
package himap

import (
	"fmt"
	"image"
	"image/draw"

	"github.com/JGtm/halo-infinite-files-reader/himodule"
)

// coteImagesEmissives: the read size of each image of a light's strip (a counter digit is a few
// pixels on screen; ten at 128 make a 1280 x 128 strip).
const coteImagesEmissives = 128

// LitBitmapImages decodes every image of the `bitm` tag `id`, each at the largest mip level whose
// side fits `cote`, left to right in one strip; n is the image count. A single-image tag reads as
// LitBitmap (n 1); so does a multi-image tag whose images cannot all be read at the first one's size.
func LitBitmapImages(idx *ModuleIndex, id uint32, cote int) (t Texture, n int, err error) {
	m, f, ok := idx.entree(id)
	if !ok || f.Group != GroupeBitmap {
		return Texture{}, 0, fmt.Errorf("himap: bitmap %#x absent from the indexed modules", id)
	}
	brut, err := m.Extract(f)
	if err != nil {
		return Texture{}, 0, err
	}
	tag := brut
	if k := f.HeaderSize + f.TagDataSize; k > 0 && k <= len(brut) {
		tag = brut[:k]
	}
	e, err := litEnteteBitmap(tag)
	if err != nil {
		return Texture{}, 0, err
	}
	seule := func() (Texture, int, error) {
		t, err := LitBitmap(idx, id, cote)
		return t, 1, err
	}
	fm, ok := formatBitmap[e.format]
	if !ok || e.nombre < 2 || f.ActualResourceSize > 0 {
		return seule()
	}
	ressources, err := m.Ressources(f)
	if err != nil || len(ressources) < e.nombre {
		return seule()
	}
	images := make([]*image.NRGBA, 0, e.nombre)
	mono := false
	for i := range e.nombre {
		niveaux, err := m.Ressources(ressources[i])
		if err != nil || len(niveaux) == 0 {
			niveaux = []himodule.File{ressources[i]}
		}
		im, err := lisNiveaux(m, niveaux, e, fm.f, fm.mono, cote)
		if err != nil || (i > 0 && im.Image.Rect.Size() != images[0].Rect.Size()) {
			return seule()
		}
		images = append(images, im.Image)
		mono = im.Monocanal
	}
	l, h := images[0].Rect.Dx(), images[0].Rect.Dy()
	bande := image.NewNRGBA(image.Rect(0, 0, l*len(images), h))
	for i, im := range images {
		draw.Draw(bande, image.Rect(i*l, 0, (i+1)*l, h), im, im.Rect.Min, draw.Src)
	}
	return Texture{Image: bande, Monocanal: mono}, len(images), nil
}
