// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * actionLayers3d.ts — the ACTION LAYERS of a 3D scene, in their build order.
 *
 * Vehicles come first: they own the position of their embarked players, which other layers
 * (deaths, held objects) read back in the same frame.
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
import { WeaponIdleEffects3dLayer } from './weaponIdleEffects3d'

export function buildActionScene(ctx: ActionContext): ActionScene3d {
  const layers = [
    new Vehicles3dLayer(ctx),
    new Pickups3dLayer(ctx),
    new Equipment3dLayer(ctx),
    // Allegiance and per-family toggles are re-read every frame (point of view, drawer panel).
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
    // The held weapons' idle particle effects (the Shock Rifle's electricity), from their tags.
    new WeaponIdleEffects3dLayer(ctx),
    new Flights3dLayer(ctx),
    new Deaths3dLayer(ctx),
  ]
  return new ActionScene3d(ctx, layers, new HeldWeapons3d(ctx.doc, () => ctx.inputs().locale))
}
