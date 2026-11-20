// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * shockBurst3d.ts — THE ROUNDS OF A BURST WEAPON'S TRIGGER PULL, placed from the film and the tag,
 * and which of them hit whom. Pure: no scene, no clock but the document's.
 *
 * THE TAG (`weaponicons.ReadBarrelShot`, the library's `shot_effects`): the Shock Rifle's barrel fires
 * `shotsPerFire` 3 shots a pull at `roundsPerSecond` 60 (1/60 s apart), one projectile each, no error
 * angle, then waits `fireRecovery` 1 s.
 *
 * THE FILM (measured 2026-11-20 on match 9220185c, 31 Shock Rifle shot records, 30 damages):
 * - a shot record is ONE ROUND, not one pull: within a pull, records lie 14 to 20 ms apart (the
 *   1/60 s of the tag on the film's 33 ms grid), or 33 to 36 ms apart when one between them is
 *   missing; pulls lie at least 1 s apart (the tag's fire recovery);
 * - the film does not publish every round: of 12 pulls, 6 have three records, 5 two, 1 one. A
 *   missing round is placed at its rank's time (the rank read from its neighbours' spacing);
 * - a damage from the shooter is one round's hit, on the round's frame or the next (the pairing the
 *   shield impacts measured, `shieldImpacts3d.pairShot`): the demo-9 kill's pull (7684+30 ms and
 *   7686) has damages at 7684, 7685 and 7686, one per round, the middle record missing;
 * - a damage gives the victim and the frame, not the instant or the point: a round's hit instant is
 *   its fire instant plus its flight at the projectile's speed (5000 u/s: 2 ms over the demo-9
 *   kill's 10.6 u, inside the damage's frame).
 *
 * FILLS, not read:
 * - a pull's first record is its first round (a pull whose first round has no record places its
 *   rounds one rank late);
 * - a missing round flies along the aim of its neighbours, interpolated by rank.
 */
import type { ShotFxEntry } from '../model/shotFx'

/** What the tag says of a pull (`WeaponShot`). */
export interface BurstSpec {
  /** Rounds a pull fires (the tag's shots per fire; its upper bound). */
  shots: number
  /** Rounds a second within the pull. */
  roundsPerSecond: number
}

/** One round of a pull. */
export interface BurstRound {
  /** Rank in the pull (0 the first). */
  k: number
  /** The round's shot record; null when the film has none for it. */
  e: ShotFxEntry | null
  /** Fractional frame the round is fired at. */
  time: number
}

/** One pull: its rounds in rank order, the first record its leader. */
export interface Burst {
  leader: ShotFxEntry
  rounds: BurstRound[]
}

/** A round's spacing in frames. */
export function roundFrames(spec: BurstSpec, msPerFrame: number): number {
  return 1000 / Math.max(1e-6, spec.roundsPerSecond) / msPerFrame
}

/**
 * groupBursts groups one shooter's shot records (`entries`, sorted by time) into pulls: a record
 * belongs to the current pull while it lies within the pull's last round's time plus half a round
 * of its first record; its rank is its spacing from the first record in rounds. Records of one rank
 * already taken take the next free rank; past the last, a new pull starts.
 */
export function groupBursts(entries: readonly ShotFxEntry[], spec: BurstSpec, msPerFrame: number): Burst[] {
  const step = roundFrames(spec, msPerFrame)
  const shots = Math.max(1, Math.floor(spec.shots))
  const out: Burst[] = []
  let cur: { leader: ShotFxEntry; byRank: (ShotFxEntry | null)[] } | null = null
  const close = () => {
    if (!cur) return
    const leader = cur.leader
    out.push({ leader, rounds: cur.byRank.map((e, k) => ({ k, e, time: e ? e.time : leader.time + k * step })) })
    cur = null
  }
  for (const e of entries) {
    if (cur) {
      const d = e.time - cur.leader.time
      let k = Math.round(d / step)
      while (k < shots && cur.byRank[k]) k++
      if (d <= (shots - 0.5) * step && k < shots) {
        cur.byRank[k] = e
        continue
      }
      close()
    }
    const byRank: (ShotFxEntry | null)[] = Array.from({ length: shots }, () => null)
    byRank[0] = e
    cur = { leader: e, byRank }
  }
  close()
  return out
}

/** A damage the film gives: the victim's slot, its author, its frame. */
export interface BurstDamage {
  t: number
  slot: number
  by?: number | null
}

/** A round's hit on a player: the victim's slot and the damage's frame. */
export interface RoundHit {
  victim: number
  frame: number
}

/**
 * burstHits pairs a pull's rounds with its shooter's damages (`damages`: that shooter's, sorted by
 * frame): in rank order, each round takes the first damage not yet taken on its fire frame or the
 * next. Returns, per rank, its hit or null (a round with no damage missed every player).
 */
export function burstHits(b: Burst, damages: readonly BurstDamage[], used: Set<BurstDamage> = new Set()): (RoundHit | null)[] {
  return b.rounds.map((r) => {
    const f = Math.floor(r.time)
    const d = damages.find((x) => !used.has(x) && x.t >= f && x.t <= f + 1 && x.slot !== x.by)
    if (!d) return null
    used.add(d)
    return { victim: d.slot, frame: d.t }
  })
}

/** aimAt: a missing round's heading and pitch, between the records around it, by rank (FILL, header). */
export function aimAt(b: Burst, k: number, aim: (e: ShotFxEntry) => { h: number; p: number } | null): { h: number; p: number } | null {
  let lo: { k: number; a: { h: number; p: number } } | null = null
  let hi: { k: number; a: { h: number; p: number } } | null = null
  for (const r of b.rounds) {
    const a = r.e ? aim(r.e) : null
    if (!a) continue
    if (r.k <= k) lo = { k: r.k, a }
    if (r.k >= k && !hi) hi = { k: r.k, a }
  }
  if (!lo) return hi?.a ?? null
  if (!hi || hi.k === lo.k) return lo.a
  const u = (k - lo.k) / (hi.k - lo.k)
  // The heading's shorter turn.
  const dh = ((((hi.a.h - lo.a.h) % 360) + 540) % 360) - 180
  return { h: lo.a.h + dh * u, p: lo.a.p + (hi.a.p - lo.a.p) * u }
}
