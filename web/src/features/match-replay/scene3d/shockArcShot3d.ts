// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * shockArcShot3d.ts — THE SHOCK RIFLE'S SHOT AS ELECTRICITY (camera-script `shockLook: 'arc'`): a
 * thin jagged core bolt from the muzzle to the shot's end point, short forking side arcs off it, and
 * a small arc burst at the impact. The default look stays the three beams of `shockShots3d`.
 *
 * WHAT THE GAME DATA SAYS (read 2026-11-20 with himap.EffetDeParticules off sgh_blueprint). The
 * projectile (`proj` 96555d72) names one effect, 9f69be2d: ONE event of particle systems and no
 * beam, contrail or light blocks. Its one readable system is particle aee88cad, a camera-facing
 * sprite of the arc sheet a119e9dd (4 frames) through the palette b5c0b591: the SAME texture and
 * palette the barrel's idle electricity (effect 1e471031, `weaponIdleEffects3d`) draws. That
 * particle lives 0.085..0.115 s, is 0.001..0.04 u across, intensity 200, its frame fixed per
 * particle. The two other systems (particles 0f7addc5 on sheet 262e7dba, c982e143 on sheet
 * 3f8dead6) are left out by the decoder (a size function of type 3). So the game draws the shot as
 * arc SPRITES riding the projectile, not as a modeled bolt: no width, segment count, fork count or
 * jitter rate exists in the data.
 *
 * THE IMPACT (INFERRED: the child projectile `proj` c489908c of 96555d72 names effect ae231ce9;
 * that it is the shot's impact is not read from a detonation field). Its arc system is the same
 * particle aee88cad: 2 arcs (startingCount 2) emitted 0.05 u off the point (emissionRadius), living
 * 0.22..0.15 s (lifespan, by a random), intensity 200, alpha 1, their frame fixed per particle,
 * growing over their life from 0.005 u to 0.225 u (size: a ranged multi-spline of particle age,
 * `IMPACT_ARC_SIZE`, copied from the tag). Those are used as read. Its flash sprite system
 * (f6237543, 2 sprites of 0.075 s) is not drawn here: the existing spark stands in for it.
 *
 * WHAT IS A NAMED ESTIMATE: the bolt itself (its radius, its glow, its roughness and corridor, its
 * finest step), the forks (spacing, count cap, length range within the impact arcs' data size,
 * angle, width), the on-screen minimum widths, and the life and jitter of bolt and forks (the
 * default look's `SHOCK_BEAM_SECONDS` and `SHOCK_JITTER_HZ`, kept so the two looks age alike).
 *
 * DETERMINISM: every point is a function of (from, to, seed, bucket) alone, the impact arcs of
 * (to, back, seed, age); `unitHash` as `shockShots3d`. A frozen frame holds, exports out of order
 * draw the same picture.
 */
import * as THREE from 'three'

import { unitHash } from './shockShots3d'
import { propertyAt, type ParticleFunction } from './weaponIdleEffects3dModel'

/** The bolt's core radius, u (~4.5 mm): a thread of light, an ESTIMATE under the flight arcs' 0.04 u sprites. */
export const ARC_CORE_RADIUS = 0.0015
/** The glow around every stroke: this multiple of the core's radius, at this fraction of its strength (ESTIMATES). */
export const ARC_GLOW_MULT = 3
export const ARC_GLOW_DIM = 0.3
/** How white the core burns: the shot's tint mixed this far toward white (blue-white, ESTIMATE). */
export const ARC_CORE_WHITE = 0.65
/** The finest step of the bolt's jag, u (ESTIMATE): the bolt subdivides until its pieces are this short. */
export const ARC_STEP = 0.08
/** At most 2^ARC_MAX_DEPTH pieces in a bolt (128): a 30 u shot keeps ~0.23 u pieces. */
export const ARC_MAX_DEPTH = 7
/** A midpoint's sideways throw: this fraction of its piece's half length (ESTIMATE)... */
export const ARC_ROUGHNESS = 0.4
/** ...never more than this, u (the default beams' `SHOCK_JAG`): the bolt stays in a narrow corridor. */
export const ARC_JAG_MAX = 0.05
/** One fork per this length of bolt, u (ESTIMATE), at most ARC_FORKS_MAX. */
export const ARC_FORK_SPACING = 0.5
export const ARC_FORKS_MAX = 32
/** A fork's length, u (ESTIMATE, within the impact arcs' data size, 0.005..0.225 u). */
export const ARC_FORK_MIN = 0.06
export const ARC_FORK_MAX = 0.225
/** A fork leaves the bolt this many degrees off its axis (ESTIMATE). */
export const ARC_FORK_ANGLE_MIN = 25
export const ARC_FORK_ANGLE_MAX = 60
/** Pieces in a fork or an impact arc: 2^ARC_SIDE_DEPTH. */
export const ARC_SIDE_DEPTH = 3
/** A fork's width against the core's (ESTIMATE). */
export const ARC_FORK_WIDTH = 0.7
/** The smallest on-screen width, pixels (ESTIMATES): the core and the glow never thin below them. */
export const ARC_CORE_MIN_PX = 1.5
export const ARC_GLOW_MIN_PX = 4

/** The impact's arcs (effect ae231ce9, particle aee88cad): count, emission radius (u), lifespan bounds (s). */
export const IMPACT_ARCS = 2
export const IMPACT_ARC_RADIUS = 0.05
export const IMPACT_ARC_LIFE_A = 0.22
export const IMPACT_ARC_LIFE_B = 0.15
/** The impact arcs' size (u) over particle age, ranged by a particle random: read from the tag. */
export const IMPACT_ARC_SIZE: ParticleFunction = {
  input: 0,
  rangeInput: 22,
  type: 8,
  ranged: true,
  min: 0.005,
  max: 0.225,
  curves: [
    [
      { end: 0.5474846, coefs: [-3.9759028, 1.9758453, 1.7857144, 0] },
      { end: 3.4028235e38, coefs: [0.044326123, -0.5161372, 0.89929557, 0.57251537] },
    ],
    [
      { end: 0.5091513, coefs: [-0.4085003, -0.6451286, 1.3851638, 0] },
      { end: 3.4028235e38, coefs: [0.6272476, -1.7841449, 1.7395204, -0.021856517] },
    ],
  ],
}

/** One stroke of the arc look: a polyline, its width against the core's, its strength (0..1). */
export interface ArcStroke {
  points: THREE.Vector3[]
  width: number
  strength: number
}

const D = new THREE.Vector3()
const P1 = new THREE.Vector3()
const P2 = new THREE.Vector3()
const UP_Y = new THREE.Vector3(0, 1, 0)
const UP_X = new THREE.Vector3(1, 0, 0)

/** perpendiculars: two unit vectors perpendicular to unit `dir` and to each other, written in `a`, `b`. */
function perpendiculars(dir: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): void {
  a.crossVectors(dir, Math.abs(dir.y) < 0.9 ? UP_Y : UP_X).normalize()
  b.crossVectors(dir, a).normalize()
}

/**
 * jaggedPath — a midpoint-displaced polyline of 2^depth pieces from `a` to `b` (both kept exactly):
 * each level throws every midpoint sideways (in the plane across the a→b line) by up to
 * `roughness` x its piece's half length, capped at `cap`, in a direction and size drawn from
 * `unitHash(salt + ...)`. A pure function of its arguments.
 */
export function jaggedPath(a: THREE.Vector3, b: THREE.Vector3, depth: number, roughness: number, cap: number, salt: number): THREE.Vector3[] {
  const n = 1 << depth
  const pts: THREE.Vector3[] = new Array(n + 1)
  pts[0] = a.clone()
  pts[n] = b.clone()
  const dir = D.subVectors(b, a)
  const len = dir.length()
  if (len < 1e-6) {
    for (let i = 1; i < n; i++) pts[i] = a.clone()
    return pts
  }
  dir.divideScalar(len)
  const p1 = P1
  const p2 = P2
  perpendiculars(dir, p1, p2)
  for (let step = n; step > 1; step >>= 1) {
    const h = step >> 1
    const amp = Math.min(roughness * (len * h) / n, cap)
    for (let i = h; i < n; i += step) {
      const k = salt + i * 13 + step * 7
      const ang = unitHash(k) * Math.PI * 2
      const r = amp * (0.25 + 0.75 * unitHash(k + 5))
      pts[i] = pts[i - h]
        .clone()
        .add(pts[i + h])
        .multiplyScalar(0.5)
        .addScaledVector(p1, Math.cos(ang) * r)
        .addScaledVector(p2, Math.sin(ang) * r)
    }
  }
  return pts
}

/** boltDepth: how many times a bolt of `len` u halves (its finest pieces near ARC_STEP), 2..ARC_MAX_DEPTH. */
export function boltDepth(len: number): number {
  if (!(len > ARC_STEP)) return 2
  return Math.min(ARC_MAX_DEPTH, Math.max(2, Math.ceil(Math.log2(len / ARC_STEP))))
}

/** forkCount: the forks of a bolt of `len` u: one per ARC_FORK_SPACING, at least 1, at most ARC_FORKS_MAX. */
export function forkCount(len: number): number {
  if (!(len > 0)) return 0
  return Math.min(ARC_FORKS_MAX, Math.max(1, Math.round(len / ARC_FORK_SPACING)))
}

/**
 * shockArcStrokes — the arc look's bolt and forks from `from` (muzzle) to `to` (end point) for the
 * shot `seed` in jitter bucket `bucket`: stroke 0 the core bolt (width 1, strength 1), then
 * `forkCount` forks, each leaving a bolt point (never an end) forward of the bolt's axis by
 * ARC_FORK_ANGLE_MIN..MAX degrees, ARC_FORK_MIN..MAX u long, at ARC_FORK_WIDTH and a strength of
 * 0.5..1. Everything is re-seeded per bucket. A zero-length shot draws nothing.
 */
export function shockArcStrokes(from: THREE.Vector3, to: THREE.Vector3, seed: number, bucket: number): ArcStroke[] {
  const len = from.distanceTo(to)
  if (len < 1e-6) return []
  const salt = seed * 7919 + bucket * 104729
  const core = jaggedPath(from, to, boltDepth(len), ARC_ROUGHNESS, ARC_JAG_MAX, salt)
  const out: ArcStroke[] = [{ points: core, width: 1, strength: 1 }]
  const dir = new THREE.Vector3().subVectors(to, from).divideScalar(len)
  const p1 = new THREE.Vector3()
  const p2 = new THREE.Vector3()
  perpendiculars(dir, p1, p2)
  const forks = forkCount(len)
  const last = core.length - 1
  for (let f = 0; f < forks; f++) {
    const k = salt + 1_000_003 + f * 31
    const at = core[1 + Math.floor(unitHash(k) * (last - 1))]
    const theta = THREE.MathUtils.degToRad(ARC_FORK_ANGLE_MIN + (ARC_FORK_ANGLE_MAX - ARC_FORK_ANGLE_MIN) * unitHash(k + 1))
    const phi = unitHash(k + 2) * Math.PI * 2
    const flen = Math.min(len, ARC_FORK_MIN + (ARC_FORK_MAX - ARC_FORK_MIN) * unitHash(k + 3))
    const fdir = dir
      .clone()
      .multiplyScalar(Math.cos(theta))
      .addScaledVector(p1, Math.sin(theta) * Math.cos(phi))
      .addScaledVector(p2, Math.sin(theta) * Math.sin(phi))
    const end = at.clone().addScaledVector(fdir, flen)
    out.push({
      points: jaggedPath(at, end, ARC_SIDE_DEPTH, ARC_ROUGHNESS, ARC_JAG_MAX, k + 17),
      width: ARC_FORK_WIDTH,
      strength: 0.5 + 0.5 * unitHash(k + 4),
    })
  }
  return out
}

/** impactArcLife: the life (s) of impact arc `i` of shot `seed`: IMPACT_ARC_LIFE_A..B by a particle random. */
export function impactArcLife(seed: number, i: number): number {
  return IMPACT_ARC_LIFE_A + (IMPACT_ARC_LIFE_B - IMPACT_ARC_LIFE_A) * unitHash(seed * 613 + i * 37 + 3)
}

/**
 * shockImpactArcs — the impact's arcs `age` s after the shot at the end point `to`, `back` the unit
 * direction from `to` toward the muzzle: IMPACT_ARCS arcs, each born IMPACT_ARC_RADIUS off the
 * point in the half-space facing `back`, reaching out along that direction to the tag's size at
 * its age (`IMPACT_ARC_SIZE`), gone at the end of its life (`impactArcLife`). Their shape is fixed
 * for their life (the particle's frame is), so a function of (to, back, seed, age) only.
 */
export function shockImpactArcs(to: THREE.Vector3, back: THREE.Vector3, seed: number, age: number): ArcStroke[] {
  const out: ArcStroke[] = []
  if (age < 0) return out
  const p1 = new THREE.Vector3()
  const p2 = new THREE.Vector3()
  perpendiculars(back, p1, p2)
  for (let i = 0; i < IMPACT_ARCS; i++) {
    const life = impactArcLife(seed, i)
    if (age >= life) continue
    const k = seed * 613 + i * 37
    const random = unitHash(k + 7)
    const size = propertyAt(IMPACT_ARC_SIZE, (input) => (input === 0 ? age / life : random))
    // A direction in the half-space toward the muzzle: `back` tilted up to 80 degrees.
    const theta = THREE.MathUtils.degToRad(80) * unitHash(k + 11)
    const phi = unitHash(k + 13) * Math.PI * 2
    const d = back
      .clone()
      .multiplyScalar(Math.cos(theta))
      .addScaledVector(p1, Math.sin(theta) * Math.cos(phi))
      .addScaledVector(p2, Math.sin(theta) * Math.sin(phi))
    const start = to.clone().addScaledVector(d, IMPACT_ARC_RADIUS)
    const end = start.clone().addScaledVector(d, size)
    out.push({ points: jaggedPath(start, end, ARC_SIDE_DEPTH, ARC_ROUGHNESS, ARC_JAG_MAX, k + 19), width: ARC_FORK_WIDTH, strength: 1 })
  }
  return out
}

/**
 * minWidthScale — how much a stroke piece of radius `radius` (view units) widens so it spans at
 * least `minPx` pixels: 1 when it already does. `clipW` is the piece's clip-space w (its depth in a
 * perspective view, 1 in an orthographic one), `projYY` the projection's [1][1], `viewportPx` the
 * target's height. The arc material's vertex shader computes the same (`widenedMaterial`).
 */
export function minWidthScale(radius: number, clipW: number, projYY: number, viewportPx: number, minPx: number): number {
  const perPx = (clipW * 2) / (projYY * viewportPx)
  return Math.max(1, (0.5 * minPx * perPx) / Math.max(radius, 1e-9))
}

/**
 * widenedMaterial — an additive glow for a `SegmentPool` whose cylinders never thin below `minPx`
 * pixels: the vertex shader widens each instance across its axis by `minWidthScale`, read at the
 * vertex's own point of the axis (a long piece widens more at its far end). `attach` hooks the
 * pool's mesh to read the target's height at render time (export targets included).
 */
export function widenedMaterial(minPx: number): { material: THREE.MeshBasicMaterial; attach: (mesh: THREE.Mesh) => void } {
  const material = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
  const uniforms = { uViewportPx: { value: 1080 }, uMinPx: { value: minPx } }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader =
      'uniform float uViewportPx;\nuniform float uMinPx;\n' +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        `#ifdef USE_INSTANCING
  {
    mat4 arcMv = modelViewMatrix * instanceMatrix;
    float arcR = length(arcMv[0].xyz);
    vec4 arcClip = projectionMatrix * (arcMv * vec4(0.0, transformed.y, 0.0, 1.0));
    float arcPerPx = arcClip.w * 2.0 / (projectionMatrix[1][1] * uViewportPx);
    float arcK = max(1.0, 0.5 * uMinPx * arcPerPx / max(arcR, 1e-9));
    transformed.xz *= arcK;
  }
#endif
#include <project_vertex>`,
      )
  }
  material.customProgramCacheKey = () => 'shock-arc-widened'
  const viewport = new THREE.Vector4()
  const attach = (mesh: THREE.Mesh) => {
    mesh.onBeforeRender = (renderer) => {
      renderer.getCurrentViewport(viewport)
      if (viewport.w > 0) uniforms.uViewportPx.value = viewport.w
    }
  }
  return { material, attach }
}
