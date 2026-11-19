// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * damageArcs.ts — THE DATA BEHIND THE HUD'S DIRECTIONAL DAMAGE INDICATOR.
 *
 * In the game, when the player takes damage, a red arc appears on a ring around the reticle,
 * centered on the direction the damage came from, and it follows the player's view as they
 * turn. This file is ONLY the data: at a frame, which arcs are live for the followed player,
 * at what bearing relative to their view, how old they are, how much of each arc is revealed
 * (`meter`) and how the hit pulse has aged (`pulseMs`). The drawing is `damageArcPaint.ts`;
 * its art and geometry are the game's own, decoded from the game's UI tags.
 *
 * The SOURCE of an arc is the attacker's position at the DAMAGE FRAME (fixed in the world);
 * the victim's position and heading are read at the CURRENT frame, so the arc swings as the
 * player turns or moves, as in the game.
 */
import { frameToMs, heldReading, isAliveAt, positionAt } from '@/lib/replay/replayLogic'
import type { ReplayDocumentReady, ReplayTrackReady } from '@/lib/replay/replayNormalize'
import { headingAt } from './headingInterp'

/** One live damage arc of the HUD's ring. */
export interface DamageArc {
  /** Bearing of the attacker, in degrees, clockwise from straight ahead; positive = to the RIGHT. */
  bearingDeg: number
  /** Age of the newest hit, in milliseconds. */
  ageMs: number
  /** The track slot of the attacker (its life, on this document). */
  by: number
  /** How much of the arc is revealed: 0.15 (no damage) to 1 (full), from the chain's vitality drops. */
  meter: number
  /** Time since the newest hit, in milliseconds: the hit pulse reads this. */
  pulseMs: number
}

/**
 * An arc's lifetime, in ms. Source: the HUD globals tag `uihg`, "damage indicator response
 * duration" = 2 s. INFERRED that this global is the arc's lifetime (the screen only sees a
 * normalized lifetime; the mapping onto this 2 s is an inference, not a measurement).
 */
export const DAMAGE_ARC_MS = 2000

/** The game's ring shows at most this many arcs: the list keeps the 8 youngest. */
const MAX_ARCS = 8

type DamageEntry = NonNullable<ReplayDocumentReady['damages']>[number]
type VictimPoints = ReplayTrackReady['points']

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

/** Whether the match records `hp` at all (match-wide, as rosterLogic's presence reads it), built once per document. */
const healthRecorded = new WeakMap<ReplayDocumentReady, boolean>()
function recordsHealth(doc: ReplayDocumentReady): boolean {
  let known = healthRecorded.get(doc)
  if (known === undefined) {
    known = doc.tracks.some((t) => t.points.some((p) => p.hp !== undefined))
    healthRecorded.set(doc, known)
  }
  return known
}

/**
 * The victim's vitality at frame `f`: (shield + health) / 2, the held readings of the life's
 * `sh` and `hp` track points (carry-forward, as `playerStateAt` reads them). If the match never
 * records `hp`, the vitality is the shield alone. INFERRED that the arc's meter measures the
 * normalized vitality the chain's hits took off.
 */
function vitalityAt(points: VictimPoints, hpPresent: boolean, frame: number): number {
  // No reading yet in this life = the spawn value, full (1), as `playerStateAt` in rosterLogic
  // reads it: the track records `hp` only once health changes, i.e. after the shield broke.
  const shield = heldReading(points, frame, (p) => p.sh, Number.POSITIVE_INFINITY)?.value ?? 1
  if (!hpPresent) return shield
  const health = heldReading(points, frame, (p) => p.hp, Number.POSITIVE_INFINITY)?.value ?? 1
  return (shield + health) / 2
}

