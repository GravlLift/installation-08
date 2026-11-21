// Package himap — bitmap_couches.go : une COUCHE d'un tableau de textures (`bitm` a profondeur).
//
// Disposition lue sur le tableau des emblemes d'equipe (932de821, 8 couches 512 x 512 BC7, pixels
// en ligne) : les niveaux de mip sont ranges NIVEAU PAR NIVEAU, toutes les couches d'un niveau
// a la suite ; la couche k du plus grand niveau commence donc a k fois sa taille. Seuls les
// formats compresses par blocs (taille calculable) et les pixels en ligne sont lus.
package himap

// LOCAL-CHANGE: user-visible strings translated to English.
// LOCAL-CHANGE (infinite-theater-3d): the layer size and its decode come from ../bitmapdecode.

import (
	"fmt"

	"github.com/JGtm/halo-infinite-map-images/bitmapdecode"
)

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
	fm, ok := bitmapdecode.Lookup(e.format)
	if !ok || !fm.Compressed() {
		return Texture{}, fmt.Errorf("%w : %d", ErrFormatBitmap, e.format)
	}
	if donnees == nil {
		return Texture{}, fmt.Errorf("himap: bitmap %#x: pixels outside the tag, not read", id)
	}
	taille := fm.LevelSize(e.larg, e.haut)
	debut := couche * taille
	if debut+taille > len(donnees) {
		return Texture{}, fmt.Errorf("himap: bitmap %#x: layer %d outside the data", id, couche)
	}
	return decodeNiveau(donnees[debut:debut+taille], e.larg, e.haut, fm, bitmapdecode.Tight, cote)
}
