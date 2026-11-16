/**
 * shockShots3d.ts — THE SHOCK RIFLE'S SHOT IN 3D (family `shock`): the same electric discharge
 * the shroud wears, fired out as THREE jagged beams from the muzzle to the shot's end point.
 *
 * WHAT THE GAME DATA SAYS (step 1, time-boxed). The Shock Rifle's weapon tags (families 1a22fee6
 * and 9387a8b9, both hinf_shock_rifle) carry six effect tags, and their projectile tag (96555d72)
 * references a projectile model plus its own effect tag (9f69be2d) — the shot is an electric
 * effect, not a projectile flight. The render model's marker set puts a `muzzle_flash` marker at
 * (0.374, 0, 0.043) in model space (X toward the barrel) and a cluster of un-named markers across
 * the shroud zone x ∈ [0.29, 0.40] (55990be4 at 0.306, f674aea6 at 0.368, and ee18be86 with three
 * instances at the front lip, (0.374..0.386, ±0.009, 0.041..0.043)). The shroud's own electricity
 * is the weapon's idle effect, read from its tags (`weaponIdleEffects3d`). The effect tags' particle colors read as an electric cyan with HDR
 * channel peaks around 4.0; the exact beam count is NOT in the data the probe read, and the
 * owner confirmed the look from the game: three beams.
 *
 * WHAT IS A NAMED ESTIMATE. Everything below except the shroud marker positions: the beam count
 * (owner-confirmed), the spacing, the jag amplitude and the jitter rate.
 *
 * DETERMINISM: a function of (from, to, seed, bucket) alone; the same shot at the same match time
 * always draws the same picture. `unitHash` follows the mix of `muzzleFlash3d`.
 */
import * as THREE from 'three'

/** Beams per shot (owner-confirmed look of the game). */
export const SHOCK_BEAMS = 3
/** Life of a shot, s: full at the shot, faded linearly to zero (same as the old beam's). */
export const SHOCK_BEAM_SECONDS = 0.25
/** The jitter re-seeds this many times a second: the beams flicker, they do not creep. */
export const SHOCK_JITTER_HZ = 20
/** Jagged pieces per beam. */
export const SHOCK_SEGMENTS = 8
/** How far a beam rides off the straight line, u (the three beams are a bunched cord, not a fan). */
export const SHOCK_LATERAL = 0.02
/** The largest sideways throw of a jag, u (at the muzzle; it dies toward the end point). */
export const SHOCK_JAG = 0.05
/** The HDR boost of the cores: the brightest channel must cross the bloom threshold (1.5). */
export const SHOCK_HD = 3

/** unitHash: a number of [0, 1) from the integer `n` (integer mix; neighbors unrelated). */
export function unitHash(n: number): number {
  let h = Math.floor(n) | 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** The jitter bucket of match time `t` seconds: re-seeded SHOCK_JITTER_HZ times a second. */
export function shockJitterBucket(t: number): number {
  return Math.floor(t * SHOCK_JITTER_HZ)
}

/** One beam: its polyline from the muzzle to the end point. */
export interface ShockBeam {
  points: THREE.Vector3[]
}

const A = new THREE.Vector3()
const B = new THREE.Vector3()
const C = new THREE.Vector3()

/**
 * shockBeamPaths — the three beams of a shot from `from` (muzzle) to `to` (end point): each beam
 * is a polyline of `SHOCK_SEGMENTS + 1` points, tied to `from` and `to` (the endpoints are never
 * offset), riding a seed-fixed lateral offset around the straight line, and jaggered at its
 * interior points with a throw that fades toward `to`. `seed` is the shot's seed, `bucket` the
 * jitter bucket; `out` (length SHOCK_BEAMS, reusable) is filled.
 */
export function shockBeamPaths(
  from: THREE.Vector3,
  to: THREE.Vector3,
  seed: number,
  bucket: number,
  out: ShockBeam[],
): ShockBeam[] {
  const dir = A.subVectors(to, from)
  const len = dir.length()
  if (len < 1e-6) {
    for (let i = 0; i < SHOCK_BEAMS; i++) out[i] = { points: [from.clone(), to.clone()] }
    return out
  }
  dir.divideScalar(len)
  // A perpendicular pair around the line: the beam offsets and the jags live in it.
  const up = Math.abs(dir.y) < 0.9 ? B.set(0, 1, 0) : B.set(1, 0, 0)
  const p1 = B.crossVectors(dir, up).normalize()
  const p2 = C.crossVectors(dir, p1).normalize()
  for (let i = 0; i < SHOCK_BEAMS; i++) {
    // Each beam's own fixed direction around the line (seed) and offset (the middle beam rides
    // closer to the axis: a cord, not a fan).
    const angle = unitHash(seed * 131 + i * 7) * Math.PI * 2
    const off = SHOCK_LATERAL * (0.4 + 0.6 * unitHash(seed * 17 + i * 3))
    const ox = Math.cos(angle) * off
    const oy = Math.sin(angle) * off
    const pts: THREE.Vector3[] = [from.clone()]
    for (let k = 1; k < SHOCK_SEGMENTS; k++) {
      const s = k / SHOCK_SEGMENTS
      // The jag: a sideways throw, biggest at the muzzle, gone at the end point; re-seeded per bucket.
      const jag = SHOCK_JAG * (1 - s) * unitHash(seed * 31 + bucket * 97 + i * 11 + k)
      const a = unitHash(seed * 41 + bucket * 131 + i * 19 + k * 2) * Math.PI * 2
      const jx = Math.cos(a) * jag
      const jy = Math.sin(a) * jag
      pts.push(
        from
          .clone()
          .addScaledVector(dir, s * len)
          .addScaledVector(p1, ox + jx)
          .addScaledVector(p2, oy + jy),
      )
    }
    pts.push(to.clone())
    out[i] = { points: pts }
  }
  return out
}
