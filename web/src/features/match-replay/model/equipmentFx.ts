// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * equipmentFx.ts — THE ACTIVE STATE OF AN EQUIPMENT on the player card, read in the episodes.
 *
 * THE SOURCE is the document (schema 7): `equipmentEpisodes`, episodes dated PER LIFE
 * (slot) on the frame axis — the only two families whose state is MEASURED on the film side
 * (camouflage: i28 queue[1], binary switch; overshield: i5 unclamped, rule
 * q > 64). The DURATION of the effect IS the episode: active exactly when the frame is in
 * [t0, t1], no invented remanence.
 *
 * THE EFFECT ATTACHES TO THE CARD BY THE LIFE (slot -> card), the same chain as the death
 * flash: `playerStateAt` gives the current life, its slot designates the episodes. An episode
 * closes at the latest at death (the document guarantees it), so a dead card never
 * has an equipment effect.
 *
 * No React, no canvas: pure logic, tested (equipmentFx.test.ts).
 */
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'

/**
 * The two families published by the document. STABLE identifiers of the contract (`fam`) —
 * an unknown family receives NO effect, never that of a neighbor.
 */
export const EQUIP_FAMILY_CAMO = 'camo'
export const EQUIP_FAMILY_OVERSHIELD = 'overshield'

/** What the card must say at a frame: each active family, independently. */
export interface ActiveEquipment {
  camo: boolean
  overshield: boolean
}

/** No allocation per frame: the « nothing active » value is shared. */
const NONE: ActiveEquipment = Object.freeze({ camo: false, overshield: false })

/**
 * activeEquipmentAt says which families are active for a SLOT at a frame.
 *
 * The search is on the slot, never on the player — a slot is a life, and that is what
 * makes the reading safe: an episode cannot outlive its carrier. The episodes
 * are few in number (tens per film): the linear sweep per frame stays negligible
 * next to the render.
 */
export function activeEquipmentAt(
  doc: ReplayDocumentReady,
  slot: number,
  frame: number,
): ActiveEquipment {
  let camo = false
  let overshield = false
  for (const e of doc.equipmentEpisodes) {
    if (e.slot !== slot || frame < e.t0 || frame > e.t1) continue
    if (e.fam === EQUIP_FAMILY_CAMO) camo = true
    else if (e.fam === EQUIP_FAMILY_OVERSHIELD) overshield = true
    if (camo && overshield) break
  }
  if (!camo && !overshield) return NONE
  return { camo, overshield }
}
