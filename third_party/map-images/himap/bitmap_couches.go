// Package himap — bitmap_couches.go : une COUCHE d'un tableau de textures (`bitm` a profondeur).
//
// Disposition lue sur le tableau des emblemes d'equipe (932de821, 8 couches 512 x 512 BC7, pixels
// en ligne) : les niveaux de mip sont ranges NIVEAU PAR NIVEAU, toutes les couches d'un niveau
// a la suite ; la couche k du plus grand niveau commence donc a k fois sa taille. Seuls les
// formats compresses par blocs (taille calculable) et les pixels en ligne sont lus.
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"fmt"

	"github.com/woozymasta/bcn"
)

// octetsParBloc : la taille d'un bloc 4 x 4 des formats compresses lus.
func octetsParBloc(f bcn.Format) (int, bool) {
	switch f {
	case bcn.FormatBC1, bcn.FormatBC4, bcn.FormatBC4S:
		return 8, true
	case bcn.FormatBC2, bcn.FormatBC3, bcn.FormatBC5, bcn.FormatBC5S, bcn.FormatBC6HU, bcn.FormatBC6HS, bcn.FormatBC7:
		return 16, true
	}
	return 0, false
}

// enteteDe lit l'en-tete du bitmap `id` et ses octets bruts.
func enteteDe(idx *ModuleIndex, id uint32) (enteteBitmap, []byte, error) {
	m, f, ok := idx.entree(id)
	if !ok || f.Group != GroupeBitmap {
		return enteteBitmap{}, nil, fmt.Errorf("himap: bitmap %#x absent from the indexed modules", id)
	}
	brut, err := m.Extract(f)
	if err != nil {
		return enteteBitmap{}, nil, err
	}
	tag := brut
	if n := f.HeaderSize + f.TagDataSize; n > 0 && n <= len(brut) {
		tag = brut[:n]
	}
	e, err := litEnteteBitmap(tag)
	if err != nil {
		return enteteBitmap{}, nil, err
	}
	if f.ActualResourceSize <= 0 {
		return e, nil, nil
	}
	return e, f.Donnees(brut), nil
}

// profondeurBitmap : le nombre de couches et le format du bitmap `id`.
func (a *Arsenal) profondeurBitmap(id uint32) (prof, format int, ok bool) {
	e, _, err := enteteDe(a.geo, id)
	if err != nil {
		return 0, 0, false
	}
	return e.prof, e.format, true
}

// LitCoucheBitmap decode la couche `couche` du premier bitmap d'un tableau de textures, a son plus
// grand niveau, reduite sous la cote.
func LitCoucheBitmap(idx *ModuleIndex, id uint32, couche, cote int) (Texture, error) {
	e, donnees, err := enteteDe(idx, id)
	if err != nil {
		return Texture{}, err
	}
	if couche < 0 || couche >= e.prof {
		return Texture{}, fmt.Errorf("himap: bitmap %#x: layer %d outside its %d", id, couche, e.prof)
	}
	fm, ok := formatBitmap[e.format]
	parBloc, compresse := octetsParBloc(fm.f)
	if !ok || !compresse {
		return Texture{}, fmt.Errorf("%w : %d", ErrFormatBitmap, e.format)
	}
	if donnees == nil {
		return Texture{}, fmt.Errorf("himap: bitmap %#x: pixels outside the tag, not read", id)
	}
	taille := ((e.larg + 3) / 4) * ((e.haut + 3) / 4) * parBloc
	debut := couche * taille
	if debut+taille > len(donnees) {
		return Texture{}, fmt.Errorf("himap: bitmap %#x: layer %d outside the data", id, couche)
	}
	return decodeNiveau(donnees[debut:debut+taille], e.larg, e.haut, fm.f, fm.mono, cote)
}
