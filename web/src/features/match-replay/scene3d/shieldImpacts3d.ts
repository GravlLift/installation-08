// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * shieldImpacts3d.ts — WHERE AND WHEN THE SHIELD IMPACT GENERATOR FIRES ON A PLAYER.
 *
 * In the game each hit the shield absorbs starts the Spartan's impact generator around the impact
 * point (`shieldGenerator3d`). The film says who was hit, by whom, and when (`doc.damages`: victim
 * slot, author slot, frame), and every published shot is a shot that dealt damage (the decoder's
 * `Shot`: a shot record exists only when damage is applied). It does not say where the bullet struck
 * the body. This file places each hit from what the film does say:
 *
 *  - the HIT: a damage with an author other than the victim, taken while the victim still had
 *    shield (the shield reading before it above 0: a hit on bare health starts no shield effect);
 *  - its SHOT: the author's shot of the same frame, or of the frame before (measured on two matches,
 *    2026-11-19: of 806 and 877 authored damages, 80% pair with a shot of the same frame, the next
 *    most frequent offset is one frame before; the rest are grenades, melee and unpublished shots).
 *    A hit with no such shot is not drawn;
 *  - its RAY: the shot's flight line as the view draws it (the tracer from the muzzle,
 *    `Shots3dLayer.flightLine`) when it passes through the victim's body capsule, otherwise the ray
 *    from that muzzle (the shooter's eye with no drawn flight) to the victim's body center;
 *  - the ray is CARRIED WITH THE VICTIM'S BODY from the hit to the drawn frame (its feet and heading),
 *    so the patch stays on the side that was hit while the victim moves (INFERRED: the game's
 *    generator follows the object it is attached to);
 *  - its AGE: from the shot's instant (its fractional frame) to the drawn frame.
 *
 * The point itself is the front of the POSED body along the ray, found by the shell
 * (`bodyShell3d`). Everything is a function of the document and the frame: a frozen frame holds
 * still, an export draws what the screen draws.
 */
import * as THREE from 'three'

import { heldReading } from '@/lib/replay/replayLogic'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import type { ShotFxEntry } from '../model/shotFx'
import { firstFrom } from './actionKit'
import { BODY_CENTER, BODY_LENGTH, BODY_RADIUS, EYE_HEIGHT } from './body3d'
import { aimDirThree, toThree, type PlayerState3d } from './tracks3d'

/** The game's ring of generators per object is not decoded: the youngest hits, this many at most. */
export const MAX_SHIELD_IMPACTS = 8

/** A damage pairs with its author's shot of its own frame or of this many frames before. */
export const SHOT_PAIR_FRAMES = 1

/** One hit on a body at the drawn frame: the ray it came along (world, carried with the body), its age. */
export interface ShieldImpact {
  origin: THREE.Vector3
  /** Unit direction. */
  dir: THREE.Vector3
  /** Seconds since the impact. */
  age: number
}

/** A shot's flight line as the view draws it (from the muzzle, toward where it ends), null without one. */
export type FlightLine = (e: ShotFxEntry, frame: number) => { from: THREE.Vector3; to: THREE.Vector3 } | null

/** What the placement reads of the scene. */
export interface ImpactSources {
  doc: ReplayDocumentReady
  /** The biped of slot `slot` at frame `frame`, null when it is not alive. */
  slotState(slot: number, frame: number): PlayerState3d | null
  /** Height of a player's published origin above his feet (u). */
  originAboveFloor: number
  /** The view's flight line of a shot (absent: the shooter's eye ray). */
  flightLine?: FlightLine
}

type DamageEntry = ReplayDocumentReady['damages'][number]

const UP = new THREE.Vector3(0, 1, 0)

/** yawOf: a heading's turn about +Y (radians), as `makeRotationY` measures it. */
function yawOf(h: number): number {
  const d = aimDirThree(h, 0)
  return Math.atan2(-d[2], d[0])
}

/** feetOf: a biped's feet (three axes), written in `out`. */
export function feetOf(s: PlayerState3d, originAboveFloor: number, out: THREE.Vector3): THREE.Vector3 {
  const [x, , z] = toThree(s.x, s.y, 0)
  return out.set(x, s.z - originAboveFloor, z)
}

/**
 * raySegmentDistance: the closest distance between the ray from `o` along unit `d` (t >= 0) and the
 * segment `a`-`b`.
 */
export function raySegmentDistance(o: THREE.Vector3, d: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const u = new THREE.Vector3().subVectors(b, a)
  const w = new THREE.Vector3().subVectors(o, a)
  const uu = u.dot(u)
  const ud = u.dot(d)
  const uw = u.dot(w)
  const dw = d.dot(w)
  const den = uu - ud * ud
  // Closest points of the two lines, then clamped: s along the segment (0..1), t along the ray (>= 0).
  let s = den > 1e-12 ? (uw - ud * dw) / den : 0
  s = Math.min(1, Math.max(0, s))
  let t = Math.max(0, s * ud - dw)
  s = uu > 1e-12 ? Math.min(1, Math.max(0, (t * ud + uw) / uu)) : 0
  t = Math.max(0, s * ud - dw)
  const p = new THREE.Vector3().copy(o).addScaledVector(d, t)
  const q = new THREE.Vector3().copy(a).addScaledVector(u, s)
  return p.distanceTo(q)
}

/**
 * passesThroughBody: the ray from `o` along unit `d` crosses the body capsule of a biped whose feet
 * are at `feet` (`body3d`: radius BODY_RADIUS around a BODY_LENGTH axis centered BODY_CENTER up).
 */
export function passesThroughBody(o: THREE.Vector3, d: THREE.Vector3, feet: THREE.Vector3): boolean {
  const a = new THREE.Vector3(feet.x, feet.y + BODY_CENTER - BODY_LENGTH / 2, feet.z)
  const b = new THREE.Vector3(feet.x, feet.y + BODY_CENTER + BODY_LENGTH / 2, feet.z)
  return raySegmentDistance(o, d, a, b) <= BODY_RADIUS
}

/**
 * carryWithBody: point `p` (or direction, `direction` true) given around a body standing at
 * `feetThen` with heading `hThen`, moved with the body to `feetNow`, heading `hNow`. In place.
 */
export function carryWithBody(p: THREE.Vector3, direction: boolean, feetThen: THREE.Vector3, hThen: number, feetNow: THREE.Vector3, hNow: number): THREE.Vector3 {
  if (!direction) p.sub(feetThen)
  p.applyAxisAngle(UP, yawOf(hNow) - yawOf(hThen))
  if (!direction) p.add(feetNow)
  return p
}

/**
 * pairShot: the author's shot that dealt damage `d`, among `shots` (that author's, by frame): the
 * one of the damage's frame first, else of the frames before it (up to SHOT_PAIR_FRAMES); among
 * shots of the same frame, the last one fired. null when there is none.
 */
export function pairShot(shots: readonly ShotFxEntry[], d: DamageEntry): ShotFxEntry | null {
  let best: ShotFxEntry | null = null
  for (let i = firstFrom(shots, (e) => e.frame, d.t - SHOT_PAIR_FRAMES); i < shots.length; i++) {
    const e = shots[i]
    if (e.frame > d.t) break
    if (!best || e.frame > best.frame || (e.frame === best.frame && e.time >= best.time)) best = e
  }
  return best
}

/** The hits of a document by victim, and the shots by author, sorted by frame. */
export class ShieldImpacts {
  private readonly src: ImpactSources
  private readonly damages = new Map<number, DamageEntry[]>()
  private readonly points = new Map<number, ReplayDocumentReady['tracks'][number]['points']>()
  private shotSource: readonly ShotFxEntry[] | null = null
  private shots = new Map<number, ShotFxEntry[]>()
  private readonly pool: ShieldImpact[] = []
  private readonly out: ShieldImpact[] = []
  private readonly feetThen = new THREE.Vector3()
  private readonly feetNow = new THREE.Vector3()
  private readonly center = new THREE.Vector3()

  constructor(src: ImpactSources) {
    this.src = src
    for (const d of src.doc.damages) {
      const list = this.damages.get(d.slot) ?? []
      list.push(d)
      this.damages.set(d.slot, list)
    }
    for (const list of this.damages.values()) list.sort((p, q) => p.t - q.t)
    for (const t of src.doc.tracks) this.points.set(t.slot, t.points)
  }

  /**
   * at: the hits on the biped of slot `slot` at frame `frame` younger than `life` seconds, the
   * youngest first, MAX_SHIELD_IMPACTS at most (the same array, overwritten on every call).
   */
  at(slot: number, frame: number, fps: number, life: number, shotFx: readonly ShotFxEntry[]): readonly ShieldImpact[] {
    const out = this.out
    out.length = 0
    const damages = this.damages.get(slot)
    const now = this.src.slotState(slot, Math.floor(frame))
    if (!damages || !now || life <= 0) return out
    if (shotFx !== this.shotSource) this.reindex(shotFx)
    feetOf(now, this.src.originAboveFloor, this.feetNow)
    const points = this.points.get(slot) ?? []
    // Newest first: from the last damage at or before the frame, back over the lifetime (and the pairing window).
    const oldest = frame - life * fps - SHOT_PAIR_FRAMES - 1
    for (let i = firstFrom(damages, (d) => d.t, Math.floor(frame) + 1) - 1; i >= 0 && out.length < MAX_SHIELD_IMPACTS; i--) {
      const d = damages[i]
      if (d.t < oldest) break
      if (d.by == null || d.by === slot) continue
      // A hit on bare health starts no shield effect: the shield before it held something.
      const before = heldReading(points, d.t - 1, (p) => p.sh, Number.POSITIVE_INFINITY)?.value ?? 1
      if (!(before > 0)) continue
      const shot = pairShot(this.shots.get(d.by) ?? [], d)
      if (!shot) continue
      const age = (frame - shot.time) / fps
      if (age < 0 || age >= life) continue
      const impact = this.slot(out.length)
      if (!this.ray(shot, slot, frame, impact)) continue
      impact.age = age
      out.push(impact)
    }
    return out
  }

  private reindex(shotFx: readonly ShotFxEntry[]): void {
    this.shotSource = shotFx
    this.shots = new Map()
    for (const e of shotFx) {
      const list = this.shots.get(e.slot) ?? []
      list.push(e)
      this.shots.set(e.slot, list)
    }
    for (const list of this.shots.values()) list.sort((p, q) => p.frame - q.frame || p.time - q.time)
  }

  private slot(i: number): ShieldImpact {
    let s = this.pool[i]
    if (!s) {
      s = { origin: new THREE.Vector3(), dir: new THREE.Vector3(), age: 0 }
      this.pool[i] = s
    }
    return s
  }

  /** ray: the hit's ray, carried from the victim's body at the shot to its body at `frame`; false without one. */
  private ray(shot: ShotFxEntry, victim: number, frame: number, out: ShieldImpact): boolean {
    const src = this.src
    const then = src.slotState(victim, shot.frame)
    const now = src.slotState(victim, Math.floor(frame))
    if (!then || !now) return false
    feetOf(then, src.originAboveFloor, this.feetThen)
    this.center.set(this.feetThen.x, this.feetThen.y + BODY_CENTER, this.feetThen.z)
    const line = src.flightLine?.(shot, frame) ?? null
    if (line) {
      out.origin.copy(line.from)
      out.dir.subVectors(line.to, line.from)
      if (out.dir.lengthSq() < 1e-12) return false
      out.dir.normalize()
      // The drawn tracer misses the body (the film's aim is not the bullet's): toward its center.
      if (!passesThroughBody(out.origin, out.dir, this.feetThen)) out.dir.subVectors(this.center, out.origin).normalize()
    } else {
      // No drawn flight: from the shooter's eye toward the body's center.
      const s = src.slotState(shot.slot, shot.frame)
      if (!s) return false
      feetOf(s, src.originAboveFloor, out.origin)
      out.origin.y += EYE_HEIGHT - s.dropOeil
      out.dir.subVectors(this.center, out.origin)
      if (out.dir.lengthSq() < 1e-12) return false
      out.dir.normalize()
    }
    carryWithBody(out.origin, false, this.feetThen, then.h, this.feetNow, now.h)
    carryWithBody(out.dir, true, this.feetThen, then.h, this.feetNow, now.h)
    return true
  }
}
