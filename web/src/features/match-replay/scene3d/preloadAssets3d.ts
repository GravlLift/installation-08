// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import { assetsOf } from '../model/assetsOf'
import type { SpartanArmory } from './armory3d'
import type { WeaponModels } from './weaponModels3d'

/**
 * preloadAssets3d requests ahead of time everything the match will show (`assetsOf`): Spartan,
 * weapons, grenades, each player's armor. The loaders are lazy: requesting them is enough to
 * launch them.
 */
export function preloadAssets3d(doc: ReplayDocumentReady, weapons: WeaponModels | null, armory: SpartanArmory | null): void {
  const assets = assetsOf(doc)
  weapons?.spartan()
  for (const id of assets.weapons) weapons?.model(id)
  for (const rank of assets.grenades) weapons?.grenade(rank)
  for (const xuid of assets.xuids) armory?.dress(xuid)
}
