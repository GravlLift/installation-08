// Package himap — themes_armure.go : les THEMES (noyaux d'armure) d'un modele personnalisable et la
// base de chacun, pour habiller un Spartan sans manifeste (armure par defaut d'un noyau).
//
// Chaine, lue sur le Spartan (10 themes, 9 `ocur` dans l'index) :
//
//	ocgd, modele (armure_defaut.go) : themes TagBlock +0x3c, 56 o par theme =
//	  { nom StringID +0, variante de modele +4, reference `ocur` +8 (GlobalID a +16) }
//	ocur racine : regions de personnalisation TagBlock +16, 44 o par region =
//	  { nom StringID +0, regions du `mode` TagBlock +4 (StringID de 4 o),
//	    permutations TagBlock +24 (60 o, nom StringID +0) }
//
// La premiere permutation de chaque region de personnalisation est la piece du noyau lui-meme, sa
// permutation propre (Mark VII 13d24f1f, Mark IV 18f393d2...) : c'est le `VariantId` du fichier de
// theme de GameCMS, et le `BaseRegionData` de ce fichier nomme cette permutation dans ses regions.
// La base d'un theme est donc, pour chaque region du `mode` d'une region de personnalisation, sa
// premiere permutation. La variante de modele de l'ocgd n'est pas cette base : sept themes sur dix
// y portent celle du Mark VII.
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"context"
	"fmt"
	"log/slog"
)

// Grammaire des themes.
const (
	GroupeTheme           = "ocur"
	ocgdThemeOffOcur      = 16
	ocurOffRegions        = 16
	ocurRegionStride      = 44
	ocurRegionOffModes    = 4
	ocurRegionOffPerms    = 24
	ocurPermutationStride = 60
	ocurRegionModeStride  = 4
)

// ThemeArmure : un noyau d'armure du modele.
type ThemeArmure struct {
	// Nom : le StringID du theme ; Variante : la variante de modele que l'ocgd lui donne.
	Nom, Variante uint32
	// Ocur : le GlobalID du tag du theme ; Lu faux quand il manque a l'index ou ne se lit pas.
	Ocur uint32
	Lu   bool
	// Permutation : la permutation propre du noyau (la plus frequente des premieres permutations).
	Permutation uint32
	// Base : region du `mode` -> premiere permutation de sa region de personnalisation.
	Base []CleArmure
}

// ThemesDuModele lit les themes du `mode` dans les globales de personnalisation de l'index, et la
// base de chacun ; un `ocur` manquant ou illisible laisse son theme sans base (Lu faux, journalise).
func (a *Arsenal) ThemesDuModele(ctx context.Context, mode uint32) ([]ThemeArmure, error) {
	for _, id := range a.geo.EntreesDuGroupe(GroupePersonnalisation) {
		tag, err := a.geo.Extract(id)
		if err != nil {
			slog.WarnContext(ctx, "unreadable customization globals", "id", fmt.Sprintf("%08x", id), "err", err)
			continue
		}
		themes, ok := themesDeLOcgd(tag, mode)
		if !ok {
			continue
		}
		for i := range themes {
			a.baseDuTheme(ctx, &themes[i])
		}
		return themes, nil
	}
	return nil, fmt.Errorf("no customization global (%s) carries mode %08x", GroupePersonnalisation, mode)
}

