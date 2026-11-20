// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * cameraScript3d.ts — THE PURE PART of camera scripts (docs/design/camera-scripts.md, unit 1).
 *
 * A camera script is a list of keyframes on the match's time axis that places the 3D replay
 * camera at every frame: types, `parseCameraScript` (validation, version 1), and
 * `evaluateCameraScript` (one pose per drawn script time). No scene, no three.js objects.
 *
 * The contract uses the replay's own terms: points in GAME coordinates (z up, headings in
 * degrees from +x toward +y). Key times are SCRIPT milliseconds; an optional `clock` maps
 * script time to document milliseconds (the film's own time) through a rate track, so a shot
 * can slow, speed or freeze the world while the camera keeps moving. An optional `holds` array
 * takes players out of the film to pose for the camera (docs/design/hold.md). The pose is
 * returned in THREE coordinates via `toThree`. Player anchors resolve at the clock's document time, not at
 * the key's script time; without a clock, script time is document time. A `cut` splits the
 * script into runs the Catmull-Rom spline never crosses.
 */
import { toThree, type Vec3 } from './tracks3d'
import { verticalFovOf } from '../model/fovLogic'
import { BODY_CENTER } from './body3d'
import { parseHolds, type Hold } from './hold3d'

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

export interface ClockRate {
  s: number
  rate: number
  ease: Ease
}
export interface ScriptClock {
  startMs: number
  rates: ClockRate[]
}
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
  clock?: ScriptClock
  holds?: Hold[]
}

export const CAMERA_SCRIPT_MAX_KEYS = 512
export const CAMERA_SCRIPT_FOV_MIN = 10
export const CAMERA_SCRIPT_FOV_MAX = 150
export const HEADING_WINDOW_DEFAULT_MS = 400
export const CLOCK_RATE_MIN = 0
export const CLOCK_RATE_MAX = 4
/**
 * The closest two keys of one run may be (script ms). A camera move is a few keys with the
 * spline between them; a path sampled into dense keys loses the spline and carries every
 * sample's error as jitter. A cut starts a new run, so it may follow at any gap.
 */
export const CAMERA_SCRIPT_MIN_KEY_GAP_MS = 250

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

