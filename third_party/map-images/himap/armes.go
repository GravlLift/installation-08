// Package himap — armes.go : les modeles des armes (et des projectiles de grenade, grenades.go), un
// maillage par objet, pour le rejeu 3D.
//
// L'identifiant d'arme du film (famille d'un loadout, d'un socle, d'une arme au sol) EST le
// GlobalID du tag `weap` du jeu. Son modele se resout comme celui d'un objet du scenario
// (`modeleDuPlacement` : `weap` -> `hlmt` -> `mode`), dans sa variante « default ». Les armes vivent
// dans les modules `globals` et `common`, que l'index d'une carte installee couvre
// (`GeometrySearchPathMonde`) : un arsenal ouvre cet index une fois et rend autant d'armes qu'on
// lui en demande.
//
// REPERE : celui du modele, en axes Halo (X vers l'avant du canon, Y a gauche, Z vers le haut),
// origine a la poignee ; l'echelle est celle du monde (une unite ~ 3 m).
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
)

// GroupeArme : le groupe des tags d'arme.
const GroupeArme = "weap"

// varianteDefaut : le StringID « default », la variante de modele d'une arme sans habillage.
const varianteDefaut uint32 = 0x42c9679f

// ErrSansModele : le tag n'est pas une arme de ces modules, ou son modele n'est pas lisible.
var ErrSansModele = errors.New("himap: weapon without a readable model")

// Arsenal : les index ouverts sur une carte installee, d'ou se lisent les modeles d'arme.
type Arsenal struct {
	geo  *ModuleIndex
	mats *ModuleIndex
	// surfaceCote (LOCAL-CHANGE (infinite-theater-3d)): la cote de lecture des surfaces dures
	// des armes et des rigs, posee par SurfaceCote. Zero = coteSurface (256).
	surfaceCote int
}

// SurfaceCote (LOCAL-CHANGE (infinite-theater-3d)) : la cote de lecture des surfaces dures
// des armes et des rigs. Zero ou absent = coteSurface (256, comme avant).
func (a *Arsenal) SurfaceCote(cote int) { a.surfaceCote = cote }

// OuvreArsenal ouvre les index de geometrie et de materiaux du module de carte `cheminModule`.
func OuvreArsenal(racineDeploy, cheminModule string) (*Arsenal, error) {
	chemins, err := GeometrySearchPathMonde(racineDeploy, cheminModule)
	if err != nil {
		return nil, err
	}
	geo, err := NewModuleIndex(chemins...)
	if err != nil {
		return nil, fmt.Errorf("geometry index: %w", err)
	}
	cheminsMat, err := CheminsMateriaux(racineDeploy, cheminModule)
	if err == nil {
		var mats *ModuleIndex
		if mats, err = NewModuleIndex(cheminsMat...); err == nil {
			return &Arsenal{geo: geo, mats: mats}, nil
		}
	}
	return nil, errors.Join(fmt.Errorf("material index: %w", err), geo.Close())
}

// Close ferme les index.
func (a *Arsenal) Close() error {
	return errors.Join(a.geo.Close(), a.mats.Close())
}

// Arme rend le maillage du modele de l'arme `weap`, materiaux et textures resolus ;
// ErrSansModele quand il n'y en a pas.
func (a *Arsenal) Arme(ctx context.Context, weap uint32) (*MaillageMonde, error) {
	return a.objet(ctx, weap, GroupeArme)
}

// Vehicule returns the vehicle's default model in its local frame.
// LOCAL-CHANGE (infinite-theater-3d): expose vehicle geometry to the replay library.
func (a *Arsenal) Vehicule(ctx context.Context, vehi uint32) (*MaillageMonde, error) {
	return a.objet(ctx, vehi, GroupeVehi)
}

// MarqueursVehicule returns named markers in the vehicle model's frame.
// LOCAL-CHANGE (infinite-theater-3d): place replay occupants on the game's seat markers.
func (a *Arsenal) MarqueursVehicule(ctx context.Context, vehi uint32, noms map[uint32]bool) ([]MarqueurArme, error) {
	if g, _, ok := a.geo.Lookup(vehi); !ok || g != GroupeVehi {
		return nil, fmt.Errorf("%w: %08x is not a vehicle", ErrSansModele, vehi)
	}
	raw, err := a.geo.Extract(vehi)
	if err != nil {
		return nil, err
	}
	mode, group, ok := RefModeleVehicule(ctx, a.geo, raw)
	if !ok || group != GroupeMode {
		return nil, ErrSansModele
	}
	return a.MarqueursDuModele(mode, noms)
}

// objet rend le maillage du modele de l'objet `id`, un tag du groupe `groupe` (arme, projectile).
func (a *Arsenal) objet(ctx context.Context, id uint32, groupe string) (*MaillageMonde, error) {
	if g, _, ok := a.geo.Lookup(id); !ok || g != groupe {
		return nil, fmt.Errorf("%w: %08x is not a %q tag", ErrSansModele, id, groupe)
	}
	mp := modeleDuPlacement(ctx, a.geo, id, varianteDefaut)
	if mp == nil {
		return nil, fmt.Errorf("%w : %08x", ErrSansModele, id)
	}
	m := &MaillageMonde{avecNormales: true} // LOCAL-CHANGE (infinite-theater-3d): geometry_normales.go
	m.poseModele(mp, PlacementScenario{Echelle: 1}.Instance())
	// Les projecteurs d'ombre d'une arme ne servent a aucune vue : la vue projette l'ombre du modele.
	m.Ombre = GroupeMaillage{}
	if m.Structure.Triangles() == 0 {
		return nil, fmt.Errorf("%w: %08x without a visible triangle", ErrSansModele, id)
	}
	// LOCAL-CHANGE (infinite-theater-3d): the arsenal's surface cap for hard-surface textures.
	m.surfaceCote = a.surfaceCote
	m.lisMateriaux(a.mats, a.geo)
	m.resoutTextures(ctx, a.geo)
	slog.InfoContext(ctx, "object read", "group", groupe, "id", fmt.Sprintf("%08x", id), "triangles", m.Structure.Triangles(),
		"materiaux", len(m.Materiaux), "materiauxIllisibles", m.MateriauxIllisibles,
		"textures", len(m.TexturesCouches), "texturesIllisibles", m.TexturesCouchesIllisibles)
	return m, nil
}
