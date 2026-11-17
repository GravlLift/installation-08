// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * riggedWeapons3d.ts — THE MODEL KEYS OF THE FIRST-PERSON RIGS A MATCH USES.
 *
 * A rig loads on its weapon's first request: for the loading screen to cover it, the scene
 * requests it ahead of time for EVERY weapon carried by a player of the match (the viewer
 * switches the followed player). A carried weapon is carried either in a loadout (`loadouts`) or
 * through a weapon change (`weaponChanges`, whose `from` names the weapon given up): this is the
 * full union of what is carried. Weapons fired or dropped were carried first; map pads are
 * spawns, never carried weapons, and so do not enter here.
 */
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import { weaponModelKey } from './weaponModels3d'

/**
 * clesRigsRejeu: the model keys (`weaponModelKey`) of weapons carried by a player of the match,
 * with no duplicate; ids with no key (grenades and others) are dropped.
 */
export function clesRigsRejeu(doc: ReplayDocumentReady): readonly string[] {
  const keys = new Set<string>()
  const add = (id?: string) => { const key = id && weaponModelKey(id); if (key) keys.add(key) }
  for (const loadout of doc.loadouts) for (const id of loadout.w) add(id)
  for (const change of doc.weaponChanges) { add(change.w); add(change.from) }
  return [...keys]
}
