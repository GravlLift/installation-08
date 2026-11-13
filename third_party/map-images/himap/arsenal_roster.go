// Package himap — arsenal_roster.go [LOCAL-CHANGE]: le roster d'armes des modules installes,
// pour la bibliotheque de modeles d'armes de la vision 3D.
//
// CHANGEMENT LOCAL (non amonte) : la bibliotheque d'armes de `infinite-theater-3d` a besoin du
// jeu complet des armes d'une installation, pas d'une seule arme nommee. Le jeu ne publie pas
// de liste d'armes : chaque arme est un tag du groupe `weap`, present dans les modules
// `globals` et `common` que l'index d'une carte installee couvre (`GeometrySearchPathMonde`).
// L'identifiant d'arme du film EST le GlobalID du tag `weap`. La methode ci-dessous rend
// l'ensemble de ces GlobalID, dedoublonnes et tries. Elle est marquee LOCAL-CHANGE car elle
// n'existe pas dans l'amonte `halo-infinite-map-images` v1.0.1.
//
// Le chemin `a.geo` (index de geometrie) est non exporte ; seules les methodes d'`Arsenal`
// peuvent le consulter, d'ou ce petit fichier ajoute au module plutot qu'un lecteur dans un
// paquet externe.
package himap

import (
	"context"
	"fmt"
	"slices"
)

// RosterArmes rend le GlobalID de chaque arme (`weap`) des modules installes, dedoublonne et
// trie. Le roster n'est pas valide par modele lisible : l'appelant decide quelles armes
// construire et rapporte les echecs. Une liste vide est une erreur (aucune arme installee).
func (a *Arsenal) RosterArmes(ctx context.Context) ([]uint32, error) {
	ids := a.geo.EntreesDuGroupe(GroupeArme)
	if len(ids) == 0 {
		return nil, fmt.Errorf("%w : aucun tag %q dans les modules installes", ErrSansModele, GroupeArme)
	}
	slices.Sort(ids)
	return ids, nil
}
