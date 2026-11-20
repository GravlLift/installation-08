// Package himap — grenades.go : le projectile lance de chaque type de grenade, pour le rejeu 3D.
//
// L'identifiant de type de grenade que le film ecrit n'est le GlobalID d'aucun tag des modules
// installes : le type se lit par son RANG (l'ordre des types, celui du film et de l'inventaire). Le
// tag des reglages des grenades (`gggl`, une seule instance, dans `globals`) porte un bloc d'un
// element par type, dans cet ordre ; chaque element reference ses `eqip` (l'objet ramassable) et ses
// `proj` (l'objet lance), en deux paires de meme modele. Le projectile d'un rang est la premiere
// reference `proj` de son element.
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"context"
	"fmt"
)

// GroupeReglagesGrenades : le groupe du tag des reglages des grenades.
const GroupeReglagesGrenades = "gggl"

// GroupeProjectile : le groupe des tags de projectile.
const GroupeProjectile = "proj"

// Grenade rend le maillage du projectile de la grenade de rang `rang` ; ErrSansModele quand le rang
// n'a pas de projectile lisible.
func (a *Arsenal) Grenade(ctx context.Context, rang int) (*MaillageMonde, error) {
	projs, err := a.projectilesDeGrenade()
	if err != nil {
		return nil, err
	}
	if rang < 0 || rang >= len(projs) {
		return nil, fmt.Errorf("%w: grenade of rank %d of %d types", ErrSansModele, rang, len(projs))
	}
	return a.objet(ctx, projs[rang], GroupeProjectile)
}

// ProjectilesDeGrenade rend le projectile de chaque type de grenade, par rang.
// LOCAL-CHANGE: exported for the effects the projectile carries (infinite-theater-3d, weapons library).
func (a *Arsenal) ProjectilesDeGrenade() ([]uint32, error) { return a.projectilesDeGrenade() }

// projectilesDeGrenade rend le projectile de chaque type de grenade, par rang.
func (a *Arsenal) projectilesDeGrenade() ([]uint32, error) {
	ids := a.geo.EntreesDuGroupe(GroupeReglagesGrenades)
	if len(ids) != 1 {
		return nil, fmt.Errorf("%w: %d %q tags", ErrSansModele, len(ids), GroupeReglagesGrenades)
	}
	raw, err := a.geo.Extract(ids[0])
	if err != nil {
		return nil, fmt.Errorf("grenade settings: %w", err)
	}
	projs := map[uint32]bool{}
	for _, d := range dependancesDuGroupe(raw, GroupeProjectile) {
		projs[d] = true
	}
	for _, ti := range tagCandidates(raw) {
		if out := ti.projectilesParElement(projs); len(out) > 0 {
			return out, nil
		}
	}
	return nil, fmt.Errorf("%w: grenade types block not found", ErrSansModele)
}

// projectilesParElement cherche, parmi les blocs du bloc racine, le premier dont chaque element
// reference un projectile de `projs`, et rend la premiere reference de chaque element.
func (ti tagInfo) projectilesParElement(projs map[uint32]bool) []uint32 {
	ri, err := ti.rootBlockIndex()
	if err != nil {
		return nil
	}
	rAbs, _ := ti.blockAbs(ri)
	offs, targets, err := ti.rootBlockRefs()
	if err != nil {
		return nil
	}
	for i, off := range offs {
		n := u32(ti.tag, rAbs+off+tagBlockCountOffset)
		abs, size := ti.blockAbs(targets[i])
		if n <= 0 || size <= 0 || size%n != 0 || abs+size > len(ti.tag) {
			continue
		}
		if out := premiersProjectiles(ti.tag[abs:abs+size], n, projs); out != nil {
			return out
		}
	}
	return nil
}

// premiersProjectiles rend la premiere reference de `projs` de chacun des `n` elements de `bloc`,
// nil quand un element n'en a pas.
func premiersProjectiles(bloc []byte, n int, projs map[uint32]bool) []uint32 {
	pas := len(bloc) / n
	out := make([]uint32, 0, n)
	for e := 0; e < n; e++ {
		trouve := false
		for o := e * pas; o+4 <= (e+1)*pas; o += 4 {
			if v := uint32(u32(bloc, o)); projs[v] {
				out = append(out, v)
				trouve = true
				break
			}
		}
		if !trouve {
			return nil
		}
	}
	return out
}
