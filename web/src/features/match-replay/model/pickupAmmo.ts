// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * pickupAmmo.ts: THE AMMO A PICKED-UP WEAPON HOLDS WHEN IT IS PICKED UP, from the film.
 *
 * WHY. The HUD reads a weapon's ammo from its own reads (per shot, every keyframe). A weapon just
 * picked up has none of its own until it fires or a keyframe passes, and the reads of its
 * emplacement before the pickup count the replaced weapon (`changesInto`): the count was blank.
 * But the pickup itself says what the weapon holds, in one of two ways, and nothing else is shown:
 *
 *   (a) A WEAPON THAT LAY ON THE GROUND (`groundWeapons`, a dead player's weapon or a swapped one).
 *       Its pickup is the ground object's own end (`end: 'pickup'`, `picker`, `t1` on the weapon
 *       change's frame: 54 of 54 on five stored films, 2026-11-18). Its ammo is the object's ammo,
 *       read from its creation record (`ammo`; equal to the per-shot read at the pickup in every
 *       case where both exist), else the dropper's last known ammo for that weapon before the drop.
 *   (b) A WEAPON FRESH FROM A PAD OR RACK (`padPickups` dated on the weapon change's frame: 207 of
 *       207). Its ammo is that weapon's spawn-on-map ammo, measured in the same film: the first
 *       read of the emplacement after each pad pickup of that weapon, before any shot of it, the
 *       value a strict majority of them read, per field. It depends on the mode (the BR75 reads
 *       36 | 108 on f5454b2a and 0bb2ccc9, 36 | 72 on a20ea4c7, 41814132 and 1a521d10), so it is
 *       never carried between films. Where the game's weapon tags are read (`weapons/index.json`,
 *       idle effects), their magazine size agrees: 6, 8, 12, 12 and 250 rounds.
 *
 * A pickup the film does not date is linked by time and place instead (`linkOf`): the picker
 * stands at a pad of that weapon during its pickup interval, or at a ground object of that weapon
 * still lying there, and at nothing else of that weapon.
 *
 * CHECKED against the per-shot read at the pickup frame, where the film has one: dated pads 124 of
 * 124, pads by time and place 29 of 30, dated ground objects 27 of 28, ground objects by time and
 * place 4 of 4 (the two misses: a read one frame before the pickup, of the replaced weapon; an
 * object read 28 rounds where the pickup read 27).
 *
 * A refill (walking over a weapon already carried) is no arrival: it keeps the spawn handling.
 * Anything else stays blank: an energy weapon (no magazine; its charge is not published), a pad
 * weapon the film never reads before it fires, a pickup linked to nothing.
 *
 * HOW LONG IT HOLDS: until the weapon's ammo moves (a shot fired with it, a per-shot read of its
 * emplacement, a refill of it) or another weapon change into its emplacement, per field like the
 * spawn ammo. A read of the emplacement since the pickup then speaks for itself.
 */
import { trackWindow } from '@/lib/replay/replayLogic'
import type { ReplayDocumentReady, ReplayTrackReady } from '@/lib/replay/replayNormalize'
import { birthWeaponsOf, weaponKey } from './pickupPlacement'
import { spawnAmmoAt, type SpawnAmmo, type SpawnAmmoIndex } from './spawnAmmo'
import { pickupPlacements, withPlacedPickups } from './weaponInHand'

/** Where a picked-up weapon's ammo comes from (`PickupArrival.source`). */
export type PickupAmmoSource = 'ground' | 'dropper' | 'pad' | 'none'

/** A weapon put into an emplacement by a pickup, and the ammo the film gives it at that instant. */
export interface PickupArrival {
  slot: number
  t: number
  emplacement: number
  /** The weapon, `0x` and upper case. */
  w: string
  source: PickupAmmoSource
  /** The film dates the pickup it came from (true), or it is linked by time and place (false). */
  dated: boolean
  ammo: SpawnAmmo
  /** The first frame after the pickup that moved the magazine, the reserve; Infinity: never. */
  magSettled: number
  resSettled: number
}

/** The film's picked-up weapons by `slot:t:emplacement`, and its pads' spawn ammo per weapon. */
export interface PickupAmmoIndex {
  arrivals: Map<string, PickupArrival>
  padSpawn: Map<string, SpawnAmmo>
}

