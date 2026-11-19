// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * cameraScript3d.ts — THE PURE PART of camera scripts (docs/design/camera-scripts.md, unit 1).
 *
 * A camera script is a list of keyframes on the match's time axis that places the 3D replay
 * camera at every frame: types, `parseCameraScript` (validation, version 1), and
 * `evaluateCameraScript` (one pose per drawn time). No scene, no three.js objects.
 *
 * The contract uses the replay's own terms: points in GAME coordinates (z up, headings in
 * degrees from +x toward +y), times in document milliseconds. The pose is returned in THREE
 * coordinates via `toThree`. Player anchors are resolved at the time being drawn, not at the
 * key's time; a `cut` splits the script into runs the Catmull-Rom spline never crosses.
 */
import { toThree, type Vec3 } from './tracks3d'
import { verticalFovOf } from '../model/fovLogic'
import { BODY_CENTER } from './body3d'

export type Ease = 'smooth' | 'linear' | 'in' | 'out' | 'cut'
export type ScriptVec3 = [number, number, number]

export interface WorldPoint { at: 'world'; point: ScriptVec3 }
export interface PlayerPoint {
  at: 'player'
  xuid: string
  offset?: ScriptVec3
  relative?: 'world' | 'heading'
  window?: number
}
export type ScriptPoint = WorldPoint | PlayerPoint

export interface CameraKey {
  t: number
  pos: ScriptPoint
  look: ScriptPoint
  fov?: number
  roll?: number
  ease?: Ease
}
export interface CameraScript {
  version: 1
  matchId: string
  name: string
  keys: CameraKey[]
}

export const CAMERA_SCRIPT_MAX_KEYS = 512
export const CAMERA_SCRIPT_FOV_MIN = 10
export const CAMERA_SCRIPT_FOV_MAX = 150
export const HEADING_WINDOW_DEFAULT_MS = 400

export type ParseResult = { ok: true; script: CameraScript } | { ok: false; error: string }

const NAME_RE = /^[a-z0-9_-]{1,64}$/
const EASES: readonly Ease[] = ['smooth', 'linear', 'in', 'out', 'cut']
/** Below this knot interval the Catmull-Rom degenerates; fall back to a linear lerp. */
const CR_EPS = 1e-6

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isVec3(v: unknown): v is ScriptVec3 {
  return Array.isArray(v) && v.length === 3 && v.every(isFiniteNumber)
}

/** Validates one `pos`/`look` point; returns a clean copy with only the known fields, or a short reason. */
function parsePoint(raw: unknown): { point: ScriptPoint } | { error: string } {
  if (typeof raw !== 'object' || raw === null) return { error: 'not an object' }
  const p = raw as Record<string, unknown>
  if (p.at === 'world') {
    if (!isVec3(p.point)) return { error: 'point must be 3 finite numbers' }
    return { point: { at: 'world', point: [p.point[0], p.point[1], p.point[2]] } }
  }
  if (p.at === 'player') {
    if (typeof p.xuid !== 'string' || p.xuid.length === 0) return { error: 'xuid must be a non-empty string' }
    const out: PlayerPoint = { at: 'player', xuid: p.xuid }
    if (p.offset !== undefined) {
      if (!isVec3(p.offset)) return { error: 'offset must be 3 finite numbers' }
      out.offset = [p.offset[0], p.offset[1], p.offset[2]]
    }
    if (p.relative !== undefined) {
      if (p.relative !== 'world' && p.relative !== 'heading') return { error: "relative must be 'world' or 'heading'" }
      out.relative = p.relative
    }
    if (p.window !== undefined) {
      if (!isFiniteNumber(p.window) || p.window <= 0 || p.window > 5000) {
        return { error: 'window must be a finite number in (0, 5000]' }
      }
      out.window = p.window
    }
    return { point: out }
  }
  return { error: "at must be 'world' or 'player'" }
}

/**
 * Validates a raw camera script (version 1) and returns a clean copy with only the known
 * fields, or a short English error naming the problem (and the key index, when there is one).
 */
