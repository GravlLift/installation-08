// Package himap — maillage_variante_palette.go : la liste de materiaux (palette) qu'un type
// d'objet de variante applique a son modele.
package himap

import (
	"context"
	"fmt"
	"github.com/JGtm/halo-infinite-files-reader/himodule"
	"log/slog"
)

// paletteDuType rend la liste des materiaux de la premiere palette que le `food` d'un type
// associe a son `rtgo`. sansPalette = vrai (journalise) quand il n'y en a pas de lisible.
func paletteDuType(ctx context.Context, idx *ModuleIndex, forge *himodule.Module,
	food himodule.File, rtgo uint32) (mats []uint32, sansPalette bool) {
	tag, err := forge.Extract(food)
	if err != nil {
		slog.WarnContext(ctx, "food illisible : objet sans palette", "food", fmt.Sprintf("%08x", food.GlobalID), "err", err)
		return nil, true
	}
	groupe := func(h uint32) string {
		g, _, _ := idx.Lookup(h)
		return g
	}
	connu := func(h uint32) bool { return groupe(h) != "" }
	id, ok := paletteApres(RefsInline(tag, connu), groupe, rtgo)
	if !ok {
		slog.WarnContext(ctx, "rtgo sans palette dans son food", "food", fmt.Sprintf("%08x", food.GlobalID), "rtgo", fmt.Sprintf("%08x", rtgo))
		return nil, true
	}
	tagPalette, err := idx.Extract(id)
	if err != nil {
		slog.WarnContext(ctx, "palette illisible", "rtmp", fmt.Sprintf("%08x", id), "err", err)
		return nil, true
	}
	mats = listeMateriauxPalette(tagPalette, func(h uint32) bool { return groupe(h) == GroupeMateriau })
	if mats == nil {
		slog.WarnContext(ctx, "palette sans liste de materiaux", "rtmp", fmt.Sprintf("%08x", id))
		return nil, true
	}
	return mats, false
}

// paletteApres rend la premiere palette referencee apres le `rtgo` donne dans la suite des
// references d'un `food`, avant le `rtgo` suivant : le `food` range chaque modele suivi de ses
// palettes.
func paletteApres(refs []uint32, groupe func(uint32) string, rtgo uint32) (uint32, bool) {
	apres := false
	for _, h := range refs {
		switch groupe(h) {
		case GroupeRtgo:
			apres = h == rtgo
		case GroupePalette:
			if apres {
				return h, true
			}
		}
	}
	return 0, false
}

// listeMateriauxPalette rend la liste des references `mat ` d'un tag `rtmp` : le bloc du root
// dont chaque enregistrement (refMateriauStride) designe un materiau. nil sans un tel bloc.
func listeMateriauxPalette(tag []byte, estMateriau func(uint32) bool) []uint32 {
	for _, ti := range tagCandidates(tag) {
		_, cibles, err := ti.rootBlockRefs()
		if err != nil {
			continue
		}
		for _, c := range cibles {
			if l := ti.materiauxInstance(c); len(l) > 0 && tousMateriaux(l, estMateriau) {
				return l
			}
		}
	}
	return nil
}

func tousMateriaux(ids []uint32, estMateriau func(uint32) bool) bool {
	for _, id := range ids {
		if !estMateriau(id) {
			return false
		}
	}
	return true
}
