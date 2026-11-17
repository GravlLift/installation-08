// Package himap — maillage_variante_representation.go : le modele que pose un objet de variante
// selon la representation que son placement choisit parmi celles de son type.
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/JGtm/halo-infinite-files-reader/himodule"
	"github.com/JGtm/halo-infinite-files-reader/mapvar"
)

// cleRepresentation identifie la representation d'un type Forge.
type cleRepresentation struct{ typeID, nom int32 }

// refsRepresentations lit les blocs de representations du tag food.
func refsRepresentations(tag []byte) map[int32]uint32 {
	out := map[int32]uint32{}
	for _, ti := range tagCandidates(tag) {
		offs, blocks, err := ti.rootBlockRefs()
		if err != nil {
			continue
		}
		for i, off := range offs {
			if off != 0x34 && off != 0x48 {
				continue
			}
			start, size := ti.blockAbs(blocks[i])
			if start < 0 || size < 0 || start+size > len(tag) || size%0x5c != 0 {
				continue
			}
			for pos := start; pos < start+size; pos += 0x5c {
				ref := pos + 0x2c
				if uint32(u32(tag, pos+0x18)) == 0x7274676f {
					ref = pos + 0x0c
				}
				out[int32(u32(tag, pos))] = uint32(u32(tag, ref))
			}
		}
		return out
	}
	return out
}

// palettesRepresentations (LOCAL-CHANGE (infinite-theater-3d)) reads, for each `rtgo`
// representation of a food, the palette (`rtmp`) its record names (FieldReference at +0x44,
// GlobalID there, group tag at +0x50). One `rtgo` serves several representations that differ
// only by palette: Eroded Terrain E's (-329379567) ten representations share rtgo 98c04a0d and
// name eight palettes; the first palette after the `rtgo` is only the "Default" one's.
func palettesRepresentations(tag []byte) map[int32]uint32 {
	out := map[int32]uint32{}
	for _, ti := range tagCandidates(tag) {
		offs, blocks, err := ti.rootBlockRefs()
		if err != nil {
			continue
		}
		for i, off := range offs {
			if off != 0x34 && off != 0x48 {
				continue
			}
			start, size := ti.blockAbs(blocks[i])
			if start < 0 || size < 0 || start+size > len(tag) || size%0x5c != 0 {
				continue
			}
			for pos := start; pos < start+size; pos += 0x5c {
				if uint32(u32(tag, pos+0x18)) != 0x7274676f || uint32(u32(tag, pos+0x50)) != 0x72746d70 {
					continue
				}
				if id := uint32(u32(tag, pos+0x44)); id != 0 && id != 0xffffffff {
					out[int32(u32(tag, pos))] = id
				}
			}
		}
		return out
	}
	return out
}

// paletteDeRepresentation (LOCAL-CHANGE (infinite-theater-3d)) reads the material list of the
// palette a representation names; an empty slot (0xffffffff) keeps the material of `defaut` (the
// type's first palette) at that rank. nil when the palette has no readable list.
func paletteDeRepresentation(ctx context.Context, idx *ModuleIndex, id uint32, defaut []uint32) []uint32 {
	tag, err := idx.Extract(id)
	if err != nil {
		slog.WarnContext(ctx, "unreadable representation palette", "rtmp", fmt.Sprintf("%08x", id), "err", err)
		return nil
	}
	estMateriau := func(h uint32) bool { g, _, _ := idx.Lookup(h); return g == GroupeMateriau }
	return combleTrous(listeMateriauxPaletteTrous(tag, estMateriau), defaut)
}

// combleTrous fills each empty slot (0xffffffff) of `mats` in place with `defaut`'s material of
// the same rank, 0 (the unknown material) past its end; nil stays nil.
func combleTrous(mats, defaut []uint32) []uint32 {
	for i, m := range mats {
		if m == 0xffffffff {
			mats[i] = 0
			if i < len(defaut) {
				mats[i] = defaut[i]
			}
		}
	}
	return mats
}

// modelesDesRepresentations ouvre le modele de chaque representation demandee ; `assets` met les
// modeles ouverts en commun avec modelesDesTypes.
func modelesDesRepresentations(ctx context.Context, objets []mapvar.Object, idx *ModuleIndex, forge *himodule.Module, assets map[uint32]*RuntimeGeoAsset) map[cleRepresentation]*modeleVariante {
	foods := map[uint32]himodule.File{}
	for _, f := range forge.Files("food") {
		foods[f.GlobalID] = f
	}
	demandes := map[int32]map[int32]bool{}
	for _, o := range objets {
		if o.RepresentationID != nil {
			if demandes[o.TypeID] == nil {
				demandes[o.TypeID] = map[int32]bool{}
			}
			demandes[o.TypeID][*o.RepresentationID] = true
		}
	}
	out := map[cleRepresentation]*modeleVariante{}
	for ty, noms := range demandes {
		food, ok := foods[uint32(ty)]
		if !ok {
			continue
		}
		tag, err := forge.Extract(food)
		if err != nil {
			continue
		}
		palettes := palettesRepresentations(tag) // LOCAL-CHANGE (infinite-theater-3d)
		for nom, id := range refsRepresentations(tag) {
			if !noms[nom] {
				continue
			}
			groupe, _, ok := idx.Lookup(id)
			if !ok {
				continue
			}
			ref := refModele{id: id, groupe: groupe}
			if groupe != GroupeRtgo && groupe != GroupeMode {
				objet, err := idx.Extract(id)
				if err != nil {
					continue
				}
				ref, ok = modeleDuHlmt(ctx, idx, objet)
				if !ok {
					continue
				}
			}
			a, deja := assets[ref.id]
			if !deja {
				a = ouvreAsset(ctx, idx, ref.id, ref.groupe)
				assets[ref.id] = a
			}
			if a == nil {
				continue
			}
			mv := &modeleVariante{modelePose: lisModelePose(a, ref.groupe, nil), ombre: map[int]bool{}}
			for _, k := range mv.maillages {
				mv.ombre[k] = horsPasseVisible(a, k)
			}
			if ref.groupe == GroupeRtgo {
				mv.materiaux, mv.sansPalette = paletteDuType(ctx, idx, forge, food, ref.id)
				// LOCAL-CHANGE (infinite-theater-3d): the representation's own palette.
				if pal, ok := palettes[nom]; ok && ref.id == id {
					if mats := paletteDeRepresentation(ctx, idx, pal, mv.materiaux); mats != nil {
						mv.materiaux, mv.sansPalette = mats, false
					}
				}
				// LOCAL-CHANGE (infinite-theater-3d): placed by the type's own pivot, the `mode`
				// permutation of the same representation, of the `rtgo`'s size (origine_forge.go).
				mv.origine = origineDuRtgo(a, mv.maillages, modesDuFood(ctx, idx, tag, assets, uint32(nom)))
			}
			out[cleRepresentation{ty, nom}] = mv
		}
	}
	return out
}

func selectionRepresentation(o mapvar.Object, defaut *modeleVariante, representations map[cleRepresentation]*modeleVariante) (*modeleVariante, bool) {
	if o.RepresentationID != nil {
		if mv := representations[cleRepresentation{o.TypeID, *o.RepresentationID}]; mv != nil {
			return mv, false
		}
	}
	return defaut, true
}