export function parseCameraScript(raw: unknown, expectedMatchId?: string): ParseResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'script is not an object' }
  const r = raw as Record<string, unknown>
  if (r.version !== 1) return { ok: false, error: 'version must be exactly 1' }
  if (typeof r.matchId !== 'string' || r.matchId.length === 0) {
    return { ok: false, error: 'matchId must be a non-empty string' }
  }
  if (expectedMatchId !== undefined && r.matchId !== expectedMatchId) {
    return { ok: false, error: `matchId '${r.matchId}' does not match the route's '${expectedMatchId}'` }
  }
  if (typeof r.name !== 'string' || !NAME_RE.test(r.name)) {
    return { ok: false, error: 'name must be 1 to 64 characters of [a-z0-9_-]' }
  }
  if (!Array.isArray(r.keys)) return { ok: false, error: 'keys must be an array' }
  if (r.keys.length > CAMERA_SCRIPT_MAX_KEYS) {
    return { ok: false, error: `keys has ${r.keys.length} entries; at most ${CAMERA_SCRIPT_MAX_KEYS}` }
  }

  const keys: CameraKey[] = []
  for (let i = 0; i < r.keys.length; i++) {
    const raw = r.keys[i]
    if (typeof raw !== 'object' || raw === null) return { ok: false, error: `key ${i} is not an object` }
    const k = raw as Record<string, unknown>
    if (!isFiniteNumber(k.t) || k.t < 0) return { ok: false, error: `key ${i}: t must be a finite number >= 0` }
    if (i > 0) {
      const prevT = keys[i - 1].t
      if (k.t < prevT) return { ok: false, error: `key ${i}: keys are not sorted by t` }
      if (k.t === prevT && k.ease !== 'cut') {
        return { ok: false, error: `key ${i}: a key sharing its time with key ${i - 1} must be a cut` }
      }
    }
    const pos = parsePoint(k.pos)
    if ('error' in pos) return { ok: false, error: `key ${i}: pos ${pos.error}` }
    const look = parsePoint(k.look)
    if ('error' in look) return { ok: false, error: `key ${i}: look ${look.error}` }
    const out: CameraKey = { t: k.t, pos: pos.point, look: look.point }
    if (k.fov !== undefined) {
      if (!isFiniteNumber(k.fov) || k.fov < CAMERA_SCRIPT_FOV_MIN || k.fov > CAMERA_SCRIPT_FOV_MAX) {
        return { ok: false, error: `key ${i}: fov must be a finite number in [${CAMERA_SCRIPT_FOV_MIN}, ${CAMERA_SCRIPT_FOV_MAX}]` }
      }
      out.fov = k.fov
    }
    if (k.roll !== undefined) {
      if (!isFiniteNumber(k.roll)) return { ok: false, error: `key ${i}: roll must be a finite number` }
      out.roll = k.roll
    }
    if (k.ease !== undefined) {
      if (typeof k.ease !== 'string' || !EASES.includes(k.ease as Ease)) {
        return { ok: false, error: `key ${i}: ease must be one of ${EASES.join(', ')}` }
      }
      out.ease = k.ease as Ease
    }
    keys.push(out)
  }

  return { ok: true, script: { version: 1, matchId: r.matchId, name: r.name, keys } }
}

/** The camera pose in THREE coordinates. */
export interface ScriptPose {
  position: ScriptVec3
  target: ScriptVec3
  verticalFov: number
  rollDeg: number
}

/** A player's feet in GAME coordinates (already floor-adjusted by the caller) and heading (deg) at document ms `tMs`; null when unknown. */
export interface ScriptSubjects {
  feetAt(xuid: string, tMs: number): { x: number; y: number; z: number; h: number } | null
}

/** circularMeanDeg — the mean direction of a set of angles in degrees, in [0, 360). */
export function circularMeanDeg(degs: readonly number[]): number {
  let sx = 0
  let sy = 0
  for (const d of degs) {
    const rad = (d * Math.PI) / 180
    sx += Math.cos(rad)
    sy += Math.sin(rad)
  }
  let deg = (Math.atan2(sy, sx) * 180) / Math.PI
  if (deg < 0) deg += 360
  // A mean that sits on the 359/0 seam within float noise reads as just under 360; it is 0.
  if (deg > 360 - 1e-9) deg = 0
  return deg
}

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u
}

function easeOf(ease: Ease, u: number): number {
  switch (ease) {
    case 'smooth':
      return u * u * (3 - 2 * u)
    case 'linear':
      return u
    case 'in':
      return u * u
    case 'out':
      return 1 - (1 - u) * (1 - u)
    case 'cut':
      return u
  }
}

