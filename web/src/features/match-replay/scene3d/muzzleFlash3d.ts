// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * muzzleFlash3d.ts — A SHOT'S MUZZLE FLASH: a burst of petals at the end of the DRAWN weapon
 * model's barrel, lasting one to two frames at 60 Hz.
 *
 * The burst has two rings of petals (`petalGeometry`: white core, black edges, additive blend):
 * long petals in planes that contain the barrel (the cone seen in profile), and a star of short
 * petals around the muzzle, opening forward (seen from behind, in first person, the star). The
 * whole thing rotates around the barrel by an angle drawn from the shot's seed (`flashRoll`): two
 * neighboring shots do not get the same burst, and the same frame always renders the same one.
 *
 * The flash only draws at the end of a drawn weapon (`muzzleFlashSite`): with no held weapon
 * model (not loaded, player hidden, a vehicle's shot), no burst. In first person, the drawn
 * weapon is the arms+weapon rig, which has no Spartan held-weapon model: the burst is then at the
 * muzzle of the rig the shot's flight left from (`rigFlashSite`), along the shot's direction.
 * Nothing is ever placed at the eye.
 */
import * as THREE from 'three'

import type { DrawnWeapon } from './avatar3d'
import { drawnMuzzle } from './muzzle3d'

/** The flash's duration: two frames at 60 Hz. */
export const MUZZLE_FLASH_SECONDS = 2 / 60
// How much strength the burst loses by its end (the second frame is weaker than the first).
const FADE = 0.6
// The petals along the barrel (u, ~24cm by ~7) and their count: seen in profile, they stick out
// past the shooter's body; seen from behind (first person), they run toward the center and hide nothing.
const SIDE_LENGTH = 0.08
const SIDE_WIDTH = 0.024
const SIDE_PETALS = 3
// The star around the muzzle (u, ~9cm by ~4), opening by STAR_TILT toward the front.
const STAR_LENGTH = 0.03
const STAR_WIDTH = 0.013
const STAR_PETALS = 5
const STAR_TILT = THREE.MathUtils.degToRad(35)
// Each petal's length varies around its size (± JITTER / 2), from the shot's seed.
const JITTER = 0.5
// The burst is born a bit smaller on its last frame.
const SHRINK = 0.3

/**
 * muzzleFlashStrength: the flash's strength (0..1) `age` seconds after the shot: full at the
 * shot, weaker on the second frame, off past `MUZZLE_FLASH_SECONDS`; 0 before the shot.
 */
export function muzzleFlashStrength(age: number): number {
  if (age < 0 || age >= MUZZLE_FLASH_SECONDS) return 0
  return 1 - FADE * (age / MUZZLE_FLASH_SECONDS)
}

/** unitHash: a number in [0, 1) drawn from integer `n` (integer mixing: neighbors are unrelated). */
function unitHash(n: number): number {
  let h = Math.floor(n) | 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** flashRoll: the angle (radians, [0, 2π)) the burst of a shot seeded `seed` rotates around the barrel. */
export function flashRoll(seed: number): number {
  return unitHash(seed) * 2 * Math.PI
}

/**
 * muzzleFlashSite: where a shot's burst draws, written to `pos` (muzzle, world) and `barrel`
 * (barrel axis, world, unit length): at the end of drawn weapon `drawn`; false (no burst) with no
 * drawn weapon or for a vehicle's shot.
 */
export function muzzleFlashSite(vehicleShot: boolean, drawn: DrawnWeapon | null, pos: THREE.Vector3, barrel: THREE.Vector3): boolean {
  if (vehicleShot || !drawn) return false
  drawnMuzzle(drawn, pos, barrel)
  return true
}

/**
 * rigFlashSite: where a first-person shot's burst draws when the drawn weapon is the rig (no
 * Spartan held-weapon, `muzzleFlashSite` gives nothing): at the muzzle of the rig the shot's
 * flight left from (`from`, measured on the same rig as the flight's origin), along the shot's
 * direction (`to`). `rigDrawn`: the shot belongs to the player tracked in first person, outside a
 * vehicle, and their weapon's rig is loaded. False with no drawn rig or no flight direction (`to`
 * null): no burst outside a drawn muzzle.
 */
export function rigFlashSite(
  rigDrawn: boolean,
  path: { from: THREE.Vector3; to: THREE.Vector3 | null },
  pos: THREE.Vector3,
  barrel: THREE.Vector3,
): boolean {
  if (!rigDrawn || path.to === null) return false
  pos.copy(path.from)
  barrel.subVectors(path.to, path.from).normalize()
  return true
}

/** A petal of the burst: its orientation (the petal's Y = its tip) and its size (X width, Y length). */
export interface FlashPetal {
  rotation: THREE.Quaternion
  size: THREE.Vector3
}

const across = new THREE.Vector3()
const side = new THREE.Vector3()
const tip = new THREE.Vector3()
const width = new THREE.Vector3()
const normal = new THREE.Vector3()
const basis = new THREE.Matrix4()
const UP = new THREE.Vector3(0, 1, 0)
const EAST = new THREE.Vector3(1, 0, 0)

/**
 * flashPetals: the petals of a shot's burst seeded `seed`, barrel along `barrel` (unit length),
 * at strength `k`; `out` is overwritten (its petals are reused from one call to the next).
 */
export function flashPetals(barrel: THREE.Vector3, k: number, seed: number, out: FlashPetal[]): FlashPetal[] {
  // A perpendicular to the barrel, from which the burst's angle starts.
  across.crossVectors(barrel, Math.abs(barrel.y) < 0.9 ? UP : EAST).normalize()
  const roll = flashRoll(seed)
  const grow = 1 - SHRINK * (1 - k)
  let n = 0
  const put = (dir: THREE.Vector3, w: THREE.Vector3, length: number, breadth: number) => {
    const p = out[n] ?? (out[n] = { rotation: new THREE.Quaternion(), size: new THREE.Vector3() })
    normal.crossVectors(w, dir)
    p.rotation.setFromRotationMatrix(basis.makeBasis(w, dir, normal))
    p.size.set(breadth * grow, length * grow * (1 - JITTER / 2 + JITTER * unitHash(seed * 31 + n)), 1)
    n++
  }
  for (let i = 0; i < SIDE_PETALS; i++) {
    // A plane that contains the barrel: the petal's width is perpendicular within it.
    width.copy(across).applyAxisAngle(barrel, roll + (i * Math.PI) / SIDE_PETALS)
    put(barrel, width, SIDE_LENGTH, SIDE_WIDTH)
  }
  for (let i = 0; i < STAR_PETALS; i++) {
    side.copy(across).applyAxisAngle(barrel, roll + (i * 2 * Math.PI) / STAR_PETALS)
    tip.copy(side).multiplyScalar(Math.cos(STAR_TILT)).addScaledVector(barrel, Math.sin(STAR_TILT))
    // The width, perpendicular to both barrel and petal: the star faces anyone looking along the barrel.
    width.crossVectors(barrel, side).normalize()
    put(tip, width, STAR_LENGTH, STAR_WIDTH)
  }
  out.length = n
  return out
}
