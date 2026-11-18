// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * reloadMagazine.ts: THE ROUNDS LEFT IN THE HELD WEAPON'S MAGAZINE WHEN A RELOAD STARTS, from the film.
 *
 * The magazine is the last `ammoReads` read of the in-hand weapon slot (`weaponInHand`) at or before the
 * reload, minus the shots the player fired with that weapon after the read. Measured 2026-11-15 on the
 * nine stored matches: in the eight matches with per-shot reads (`src: delta`), every reload start has a
 * read before it, the median read is 0.8 to 1.5 s old and 1 to 16 starts per match have a shot after it.
 * Match 05dfe4e9 has keyframe reads only (median 8.5 s old, 169 of 397 starts without any): there the
 * subtraction of the shots carries most of the answer, and a reload between the read and this one (the
 * magazine refilled to a size the film does not give) leaves the magazine unknown.
 */
import { frameToMs, msToFrames } from '@/lib/replay/replayLogic'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import { changesInto, weaponInHand } from './weaponInHand'

/** The model key of a weapon id: its first eight hex digits, lower case. */
function modelKeyOf(id: string | undefined): string {
  return (id ?? '').replace(/^0x/i, '').slice(0, 8).toLowerCase()
}

/**
 * magazineAtReload: the rounds in the in-hand weapon's magazine at `ms`, when a reload of life `slot`
 * starts; null when the film does not say (no hand, no read, or a reload since the read). `starts`: the
 * life's reload starts in ms, sorted.
 */
export function magazineAtReload(doc: ReplayDocumentReady, slot: number, ms: number, starts: readonly number[]): number | null {
  const frame = msToFrames(ms, doc)
  const main = weaponInHand(doc, slot, frame)
  if (!main) return null
  // A read dated before the latest weapon change into the emplacement counts the replaced weapon.
  const since = changesInto(doc, slot, main.weaponSlot, frame).last
  let read: ReplayDocumentReady['ammoReads'][number] | null = null
  for (const r of doc.ammoReads) {
    if (r.slot !== slot || r.w !== main.weaponSlot || r.mag == null || r.ms > ms || r.t < since) continue
    if (!read || r.ms >= read.ms) read = r
  }
  if (!read || read.mag == null) return null
  const readMs = read.ms
  if (starts.some((d) => d > readMs && d < ms)) return null
  const key = modelKeyOf(main.id)
  let shots = 0
  for (const s of doc.shots) {
    if (s.slot !== slot || modelKeyOf(s.w) !== key) continue
    const t = frameToMs(s.t, doc) + (s.o ?? 0)
    if (t > readMs && t <= ms) shots++
  }
  return Math.max(0, read.mag - shots)
}
