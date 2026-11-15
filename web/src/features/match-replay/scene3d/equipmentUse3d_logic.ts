/**
 * equipmentUse3d_logic.ts — THE USE ANIMATIONS OF EQUIPMENT: which of the game's own clips plays,
 * for which slot, from which frame. A function of the frame alone: seeking gives the same pose.
 *
 * THE CLIPS are the game's, read from the animation graphs (no invented motion):
 *   - first person, carried equipment: the FP graph of every weapon carries one animation per
 *     equipment under the action `equipment_activate`, in the mode tree's « set » level (path
 *     `any / any / any / <set> / equipment_activate`, game name `any:any:any:<set>:equipment_activate`,
 *     both StringIDs checked by murmur3 on 79 FP graphs out of 79). The repulsor's set is
 *     `knockback` (its ability is `ability_knockback`), the threat sensor's is `location`
 *     (`ability_location_sensor`), the active camo's is `camo` and the translocator's is `quantum`.
 *     The first-person library bakes them as `<set>:equipment_activate`.
 *   - first person, thruster: `first_person:evade_front|back|left|right`; grapple fire:
 *     `first_person:grapple_hook_deploy` (in every FP graph).
 *   - third person, thruster: `combat:<class>:dodge_front|back|left|right`, already in the Spartan
 *     library (`internal/mapmesh/spartan.go` BodyAnimations).
 *
 * THE FRAMES are the document's: `carriedEquipment[].uses` (the activations of a carried object,
 * family from `abilityLabels[r].family`), `grappleLines[].t0` (the hook leaves the hand), and the
 * thruster bursts whose direction the trajectory gives (`thruster3d_logic.thrusterBursts`).
 */
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import type { ThrusterBurst } from './thruster3d_logic'

/** The first-person clip of each carried equipment's activation, by palette family. */
export const FP_USE_ACTION: Readonly<Record<string, string>> = {
  repulsor: 'knockback:equipment_activate',
  sensor: 'location:equipment_activate',
  powerup_camo: 'camo:equipment_activate',
  translocator_beacon: 'quantum:equipment_activate',
}

/** The first-person clip of the grapple fire. */
export const FP_GRAPPLE_FIRE_ACTION = 'grapple_hook_deploy'

/** The four directions of the thruster's clips, relative to where the player faces. */
export type EvadeDir = 'front' | 'back' | 'left' | 'right'

/** One use that plays a first-person clip: its frame and the rig action that names the clip. */
export interface UseShot {
  frame: number
  action: string
}

/** One thruster push that plays a third-person dodge: its frame and its direction. */
export interface DodgeShot {
  t: number
  dir: EvadeDir
}

/** The first-person clip of a thruster push in direction `dir`. */
export function fpEvadeAction(dir: EvadeDir): string {
  return `evade_${dir}`
}

/**
 * evadeDirection — the clip direction of a push (`dx`, `dy`, Halo axes) for a player facing
 * `headingDeg` (0 = +X, 90 = +Y): the quarter around front, left, back or right that holds the
 * push's angle relative to the heading (+ = left).
 */
export function evadeDirection(dx: number, dy: number, headingDeg: number): EvadeDir {
  const rel = Math.atan2(dy, dx) * (180 / Math.PI) - headingDeg
  const a = rel - 360 * Math.floor((rel + 180) / 360)
  if (a >= -45 && a <= 45) return 'front'
  if (a > 45 && a < 135) return 'left'
  if (a < -45 && a > -135) return 'right'
  return 'back'
}

function push<T>(map: Map<number, T[]>, slot: number, v: T): void {
  const list = map.get(slot)
  if (list) list.push(v)
  else map.set(slot, [v])
}

/** dodgeShots — the thruster bursts as third-person dodges, by slot, sorted by frame; a burst without heading is left out. */
export function dodgeShots(bursts: readonly ThrusterBurst[], headingAt: (slot: number, frame: number) => number | null): Map<number, DodgeShot[]> {
  const out = new Map<number, DodgeShot[]>()
  for (const b of bursts) {
    const h = headingAt(b.slot, b.t)
    if (h === null) continue
    push(out, b.slot, { t: b.t, dir: evadeDirection(b.dx, b.dy, h) })
  }
  for (const list of out.values()) list.sort((a, b) => a.t - b.t)
  return out
}

/**
 * firstPersonUses — every use that plays a first-person clip, by slot, sorted by frame: carried
 * equipment activations of a family that has a clip, grapple fires, and thruster pushes.
 */
export function firstPersonUses(
  doc: Pick<ReplayDocumentReady, 'carriedEquipment' | 'abilityLabels' | 'grappleLines'>,
  dodges: ReadonlyMap<number, readonly DodgeShot[]>,
): Map<number, UseShot[]> {
  const out = new Map<number, UseShot[]>()
  for (const c of doc.carriedEquipment) {
    const action = FP_USE_ACTION[doc.abilityLabels?.[String(c.r)]?.family ?? '']
    if (action) for (const frame of c.uses) push(out, c.slot, { frame, action })
  }
  for (const g of doc.grappleLines) push(out, g.slot, { frame: g.t0, action: FP_GRAPPLE_FIRE_ACTION })
  for (const [slot, list] of dodges) for (const d of list) push(out, slot, { frame: d.t, action: fpEvadeAction(d.dir) })
  for (const list of out.values()) list.sort((a, b) => a.frame - b.frame)
  return out
}

/** lastStartedAt — the index of the last entry of `list` (sorted by `key`) at or before `frame`, -1 when none. */
export function lastStartedAt<T>(list: readonly T[], frame: number, key: (v: T) => number): number {
  let lo = 0
  let hi = list.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (key(list[mid]) <= frame) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

/** useAt — the latest first-person use started at or before `frame`, or null. */
export function useAt(list: readonly UseShot[], frame: number): UseShot | null {
  const i = lastStartedAt(list, frame, (u) => u.frame)
  return i < 0 ? null : list[i]
}
