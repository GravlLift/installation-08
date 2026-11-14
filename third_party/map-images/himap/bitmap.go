// Package himap — bitmap.go : le tag `bitm` (texture) decode en image.
//
// CHAINE (lecture de `Gravemind2401/Reclaimer` `BitmapTag.cs` et de `TheHaloArchive/ekur`
// `ekur_texture`, verifiee sur nos modules) :
//
//	tag `bitm` -> bloc `bitmaps` (@0xD4, 40 o : largeur, hauteur, type, format)
//	pixels : EN LIGNE apres l'en-tete et les donnees du tag (petits bitmaps), ou dans les
//	ressources de l'entree, un niveau de mip par ressource, du plus petit au plus grand ;
//	une ressource peut elle-meme porter ses niveaux (bitmaps en tableau).
//
// Le niveau lu est le plus grand qui tient sous la cote demandee : une vue 3D n'a pas l'usage
// d'un 2048 x 2048, et decoder moins coute moins. Une ressource illisible (compagnon `_hd1`
// absent) fait descendre d'un niveau.
package himap

import (
	"errors"
	"fmt"
	"image"

	"github.com/JGtm/halo-infinite-files-reader/himodule"
	"github.com/woozymasta/bcn"
)

// GroupeBitmap : le groupe de tag des textures.
const GroupeBitmap = "bitm"

const (
	bitmOffBitmaps  = 0xD4
	bitmapStride    = 40
	bitmapOffLarg   = 0x00
	bitmapOffHaut   = 0x02
	bitmapOffFormat = 0x08
)

// Texture est un bitmap decode.
type Texture struct {
	Image *image.NRGBA
	// Monocanal : le format ne porte qu'un canal, recopie dans R, V et B (alpha a 255). C'est
	// alors R, et non A, qui porte un masque de decoupe.
	Monocanal bool
}

// formatBitmap traduit l'enum de format du moteur (ekur `BitmapFormat`) vers le decodeur.
// Les formats absents de la table ne sont pas lus.
var formatBitmap = map[int]struct {
	f    bcn.Format
	mono bool
}{
	0:  {bcn.FormatA8, true},
	1:  {bcn.FormatR8, true},
	2:  {bcn.FormatR8, true},
	3:  {bcn.FormatRG8, false},
	10: {bcn.FormatBGRX8, false},
	11: {bcn.FormatBGRA8, false},
	14: {bcn.FormatBC1, false},
	15: {bcn.FormatBC2, false},
	16: {bcn.FormatBC3, false},
	22: {bcn.FormatRG8S, false},
	36: {bcn.FormatBC4, true},
	37: {bcn.FormatBC4S, true},
	39: {bcn.FormatBC5S, false},
	43: {bcn.FormatBC4, true},
	44: {bcn.FormatBC4, true},
	45: {bcn.FormatBC5, false},
	46: {bcn.FormatBC5S, false},
	47: {bcn.FormatBC6HU, false},
	48: {bcn.FormatBC6HS, false},
	49: {bcn.FormatBC7, false},
}

// ErrFormatBitmap signale un format de pixels que le decodeur ne lit pas.
var ErrFormatBitmap = errors.New("himap: format de bitmap non pris en charge")

// enteteBitmap : le premier enregistrement du bloc `bitmaps` d'un tag. prof : le nombre de
// couches d'un tableau de textures (1 pour une texture simple).
type enteteBitmap struct{ larg, haut, prof, format, nombre int }

func litEnteteBitmap(tag []byte) (enteteBitmap, error) {
	for _, ti := range tagCandidates(tag) {
		rb, err := ti.rootBlockIndex()
		if err != nil {
			continue
		}
		c := ti.subBlockTarget(rb, bitmOffBitmaps)
		if c < 0 || c >= ti.dataBlocks {
			continue
		}
		abs, size := ti.blockAbs(c)
		if abs < 0 || size < bitmapStride || abs+size > len(tag) {
			continue
		}
		return enteteBitmap{
			larg:   int(u16(tag, abs+bitmapOffLarg)),
			haut:   int(u16(tag, abs+bitmapOffHaut)),
			prof:   max(int(u16(tag, abs+bitmapOffProf)), 1),
			format: int(u16(tag, abs+bitmapOffFormat)),
			nombre: size / bitmapStride,
		}, nil
	}
	return enteteBitmap{}, fmt.Errorf("himap: tag %s illisible", GroupeBitmap)
}

