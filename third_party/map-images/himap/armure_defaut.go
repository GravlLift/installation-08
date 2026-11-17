// Package himap — armure_defaut.go : l'armure par defaut d'un modele personnalisable (le Spartan).
//
// Les permutations d'une region du `mode` du Spartan ne sont PAS rangees noyau de base en tete :
// la permutation 0 d'une region est une piece quelconque d'un noyau quelconque, et « la
// permutation 0 de chaque region » laisse des trous (le plastron y est un ornement de quelques
// centaines de triangles). L'armure par defaut est celle que le jeu nomme, par la chaine :
//
//	ocgd (globales de personnalisation) : bloc des modeles au champ racine +0x10, 80 o par modele
//	  = { nom StringID +0, reference du `mode` +4 (GlobalID a +12), reference du `bipd` +32,
//	  themes TagBlock +0x3c }
//	theme (56 o) = { nom StringID +0, nom de la VARIANTE de modele +4, reference `ocur` +8, ... } ;
//	  le theme 0 est le noyau par defaut
//	bipd -> hlmt : la variante de ce nom, region -> permutation (variantes_modele.go)
//
// Une region que la variante nomme sans que le `mode` porte la permutation ne dessine rien : c'est
// le cas des pieces facultatives (coudieres, genouilleres, poignets) du noyau de base.
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
)

// GroupePersonnalisation : le groupe des globales de personnalisation des modeles.
const GroupePersonnalisation = "ocgd"

// GroupeBiped : le groupe des bipedes, qui portent le `hlmt` de leur modele.
const GroupeBiped = "bipd"

// Grammaire de l'ocgd.
const (
	ocgdOffModeles       = 0x10
	ocgdModeleStride     = 80
	ocgdModeleOffMode    = 12
	ocgdModeleOffThemes  = 0x3c
	ocgdThemeStride      = 56
	ocgdThemeOffVariante = 4
)

// ArmureParDefaut : la variante de modele du noyau par defaut et les tags qui la donnent.
type ArmureParDefaut struct {
	Variante    VarianteModele
	NomVariante uint32
	// Personnalisation, Biped et Modele : les GlobalID de l'ocgd, du bipd et du hlmt lus.
	Personnalisation, Biped, Modele uint32
}

// armureParDefaut lit l'armure par defaut du `mode` dans les globales de personnalisation de
// l'index ; erreur quand aucune ne le porte ou que la chaine vers sa variante est rompue.
func armureParDefaut(ctx context.Context, idx *ModuleIndex, mode uint32) (ArmureParDefaut, error) {
	ids := idx.EntreesDuGroupe(GroupePersonnalisation)
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	for _, id := range ids {
		tag, err := idx.Extract(id)
		if err != nil {
			slog.WarnContext(ctx, "unreadable customization globals", "id", fmt.Sprintf("%08x", id), "err", err)
			continue
		}
		nom, modele, ok, err := themeParDefaut(tag, mode)
		if err != nil {
			slog.WarnContext(ctx, "unreadable customization themes", "id", fmt.Sprintf("%08x", id), "err", err)
			continue
		}
		if !ok {
			continue
		}
		return varianteDuBiped(ctx, idx, ArmureParDefaut{NomVariante: nom, Personnalisation: id}, modele)
	}
	return ArmureParDefaut{}, fmt.Errorf("aucune globale de personnalisation (%s) ne porte le mode %08x", GroupePersonnalisation, mode)
}

// themeParDefaut rend le nom de variante du theme 0 du modele `mode` de l'ocgd, et les octets de
// l'enregistrement du modele (ou se lit sa reference de bipd). ok faux quand l'ocgd ne le porte pas.
func themeParDefaut(ocgd []byte, mode uint32) (uint32, []byte, bool, error) {
	ti, err := meilleurTagInfo(ocgd)
	if err != nil {
		return 0, nil, false, err
	}
	offs, cibles, err := ti.rootBlockRefs()
	if err != nil {
		return 0, nil, false, err
	}
	for i, o := range offs {
		if o != ocgdOffModeles {
			continue
		}
		abs, taille := ti.blockAbs(cibles[i])
		for k := 0; abs >= 0 && (k+1)*ocgdModeleStride <= taille; k++ {
			rec := abs + k*ocgdModeleStride
			if uint32(u32(ti.tag, rec+ocgdModeleOffMode)) != mode {
				continue
			}
			themes := ti.subBlockTarget(cibles[i], k*ocgdModeleStride+ocgdModeleOffThemes)
			tAbs, tTaille := ti.blockAbs(themes)
			if themes < 0 || tAbs < 0 || tTaille < ocgdThemeStride {
				return 0, nil, false, fmt.Errorf("modele %08x sans theme", mode)
			}
			return uint32(u32(ti.tag, tAbs+ocgdThemeOffVariante)), ti.tag[rec : rec+ocgdModeleStride], true, nil
		}
	}
	return 0, nil, false, nil
}

// varianteDuBiped resout la variante `a.NomVariante` par le `hlmt` du bipd que l'enregistrement
// du modele reference.
func varianteDuBiped(ctx context.Context, idx *ModuleIndex, a ArmureParDefaut, modele []byte) (ArmureParDefaut, error) {
	for _, b := range refsInlineDuGroupe(modele, idx, GroupeBiped) {
		bipd, err := idx.Extract(b)
		if err != nil {
			slog.WarnContext(ctx, "unreadable bipd", "id", fmt.Sprintf("%08x", b), "err", err)
			continue
		}
		for _, h := range refsVehicule(bipd, idx, GroupeHlmt) {
			hlmt, err := idx.Extract(h)
			if err != nil {
				slog.WarnContext(ctx, "unreadable hlmt", "id", fmt.Sprintf("%08x", h), "err", err)
				continue
			}
			v, ok, err := LitVarianteModele(hlmt, a.NomVariante)
			if err != nil {
				slog.WarnContext(ctx, "unreadable hlmt variants", "id", fmt.Sprintf("%08x", h), "err", err)
				continue
			}
			if ok {
				a.Variante, a.Biped, a.Modele = v, b, h
				return a, nil
			}
		}
	}
	return a, fmt.Errorf("variante %08x du theme par defaut absente des hlmt du bipd de l'ocgd %08x", a.NomVariante, a.Personnalisation)
}
