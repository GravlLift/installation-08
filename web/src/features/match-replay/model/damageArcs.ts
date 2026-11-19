// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * damageArcs.ts — THE DATA BEHIND THE HUD'S DIRECTIONAL DAMAGE INDICATOR.
 *
 * In the game, when the player takes damage, a red arc appears on a ring around the reticle,
 * centered on the direction the damage came from, and it follows the player's view as they
 * turn. This file is ONLY the data: at a frame, which arcs are live for the followed player,
 * at what bearing relative to their view, and how old they are. The drawing comes later, once
 * the game's own art and timing are found — nothing here draws.
 *
 * The SOURCE of an arc is the attacker's position at the DAMAGE FRAME (fixed in the world);
 * the victim's position and heading are read at the CURRENT frame, so the arc swings as the
 * player turns or moves, as in the game.
 */
import { frameToMs, isAliveAt, positionAt } from '@/lib/replay/replayLogic'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import { headingAt } from './headingInterp'

/** One live damage arc of the HUD's ring. */
export interface DamageArc {
  /** Bearing of the attacker, in degrees, clockwise from straight ahead; positive = to the RIGHT. */
  bearingDeg: number
  /** Age of the hit, in milliseconds. */
  ageMs: number
  /** The track slot of the attacker (its life, on this document). */
  by: number
}

/** Placeholder lifetime of an arc, NOT measured from the game: replace once the HUD's own timing is decoded. */
export const DAMAGE_ARC_MS = 1000

type DamageEntry = NonNullable<ReplayDocumentReady['damages']>[number]

/** Built once per document (the per-frame call must not rescan every damage of the match): the damages by victim slot. */
const damagesBySlot = new WeakMap<ReplayDocumentReady, ReadonlyMap<number, readonly DamageEntry[]>>()

function indexDamages(doc: ReplayDocumentReady): ReadonlyMap<number, readonly DamageEntry[]> {
  let index = damagesBySlot.get(doc)
  if (!index) {
    const fresh = new Map<number, DamageEntry[]>()
    for (const damage of doc.damages) {
      const list = fresh.get(damage.slot) ?? []
      list.push(damage)
      fresh.set(damage.slot, list)
    }
    index = fresh
    damagesBySlot.set(doc, index)
  }
  return index
}

/**
 * damageArcsAt — the damage arcs live at `frame` for the life of `slot` (the followed
 * player's CURRENT life track slot, what `readHud` calls `slot`).
 *
 * Live: damaged at or before `frame`, within `DAMAGE_ARC_MS`, the attacker known (`by`) and
 * not the player themselves, the attacker locatable at the damage frame, the victim
 * locatable and oriented at `frame`. Several hits from the same attacker inside the window
 * keep only the NEWEST one: one arc per attacker.
 */
export function damageArcsAt(doc: ReplayDocumentReady, slot: number, frame: number): DamageArc[] {
  const now = frameToMs(frame, doc)
  const victim = positionAt(doc.tracks.find((t) => t.slot === slot)?.points ?? [], frame)
  const heading = headingAt(doc.tracks.find((t) => t.slot === slot)?.points ?? [], frame)
  if (!victim || heading == null) return []
  const best = new Map<number, NonNullable<ReplayDocumentReady['damages']>[number]>()
  for (const damage of indexDamages(doc).get(slot) ?? []) {
    if (damage.t > frame || now - frameToMs(damage.t, doc) >= DAMAGE_ARC_MS) continue
    const by = damage.by
    if (by == null || by === slot) continue
    // The newest hit per attacker wins (the document is not necessarily sorted by time).
    const current = best.get(by)
    if (current == null || damage.t >= current.t) best.set(by, damage)
  }
  const h = (heading * Math.PI) / 180
  const arcs: DamageArc[] = []
  for (const [by, damage] of best) {
    const attacker = doc.tracks.find((t) => t.slot === by)
    if (!attacker || !isAliveAt(attacker, damage.t)) continue
    const source = positionAt(attacker.points, damage.t)
    if (!source) continue
    // The bearing clockwise from straight ahead, in (-180, 180]: the convention of `spatialOf` in
    // soundSpatial.ts — right = (sin h, -cos h), forward = (cos h, sin h), so `side` is the
    // component along the right and `ahead` the one along the forward.
    const dx = source.x - victim.x
    const dy = source.y - victim.y
    const side = dx * Math.sin(h) - dy * Math.cos(h)
    const ahead = dx * Math.cos(h) + dy * Math.sin(h)
    arcs.push({ bearingDeg: (Math.atan2(side, ahead) * 180) / Math.PI, ageMs: now - frameToMs(damage.t, doc), by })
  }
  return arcs
}