// LitBitmap decode le premier bitmap d'un tag `bitm`, au plus grand niveau de mip dont le plus
// grand cote ne depasse pas `cote` (le plus petit niveau disponible sinon).
func LitBitmap(idx *ModuleIndex, id uint32, cote int) (Texture, error) {
	m, f, ok := idx.entree(id)
	if !ok || f.Group != GroupeBitmap {
		return Texture{}, fmt.Errorf("himap: bitmap %#x absent des modules indexes", id)
	}
	brut, err := m.Extract(f)
	if err != nil {
		return Texture{}, err
	}
	// Le lecteur de tag refuse des octets en trop : les pixels en ligne restent hors de sa vue.
	tag := brut
	if n := f.HeaderSize + f.TagDataSize; n > 0 && n <= len(brut) {
		tag = brut[:n]
	}
	e, err := litEnteteBitmap(tag)
	if err != nil {
		return Texture{}, err
	}
	fm, ok := formatBitmap[e.format]
	if !ok {
		return Texture{}, fmt.Errorf("%w : %d", ErrFormatBitmap, e.format)
	}
	if f.ActualResourceSize > 0 {
		return decodeNiveau(f.Donnees(brut), e.larg, e.haut, fm.f, fm.mono, cote)
	}
	niveaux, err := m.Ressources(f)
	if err != nil {
		return Texture{}, err
	}
	if e.nombre > 1 && len(niveaux) > 0 {
		// Bitmap en tableau : la premiere ressource porte le premier bitmap et ses niveaux.
		if sous, err := m.Ressources(niveaux[0]); err == nil && len(sous) > 0 {
			niveaux = sous
		} else {
			niveaux = niveaux[:1]
		}
	}
	return lisNiveaux(m, niveaux, e, fm.f, fm.mono, cote)
}

// lisNiveaux parcourt les niveaux du plus grand au plus petit, garde le premier qui tient sous
// la cote et se decode ; le niveau k (en partant du haut) mesure larg>>k x haut>>k.
func lisNiveaux(m *himodule.Module, niveaux []himodule.File, e enteteBitmap, f bcn.Format, mono bool, cote int) (Texture, error) {
	derniere := fmt.Errorf("himap: bitmap sans niveau lisible")
	for k := 0; k < len(niveaux); k++ {
		r := niveaux[len(niveaux)-1-k]
		l, h := max(e.larg>>k, 1), max(e.haut>>k, 1)
		if max(l, h) > cote && k < len(niveaux)-1 {
			continue
		}
		octets, err := m.Extract(r)
		if err != nil {
			derniere = err
			continue
		}
		t, err := decodeNiveau(r.Donnees(octets), l, h, f, mono, cote)
		if err != nil {
			derniere = err
			continue
		}
		return t, nil
	}
	return Texture{}, derniere
}

// decodeNiveau decode le premier niveau de mip des octets (les niveaux suivants, s'il y en a,
// sont ignores), puis le reduit par moities jusqu'a la cote.
func decodeNiveau(octets []byte, l, h int, f bcn.Format, mono bool, cote int) (Texture, error) {
	img, err := bcn.DecodeImage(octets, l, h, f)
	if err != nil {
		return Texture{}, fmt.Errorf("himap: decodage %dx%d : %w", l, h, err)
	}
	if mono {
		for i := 0; i+3 < len(img.Pix); i += 4 {
			v := img.Pix[i]
			if f == bcn.FormatA8 {
				v = img.Pix[i+3]
			}
			img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = v, v, v, 255
		}
	}
	for max(img.Rect.Dx(), img.Rect.Dy()) > cote && img.Rect.Dx() > 1 && img.Rect.Dy() > 1 {
		img = demiImage(img)
	}
	return Texture{Image: img, Monocanal: mono}, nil
}

// demiImage moyenne les pixels par carres de 2 x 2.
func demiImage(src *image.NRGBA) *image.NRGBA {
	l, h := src.Rect.Dx()/2, src.Rect.Dy()/2
	dst := image.NewNRGBA(image.Rect(0, 0, l, h))
	for y := 0; y < h; y++ {
		for x := 0; x < l; x++ {
			for c := 0; c < 4; c++ {
				s := 0
				for dy := 0; dy < 2; dy++ {
					for dx := 0; dx < 2; dx++ {
						s += int(src.Pix[(2*y+dy)*src.Stride+(2*x+dx)*4+c])
					}
				}
				dst.Pix[y*dst.Stride+x*4+c] = uint8(s / 4)
			}
		}
	}
	return dst
}