// themesDeLOcgd rend les themes de l'enregistrement du `mode` de l'ocgd ; faux quand il ne le porte pas.
func themesDeLOcgd(ocgd []byte, mode uint32) ([]ThemeArmure, bool) {
	ti, err := meilleurTagInfo(ocgd)
	if err != nil {
		return nil, false
	}
	offs, cibles, err := ti.rootBlockRefs()
	if err != nil {
		return nil, false
	}
	for i, o := range offs {
		if o != ocgdOffModeles {
			continue
		}
		abs, taille := ti.blockAbs(cibles[i])
		for k := 0; abs >= 0 && (k+1)*ocgdModeleStride <= taille; k++ {
			if uint32(u32(ti.tag, abs+k*ocgdModeleStride+ocgdModeleOffMode)) != mode {
				continue
			}
			tAbs, tTaille := ti.blockAbs(ti.subBlockTarget(cibles[i], k*ocgdModeleStride+ocgdModeleOffThemes))
			var out []ThemeArmure
			for j := 0; tAbs >= 0 && (j+1)*ocgdThemeStride <= tTaille; j++ {
				rec := tAbs + j*ocgdThemeStride
				out = append(out, ThemeArmure{Nom: uint32(u32(ti.tag, rec)),
					Variante: uint32(u32(ti.tag, rec+ocgdThemeOffVariante)), Ocur: uint32(u32(ti.tag, rec+ocgdThemeOffOcur))})
			}
			return out, true
		}
	}
	return nil, false
}

// baseDuTheme lit l'ocur du theme et pose Lu, Permutation et Base.
func (a *Arsenal) baseDuTheme(ctx context.Context, th *ThemeArmure) {
	if g, _, ok := a.geo.Lookup(th.Ocur); !ok || g != GroupeTheme {
		slog.WarnContext(ctx, "theme without ocur in the index", "theme", fmt.Sprintf("%08x", th.Nom), "ocur", fmt.Sprintf("%08x", th.Ocur))
		return
	}
	tag, err := a.geo.Extract(th.Ocur)
	if err == nil {
		th.Base, th.Permutation, err = baseDeLOcur(tag)
	}
	if err != nil {
		slog.WarnContext(ctx, "unreadable ocur", "theme", fmt.Sprintf("%08x", th.Nom), "ocur", fmt.Sprintf("%08x", th.Ocur), "err", err)
		return
	}
	th.Lu = true
}

// baseDeLOcur rend la base d'un ocur (region du `mode` -> premiere permutation) et la permutation
// propre du noyau.
func baseDeLOcur(ocur []byte) ([]CleArmure, uint32, error) {
	ti, err := meilleurTagInfo(ocur)
	if err != nil {
		return nil, 0, err
	}
	offs, cibles, err := ti.rootBlockRefs()
	if err != nil {
		return nil, 0, err
	}
	for i, o := range offs {
		if o != ocurOffRegions {
			continue
		}
		abs, taille := ti.blockAbs(cibles[i])
		if abs < 0 || taille%ocurRegionStride != 0 {
			return nil, 0, fmt.Errorf("customization regions over %d bytes", taille)
		}
		sous := ti.sousBlocsParOffset(cibles[i])
		var base []CleArmure
		freq := map[uint32]int{}
		for r := 0; r < taille/ocurRegionStride; r++ {
			pAbs, pTaille := blocDe(ti, sous, r*ocurRegionStride+ocurRegionOffPerms)
			if pTaille < ocurPermutationStride {
				continue
			}
			perm := uint32(u32(ti.tag, pAbs))
			freq[perm]++
			mAbs, mTaille := blocDe(ti, sous, r*ocurRegionStride+ocurRegionOffModes)
			for m := 0; mAbs >= 0 && (m+1)*ocurRegionModeStride <= mTaille; m++ {
				base = append(base, CleArmure{Region: uint32(u32(ti.tag, mAbs+m*ocurRegionModeStride)), Permutation: perm})
			}
		}
		propre, n := uint32(0), 0
		for p, k := range freq {
			if k > n || (k == n && p < propre) {
				propre, n = p, k
			}
		}
		return base, propre, nil
	}
	return nil, 0, fmt.Errorf("no customization regions at root +%d", ocurOffRegions)
}

// blocDe rend l'adresse et la taille du sous-bloc du champ `off` ; (-1, 0) sans sous-bloc.
func blocDe(ti tagInfo, sous map[int]int, off int) (int, int) {
	b, ok := sous[off]
	if !ok {
		return -1, 0
	}
	abs, taille := ti.blockAbs(b)
	if abs < 0 || abs+taille > len(ti.tag) {
		return -1, 0
	}
	return abs, taille
}
