// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * reloadStarts.ts — WHICH OF THE FILM'S `reload` ACTIONS START A RELOAD, AND WHICH END ONE.
 *
 * The film writes the game's `weapon_reload` message (`doc.actions`, kind `reload`) in two shapes:
 *   - ONCE at an instant: the player starts a reload. Measured on the seven stored matches
 *     (2026-11-14): 894 of 1,289 such instants are followed within 4 s by a magazine that refills
 *     (`ammoReads`), the rest by a shot, a melee or a death that cuts the reload short.
 *   - TWO OR MORE TIMES for the same life at the same millisecond: no reload starts. 11 of 753 such
 *     instants are followed by a refill that no later single message explains. They land on what
 *     takes the hands: every carried-equipment activation (81 of 81, `carriedEquipment[].uses`),
 *     melees (391), slides (157) and some thruster pushes.
 * So a repeated instant is never a reload start, whatever caused it, and no animation or sound of
 * a reload starts there; it is the instant the hands leave the weapon, so a reload under way ends
 * there (`cuts`).
 */
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

/** A life's reload messages, read: the reload starts and the instants that end a reload, in ms, sorted. */
export interface ReloadReading {
  starts: number[]
  cuts: number[]
}

/** reloadReadings — each life's reload starts and reload cuts (`ReloadReading`), by slot. */
export function reloadReadings(doc: Pick<ReplayDocumentReady, 'actions'>): Map<number, ReloadReading> {
  const count = new Map<number, Map<number, number>>()
  for (const a of doc.actions) {
    if (a.kind !== 'reload') continue
    let bySlot = count.get(a.slot)
    if (!bySlot) count.set(a.slot, (bySlot = new Map()))
    bySlot.set(a.ms, (bySlot.get(a.ms) ?? 0) + 1)
  }
  const out = new Map<number, ReloadReading>()
  for (const [slot, byMs] of count) {
    const reading: ReloadReading = { starts: [], cuts: [] }
    for (const [ms, n] of byMs) (n === 1 ? reading.starts : reading.cuts).push(ms)
    reading.starts.sort((a, b) => a - b)
    reading.cuts.sort((a, b) => a - b)
    out.set(slot, reading)
  }
  return out
}