const arrivalKey = (slot: number, t: number, emplacement: number) => `${slot}:${t}:${emplacement}`

/** The weapon family of a shot's 64-bit weapon id, the loadout rows' spelling. */
function familyOf(w: string): string {
  const m = /^0x([0-9a-f]{8})/i.exec(w)
  return m ? `0x${m[1].toUpperCase()}` : weaponKey(w)
}

/** The value read by a strict majority of `values`; undefined without one. */
function majority(values: readonly number[]): number | undefined {
  const counts = new Map<number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  for (const [v, n] of counts) if (n * 2 > values.length) return v
  return undefined
}

/** What this module reads of a weapon change. */
type WeaponChange = { t: number; slot: number; k?: number; w?: string }

/** Where an arrival's weapon came from: a ground object, a pad, or not established. */
type Link = ({ kind: 'ground'; g: { ammo?: { mag: number; res: number }; dropper: number; t0: number } } | { kind: 'pad' }) & { dated: boolean } | null

/**
 * LINK_RADIUS: how close, in meters on the ground plane, a picker stands to the pad or ground
 * object he picks up from, when the film does not date that pickup. Measured on the dated ones of
 * five stored films (2026-11-18): within 0.83 m of the ground object (54 of 54) and, on the three
 * films whose pads sit where the pickups happen, within 0.75 m of the pad (166 of 166).
 */
const LINK_RADIUS = 1.5

/** A life's position at frame `t`: its nearest point within ten frames, null without one. */
function positionAt(life: ReplayTrackReady, t: number): { x: number; y: number } | null {
  let best: { x: number; y: number; t: number } | null = null
  for (const p of life.points) if (Math.abs(p.t - t) <= 10 && (!best || Math.abs(p.t - t) < Math.abs(best.t - t))) best = p
  return best
}

