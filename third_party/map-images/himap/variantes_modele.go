// Package himap — variantes_modele.go : la VARIANTE de modele qu'un objet pose choisit.
//
// Un `mode` (render_model) range ses sections par region et par permutation ; la permutation 0
// de chaque region est le modele par defaut. Un objet pose par le scenario nomme une VARIANTE
// (StringID, record de placement +0x194) que son `hlmt` (model) traduit, region par region, en
// une permutation : une palette chargee y prend ses caisses au lieu de ses bidons, et une region
// dont la permutation choisie manque au `mode` ne dessine rien.
//
// Grammaire du `hlmt`, lue sur Recharge (palette `hlmt 7fa76b1a`) :
//
//	root +0xf4 : variantes, 364 o (nom @+0, regions @+0x34)
//	region      : 32 o (nom de la region @+0, permutations @+0x8)
//	permutation : 44 o (nom @+0, probabilite f32 @+0xc)
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"context"
	"fmt"
	"log/slog"
)

// Grammaire des variantes d'un `hlmt`.
const (
	hlmtOffVariantes      = 0xf4
	varianteStride        = 364
	varianteOffRegions    = 0x34
	regionVarStride       = 32
	regionVarOffPerms     = 0x8
	permVarStride         = 44
	permVarOffProbabilite = 0xc
)

// VarianteModele : nom de region -> nom de la permutation que la variante y dessine. Une region
// absente de la table garde sa permutation par defaut.
type VarianteModele map[uint32]uint32

// LitVarianteModele lit la variante `nom` d'un tag `hlmt` deja decompresse. ok faux quand le tag
// ne porte pas cette variante.
func LitVarianteModele(hlmt []byte, nom uint32) (VarianteModele, bool, error) {
	ti, err := meilleurTagInfo(hlmt)
	if err != nil {
		return nil, false, fmt.Errorf("himap: en-tete du hlmt : %w", err)
	}
	offs, cibles, err := ti.rootBlockRefs()
	if err != nil {
		return nil, false, err
	}
	for i, o := range offs {
		if o != hlmtOffVariantes {
			continue
		}
		abs, taille := ti.blockAbs(cibles[i])
		for k := 0; abs >= 0 && (k+1)*varianteStride <= taille; k++ {
			if uint32(u32(ti.tag, abs+k*varianteStride)) == nom {
				return regionsDeLaVariante(ti, cibles[i], k), true, nil
			}
		}
	}
	return nil, false, nil
}

// regionsDeLaVariante lit les regions de la variante de rang k du bloc `bloc`.
func regionsDeLaVariante(ti tagInfo, bloc, k int) VarianteModele {
	out := VarianteModele{}
	regions := ti.subBlockTarget(bloc, k*varianteStride+varianteOffRegions)
	if regions < 0 {
		return out
	}
	abs, taille := ti.blockAbs(regions)
	for r := 0; abs >= 0 && (r+1)*regionVarStride <= taille; r++ {
		nomRegion := uint32(u32(ti.tag, abs+r*regionVarStride))
		if perm, ok := permutationRetenue(ti, ti.subBlockTarget(regions, r*regionVarStride+regionVarOffPerms)); ok {
			out[nomRegion] = perm
		}
	}
	return out
}

// permutationRetenue rend la permutation la plus probable du bloc (la premiere a egalite) : le
// jeu tire au sort entre plusieurs, la vue fixe n'en montre qu'une.
func permutationRetenue(ti tagInfo, bloc int) (uint32, bool) {
	if bloc < 0 {
		return 0, false
	}
	abs, taille := ti.blockAbs(bloc)
	var nom uint32
	meilleure, lu := -1.0, false
	for p := 0; abs >= 0 && (p+1)*permVarStride <= taille; p++ {
		o := abs + p*permVarStride
		if prob := f32(ti.tag, o+permVarOffProbabilite); prob > meilleure {
			nom, meilleure, lu = uint32(u32(ti.tag, o)), prob, true
		}
	}
	return nom, lu
}

// varianteDuPlacement resout la variante `nom` d'un objet par ses `hlmt` (le premier qui la
// porte). nil sans variante nommee ni `hlmt` qui la porte : le modele garde ses permutations par
// defaut.
func varianteDuPlacement(ctx context.Context, idx *ModuleIndex, objet []byte, nom uint32) VarianteModele {
	if nom == 0 {
		return nil
	}
	for _, h := range refsVehicule(objet, idx, "hlmt") {
		tag, err := idx.Extract(h)
		if err != nil {
			slog.DebugContext(ctx, "unreadable hlmt", "id", fmt.Sprintf("%08x", h), "err", err)
			continue
		}
		v, ok, err := LitVarianteModele(tag, nom)
		if err != nil {
			slog.DebugContext(ctx, "unreadable hlmt variants", "id", fmt.Sprintf("%08x", h), "err", err)
			continue
		}
		if ok {
			return v
		}
	}
	return nil
}