/** Resolves a point at the time being drawn into GAME coordinates; null when the player is unknown. */
function resolvePoint(point: ScriptPoint, tMs: number, subjects: ScriptSubjects, isLook: boolean): Vec3 | null {
  if (point.at === 'world') return point.point
  const feet = subjects.feetAt(point.xuid, tMs)
  if (feet === null) return null
  // A look point WITHOUT an offset aims at the body center; every other point uses [0,0,0].
  const offset: ScriptVec3 = point.offset ?? (isLook ? [0, 0, BODY_CENTER] : [0, 0, 0])
  if (point.relative === 'heading') {
    // The heading is a circular mean over 8 samples ending at tMs; a pure function of tMs.
    const window = point.window ?? HEADING_WINDOW_DEFAULT_MS
    const samples: number[] = []
    for (let i = 0; i < 8; i++) {
      const s = subjects.feetAt(point.xuid, tMs - (window * i) / 7)
      if (s !== null) samples.push(s.h)
    }
    const h = samples.length > 0 ? circularMeanDeg(samples) : feet.h
    const rad = (h * Math.PI) / 180
    // fwd = (cos h, sin h, 0), left = (-sin h, cos h, 0); the offset's axes are x fwd, y left, z up.
    const fx = Math.cos(rad)
    const fy = Math.sin(rad)
    return [
      feet.x + fx * offset[0] - fy * offset[1],
      feet.y + fy * offset[0] + fx * offset[1],
      feet.z + offset[2],
    ]
  }
  return [feet.x + offset[0], feet.y + offset[1], feet.z + offset[2]]
}

/** The reflection of `other` across `base` (the phantom a run's end mirrors through its neighbor). */
function mirrorVec(base: Vec3, other: Vec3): Vec3 {
  return [2 * base[0] - other[0], 2 * base[1] - other[1], 2 * base[2] - other[2]]
}

/**
 * Centripetal Catmull-Rom (alpha 0.5, Barry-Goldman form) between P1 and P2 at u, steered by P0 and P3.
 * P1 and P2 coinciding has nothing to interpolate: the result is P1. A neighbor that coincides with an
 * end point would collapse a centripetal knot to a forced straight line, so it is replaced by the
 * mirrored phantom (2*P1 - P2, or 2*P2 - P1) and its distance recomputed: the segment keeps curving,
 * and the result is never NaN.
 */
function catmullRom(P0: Vec3, P1: Vec3, P2: Vec3, P3: Vec3, u: number): Vec3 {
  const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  const d2 = Math.sqrt(dist(P1, P2))
  if (d2 < CR_EPS) return [P1[0], P1[1], P1[2]]
  let Q0 = P0
  let Q3 = P3
  let d1 = Math.sqrt(dist(P0, P1))
  if (d1 < CR_EPS) {
    Q0 = mirrorVec(P1, P2)
    d1 = Math.sqrt(dist(Q0, P1))
  }
  let d3 = Math.sqrt(dist(P2, P3))
  if (d3 < CR_EPS) {
    Q3 = mirrorVec(P2, P1)
    d3 = Math.sqrt(dist(Q3, P2))
  }
  // Knots: P1 at T1, P2 at T2; the span P1..P2 is normalized to u.
  const T1 = d1
  const T2 = d1 + d2
  const T3 = T2 + d3
  const T = T1 + u * d2
  // First pass: three linear interpolations.
  const ax = lerp(Q0[0], P1[0], T / T1)
  const ay = lerp(Q0[1], P1[1], T / T1)
  const az = lerp(Q0[2], P1[2], T / T1)
  const bx = lerp(P1[0], P2[0], u)
  const by = lerp(P1[1], P2[1], u)
  const bz = lerp(P1[2], P2[2], u)
  const cx = lerp(P2[0], Q3[0], (T - T2) / d3)
  const cy = lerp(P2[1], Q3[1], (T - T2) / d3)
  const cz = lerp(P2[2], Q3[2], (T - T2) / d3)
  // Second pass.
  const dx = lerp(ax, bx, T / T2)
  const dy = lerp(ay, by, T / T2)
  const dz = lerp(az, bz, T / T2)
  const ex = lerp(bx, cx, (T - T1) / (T3 - T1))
  const ey = lerp(by, cy, (T - T1) / (T3 - T1))
  const ez = lerp(bz, cz, (T - T1) / (T3 - T1))
  return [lerp(dx, ex, u), lerp(dy, ey, u), lerp(dz, ez, u)]
}