/** The arc's accumulated damage, normalized 0..1, summed across the chain's hits (newest first). */
function meterOfChain(chain: readonly DamageEntry[], victimPoints: VictimPoints, hpPresent: boolean, frame: number): number {
  let acc = 0
  for (let i = 0; i < chain.length; i++) {
    const hit = chain[i]
    // `end` is the newest of: 3 frames after the hit, one frame before the chain's NEXT (newer)
    // hit, and the current frame. The newest hit has no newer hit to bound it.
    const end = Math.min(hit.t + 3, i > 0 ? chain[i - 1].t - 1 : Number.POSITIVE_INFINITY, frame)
    acc += Math.max(0, vitalityAt(victimPoints, hpPresent, hit.t - 1) - vitalityAt(victimPoints, hpPresent, end))
  }
  return 0.15 + 0.85 * Math.min(1, Math.max(0, acc))
}

/**
 * damageArcsAt — the damage arcs live at `frame` for the life of `slot` (the followed
 * player's CURRENT life track slot, what `readHud` calls `slot`), the youngest first, 8 at most.
 *
 * Live: the attacker's NEWEST hit on this victim at or before `frame` is within `DAMAGE_ARC_MS`,
 * the attacker known (`by`) and not the player themselves, the attacker locatable at that hit,
 * the victim locatable and oriented at `frame`. One arc per attacker.
 *
 * A CHAIN: in the game an attacker's arc stays alive while hits keep coming, so the arc's hits
 * are the attacker's on this victim, going back from the newest while each gap is <
 * `DAMAGE_ARC_MS` (INFERRED). `ageMs` is the newest hit's age; `meter` is built from the
 * chain's vitality drops.
 */
export function damageArcsAt(doc: ReplayDocumentReady, slot: number, frame: number): DamageArc[] {
  const now = frameToMs(frame, doc)
  const victimPoints = doc.tracks.find((t) => t.slot === slot)?.points ?? []
  const victim = positionAt(victimPoints, frame)
  const heading = headingAt(victimPoints, frame)
  if (!victim || heading == null) return []
  const h = (heading * Math.PI) / 180
  const hpPresent = recordsHealth(doc)

  // The attacker's hits on this victim, newest first per attacker.
  const hitsByAttacker = new Map<number, DamageEntry[]>()
  for (const damage of indexDamages(doc).get(slot) ?? []) {
    if (damage.t > frame) continue
    const by = damage.by
    if (by == null || by === slot) continue
    hitsByAttacker.set(by, [...(hitsByAttacker.get(by) ?? []), damage])
  }

  const arcs: DamageArc[] = []
  for (const [by, hits] of hitsByAttacker) {
    hits.sort((a, b) => b.t - a.t) // newest first
    const newest = hits[0]
    if (now - frameToMs(newest.t, doc) >= DAMAGE_ARC_MS) continue
    // The chain: walk back from the newest while each gap stays inside the lifetime.
    const chain: DamageEntry[] = [newest]
    for (let i = 1; i < hits.length; i++) {
      if (frameToMs(hits[i - 1].t, doc) - frameToMs(hits[i].t, doc) < DAMAGE_ARC_MS) chain.push(hits[i])
      else break
    }
    const attacker = doc.tracks.find((t) => t.slot === by)
    if (!attacker || !isAliveAt(attacker, newest.t)) continue
    const source = positionAt(attacker.points, newest.t)
    if (!source) continue
    // The bearing clockwise from straight ahead, in (-180, 180]: the convention of `spatialOf` in
    // soundSpatial.ts — right = (sin h, -cos h), forward = (cos h, sin h), so `side` is the
    // component along the right and `ahead` the one along the forward.
    const dx = source.x - victim.x
    const dy = source.y - victim.y
    const side = dx * Math.sin(h) - dy * Math.cos(h)
    const ahead = dx * Math.cos(h) + dy * Math.sin(h)
    const ageMs = now - frameToMs(newest.t, doc)
    arcs.push({
      bearingDeg: (Math.atan2(side, ahead) * 180) / Math.PI,
      ageMs,
      by,
      meter: meterOfChain(chain, victimPoints, hpPresent, frame),
      pulseMs: ageMs,
    })
  }
  arcs.sort((a, b) => a.ageMs - b.ageMs) // youngest first
  return arcs.slice(0, MAX_ARCS)
}
