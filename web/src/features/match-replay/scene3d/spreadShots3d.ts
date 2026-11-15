/**
 * spreadShots3d.ts — THE SPREAD SHOT IN 3D (family `spread`, the Heatwave): one trigger pull is a
 * fan of energy bolts that fly at a projectile's speed and ricochet once off the scenery.
 *
 * WHAT IS THE GAME'S. The Heatwave (Forerunner shotgun) fires a line of hard-light bolts, spread
 * horizontally or vertically (the player toggles it), that bounce off surfaces. That is the shape
 * drawn here: a fan, the bolts as short glowing streaks, one ricochet each.
 *
 * WHAT IS NOT READ, AND IS THEREFORE A NAMED ESTIMATE. The film carries one shot event per pull
 * (position, heading, pitch), never the bolts, their count, their speed, nor the spread mode; the
 * app reads no weapon tag that would give them (the Ekur export carries none). The count, the fan
 * angle, the speed and the ricochet range below are eyeballed on the game. The mode is not in the
 * film: the fan is drawn HORIZONTAL, the weapon's default.
 *
 * A function of the age alone: seeking gives the same picture.
 */
import * as THREE from 'three'

/** Bolts per pull. ESTIMATE of the game's line of bolts. */
export const SPREAD_BOLTS = 7
/** Half-angle of the fan, degrees. ESTIMATE: the line opens to about 1.7 m at 10 m. */
export const SPREAD_HALF_ANGLE_DEG = 5
/** Bolt speed, u/s (~210 m/s). ESTIMATE: slower than a bullet (300 u/s), the bolts are seen in flight. */
export const SPREAD_SPEED = 70
/** Range of a bolt before it hits anything, u (~120 m). */
export const SPREAD_RANGE = 40
/** Range of the ricochet, u: the bolt flies on after its one bounce, then dies out. */
export const SPREAD_BOUNCE_RANGE = 8
/** Length of a bolt's streak, u (~1 m). */
export const SPREAD_STREAK = 0.35

/** What a bolt's flight needs of the scenery: the first face hit along a ray. */
export type FaceHit = (from: THREE.Vector3, dir: THREE.Vector3, far: number) => { point: THREE.Vector3; normal: THREE.Vector3 } | null

/** One bolt's flight: the polyline from the muzzle, through its ricochet, to its end. */
export interface BoltPath {
  points: THREE.Vector3[]
  /** Distance from the muzzle to each point. */
  at: number[]
  /** Whether the flight ends on the scenery (an impact spark) rather than dying out. */
  hit: boolean
}

const UP = new THREE.Vector3(0, 1, 0)

/**
 * spreadDirections — the bolts' directions: `dir` (unit) turned around the aim's own up axis, so
 * the fan stays level with the aim when the shooter looks up or down. Looking straight up or
 * down, the fan turns around the world's X axis.
 */
export function spreadDirections(dir: THREE.Vector3, count = SPREAD_BOLTS, halfAngleDeg = SPREAD_HALF_ANGLE_DEG): THREE.Vector3[] {
  const right = new THREE.Vector3().crossVectors(dir, UP)
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0)
  const axis = new THREE.Vector3().crossVectors(right.normalize(), dir).normalize()
  const half = (halfAngleDeg * Math.PI) / 180
  const out: THREE.Vector3[] = []
  for (let i = 0; i < count; i++) {
    const a = count === 1 ? 0 : -half + (2 * half * i) / (count - 1)
    out.push(dir.clone().applyAxisAngle(axis, a))
  }
  return out
}

/** boltPath — a bolt's flight from `from` along `dir`: to the first face, one ricochet, then on. */
export function boltPath(from: THREE.Vector3, dir: THREE.Vector3, hitFace: FaceHit): BoltPath {
  const first = hitFace(from, dir, SPREAD_RANGE)
  if (!first) {
    const end = from.clone().addScaledVector(dir, SPREAD_RANGE)
    return { points: [from.clone(), end], at: [0, SPREAD_RANGE], hit: false }
  }
  const d1 = from.distanceTo(first.point)
  // The reflection off the face: r = d - 2 (d . n) n.
  const bounce = dir.clone().addScaledVector(first.normal, -2 * dir.dot(first.normal)).normalize()
  // A hair off the face, so the ricochet's ray does not hit the face it leaves.
  const start = first.point.clone().addScaledVector(first.normal, 1e-3)
  const second = hitFace(start, bounce, SPREAD_BOUNCE_RANGE)
  const end = second ? second.point.clone() : first.point.clone().addScaledVector(bounce, SPREAD_BOUNCE_RANGE)
  return { points: [from.clone(), first.point.clone(), end], at: [0, d1, d1 + first.point.distanceTo(end)], hit: second !== null }
}

/** pointAt — the point at distance `s` along the bolt's polyline (clamped to its ends). */
function pointAt(p: BoltPath, s: number, out: THREE.Vector3): THREE.Vector3 {
  const last = p.points.length - 1
  if (s <= 0) return out.copy(p.points[0])
  for (let i = 1; i <= last; i++) {
    if (s <= p.at[i]) {
      const leg = p.at[i] - p.at[i - 1]
      return out.lerpVectors(p.points[i - 1], p.points[i], leg > 0 ? (s - p.at[i - 1]) / leg : 1)
    }
  }
  return out.copy(p.points[last])
}

/** The leg a distance falls on (its index of end point). */
function legOf(p: BoltPath, s: number): number {
  for (let i = 1; i < p.points.length; i++) if (s <= p.at[i]) return i
  return p.points.length - 1
}

/**
 * boltStreak — the streak of the bolt `age` seconds after the pull: its head at `age * speed`
 * along the flight, its tail `SPREAD_STREAK` behind ON THE SAME LEG (it does not bend around the
 * ricochet), or null before the pull and once the head has reached the end.
 */
export function boltStreak(p: BoltPath, age: number, tail: THREE.Vector3, head: THREE.Vector3, speed = SPREAD_SPEED): boolean {
  const total = p.at[p.at.length - 1]
  const s = age * speed
  if (age < 0 || s >= total) return false
  const leg = legOf(p, s)
  pointAt(p, s, head)
  pointAt(p, Math.max(p.at[leg - 1], s - SPREAD_STREAK), tail)
  return true
}

/** boltEndAge — the age (s) at which the bolt reaches the end of its flight. */
export function boltEndAge(p: BoltPath, speed = SPREAD_SPEED): number {
  return p.at[p.at.length - 1] / speed
}