/**
 * The scripted camera pose at document ms `tMs`, in THREE coordinates, or null for a keyless
 * script. Player anchors resolve at `tMs` (the time being drawn); a key before the first key
 * holds the first key, a cut key holds the previous key, both still resolved at `tMs`, so a
 * held player key keeps following its player.
 */
export function evaluateCameraScript(
  script: CameraScript,
  tMs: number,
  subjects: ScriptSubjects,
  baseGameFov: number,
): ScriptPose | null {
  const keys = script.keys
  if (keys.length === 0) return null

  const isCut = (i: number): boolean => keys[i].ease === 'cut'
  // Two keys are in the same run when no cut key sits between them (a cut key starts a new run).
  const sameRun = (a: number, b: number): boolean => {
    for (let i = Math.min(a, b) + 1; i <= Math.max(a, b); i++) if (isCut(i)) return false
    return true
  }

  // k = the last key at or before tMs; before key 0, k = 0 and key 0 holds.
  let k = 0
  for (let i = 0; i < keys.length; i++) if (keys[i].t <= tMs) k = i

  // An unresolved point takes the resolved point of the same field on the nearest earlier key
  // in the same run, else the nearest later key in the same run, else the world origin.
  const resolve = (i: number, field: 'pos' | 'look'): Vec3 => {
    const point = keys[i][field]
    const direct = resolvePoint(point, tMs, subjects, field === 'look')
    if (direct !== null) return direct
    for (let j = i - 1; j >= 0; j--) {
      if (!sameRun(j, i)) break
      const earlier = resolvePoint(keys[j][field], tMs, subjects, field === 'look')
      if (earlier !== null) return earlier
    }
    for (let j = i + 1; j < keys.length; j++) {
      if (!sameRun(i, j)) break
      const later = resolvePoint(keys[j][field], tMs, subjects, field === 'look')
      if (later !== null) return later
    }
    return [0, 0, 0]
  }

  if (tMs < keys[0].t || k === keys.length - 1 || isCut(k + 1)) {
    // Hold key k: its points, resolved at tMs.
    const position = toThree(...resolve(k, 'pos'))
    const target = toThree(...resolve(k, 'look'))
    return {
      position,
      target,
      verticalFov: verticalFovOf(keys[k].fov ?? baseGameFov),
      rollDeg: keys[k].roll ?? 0,
    }
  }

  const u = easeOf(keys[k + 1].ease ?? 'smooth', (tMs - keys[k].t) / (keys[k + 1].t - keys[k].t))

  // Spline neighbors: a run's end is mirrored through its neighbor (a phantom), so the first and last
  // segment of a run still curve instead of going straight to a duplicated point.
  const P1 = resolve(k, 'pos')
  const P2 = resolve(k + 1, 'pos')
  const P0 = k >= 1 && sameRun(k - 1, k) ? resolve(k - 1, 'pos') : mirrorVec(P1, P2)
  const P3 = k + 2 < keys.length && sameRun(k + 1, k + 2) ? resolve(k + 2, 'pos') : mirrorVec(P2, P1)
  const L1 = resolve(k, 'look')
  const L2 = resolve(k + 1, 'look')
  const L0 = k >= 1 && sameRun(k - 1, k) ? resolve(k - 1, 'look') : mirrorVec(L1, L2)
  const L3 = k + 2 < keys.length && sameRun(k + 1, k + 2) ? resolve(k + 2, 'look') : mirrorVec(L2, L1)

  return {
    position: toThree(...catmullRom(P0, P1, P2, P3, u)),
    target: toThree(...catmullRom(L0, L1, L2, L3, u)),
    verticalFov: verticalFovOf(lerp(keys[k].fov ?? baseGameFov, keys[k + 1].fov ?? baseGameFov, u)),
    rollDeg: lerp(keys[k].roll ?? 0, keys[k + 1].roll ?? 0, u),
  }
}
