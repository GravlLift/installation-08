// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * pickupPlacement.ts: WHICH WEAPON EMPLACEMENT A PICKUP CHANGED, when no weapon change saw it.
 *
 * The film's native pickups (`doc.pickups`) carry no emplacement, and the weapon change channel
 * (`doc.weaponChanges`, which does) does not see every pickup. This module places the ones it
 * misses by the game's rule, so the spawn ammo (`spawnAmmo.ts`), the weapon in hand
 * (`weaponInHand.ts`) and the ammo reads it invalidates all read the same placement.
 *
 * Pure: no React, no scene.
 */
import { trackWindow } from '@/lib/replay/replayLogic'
import { LOADOUT_SRC_BIRTH } from '@/lib/replay/rosterLogic'
import type { ReplayDocumentReady, ReplayTrackReady } from '@/lib/replay/replayNormalize'

/** A weapon identifier in one spelling (`0x` and upper case), the loadout rows' and the pickups' alike. */
export function weaponKey(id: string): string {
  return /^(0x)?[0-9a-f]+$/i.test(id) ? `0x${id.replace(/^0x/i, '').toUpperCase()}` : id
}

/** The birth loadout's weapon at each emplacement of a life (`loadouts[].k`); null without one. */
export function birthWeaponsOf(doc: ReplayDocumentReady, track: ReplayTrackReady): Map<number, string> | null {
  const { start, end } = trackWindow(track)
  const birth = doc.loadouts.find((l) => l.slot === track.slot && l.t >= start && l.t <= end && l.src === LOADOUT_SRC_BIRTH)
  if (!birth) return null
  const weapons = new Map<number, string>()
  birth.w.forEach((id, i) => weapons.set(birth.k?.[i] ?? i, weaponKey(id)))
  return weapons
}

/** What an uncovered weapon pickup did to the two carried emplacements (`pickupEffects`). */
export interface PickupEffect {
  t: number
  /** The pickup's weapon family, in the `weaponChanges[].w` spelling (8 hex digits, lower case). */
  w: string
  /**
   * 'refill': the picked family is already carried, so the pickup only tops up that emplacement's
   * ammo. 'fill': a new weapon went into the empty emplacement, replacing nothing. 'replace': a new
   * weapon replaced the one in hand. 'unknown': the life's emplacements cannot be followed here.
   */
  effect: 'refill' | 'fill' | 'replace' | 'unknown'
  /** The emplacement the pickup changed (refill, fill, replace); absent for 'unknown'. */
  emplacement?: number
}

/** The hand's emplacement at a frame, as the caller locates it (`weaponInHand`, without placed pickups). */
export type HandAt = (slot: number, frame: number) => { weaponSlot: number } | null

/** The two weapon emplacements a Spartan carries (`weaponChanges[].k` 2 is an objective object). */
const CARRIED_EMPLACEMENTS = [0, 1]

/**
 * pickupEffects places every native weapon pickup of a life that no weapon change saw, by
 * following what each emplacement holds from the birth loadout through the life's weapon changes,
 * in time order, and applying the game's rule:
 *   - a family the player already carries is an ammo refill of that emplacement. Measured on five
 *     stored films (2026-11-18): 292 of the 295 uncovered weapon pickups of lives with a birth
 *     loadout are such refills, and each of the 238 with a per-shot read at its frame has that read
 *     on the emplacement holding the family, its reserve topped up (none on the other one);
 *   - a new weapon fills the empty emplacement of a player who carries only one weapon;
 *   - with both emplacements full, it replaces the weapon in hand just before the pickup, and the
 *     holstered one stays. The other 3 of the 295 are such replacements, and the film agrees each
 *     time: 0bb2ccc9 frame 10825, the in-hand 0x48C19D2D of emplacement 0 becomes the 0x80977BA5
 *     (per-shot read on emplacement 0 at the pickup; the next keyframe row reads 0x80977BA5 and the
 *     holstered 0x6ACDC44D); 41814132 frame 1357, the in-hand emplacement 0 takes the 0x2FB21C87,
 *     which the weapon change at 1395 then names as emplacement 0's previous weapon.
 * Without a way to follow the emplacements (a weapon change with no slot, a pickup the hand cannot
 * place), the effect is 'unknown', and so is every later one of the life.
 */
export function pickupEffects(doc: ReplayDocumentReady, track: ReplayTrackReady, weapons: Map<number, string>, handAt: HandAt): PickupEffect[] {
  const { start, end } = trackWindow(track)
  const inLife = (x: { slot: number; t: number }) => x.slot === track.slot && x.t >= start && x.t <= end
  type Event = { t: number; change?: ReplayDocumentReady['weaponChanges'][number]; pickup?: ReplayDocumentReady['pickups'][number] }
  const events: Event[] = []
  for (const c of doc.weaponChanges) if (inLife(c)) events.push({ t: c.t, change: c })
  for (const p of doc.pickups) {
    if (p.kind !== 'weapon' || !inLife(p)) continue
    const covered = doc.weaponChanges.some((c) => c.kind !== 'dropped' && c.slot === p.slot && c.w === p.w && Math.abs(c.t - p.t) <= 5)
    if (!covered) events.push({ t: p.t, pickup: p })
  }
  // At the same frame the weapon change goes first: it is what the emplacement holds.
  events.sort((a, b) => a.t - b.t || (a.change ? 0 : 1) - (b.change ? 0 : 1))
  const carried = new Map<number, string>()
  for (const e of CARRIED_EMPLACEMENTS) { const id = weapons.get(e); if (id) carried.set(e, id) }
  let followed = true
  const out: PickupEffect[] = []
  for (const ev of events) {
    const c = ev.change
    if (c) {
      if (c.k == null) followed = false
      else if (!CARRIED_EMPLACEMENTS.includes(c.k)) continue
      else if (c.kind === 'dropped') carried.delete(c.k)
      else if (c.w) carried.set(c.k, weaponKey(c.w))
      else followed = false
      continue
    }
    const p = ev.pickup!
    const w = p.w.replace(/^0x/i, '').toLowerCase()
    if (!followed) { out.push({ t: p.t, w, effect: 'unknown' }); continue }
    const id = weaponKey(p.w)
    const holding = CARRIED_EMPLACEMENTS.filter((e) => carried.get(e) === id)
    if (holding.length) { for (const e of holding) out.push({ t: p.t, w, effect: 'refill', emplacement: e }); continue }
    const empty = CARRIED_EMPLACEMENTS.filter((e) => !carried.has(e))
    if (empty.length === 1) {
      carried.set(empty[0], id)
      out.push({ t: p.t, w, effect: 'fill', emplacement: empty[0] })
      continue
    }
    const hand = empty.length === 0 && p.t - 1 >= start ? handAt(p.slot, p.t - 1) : null
    if (hand && CARRIED_EMPLACEMENTS.includes(hand.weaponSlot)) {
      carried.set(hand.weaponSlot, id)
      out.push({ t: p.t, w, effect: 'replace', emplacement: hand.weaponSlot })
      continue
    }
    // Both emplacements empty, or the hand is not placed: which one changed is not known.
    followed = false
    out.push({ t: p.t, w, effect: 'unknown' })
  }
  return out
}
