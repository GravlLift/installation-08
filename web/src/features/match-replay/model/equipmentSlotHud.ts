// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * equipmentSlotHud.ts — THE HUD'S EQUIPMENT SLOT: what the followed player carries at a frame, as
 * the game's bottom-right slot beside the grenades shows it (the equipment's icon and the uses left).
 *
 * THE EQUIPMENT CARRIED is `abilityAt` (the `abilities` readings refined by `equipmentChanges`): it
 * appears with the pickup (`taken`), changes with the next pickup, and is gone once spent (`spent`)
 * or with the life. A reading AHEAD of the frame never shows: the slot does not hold an equipment
 * before it is picked up.
 *
 * THE USES LEFT come from the two channels that count them, never from a guess:
 *   - `carriedEquipment[].energy[].n` for the families counted by energy (the game's HUD rule,
 *     uses = trunc(energy / cost), cost from the tags), read on the carried object of that rank
 *     whose window covers the frame;
 *   - `abilityCharges` for the grapple and the thruster (whole charges, read on change).
 * Neither = no count is shown (`uses: null`), the icon alone.
 */
import { trackWindow } from '@/lib/replay/replayLogic'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import { abilityAt, currentLifeOf } from '@/lib/replay/rosterLogic'

/** EquipmentSlot — the equipment in the HUD slot at a frame. */
export interface EquipmentSlot {
  /** The palette rank (`abilityLabels` key). */
  rank: number
  /** The uses left, null when no channel counts them. */
  uses: number | null
}

/** equipmentSlotAt — the equipment in the HUD slot of life `slot` at `frame`, null when it is empty. */
export function equipmentSlotAt(doc: ReplayDocumentReady, slot: number, frame: number): EquipmentSlot | null {
  const carried = abilityAt(doc, slot, frame)
  if (!carried || carried.age < 0) return null
  return { rank: carried.rank, uses: energyUses(doc, slot, carried.rank, frame) ?? chargeUses(doc, slot, carried.rank, frame) }
}

/** latestAt — the entry with the greatest `t` at or before `frame` among those `keep` accepts. */
function latestAt<T extends { t: number }>(list: readonly T[], frame: number, keep: (v: T) => boolean): T | null {
  let last: T | null = null
  for (const v of list) if (v.t <= frame && keep(v) && (!last || v.t >= last.t)) last = v
  return last
}

/** energyUses — the uses left read on the carried object of this life and rank covering `frame`. */
function energyUses(doc: ReplayDocumentReady, slot: number, rank: number, frame: number): number | null {
  for (const c of doc.carriedEquipment) {
    if (c.slot !== slot || c.r !== rank || frame < c.t0 || (c.t1 !== undefined && frame > c.t1)) continue
    const read = latestAt(c.energy, frame, (e) => e.n != null)
    if (read?.n != null) return read.n
  }
  return null
}

/** chargeUses — the last whole-charge reading of this life for the rank's family. */
function chargeUses(doc: ReplayDocumentReady, slot: number, rank: number, frame: number): number | null {
  const family = doc.abilityLabels?.[String(rank)]?.family
  const life = family ? currentLifeOf(doc, slot, frame) : null
  if (!family || !life) return null
  const start = trackWindow(life).start
  return latestAt(doc.abilityCharges, frame, (c) => c.slot === slot && c.family === family && c.t >= start)?.charges ?? null
}
