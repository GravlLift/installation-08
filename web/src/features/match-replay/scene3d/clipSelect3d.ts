// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * clipSelect3d.ts — WHICH GAME CLIPS TO PLAY AT A FRAME, and at what time: a pure function of
 * what the film says about the player (gait, dated stances, held weapon class, dated actions).
 *
 * Nothing accumulates: every weight and every time is computed from the frame (fades measured
 * from the start or end of a stance interval, from an action's frame), so pause, slow motion,
 * rewind and seek render the same frame.
 *
 * BASE (weights summing to 1, by priority: clamber, slide, jump, land, then locomotion):
 *   - locomotion: idle, walk, run chosen by speed (bounds = the clips' own speeds, drawn from
 *     their stride), sprint by its stance; movement direction relative to heading blends the two
 *     directional clips bracketing it; crouched by its stance. A moving clip's time comes from
 *     the life's PHASE (`MotionGait.phase`, cycles integrated from ground distance divided by
 *     the mix's stride) and the clip's own sync phase (`SpartanClip.sync`): feet don't slide and
 *     every blended clip plants the same foot;
 *   - clamber: entry then exit stretched over the interval; slide and jump: time since the
 *     interval's start; land: time since the jump's end.
 * OVER (replace the bones they animate): thruster (the game's dodge in the push direction
 * relative to heading, from the push frame), melee (impact timed to the hit's frame), grenade
 * throw (release timed to the throw's frame), reload (from its frame), put-away (finished at the
 * weapon-change frame, old class) and ready (from that frame, new class).
 *
 * A clip missing for the held class is taken from the rifle's (the complete set).
 */
import type { SpartanClip } from './clips3d'
import type { ClipLayer, ClipMix } from './clipSample3d'
import { lastStartedAt, type DodgeShot, type EvadeDir } from './equipmentUse3d_logic'
import { DEFAULT_WEAPON_CLASS, type WeaponClass } from './weaponClass3d'

/** A film stance interval, closed at both ends (`replaySpans.covers`). */
export interface Span {
  t0: number
  t1: number
}

/** A life's stances, each list sorted by start. */
export interface MotionStances {
  crouch: readonly Span[]
  sprint: readonly Span[]
  slide: readonly Span[]
  clamber: readonly Span[]
  jump: readonly Span[]
}

/** A held-weapon change: its frame, the class left and the class taken. */
export interface WeaponSwap {
  t: number
  from: WeaponClass
  to: WeaponClass
}

/** A life's actions, as sorted frames. */
export interface MotionEvents {
  /** The hit's frame (melee kill, non-lethal hit). */
  melee: readonly number[]
  meleeStart?: readonly number[]
  /** The throw's frame. */
  grenade: readonly number[]
  /** The reload start's frame. */
  reload: readonly number[]
  swaps: readonly WeaponSwap[]
  /** The thruster's pushes: their frame and their direction relative to heading. */
  dodges?: readonly DodgeShot[]
}

/** Gait: ground speed (u/s), direction relative to heading (degrees, + = left), phase (cycles). */
export interface MotionGait {
  speed: number
  rel: number
  phase: number
}

export interface MotionInput {
  /** Film frame (fractional). */
  frame: number
  /** Film frames per second. */
  fps: number
  reloadClip?: SpartanClip | null
  weapon: WeaponClass
  /** null: aboard a vehicle (idle only). */
  gait: MotionGait | null
  stances: MotionStances
  events: MotionEvents
}

export interface ClipCatalog {
  get(name: string): SpartanClip | undefined
}

/** Below this speed (u/s), the player stands (published positions' jitter stays under it). */
export const IDLE_BELOW = 0.1
/** From this speed (u/s) up, nothing of idle is left. */
export const MOVE_FULL = 0.5
/** Stance fades (s): crouch and sprint; jump; land; clamber and slide. */
export const STANCE_FADE = 0.15
const JUMP_FADE_IN = 0.1
const JUMP_FADE_OUT = 0.08
/** Landing plays over this long after the jump (s), faded on entry and on exit. */
export const LAND_SECONDS = 0.45
const LAND_FADE_IN = 0.05
const LAND_FADE_OUT = 0.25
const MOVE_FADE = 0.1
/** Fades of an over action (s). */
export const ACTION_FADE_IN = 0.05
export const ACTION_FADE_OUT = 0.15
/** The impact within `melee_strike_1` (s): the hand's peak speed at frame 3 (measured on the GLB). */
export const MELEE_IMPACT = 0.1
/** The release holds the pose of the clip's frame 15 at 60 Hz. */
export const THROW_RELEASE = 0.25

/** The clips' eight directions and their angle (degrees, + = left), within [-180, 180). */
const DIRECTIONS: readonly (readonly [string, number])[] = [
  ['back', -180], ['backright', -135], ['right', -90], ['frontright', -45],
  ['front', 0], ['frontleft', 45], ['left', 90], ['backleft', 135],
]
const CARDINALS = new Set(['front', 'left', 'back', 'right'])

interface DirSet {
  clips: SpartanClip[]
  angles: number[]
}

interface ClassClips {
  idle: SpartanClip | null
  walk: DirSet
  run: DirSet
  sprint: SpartanClip | null
  crouchIdle: SpartanClip | null
  crouchWalk: DirSet
  slide: SpartanClip | null
  airborne: SpartanClip | null
  land: SpartanClip | null
  clamberEnter: SpartanClip | null
  clamberExit: SpartanClip | null
  melee: SpartanClip | null
  grenade: SpartanClip | null
  reload: SpartanClip | null
  putAway: SpartanClip | null
  ready: SpartanClip | null
  dodge: Record<EvadeDir, SpartanClip | null>
}

const resolved = new WeakMap<ClipCatalog, Map<WeaponClass, ClassClips>>()

/** classClips: a class's clips within a catalog, resolved once (rifle fallback). */
function classClips(cat: ClipCatalog, cls: WeaponClass): ClassClips {
  let byClass = resolved.get(cat)
  if (!byClass) {
    byClass = new Map()
    resolved.set(cat, byClass)
  }
  let c = byClass.get(cls)
  if (!c) {
    c = resolveClass(cat, cls)
    byClass.set(cls, c)
  }
  return c
}

function resolveClass(cat: ClipCatalog, cls: WeaponClass): ClassClips {
  const one = (posture: string, action: string) =>
    cat.get(`${posture}:${cls}:${action}`) ?? cat.get(`${posture}:${DEFAULT_WEAPON_CLASS}:${action}`) ?? null
  return {
    idle: one('combat', 'idle'),
    walk: dirSet(cat, cls, (k, d) => `combat:${k}:locomote_walk_${d}`),
    run: dirSet(cat, cls, (k, d) => `combat:${k}:locomote_run_${d}`),
    sprint: cat.get(`sprint:${cls}:locomote`) ?? cat.get(`sprint:${DEFAULT_WEAPON_CLASS}:locomote`) ?? null,
    crouchIdle: one('crouch', 'idle'),
    crouchWalk: dirSet(cat, cls, (k, d) => `crouch:${k}:locomote_walk_${d}`),
    slide: one('crouch', 'slide'),
    airborne: one('combat', 'airborne_arc'),
    land: one('combat', 'land_hard'),
    clamberEnter: one('combat', 'clamber_enter'),
    clamberExit: one('combat', 'clamber_exit'),
    melee: one('combat', 'melee_strike_1'),
    grenade: one('combat', 'throw_grenade'),
    reload: one('combat', 'reload_1'),
    putAway: one('combat', 'put_away'),
    ready: one('combat', 'ready'),
    dodge: { front: one('combat', 'dodge_front'), back: one('combat', 'dodge_back'), left: one('combat', 'dodge_left'), right: one('combat', 'dodge_right') },
  }
}

/**
 * dirSet: a class's directional clips. A class with all four cardinal directions keeps its own
 * set; otherwise the rifle's set, where every direction the class owns takes its own clip (a
 * heavy weapon that only advances facing forward keeps its own arms walking straight ahead).
 */
function dirSet(cat: ClipCatalog, cls: WeaponClass, name: (cls: string, dir: string) => string): DirSet {
  const own = DIRECTIONS.map(([d]) => cat.get(name(cls, d)))
  const full = DIRECTIONS.every(([d], i) => !CARDINALS.has(d) || own[i])
  const out: DirSet = { clips: [], angles: [] }
  DIRECTIONS.forEach(([d, angle], i) => {
    const clip = own[i] ?? (full ? undefined : cat.get(name(DEFAULT_WEAPON_CLASS, d)))
    if (!clip) return
    out.clips.push(clip)
    out.angles.push(angle)
  })
  return out
}

/** Two neighboring directional clips and their weights (sum 1). */
export interface DirPair {
  a: SpartanClip | null
  wa: number
  b: SpartanClip | null
  wb: number
}

/** wrap180: an angle (degrees) brought into [-180, 180). */
export function wrap180(a: number): number {
  return a - 360 * Math.floor((a + 180) / 360)
}

/**
 * dirPairOf: the two clips of set `set` bracketing direction `rel` (degrees), weights linear in
 * angle (continuous from one sector to the next, sum 1); written into `out`.
 */
function dirPairOf(set: DirSet, rel: number, out: DirPair): DirPair {
  const n = set.angles.length
  out.a = n > 0 ? set.clips[0] : null
  out.wa = 1
  out.b = null
  out.wb = 0
  if (n < 2) return out
  const x = wrap180(rel)
  let i = n - 1
  for (let k = 0; k < n; k++) if (set.angles[k] <= x) i = k
  const j = (i + 1) % n
  const span = set.angles[j] - set.angles[i] + (j <= i ? 360 : 0)
  const into = x - set.angles[i] + (x < set.angles[i] ? 360 : 0)
  const u = into / span
  out.a = set.clips[i]
  out.wa = 1 - u
  out.b = set.clips[j]
  out.wb = u
  return out
}

/** dirWeights: the class's directional clip weights for gait `kind` (tests, tuning). */
export function dirWeights(cat: ClipCatalog, cls: WeaponClass, kind: 'walk' | 'run' | 'crouchWalk', rel: number): DirPair {
  return dirPairOf(classClips(cat, cls)[kind], rel, { a: null, wa: 0, b: null, wb: 0 })
}

function clipSpeed(c: SpartanClip | null): number {
  return c ? c.stride / c.cycle : 0
}

function pairSpeed(p: DirPair): number {
  return p.wa * clipSpeed(p.a) + p.wb * clipSpeed(p.b)
}

/** phaseTime: a moving clip's time (s) at life phase `phase` (cycles). */
export function phaseTime(clip: SpartanClip, phase: number): number {
  const u = phase + clip.sync
  return (u - Math.floor(u)) * clip.cycle
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

/** smoothstep: 0 below `lo`, 1 above `hi`, smooth in between. */
export function smoothstep(x: number, lo: number, hi: number): number {
  const u = clamp01((x - lo) / (hi - lo))
  return u * u * (3 - 2 * u)
}

/** lastStarted: the index of the last interval started at or before frame `f` (list sorted by start), -1 otherwise. */
function lastStarted(spans: readonly Span[], f: number): number {
  let lo = 0
  let hi = spans.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (spans[mid].t0 <= f) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

/** fadeOf: an interval's weight at frame `f`: rises over `fadeIn` (s) from `t0`, falls over `fadeOut` after its last frame. */
function fadeOf(s: Span, f: number, fps: number, fadeIn: number, fadeOut: number): number {
  const since = (f - s.t0) / fps
  const after = (f - (s.t1 + 1)) / fps
  if (since < 0) return 0
  return clamp01(Math.min(since / fadeIn, after <= 0 ? 1 : 1 - after / fadeOut))
}

/**
 * spanWeight: a stance's weight at frame `f`: the stronger of the two most recently started
 * intervals (an interval that closely follows the previous one doesn't dip the weight).
 */
export function spanWeight(spans: readonly Span[], f: number, fps: number, fadeIn: number, fadeOut: number): number {
  const i = lastStarted(spans, f)
  if (i < 0) return 0
  const w = fadeOf(spans[i], f, fps, fadeIn, fadeOut)
  return i > 0 ? Math.max(w, fadeOf(spans[i - 1], f, fps, fadeIn, fadeOut)) : w
}

function push(list: ClipLayer[], count: number, clip: SpartanClip | null, time: number, weight: number, loop: boolean): number {
  if (!clip || weight <= 0 || count >= list.length) return count
  const l = list[count]
  l.clip = clip
  l.time = time
  l.weight = weight
  l.loop = loop
  return count + 1
}

function pushBase(out: ClipMix, clip: SpartanClip | null, time: number, weight: number, loop: boolean): void {
  out.baseCount = push(out.base, out.baseCount, clip, time, weight, loop)
}

function pushOver(out: ClipMix, clip: SpartanClip | null, time: number, weight: number): void {
  out.overCount = push(out.over, out.overCount, clip, time, weight, false)
}

const pairA: DirPair = { a: null, wa: 0, b: null, wb: 0 }
const pairB: DirPair = { a: null, wa: 0, b: null, wb: 0 }

function pushPair(out: ClipMix, p: DirPair, weight: number, phase: number): void {
  if (p.a) pushBase(out, p.a, phaseTime(p.a, phase), weight * p.wa, true)
  if (p.b) pushBase(out, p.b, phaseTime(p.b, phase), weight * p.wb, true)
}

/**
 * selectClips writes the frame's mix into `out` (see the header) and returns it. The base
 * weights sum to 1 as soon as the catalog carries the rifle's clips.
 */
export function selectClips(q: MotionInput, cat: ClipCatalog, out: ClipMix): ClipMix {
  out.baseCount = 0
  out.overCount = 0
  const c = classClips(cat, q.weapon)
  if (!q.gait) pushBase(out, c.idle, q.frame / q.fps, 1, true)
  else {
    const rest = specialStates(q, c, out)
    if (rest > 0) locomotion(q, q.gait, c, rest, out)
  }
  actions(q, cat, c, out)
  return out
}

/** specialStates places clamber, slide, jump and land by priority; returns the remaining weight. */
function specialStates(q: MotionInput, c: ClassClips, out: ClipMix): number {
  const { frame: f, fps, stances } = q
  let rest = 1
  rest = clamber(q, c, rest, out)
  const slide = spanWeight(stances.slide, f, fps, MOVE_FADE, MOVE_FADE) * rest
  const s = stances.slide[lastStarted(stances.slide, f)]
  if (s) pushBase(out, c.slide, (f - s.t0) / fps, slide, false)
  rest -= slide
  const jumpI = lastStarted(stances.jump, f)
  if (jumpI < 0) return rest
  const j = stances.jump[jumpI]
  const air = spanWeight(stances.jump, f, fps, JUMP_FADE_IN, JUMP_FADE_OUT) * rest
  pushBase(out, c.airborne, (f - j.t0) / fps, air, false)
  rest -= air
  const since = (f - (j.t1 + 1)) / fps
  if (since < 0 || since > LAND_SECONDS) return rest
  const land = clamp01(Math.min(since / LAND_FADE_IN, (LAND_SECONDS - since) / LAND_FADE_OUT)) * rest
  pushBase(out, c.land, since, land, false)
  return rest - land
}

/** clamber: entry then exit stretched over the interval; returns the remaining weight. */
function clamber(q: MotionInput, c: ClassClips, rest: number, out: ClipMix): number {
  const spans = q.stances.clamber
  const s = spans[lastStarted(spans, q.frame)]
  const w = s ? fadeOf(s, q.frame, q.fps, MOVE_FADE, MOVE_FADE) * rest : 0
  if (w <= 0) return rest
  const enter = c.clamberEnter
  const exit = c.clamberExit
  const u = clamp01((q.frame - s.t0) / (s.t1 + 1 - s.t0))
  const split = enter && exit ? enter.cycle / (enter.cycle + exit.cycle) : enter ? 1 : 0
  if (enter && u < split) pushBase(out, enter, (u / split) * enter.once, w, false)
  else if (exit) pushBase(out, exit, ((u - split) / (1 - split)) * exit.once, w, false)
  return rest - w
}

/** locomotion: idle, walk, run, sprint and crouched at weight `weight`. */
function locomotion(q: MotionInput, g: MotionGait, c: ClassClips, weight: number, out: ClipMix): void {
  const { frame: f, fps, stances } = q
  const crouch = spanWeight(stances.crouch, f, fps, STANCE_FADE, STANCE_FADE)
  const sprint = spanWeight(stances.sprint, f, fps, STANCE_FADE, STANCE_FADE)
  const move = smoothstep(g.speed, IDLE_BELOW, MOVE_FULL)
  const idleTime = f / fps
  const stand = weight * (1 - crouch)
  if (stand > 0) {
    pushBase(out, c.idle, idleTime, stand * (1 - move), true)
    const moving = stand * move
    if (moving > 0) {
      if (c.sprint) pushBase(out, c.sprint, phaseTime(c.sprint, g.phase), moving * sprint, true)
      const walk = dirPairOf(c.walk, g.rel, pairA)
      const run = dirPairOf(c.run, g.rel, pairB)
      const vw = pairSpeed(walk)
      const vr = pairSpeed(run)
      const r = vr > vw ? clamp01((g.speed - vw) / (vr - vw)) : 1
      pushPair(out, walk, moving * (1 - sprint) * (1 - r), g.phase)
      pushPair(out, run, moving * (1 - sprint) * r, g.phase)
    }
  }
  const low = weight * crouch
  if (low > 0) {
    pushBase(out, c.crouchIdle, idleTime, low * (1 - move), true)
    pushPair(out, dirPairOf(c.crouchWalk, g.rel, pairA), low * move, g.phase)
  }
}

/** actionWeight: the weight of an action played once at time `time` of its clip (duration `once`). */
export function actionWeight(time: number, once: number): number {
  if (time < 0 || time > once) return 0
  return clamp01(Math.min(time / ACTION_FADE_IN, (once - time) / ACTION_FADE_OUT))
}

/** lastBefore: the index of the last frame in `frames` (sorted) at most `f`, -1 otherwise. */
function lastBefore(frames: readonly number[], f: number): number {
  let lo = 0
  let hi = frames.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (frames[mid] <= f) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

/** oneAction: the most recent action in `frames` whose point `at` (s within the clip) lands on its frame. */
function oneAction(out: ClipMix, clip: SpartanClip | null, frames: readonly number[], q: MotionInput, at: number): void {
  if (!clip) return
  const i = lastBefore(frames, q.frame + at * q.fps)
  if (i < 0) return
  const time = (q.frame - frames[i]) / q.fps + at
  pushOver(out, clip, time, actionWeight(time, clip.once))
}

/** actions places the over actions (see the header). */
function actions(q: MotionInput, cat: ClipCatalog, c: ClassClips, out: ClipMix): void {
  const ev = q.events
  const d = ev.dodges ? lastStartedAt(ev.dodges, q.frame, (s) => s.t) : -1
  if (d >= 0) {
    const shot = (ev.dodges as readonly DodgeShot[])[d]
    const clip = c.dodge[shot.dir]
    const time = (q.frame - shot.t) / q.fps
    if (clip) pushOver(out, clip, time, actionWeight(time, clip.once))
  }
  oneAction(out, c.melee, ev.melee, q, MELEE_IMPACT)
  oneAction(out, c.melee, ev.meleeStart ?? [], q, 0)
  oneAction(out, c.grenade, ev.grenade, q, THROW_RELEASE)
  oneAction(out, q.reloadClip === undefined ? c.reload : q.reloadClip, ev.reload, q, 0)
  const swaps = ev.swaps
  let lo = 0
  let hi = swaps.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (swaps[mid].t <= q.frame + q.fps) lo = mid + 1
    else hi = mid
  }
  for (let i = Math.max(0, lo - 2); i < lo; i++) {
    const s = swaps[i]
    const since = (q.frame - s.t) / q.fps
    const away = classClips(cat, s.from).putAway
    if (away) pushOver(out, away, since + away.once, actionWeight(since + away.once, away.once))
    const ready = classClips(cat, s.to).ready
    if (ready) pushOver(out, ready, since, actionWeight(since, ready.once))
  }
}

/** mixStride: the stride (u per cycle) of the moving base layers, averaged at their weight; 0 without them. */
export function mixStride(mix: ClipMix): number {
  let w = 0
  let s = 0
  for (let i = 0; i < mix.baseCount; i++) {
    const l = mix.base[i]
    if (!l.clip || l.clip.stride <= 0) continue
    w += l.weight
    s += l.weight * l.clip.stride
  }
  return w > 0 ? s / w : 0
}
