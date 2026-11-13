/**
 * actionLayers3d.ts — LES CALQUES D'ACTION d'une scène 3D, dans leur ordre de pose.
 *
 * Les véhicules d'abord : ils répondent de la place des joueurs embarqués, que les autres calques
 * (morts, objets portés) relisent dans la même image.
 */
import { ActionScene3d, type ActionContext } from './actionScene3d'
import { Deaths3dLayer } from './deaths3d'
import { Equipment3dLayer } from './equipment3d'
import { Flights3dLayer } from './flights3d'
import { HeldWeapons3d } from './heldWeapon3d'
import { Objectives3dLayer } from './objectives3d'
import { Pickups3dLayer } from './pickups3d'
import { Shots3dLayer } from './shots3d'
import { Vehicles3dLayer } from './vehicles3d'

export function buildActionScene(ctx: ActionContext): ActionScene3d {
  const layers = [
    new Vehicles3dLayer(ctx),
    new Pickups3dLayer(ctx),
    new Equipment3dLayer(ctx),
    // L'allégeance et les interrupteurs par famille se relisent à chaque image (point de vue, tiroir).
    new Objectives3dLayer(ctx, {
      get allegiance() {
        return ctx.inputs().allegiance
      },
      families: () => {
        const { flags, vipCrown, bombCarrier } = ctx.inputs().show
        return { flags, vipCrown, bombCarrier }
      },
    }),
    new Shots3dLayer(ctx),
    new Flights3dLayer(ctx),
    new Deaths3dLayer(ctx),
  ]
  return new ActionScene3d(ctx, layers, new HeldWeapons3d(ctx.doc, () => ctx.inputs().locale))
}