/** Validates a raw `clock` (version 1); returns a clean copy with only the known fields, or a short reason. */
function parseClock(raw: unknown): { clock: ScriptClock } | { error: string } {
  if (typeof raw !== 'object' || raw === null) return { error: 'clock is not an object' }
  const c = raw as Record<string, unknown>
  if (!isFiniteNumber(c.startMs) || c.startMs < 0) return { error: 'clock.startMs must be a finite number >= 0' }
  if (!Array.isArray(c.rates)) return { error: 'clock.rates must be an array' }
  if (c.rates.length === 0) return { error: 'clock.rates must have at least one entry' }
  if (c.rates.length > CAMERA_SCRIPT_MAX_KEYS) {
    return { error: `clock.rates has ${c.rates.length} entries; at most ${CAMERA_SCRIPT_MAX_KEYS}` }
  }
  const rates: ClockRate[] = []
  for (let i = 0; i < c.rates.length; i++) {
    const e = c.rates[i]
    if (typeof e !== 'object' || e === null) return { error: `clock.rates[${i}] is not an object` }
    const re = e as Record<string, unknown>
    if (!isFiniteNumber(re.s) || re.s < 0) return { error: `clock.rates[${i}].s must be a finite number >= 0` }
    if (i > 0 && re.s < rates[i - 1].s) return { error: `clock.rates[${i}].s: rates are not sorted by s` }
    if (!isFiniteNumber(re.rate) || re.rate < CLOCK_RATE_MIN || re.rate > CLOCK_RATE_MAX) {
      return { error: `clock.rates[${i}].rate must be a finite number in [${CLOCK_RATE_MIN}, ${CLOCK_RATE_MAX}]` }
    }
    let ease: Ease = 'smooth'
    if (re.ease !== undefined) {
      if (typeof re.ease !== 'string' || !EASES.includes(re.ease as Ease)) {
        return { error: `clock.rates[${i}].ease must be one of ${EASES.join(', ')}` }
      }
      ease = re.ease as Ease
    }
    rates.push({ s: re.s, rate: re.rate, ease })
  }
  return { clock: { startMs: c.startMs, rates } }
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
      if (k.ease !== 'cut' && k.t - prevT < CAMERA_SCRIPT_MIN_KEY_GAP_MS) {
        return {
          ok: false,
          error:
            `key ${i}: ${k.t - prevT} ms after key ${i - 1}; keys in a run must be at least ${CAMERA_SCRIPT_MIN_KEY_GAP_MS} ms apart ` +
            '(a move is a few keys with the spline between them, not a sampled path; a jump is a cut)',
        }
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

  let clock: ScriptClock | undefined
  if (r.clock !== undefined) {
    const parsed = parseClock(r.clock)
    if ('error' in parsed) return { ok: false, error: parsed.error }
    clock = parsed.clock
  }

  let holds: Hold[] | undefined
  if (r.holds !== undefined) {
    const parsed = parseHolds(r.holds)
    if ('error' in parsed) return { ok: false, error: parsed.error }
    holds = parsed.holds
  }

  const script: CameraScript = { version: 1, matchId: r.matchId, name: r.name, keys }
  if (clock !== undefined) script.clock = clock
  if (holds !== undefined) script.holds = holds
  return { ok: true, script }
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

/** The integral of an ease curve from 0 to u; E(u) in the closed form. 0 for cut, which holds the previous rate until it jumps. */
function easeIntegral(ease: Ease, u: number): number {
  switch (ease) {
    case 'smooth':
      return u * u * u - (u * u * u * u) / 2
    case 'linear':
      return (u * u) / 2
    case 'in':
      return (u * u * u) / 3
    case 'out':
      return u * u - (u * u * u) / 3
    case 'cut':
      return 0
  }
}

/** The script's clock view: script time to document time, the rate at script time, and the script's length in script ms. */
export interface ScriptClockView {
  docMsAt(s: number): number
  rateAt(s: number): number
  lengthMs: number
}

/**
 * Maps a script's clock to document time. Without a clock, script time IS document time
 * (start 0, rate 1). With one, `docMs(s) = startMs + ∫₀ˢ rate`, in closed form per segment
 * (each ease's integral), so it is a pure function of s and the export samples it exactly.
 */
export function scriptClockOf(script: CameraScript): ScriptClockView {
  const keys = script.keys
  const lastKeyT = keys.length > 0 ? keys[keys.length - 1].t : 0

  const clock = script.clock
  if (clock === undefined) {
    return {
      docMsAt: (s: number): number => s,
      rateAt: (): number => 1,
      lengthMs: lastKeyT,
    }
  }

  const { startMs, rates } = clock
  const n = rates.length
  const firstS = rates[0].s
  const lastS = rates[n - 1].s

  // Cumulative document ms at each entry's s: cum[i] = ∫₀^{s_i} rate.
  const cum: number[] = new Array(n)
  cum[0] = rates[0].rate * firstS // constant first rate on [0, s_0]
  for (let i = 1; i < n; i++) {
    const L = rates[i].s - rates[i - 1].s
    const r0 = rates[i - 1].rate
    const r1 = rates[i].rate
    cum[i] = cum[i - 1] + (L === 0 ? 0 : L * (r0 + (r1 - r0) * easeIntegral(rates[i].ease, 1)))
  }

  // The entry i such that rates[i-1].s <= s <= rates[i].s (callers ensure firstS < s < lastS).
  const segment = (s: number): number => {
    let i = 1
    while (rates[i].s < s) i++
    return i
  }

  return {
    docMsAt(s: number): number {
      if (s <= firstS) return startMs + rates[0].rate * s // constant first rate
      if (s >= lastS) return startMs + cum[n - 1] + rates[n - 1].rate * (s - lastS) // constant last rate
      const i = segment(s)
      const s0 = rates[i - 1].s
      const s1 = rates[i].s
      if (s0 === s1) return startMs + cum[i - 1] // zero-length segment: no integral
      const L = s1 - s0
      const u = (s - s0) / L
      const r0 = rates[i - 1].rate
      const r1 = rates[i].rate
      return startMs + cum[i - 1] + L * (r0 * u + (r1 - r0) * easeIntegral(rates[i].ease, u))
    },
    rateAt(s: number): number {
      if (s < firstS) return rates[0].rate
      if (s >= lastS) return rates[n - 1].rate
      const i = segment(s)
      const s0 = rates[i - 1].s
      const s1 = rates[i].s
      const r0 = rates[i - 1].rate
      const r1 = rates[i].rate
      if (s0 === s1) return r1 // two entries at one s: the later wins from that s on
      const u = (s - s0) / (s1 - s0)
      if (rates[i].ease === 'cut') return u >= 1 ? r1 : r0 // cut: the previous rate holds until s1, then jumps
      return r0 + (r1 - r0) * easeOf(rates[i].ease, u)
    },
    lengthMs: Math.max(lastKeyT, lastS),
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
 * The scripted camera pose at script ms `sMs`, in THREE coordinates, or null for a keyless
 * script. Keys interpolate on script time; every player anchor resolves at the clock's document
 * time `docMsAt(sMs)` (the time the world is at), so the camera can move on a slow or frozen
 * world. A key before the first key holds the first key, a cut key holds the previous key, both
 * still resolved at the document time, so a held player key keeps following its player.
 */
export function evaluateCameraScript(
  script: CameraScript,
  sMs: number,
  subjects: ScriptSubjects,
  baseGameFov: number,
): ScriptPose | null {
  const keys = script.keys
  if (keys.length === 0) return null

  const tMs = scriptClockOf(script).docMsAt(sMs) // document time: where the world is

  const isCut = (i: number): boolean => keys[i].ease === 'cut'
  // Two keys are in the same run when no cut key sits between them (a cut key starts a new run).
  const sameRun = (a: number, b: number): boolean => {
    for (let i = Math.min(a, b) + 1; i <= Math.max(a, b); i++) if (isCut(i)) return false
    return true
  }

  // k = the last key at or before sMs (script time); before key 0, k = 0 and key 0 holds.
  let k = 0
  for (let i = 0; i < keys.length; i++) if (keys[i].t <= sMs) k = i

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

  // The run holding key k: from key a (key 0, or the cut that starts it) to key b (its last).
  let a = k
  while (a > 0 && !isCut(a)) a--
  let b = k
  while (b + 1 < keys.length && !isCut(b + 1)) b++

  if (sMs < keys[0].t || k === b) {
    // Hold key k: its points, resolved at the document time.
    const position = toThree(...resolve(k, 'pos'))
    const target = toThree(...resolve(k, 'look'))
    return {
      position,
      target,
      verticalFov: verticalFovOf(keys[k].fov ?? baseGameFov),
      rollDeg: keys[k].roll ?? 0,
    }
  }

  // A RUN IS ONE MOVE (docs/design/camera-scripts.md, "Timing"): its ends ease as the first and
  // last segment's `ease` asks, and in between the motion never stops at a key: distance along
  // the spline, fov and roll each follow one C1 monotone curve of time through the keys.
  const run: RunTiming = {
    a,
    b,
    t: (i) => keys[i].t,
    easeStart: easesFromRest(keys[a + 1].ease),
    easeEnd: easesToRest(keys[b].ease),
  }
  const cache = new Map<string, Vec3>()
  const at = (field: 'pos' | 'look') => (i: number): Vec3 => {
    const id = `${field}${i}`
    let p = cache.get(id)
    if (p === undefined) {
      p = resolve(i, field)
      cache.set(id, p)
    }
    return p
  }
  const fovOf = (i: number): number => keys[i].fov ?? baseGameFov
  const rollOf = (i: number): number => keys[i].roll ?? 0

  return {
    position: toThree(...pathAt(at('pos'), run, k, sMs)),
    target: toThree(...pathAt(at('look'), run, k, sMs)),
    verticalFov: verticalFovOf(curveAt(fovOf, run, k, sMs)),
    rollDeg: curveAt(rollOf, run, k, sMs),
  }
}

/** One run's timing: its key range [a, b], key times, and whether each end eases from/to rest. */
interface RunTiming {
  a: number
  b: number
  t: (i: number) => number
  easeStart: boolean
  easeEnd: boolean
}

/** A run starts from rest when its first segment eases in (`smooth`, the default, or `in`). */
function easesFromRest(ease: Ease | undefined): boolean {
  const e = ease ?? 'smooth'
  return e === 'smooth' || e === 'in'
}

/** A run comes to rest when its last segment eases out (`smooth`, the default, or `out`). */
function easesToRest(ease: Ease | undefined): boolean {
  const e = ease ?? 'smooth'
  return e === 'smooth' || e === 'out'
}

/**
 * The slope of a run's value curve at key i (value per script ms). The run's ends: zero when
 * that end eases to rest, else the end segment's secant. Inside: the monotone (PCHIP,
 * Fritsch-Butland) slope, a weighted harmonic mean of the two neighboring secants, zero where
 * they disagree in sign, so the curve never overshoots a key and never runs backward.
 */
function runSlope(v: (i: number) => number, run: RunTiming, i: number): number {
  const { a, b, t } = run
  if (i === a) return run.easeStart ? 0 : (v(a + 1) - v(a)) / (t(a + 1) - t(a))
  if (i === b) return run.easeEnd ? 0 : (v(b) - v(b - 1)) / (t(b) - t(b - 1))
  const hPrev = t(i) - t(i - 1)
  const h = t(i + 1) - t(i)
  const dPrev = (v(i) - v(i - 1)) / hPrev
  const d = (v(i + 1) - v(i)) / h
  if (dPrev * d <= 0) return 0
  const w1 = 2 * h + hPrev
  const w2 = h + 2 * hPrev
  return (w1 + w2) / (w1 / dPrev + w2 / d)
}

/** Cubic Hermite between (t0, v0) and (t1, v1) with slopes m0, m1, at t. */
function hermite(t0: number, t1: number, v0: number, v1: number, m0: number, m1: number, t: number): number {
  const h = t1 - t0
  const x = (t - t0) / h
  const x2 = x * x
  const x3 = x2 * x
  return (2 * x3 - 3 * x2 + 1) * v0 + (x3 - 2 * x2 + x) * h * m0 + (-2 * x3 + 3 * x2) * v1 + (x3 - x2) * h * m1
}

/** A scalar key value (fov, roll) at script ms `sMs` inside segment k of the run: C1 through every key. */
function curveAt(v: (i: number) => number, run: RunTiming, k: number, sMs: number): number {
  return hermite(run.t(k), run.t(k + 1), v(k), v(k + 1), runSlope(v, run, k), runSlope(v, run, k + 1), sMs)
}

/** Segment j of a run's spline at u; a run's end is mirrored through its neighbor (a phantom), so the end segments still curve. */
function splineAt(pt: (i: number) => Vec3, run: RunTiming, j: number, u: number): Vec3 {
  const P1 = pt(j)
  const P2 = pt(j + 1)
  const P0 = j > run.a ? pt(j - 1) : mirrorVec(P1, P2)
  const P3 = j + 1 < run.b ? pt(j + 2) : mirrorVec(P2, P1)
  return catmullRom(P0, P1, P2, P3, u)
}

/** Samples per segment for its arc length. */
const ARC_STEPS = 96

/** Segment j's cumulative arc length at ARC_STEPS + 1 even steps of u (world units). */
function arcTable(pt: (i: number) => Vec3, run: RunTiming, j: number): number[] {
  const cum = [0]
  let prev = splineAt(pt, run, j, 0)
  for (let s = 1; s <= ARC_STEPS; s++) {
    const p = splineAt(pt, run, j, s / ARC_STEPS)
    cum.push(cum[s - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]))
    prev = p
  }
  return cum
}

/**
 * The point of a run's spline at script ms `sMs` inside segment k, timed BY DISTANCE: the
 * distance traveled is a C1 monotone curve of time through the keys (each key is passed at its
 * `t`), so the speed changes smoothly through every key and the camera never backs up. Only the
 * segments k-1..k+1 are measured: the slopes at keys k and k+1 need no more.
 */
function pathAt(pt: (i: number) => Vec3, run: RunTiming, k: number, sMs: number): Vec3 {
  const table = arcTable(pt, run, k)
  const len = table[ARC_STEPS]
  if (len < CR_EPS) return splineAt(pt, run, k, 0)
  const lenPrev = k > run.a ? arcTable(pt, run, k - 1)[ARC_STEPS] : 0
  const lenNext = k + 1 < run.b ? arcTable(pt, run, k + 1)[ARC_STEPS] : 0
  // Distance along the run, measured from key k (only differences enter the slopes).
  const dist = (i: number): number => (i <= k - 1 ? -lenPrev : i === k ? 0 : i === k + 1 ? len : len + lenNext)
  const s = hermite(run.t(k), run.t(k + 1), 0, len, runSlope(dist, run, k), runSlope(dist, run, k + 1), sMs)
  const target = Math.min(len, Math.max(0, s))
  // Distance back to the spline's parameter, through the segment's arc table.
  let i = 1
  while (i < ARC_STEPS && table[i] < target) i++
  const span = table[i] - table[i - 1]
  const u = (i - 1 + (span > 0 ? (target - table[i - 1]) / span : 0)) / ARC_STEPS
  return splineAt(pt, run, k, u)
}
