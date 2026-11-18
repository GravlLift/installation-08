// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * spawnAmmo.ts: THE MAGAZINE AND RESERVE A WEAPON HOLDS AT SPAWN, measured in the film itself.
 *
 * WHY. The film sends a weapon's ammo on change (a per-shot delta) and in keyframes about every
 * 20 s. A Spartan who spawns and does not fire has neither: on Streets (f5454b2a) 100 of 151 lives
 * with a birth loadout have no inventory reading before their first shot, and the HUD showed no ammo
 * count for up to ten seconds after a respawn (R One Oh 7's third life, frames 2376 to 2668).
 *
 * WHERE THE NUMBER COMES FROM. Every life the film reads by keyframe BEFORE anything moved its ammo
 * (no shot, no per-shot read, no weapon change since its birth) gives the spawn state of each weapon
 * of its birth loadout. Measured on the stored films (2026-11-18): the spawn magazine agrees across
 * lives (0x6ACDC44D reads 15 | 45 in 50 of 50 lives on f5454b2a; 0x48C19D2D reads a magazine of 36
 * in 126 of 126 on 1a521d10, its reserve 108 in 122 and 216 in 4). The value a strict majority of
 * those lives read is kept, per field; a field without one is left out rather than guessed.
 *
 * HOW LONG IT HOLDS. The measurement above stays conservative (per life), but the AMMO ITSELF is
 * valid per EMPLACEMENT: the birth weapon of an emplacement keeps its spawn ammo until something
 * moves THAT weapon's ammo specifically. A shot fired with it, a non-kf ammo read of it, or a
 * pickup/swap that puts a different weapon object into its emplacement ends it; a plain switch to
 * the other carried weapon does not, because the switch moves no magazine.
 */
import { trackWindow } from '@/lib/replay/replayLogic'
import { LOADOUT_SRC_BIRTH } from '@/lib/replay/rosterLogic'
import type { ReplayDocumentReady, ReplayTrackReady } from '@/lib/replay/replayNormalize'
import { weaponInHand } from './weaponInHand'

/** A weapon's ammo at spawn; a field is absent when the film's spawn reads do not agree on it. */
export interface SpawnAmmo {
  mag?: number
  res?: number
}

/** A life read from its birth loadout: its weapons by emplacement, and when its ammo first moved. */
export interface SpawnLife {
  /** The birth loadout's weapon at each emplacement (`loadouts[].k`). */
  weapons: Map<number, string>
  /** The first frame of the life with a shot, a per-shot ammo read or a weapon change; Infinity: none. */
  settled: number
  /** The first frame that moved the birth weapon of each emplacement; Infinity: never moved. */
  settledByEmplacement: Map<number, number>
}

/** The film's spawn reads of its weapons, and its lives read from their birth loadout. */
export interface SpawnAmmoIndex {
  byWeapon: Map<string, SpawnAmmo>
  lives: Map<ReplayTrackReady, SpawnLife>
}

/** A weapon identifier in one spelling (`0x` and upper case), the loadout rows' and the pickups' alike. */
export function weaponKey(id: string): string {
  return /^(0x)?[0-9a-f]+$/i.test(id) ? `0x${id.replace(/^0x/i, '').toUpperCase()}` : id
}

/** The value read by a strict majority of `values`; undefined without one. */
function majority(values: readonly number[]): number | undefined {
  const counts = new Map<number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  for (const [v, n] of counts) if (n * 2 > values.length) return v
  return undefined
}

/** The weapon family of a shot's 64-bit weapon id (`0xFFFFFFFFVVVVVVVV` -> `0xFFFFFFFF`), the form of a loadout row. */
function familyOf(w: string): string {
  const m = /^0x([0-9a-f]{8})/i.exec(w)
  return m ? `0x${m[1].toUpperCase()}` : w
}

/** spawnAmmoIndex measures the spawn ammo of every birth-loadout weapon of the film. */
export function spawnAmmoIndex(doc: ReplayDocumentReady): SpawnAmmoIndex {
  const lives = new Map<ReplayTrackReady, SpawnLife>()
  const samples = new Map<string, { mag: number[]; res: number[] }>()
  for (const track of doc.tracks) {
    const { start, end } = trackWindow(track)
    const inLife = (x: { slot: number; t: number }) => x.slot === track.slot && x.t >= start && x.t <= end
    const birth = doc.loadouts.find((l) => inLife(l) && l.src === LOADOUT_SRC_BIRTH)
    if (!birth) continue
    const weapons = new Map<number, string>()
    birth.w.forEach((id, i) => weapons.set(birth.k?.[i] ?? i, weaponKey(id)))
    let settled = Infinity
    for (const s of doc.shots) if (inLife(s) && s.t < settled) settled = s.t
    for (const c of doc.weaponChanges) if (inLife(c) && c.t < settled) settled = c.t
    for (const r of doc.ammoReads) if (r.src !== 'kf' && inLife(r) && r.t < settled) settled = r.t
    // Per emplacement: the first frame that moved the birth weapon sitting in it. A plain switch
    // to the other carried weapon moves no magazine, so it settles nothing.
    const settledByEmplacement = new Map<number, number>()
    for (const e of weapons.keys()) settledByEmplacement.set(e, Infinity)
    const settle = (e: number, t: number) => {
      if (weapons.has(e) && t < (settledByEmplacement.get(e) ?? Infinity)) settledByEmplacement.set(e, t)
    }
    const settleAll = (t: number) => { for (const e of weapons.keys()) settle(e, t) }
    // A shot fired with the birth weapon of an emplacement settles it. Shots carry no emplacement,
    // so the weapon in hand at the shot's frame names it; a shot the hand cannot place is matched
    // against the loadout by the family its own id names. A vehicle shot names the vehicle's
    // weapon, not a carried one.
    for (const s of doc.shots) {
      if (!inLife(s) || s.v != null) continue
      const hand = weaponInHand(doc, s.slot, s.t)
      if (hand) { settle(hand.weaponSlot, s.t); continue }
      if (!s.w) continue
      const id = weaponKey(familyOf(s.w))
      for (const [e, born] of weapons) if (born === id) settle(e, s.t)
    }
    // A non-kf ammo read names its emplacement: the magazine that moved is its in-hand one.
    for (const r of doc.ammoReads) if (r.src !== 'kf' && inLife(r)) settle(r.w, r.t)
    // A weapon change into a named emplacement settles that one; a change without a slot name
    // cannot be placed, so it settles every emplacement.
    for (const c of doc.weaponChanges) {
      if (!inLife(c)) continue
      if (c.k == null) settleAll(c.t)
      else settle(c.k, c.t)
    }
    // A native weapon pickup carries no emplacement, so it settles every emplacement, except when
    // a weapon change of the same life saw the same gesture (settled above, at its emplacement).
    for (const p of doc.pickups) {
      if (p.kind !== 'weapon' || !inLife(p)) continue
      const covered = doc.weaponChanges.some((c) => c.kind !== 'dropped' && c.slot === p.slot && c.w === p.w && Math.abs(c.t - p.t) <= 5)
      if (covered) continue
      settleAll(p.t)
    }
    lives.set(track, { weapons, settled, settledByEmplacement })
    const read = doc.inventory
      .filter((r) => inLife(r) && !r.empty && r.t < settled)
      .sort((a, b) => a.t - b.t)[0]
    if (!read) continue
    for (const [e, id] of weapons) {
      const am = read.am?.[e]
      if (!am) continue
      const s = samples.get(id) ?? { mag: [], res: [] }
      if (am.mag != null) s.mag.push(am.mag)
      if (am.res != null) s.res.push(am.res)
      samples.set(id, s)
    }
  }
  const byWeapon = new Map<string, SpawnAmmo>()
  for (const [id, s] of samples) {
    const ammo: SpawnAmmo = { mag: majority(s.mag), res: majority(s.res) }
    if (ammo.mag != null || ammo.res != null) byWeapon.set(id, ammo)
  }
  return { byWeapon, lives }
}

/**
 * spawnAmmoAt: the ammo of the weapon in hand at `frame` of `life`, while nothing has moved THAT
 * emplacement's spawn weapon since the spawn: the hand holds the birth loadout's weapon of
 * emplacement `weaponSlot`, and no shot fired with it, non-kf read of it or weapon change into it
 * is dated before `frame`. A plain switch to the other carried weapon does not end it. Null
 * otherwise.
 */
export function spawnAmmoAt(
  index: SpawnAmmoIndex,
  life: ReplayTrackReady,
  frame: number,
  held: { id: string; weaponSlot: number },
): SpawnAmmo | null {
  const spawn = index.lives.get(life)
  if (!spawn) return null
  const id = spawn.weapons.get(held.weaponSlot)
  if (!id || id !== weaponKey(held.id)) return null
  if (frame > (spawn.settledByEmplacement.get(held.weaponSlot) ?? Infinity)) return null
  return index.byWeapon.get(id) ?? null
}
