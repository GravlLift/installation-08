// Package himap — arsenal_equipements.go [LOCAL-CHANGE (infinite-theater-3d)]: the model of an
// equipment object (`eqip`), for the 3D viewer's model library.
//
// The pickup object of an equipment (the one the film creates on the ground or on a power-up pad,
// named by its GlobalID; `equipement_energie.go` pairs it with the carried object) is a tag of the
// `eqip` group in the `globals`/`common` modules, and its model resolves like a weapon's
// (`eqip` -> `hlmt` -> `mode`/`rtgo`, "default" variant). Same frame as a weapon model: Halo axes,
// model origin, world scale.
package himap

import "context"

// GroupeEquipement : the group of equipment object tags.
const GroupeEquipement = "eqip"

// Equipement returns the mesh of the model of the equipment object `eqip`, materials and textures
// resolved; ErrSansModele when it is not an `eqip` of these modules or has no readable model.
func (a *Arsenal) Equipement(ctx context.Context, eqip uint32) (*MaillageMonde, error) {
	return a.objet(ctx, eqip, GroupeEquipement)
}