/** pickupAmmoIndex: every pickup of a new weapon of the film, with the ammo the film gives it. */
export function pickupAmmoIndex(doc: ReplayDocumentReady, spawn: SpawnAmmoIndex): PickupAmmoIndex {
  const placed = withPlacedPickups(doc)
  const changes = placed.weaponChanges
  const lifeOf = (slot: number, t: number) => doc.tracks.find((tr) => tr.slot === slot && t >= trackWindow(tr).start && t <= trackWindow(tr).end)
  const arrivalsIn = changes.filter((c) => c.kind !== 'dropped' && c.w && (c.k === 0 || c.k === 1)).sort((a, b) => a.t - b.t)
  const padWeapon = doc.weaponPads.map((p) => weaponKey(p.weapon))
  const linkCache = new Map<WeaponChange, Link>()
  /**
   * Where the weapon of an arrival came from. Dated links first: the ground object whose pickup
   * the film dates on this frame, by this picker; a pad pickup dated on this frame. Without
   * either, time and place: the picker stands within LINK_RADIUS of a pad of that weapon whose
   * pickup interval covers the frame, or of a ground object of that weapon still lying there,
   * and of nothing else of that weapon. Two candidates of different kinds: no link.
   */
  const linkOf = (c: WeaponChange, life: ReplayTrackReady): Link => {
    const cached = linkCache.get(c)
    if (cached !== undefined) return cached
    const w = weaponKey(c.w!)
    let link: Link = null
    const dated = doc.groundWeapons.filter((g) => g.end === 'pickup' && g.picker === c.slot && Math.abs(g.t1 - c.t) <= 1 && weaponKey(g.w) === w)
    if (dated.length) link = dated.length === 1 ? { kind: 'ground', g: dated[0], dated: true } : null
    else if (doc.padPickups.some((p) => p.t != null && Math.abs(p.t - c.t) <= 1 && padWeapon[p.pad] === w && (p.xuid == null || p.xuid === life.xuid))) link = { kind: 'pad', dated: true }
    else {
      const at = positionAt(life, c.t)
      if (at) {
        const near = (x: number, y: number) => Math.hypot(x - at.x, y - at.y) <= LINK_RADIUS
        const ground = doc.groundWeapons.filter((g) => weaponKey(g.w) === w && g.t0 <= c.t && c.t <= g.t1max && g.end !== 'pickup' && near(g.x, g.y))
        const pad = doc.padPickups.some((p) => padWeapon[p.pad] === w && p.t == null && p.tLow <= c.t && c.t <= p.tHigh && near(doc.weaponPads[p.pad].x, doc.weaponPads[p.pad].y))
        if (ground.length === 1 && !pad) link = { kind: 'ground', g: ground[0], dated: false }
        else if (pad && ground.length === 0) link = { kind: 'pad', dated: false }
      }
    }
    linkCache.set(c, link)
    return link
  }
  const fromGround = (c: WeaponChange, life: ReplayTrackReady) => { const l = linkOf(c, life); return l?.kind === 'ground' ? l.g : null }
  const fromPad = (c: WeaponChange, life: ReplayTrackReady) => linkOf(c, life)?.kind === 'pad'

  // When each arrival's ammo first moves: a shot fired with it, a per-shot read of its emplacement,
  // a refill of it, the next change into its emplacement.
  const settledOf = (c: WeaponChange, life: ReplayTrackReady) => {
    const { end } = trackWindow(life)
    const w = weaponKey(c.w!)
    let next = end + 1
    for (const x of changes) if (x.slot === c.slot && x.t > c.t && x.t <= end && (x.k === c.k || x.k == null) && x.t < next) next = x.t
    let mag = next, res = next
    for (const s of doc.shots) {
      if (s.slot === c.slot && s.t >= c.t && s.t < mag && s.w && s.v == null && familyOf(s.w) === w) { mag = Math.min(mag, s.t); res = Math.min(res, s.t) }
    }
    for (const r of doc.ammoReads) {
      if (r.slot !== c.slot || r.w !== c.k || r.src === 'kf' || r.t <= c.t || r.t >= next) continue
      if (r.mag != null) mag = Math.min(mag, r.t)
      if (r.res != null) res = Math.min(res, r.t)
    }
    for (const fx of pickupPlacements(doc).get(life) ?? []) {
      if (fx.effect === 'refill' && fx.emplacement === c.k && fx.t > c.t) res = Math.min(res, fx.t)
    }
    return { magSettled: mag === end + 1 ? Infinity : mag, resSettled: res === end + 1 ? Infinity : res }
  }

  // (b) The pads' spawn ammo, per weapon: the first read of the emplacement after a pad pickup,
  // before the weapon fires or the emplacement changes again; strict majority per field.
  const padSamples = new Map<string, { mag: number[]; res: number[] }>()
  for (const c of arrivalsIn) {
    const life = lifeOf(c.slot, c.t)
    if (!life || !fromPad(c, life)) continue
    const { end } = trackWindow(life)
    let next = end + 1
    for (const x of changes) if (x.slot === c.slot && x.t > c.t && x.t <= end && (x.k === c.k || x.k == null) && x.t < next) next = x.t
    const firstShot = Math.min(...doc.shots.filter((s) => s.slot === c.slot && s.t >= c.t && s.w && s.v == null && familyOf(s.w) === weaponKey(c.w!)).map((s) => s.t), Infinity)
    const first = doc.ammoReads.find((r) => r.slot === c.slot && r.w === c.k && r.t >= c.t && r.t < next && r.t < firstShot)
    if (!first || first.mag == null || first.res == null) continue
    const w = weaponKey(c.w!)
    const s = padSamples.get(w) ?? { mag: [], res: [] }
    s.mag.push(first.mag)
    s.res.push(first.res)
    padSamples.set(w, s)
  }
  const padSpawn = new Map<string, SpawnAmmo>()
  for (const [w, s] of padSamples) {
    const ammo: SpawnAmmo = { mag: majority(s.mag), res: majority(s.res) }
    if (ammo.mag != null || ammo.res != null) padSpawn.set(w, ammo)
  }

  const arrivals = new Map<string, PickupArrival>()
  /** The ammo of weapon `w` a life held at `frame`: its last reads, its pickup's, or its spawn's. */
  const heldAmmo = (life: ReplayTrackReady, w: string, frame: number): SpawnAmmo | null => {
    const birth = birthWeaponsOf(doc, life)
    if (!birth) return null
    const { start } = trackWindow(life)
    // Follow what each emplacement holds from the birth through the changes, up to `frame`.
    const carried = new Map<number, { w: string; since: number }>()
    for (const [e, id] of birth) if (e === 0 || e === 1) carried.set(e, { w: id, since: -Infinity })
    for (const x of changes) {
      if (x.slot !== life.slot || x.t < start || x.t > frame) continue
      if (x.k == null) return null
      if (x.k !== 0 && x.k !== 1) continue
      if (x.kind === 'dropped' || !x.w) carried.delete(x.k)
      else carried.set(x.k, { w: weaponKey(x.w), since: x.t })
    }
    const at = [...carried].filter(([, v]) => v.w === w)
    if (at.length !== 1) return null
    const [e, { since }] = at[0]
    const moved = (t: number) => doc.shots.some((s) => s.slot === life.slot && s.t > t && s.t <= frame && s.w && s.v == null && familyOf(s.w) === w)
    const refilled = (t: number) => (pickupPlacements(doc).get(life) ?? []).some((fx) => fx.effect === 'refill' && fx.emplacement === e && fx.t > t && fx.t <= frame)
    const out: SpawnAmmo = {}
    let magRead: number | undefined, resRead: number | undefined
    for (const r of doc.ammoReads) {
      if (r.slot !== life.slot || r.w !== e || r.t < Math.max(since, start) || r.t > frame) continue
      if (r.mag != null) { out.mag = r.mag; magRead = r.t }
      if (r.res != null) { out.res = r.res; resRead = r.t }
    }
    if (magRead != null && moved(magRead)) delete out.mag
    if (resRead != null && (moved(resRead) || refilled(resRead))) delete out.res
    // Without a read of the field since the weapon came: what it came with, while unmoved.
    const base = since === -Infinity
      ? spawnAmmoAt(spawn, life, frame, { id: w, weaponSlot: e })
      : (() => {
          const a = arrivals.get(arrivalKey(life.slot, since, e))
          if (!a || a.w !== w) return null
          return { ...(frame <= a.magSettled && a.ammo.mag != null ? { mag: a.ammo.mag } : {}), ...(frame <= a.resSettled && a.ammo.res != null ? { res: a.ammo.res } : {}) }
        })()
    if (magRead == null && base?.mag != null) out.mag = base.mag
    if (resRead == null && base?.res != null) out.res = base.res
    return out.mag != null || out.res != null ? out : null
  }

  for (const c of arrivalsIn) {
    const life = lifeOf(c.slot, c.t)
    if (!life) continue
    const w = weaponKey(c.w!)
    let source: PickupAmmoSource = 'none'
    let ammo: SpawnAmmo = {}
    const g = fromGround(c, life)
    if (g) {
      // An object read empty in both fields is an energy weapon's (its charge is not a magazine).
      if (g.ammo && (g.ammo.mag !== 0 || g.ammo.res !== 0)) { ammo = { mag: g.ammo.mag, res: g.ammo.res }; source = 'ground' }
      else if (g.dropper >= 0) {
        const dropper = doc.tracks.find((tr) => tr.slot === g.dropper && g.t0 >= trackWindow(tr).start && g.t0 <= trackWindow(tr).end + 30)
        const last = dropper ? heldAmmo(dropper, w, Math.min(g.t0, trackWindow(dropper).end)) : null
        if (last) { ammo = last; source = 'dropper' }
      }
    } else if (fromPad(c, life)) {
      const pad = padSpawn.get(w)
      if (pad) { ammo = pad; source = 'pad' }
    }
    arrivals.set(arrivalKey(c.slot, c.t, c.k!), { slot: c.slot, t: c.t, emplacement: c.k!, w, source, dated: linkOf(c, life)?.dated ?? false, ammo, ...settledOf(c, life) })
  }
  return { arrivals, padSpawn }
}

/**
 * pickupAmmoAt: the ammo the weapon in hand came with, when it was picked up at `since` (the latest
 * weapon change into its emplacement, `changesInto`) and nothing has moved that field since. Null
 * otherwise.
 */
export function pickupAmmoAt(index: PickupAmmoIndex, slot: number, since: number, frame: number, held: { id: string; weaponSlot: number }): SpawnAmmo | null {
  const a = index.arrivals.get(arrivalKey(slot, since, held.weaponSlot))
  if (!a || a.w !== weaponKey(held.id)) return null
  const out: SpawnAmmo = {}
  if (a.ammo.mag != null && frame <= a.magSettled) out.mag = a.ammo.mag
  if (a.ammo.res != null && frame <= a.resSettled) out.res = a.ammo.res
  return out.mag != null || out.res != null ? out : null
}
