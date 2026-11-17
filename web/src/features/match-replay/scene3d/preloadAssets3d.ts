// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import { assetsOf } from '../model/assetsOf'
import type { SpartanArmory } from './armory3d'
import type { WeaponModels } from './weaponModels3d'

/**
 * preloadAssets3d demande d'avance tout ce que le match montrera (`assetsOf`) : Spartan, armes,
 * grenades, armure de chaque joueur. Les chargeurs sont paresseux : les demander suffit à les lancer.
 */
export function preloadAssets3d(doc: ReplayDocumentReady, weapons: WeaponModels | null, armory: SpartanArmory | null): void {
  const assets = assetsOf(doc)
  weapons?.spartan()
  for (const id of assets.weapons) weapons?.model(id)
  for (const rank of assets.grenades) weapons?.grenade(rank)
  for (const xuid of assets.xuids) armory?.dress(xuid)
}
