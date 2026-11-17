/**
 * weaponIdleEffects3dModel.ts — THE PARTICLE EFFECTS A HELD WEAPON CARRIES (the Shock Rifle's
 * electricity around its barrel housing), as the weapon library index describes them
 * (`idle_effects`, written by the server from each weapon's tags: `internal/weapons/idle_effects.go`,
 * `himap/effet_arme.go`). This file is the data and the simulation, without three's renderer.
 *
 * WHAT THE INDEX GIVES, READ FROM THE GAME: per weapon, the effect's systems, each emitted at a marker
 * of the weapon's model, in the marker's frame; per system its camera mode (first person only, third
 * person only), its event's duration and flags, the emitter (shape, axis scale, direction, billboard)
 * and its properties as mapping functions of the engine's inputs (particle age, effect A and B
 * scales, per-particle randoms), and how the particle draws (textures, shader constants, mesh). The
 * effect is gated by the weapon's own functions: on the Shock Rifle `fx_ready` = `ready`, off while
 * `fx_reloading` (1 - `is_reloading`) is 0, itself off while `fx_ammo` is 0.
 *
 * WHAT THIS FILE INFERS, NOT READ (each named where it is used): the event loops for as long as the
 * effect is on (an attached effect plays again when its events end); a cylinder emitter spreads its
 * particles along its axis over the axis scale's first component from the location (its radius is
 * the emission radius, 0 here); rotations are in turns (0..1 a full turn); a sprite's quad is twice
 * its size on a side (the team banner's measured rule, flagBanner3d); an input the plugin enum does
 * not name (21..24) is a per-particle random of its own; a mesh particle scales by its size; the
 * vertex color is tint x tint2 x the intensity compressed as the view's lights are (`glowLevel`).
 *
 * NOT APPLIED: the emitters' per-particle alpha black and white points (the two decoded particle
 * shaders read only their constant ones, off here: ALPHA_BLACK_WHITE_POINT 0; the GPU simulation
 * that might fold them in is not in the tags), the shaders' depth fade (1 cm soft edges), the
 * camera-distance input (no property of these effects reads it).
 *
 * DETERMINISM: everything is a function of the match time and a player seed (`unitHash`): the same
 * frame always draws the same particles.
 */
import { glowLevel } from './lighting'

/** A piece of a multi-spline: the polynomial (highest degree first) up to `end`. */
export interface CurveSegment {
  end: number
  coefs: number[]
}

/** An emitter property (`himap.FonctionParticule`). */
export interface ParticleFunction {
  input: number
  rangeInput: number
  modifier?: number
  modifierInput?: number
  type: number
  ranged?: boolean
  min: number
  max: number
  curves?: CurveSegment[][]
  color?: [number, number, number]
}

export interface IdleEmitter {
  flags: number
  appearance: number
  particleFlags: number
  shape: number
  axisScale: [number, number, number]
  direction: [number, number, number]
  startingInterpolant: [number, number, number]
  billboard: number
  properties: Record<string, ParticleFunction>
}

export interface IdleTexture {
  name: string
  file: string
  layers: number
  /** Sampled through an sRGB view (the bitmap's curve): decoded to linear. */
  srgb: boolean
  /** A signed format, written (v + 1) / 2. */
  signed: boolean
}

export interface IdleRender {
  appearance: number
  blendMode: number
  shader: string
  textures: IdleTexture[]
  constants: Record<string, number[]>
  model?: string
}

export interface IdleSystem {
  location: string
  event: number
  eventFlags: number
  eventDuration: [number, number]
  coordinateSystem: number
  cameraMode: number
  flags: number
  sizeScale: number
  emitter: IdleEmitter
  render: IdleRender
  particle: string
}

export interface IdleFunction {
  import: string
  default: number
  export: string
  turnOffWith?: string
  invert?: boolean
  /** The function's mapping of its import (its tag's `default function`); absent: the identity 0..1. */
  mapping?: ParticleFunction
}

export interface IdleEffect {
  effect: string
  scaleA: string
  scaleB: string
  functions: IdleFunction[]
  /** Per location, the marker instances on the third-person model (model space, GLB axes). */
  markers: Record<string, [number, number, number][]>
  /** Their rotations, same order (quaternions x, y, z, w, GLB axes); absent in an older library: none. */
  markerRotations?: Record<string, [number, number, number, number][]>
  /**
   * The animation functions the weapon's own reload animations set, by name (read from its graph:
   * the Heatwave's and the Cindershot's `animation_event_function_variant_switch`, 1 over every frame).
   */
  reloadFunctions?: Record<string, number>
  /** The rounds the weapon's magazine holds loaded (its tag's `rounds loaded maximum`); absent in an older library. */
  magazine?: number
  systems: IdleSystem[]
}

export type IdleEffectTable = Readonly<Record<string, readonly IdleEffect[]>>

/** Function types the index carries (`himap/effet_arme.go`). */
export const FN_IDENTITY = 0
export const FN_CONSTANT = 1
export const FN_MULTI_SPLINE = 8

/** Engine inputs of a property (the community plugin's enum). */
export const IN_PARTICLE_AGE = 0
export const IN_SYSTEM_AGE = 1
export const IN_PARTICLE_RANDOM = 2
export const IN_SYSTEM_RANDOM = 3
export const IN_EMISSION_TIME = 10
export const IN_CAMERA_DISTANCE = 11
export const IN_GAME_TIME = 12
export const IN_SCALE_A = 13
export const IN_SCALE_B = 14

/** Camera modes of a system: drawn in which view. */
export const CAMERA_INDEPENDENT = 0
export const CAMERA_FIRST_PERSON = 1
export const CAMERA_THIRD_PERSON = 2

/** System flags (plugin): turned off in aimed-down-sight; particles hard killed when the event ends. */
export const SYSTEM_NO_ADS = 1 << 16
export const SYSTEM_KILLED_WITH_EVENT = 1 << 19

/** Emission shapes (plugin enum) spread along their axis. */
const SHAPE_TUBE = 2
const SHAPE_LINE = 7
const SHAPE_CYLINDER = 10

/** Bounds against a malformed entry. */
const MAX_PER_SYSTEM = 64
const MAX_FUNCTION_DEPTH = 8
const MAX_LOOKBACK = 4

/** parseIdleEffects reads the table out of an index document; null when the field is absent. */
export function parseIdleEffects(doc: unknown): IdleEffectTable | null {
  const raw = (doc as { idle_effects?: unknown } | null)?.idle_effects
  if (!raw || typeof raw !== 'object') return null
  const out: Record<string, IdleEffect[]> = {}
  for (const [key, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue
    const effects = list.filter((e): e is IdleEffect => {
      const x = e as Partial<IdleEffect> | null
      return !!x && typeof x.scaleA === 'string' && Array.isArray(x.systems) && Array.isArray(x.functions) && !!x.markers
    })
    if (effects.length > 0) out[key] = effects
  }
  return out
}

/** curveAt evaluates a multi-spline at x: the first piece whose end is at or past x. */
export function curveAt(segs: readonly CurveSegment[], x: number): number {
  let seg = segs[segs.length - 1]
  for (const s of segs) {
    if (x <= s.end) {
      seg = s
      break
    }
  }
  let v = 0
  for (const c of seg.coefs) v = v * x + c
  return v
}

/**
 * propertyAt is the value of a property given its inputs' values (`input(k)`, the engine input k:
 * particle age in [0, 1], a random in [0, 1], an effect scale...). Min + (Max - Min) x the function's
 * value; a ranged function mixes its two curves (or its two ends, a constant) by the range input.
 */
export function propertyAt(f: ParticleFunction, input: (k: number) => number): number {
  const r = f.ranged ? input(f.rangeInput) : 0
  let v: number
  switch (f.type) {
    case FN_IDENTITY:
      v = f.min + (f.max - f.min) * input(f.input)
      break
    case FN_CONSTANT:
      v = f.ranged ? f.min + (f.max - f.min) * r : f.min
      break
    case FN_MULTI_SPLINE: {
      const c = f.curves ?? []
      if (c.length === 0) return 0
      const x = input(f.input)
      const y = f.ranged && c.length > 1 ? curveAt(c[0], x) + (curveAt(c[1], x) - curveAt(c[0], x)) * r : curveAt(c[0], x)
      v = f.min + (f.max - f.min) * y
      break
    }
    default:
      return 0
  }
  if (f.modifier === 1) v += input(f.modifierInput ?? 0)
  else if (f.modifier === 2) v *= input(f.modifierInput ?? 0)
  return v
}

/**
 * functionValue is the value of the weapon function `name`: an export of `fns` (the LAST that exports
 * it: the Heatwave exports `#9ef8b167` twice, and the Cindershot, whose effect is gated the same way,
 * carries only its second, 1 - `primary_ammunition`), else an import the view feeds (`imports`: the Heatwave's vent B scale names
 * `animation_event_function_variant_switch`, which its weapon's reload animations set, fed while the
 * holder reloads), else 0. A function's value is its import's (its
 * default without one) through its mapping (`mapping`, the tag's `default function`: the Heatwave's
 * `fx_camo_off` is 1 - camo), clamped to [0, 1], inverted when the function says so, and 0 while its
 * turn-off function is 0.
 *
 * INFERRED, not read: the inversion applies to the mapped value (the older engines' tag comment, "the
 * result of the function is one minus the actual result"); a turn-off name that no function exports
 * and the view does not feed turns nothing off (the Heatwave's first `#9ef8b167` turns off with
 * `#9f494a78`, a function of the Shock Rifle's that the Heatwave does not define); of two functions
 * with one export name, the last is read (see above).
 */
export function functionValue(fns: readonly IdleFunction[], imports: Readonly<Record<string, number>>, name: string, depth = 0): number {
  if (!name) return 1
  const f = fns.findLast((g) => g.export === name)
  if (!f) return name in imports ? imports[name] : 0
  if (depth > MAX_FUNCTION_DEPTH) return 0
  let v = f.import in imports ? imports[f.import] : (fns.some((g) => g.export === f.import) ? functionValue(fns, imports, f.import, depth + 1) : f.default)
  v = Math.min(1, Math.max(0, v))
  if (f.mapping) {
    const x = v
    v = Math.min(1, Math.max(0, propertyAt(f.mapping, () => x)))
  }
  if (f.invert) v = 1 - v
  if (f.turnOffWith && resolvable(fns, imports, f.turnOffWith) && functionValue(fns, imports, f.turnOffWith, depth + 1) === 0) return 0
  return v
}

/** resolvable: `name` is a function of `fns` or an import the view feeds. */
function resolvable(fns: readonly IdleFunction[], imports: Readonly<Record<string, number>>, name: string): boolean {
  return name in imports || fns.some((g) => g.export === name)
}

/** unitHash — a deterministic value in [0, 1) of an integer key. */
export function unitHash(n: number): number {
  let h = Math.imul(n | 0, 0x9e3779b1) ^ 0x85ebca6b
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

/** One live particle of a system, in the emitting marker's frame. */
export interface LiveParticle {
  /** Position in the marker's frame. */
  x: number
  y: number
  z: number
  /** Its direction (unit), the marker frame's. */
  dir: [number, number, number]
  /** Size (a sprite's half side, a mesh's scale) and the sprite's x / y stretch. */
  size: number
  scaleX: number
  scaleY: number
  /** Rotation, radians. */
  angle: number
  /** Linear color, the intensity compressed as the view's lights are (`glowLevel`). */
  r: number
  g: number
  b: number
  alpha: number
  /** The palette's row (V) and the texture frame (before the frame count). */
  palette: number
  frame: number
  /** Age in seconds (the mesh shader's scrolling clock). */
  age: number
  /** Two per-particle randoms (the mesh shader's random UV offsets). */
  rand0: number
  rand1: number
}

/** The effect's state a frame reads: its scales (A on and scaling, B) and the camera distance. */
export interface EffectInputs {
  scaleA: number
  scaleB: number
  cameraDistance: number
}

const seedOf = (...keys: number[]) => keys.reduce((h, k) => Math.imul(h ^ (k | 0), 0x01000193), 0x811c9dc5)

/**
 * simulateSystem fills `out` with the live particles of system `s` at match time `t` (seconds), for
 * the holder of seed `seed` (system rank `rank` keeps two systems of one weapon apart). Returns `out`.
 *
 * The event loops (inferred, header): loop L covers [L·D, (L+1)·D) of the time shifted by a seed
 * phase. A loop emits its starting count at its start, then `emissionRate` particles a second (the
 * rate read once per loop, at the system's age 0: the Shock Rifle's rates follow effect scale B, not
 * time); a particle lives its lifespan, cut at its loop's end when the system's particles die with
 * the event. At most `maxCount` (when given) live at once.
 */
export function simulateSystem(s: IdleSystem, t: number, seed: number, rank: number, inputs: EffectInputs, out: LiveParticle[]): LiveParticle[] {
  out.length = 0
  const p = s.emitter.properties
  const d = Math.max(1e-3, s.eventDuration[0] || 1)
  const shifted = t + unitHash(seedOf(seed, rank, 1)) * d
  const loop = Math.floor(shifted / d)
  const sysInput = (L: number) => (k: number): number => {
    switch (k) {
      case IN_SYSTEM_AGE: return 0
      case IN_SYSTEM_RANDOM: return unitHash(seedOf(seed, rank, L, 3))
      case IN_SCALE_A: return inputs.scaleA
      case IN_SCALE_B: return inputs.scaleB
      case IN_CAMERA_DISTANCE: return inputs.cameraDistance
      default: return unitHash(seedOf(seed, rank, L, 100 + k))
    }
  }
  const maxCount = p.maxCount ? propertyAt(p.maxCount, sysInput(loop)) : 0
  const killed = (s.flags & SYSTEM_KILLED_WITH_EVENT) !== 0
  // The loops whose particles may still live: as far back as the longest lifespan reaches.
  const longest = p.lifespan ? Math.max(Math.abs(p.lifespan.min), Math.abs(p.lifespan.max)) : 1
  const back = killed ? 0 : Math.min(MAX_LOOKBACK, Math.ceil(longest / d))
  for (let L = loop - back; L <= loop; L++) {
    const tau = shifted - L * d
    const si = sysInput(L)
    const start = Math.max(0, Math.floor(p.startingCount ? propertyAt(p.startingCount, si) : 0))
    const rate = Math.max(0, p.emissionRate ? propertyAt(p.emissionRate, si) : 0)
    // The emission runs on across loops (births at (n + 0.5) / rate of the shifted time), so a rate
    // below one particle a loop still emits: the Heatwave's vent emits 2 a second over 0.35 s loops.
    const first = rate > 0 ? Math.ceil(L * d * rate - 0.5) : 0
    const emitted = rate > 0 ? Math.min(MAX_PER_SYSTEM, Math.max(0, Math.ceil((L + 1) * d * rate - 0.5) - first)) : 0
    const total = Math.min(MAX_PER_SYSTEM, start + emitted)
    for (let k = 0; k < total; k++) {
      const born = k < start ? 0 : (first + k - start + 0.5) / rate - L * d
      if (born > tau) break
      const pk = seedOf(seed, rank, L, k)
      const rnd = (j: number) => unitHash(seedOf(pk, j))
      const lifeInput = (k2: number) => (k2 === IN_PARTICLE_AGE ? 0 : particleInput(k2))
      // Per-particle inputs: age is set below; every random of a given input is shared by the
      // particle's properties (the engine's range variables correlate them).
      let ageNorm = 0
      const particleInput = (k2: number): number => {
        switch (k2) {
          case IN_PARTICLE_AGE: return ageNorm
          case IN_SYSTEM_AGE: return Math.min(1, tau / d)
          case IN_SYSTEM_RANDOM: return si(IN_SYSTEM_RANDOM)
          case IN_EMISSION_TIME: return born / d
          case IN_SCALE_A: return inputs.scaleA
          case IN_SCALE_B: return inputs.scaleB
          case IN_CAMERA_DISTANCE: return inputs.cameraDistance
          case IN_GAME_TIME: return t
          default: return rnd(k2)
        }
      }
      const life = p.lifespan ? propertyAt(p.lifespan, lifeInput) : 1
      const age = tau - born
      if (life <= 0 || age < 0 || age >= life) continue
      if (killed && L < loop) continue
      if (maxCount > 0 && out.length >= maxCount) break
      ageNorm = age / life
      out.push(particleAt(s, particleInput, age, rnd))
    }
  }
  return out
}

/** particleAt evaluates one particle's state from its inputs. */
function particleAt(s: IdleSystem, input: (k: number) => number, age: number, rnd: (j: number) => number): LiveParticle {
  const p = s.emitter.properties
  const v = (name: string, fallback: number) => (p[name] ? propertyAt(p[name], input) : fallback)
  const [dx, dy, dz] = unit(s.emitter.direction)
  // Spawn: along the axis for a tube, line or cylinder (inferred, header), else at the location;
  // then the starting interpolant and the travel along the direction.
  const along = SHAPE_ALONG.has(s.emitter.shape) ? s.emitter.axisScale[0] * rnd(200) : 0
  const radius = v('emissionRadius', 0)
  const ra = rnd(201) * Math.PI * 2
  const travel = v('velocity', 0) * age
  const [ux, uy, uz] = perpendicular(dx, dy, dz)
  const [wx, wy, wz] = [dy * uz - dz * uy, dz * ux - dx * uz, dx * uy - dy * ux]
  const si = s.emitter.startingInterpolant
  const x = si[0] + dx * (along + travel) + radius * (ux * Math.cos(ra) + wx * Math.sin(ra))
  const y = si[1] + dy * (along + travel) + radius * (uy * Math.cos(ra) + wy * Math.sin(ra))
  const z = si[2] + dz * (along + travel) + radius * (uz * Math.cos(ra) + wz * Math.sin(ra))
  const tint = p.tint?.color ?? [1, 1, 1]
  const tint2 = p.tint2?.color ?? [1, 1, 1]
  const glow = glowLevel(Math.max(0, v('intensity', 1)))
  const scale = v('scale', 1)
  return {
    x, y, z, dir: [dx, dy, dz],
    size: Math.max(0, v('size', 0) * scale * (s.sizeScale || 1)),
    scaleX: v('scaleX', 1),
    scaleY: v('scaleY', 1) * v('aspectRatio', 1),
    angle: 2 * Math.PI * (v('rotation', 0) + v('rotationRate', 0) * age),
    r: tint[0] * tint2[0] * glow, g: tint[1] * tint2[1] * glow, b: tint[2] * tint2[2] * glow,
    alpha: Math.min(1, Math.max(0, v('alpha', 1) * v('alpha2', 1))),
    palette: Math.min(1, Math.max(0, v('paletteAnimation', 0))),
    frame: v('frameIndex', 0) + v('animationRate', 0) * age,
    age,
    rand0: rnd(300), rand1: rnd(301),
  }
}

const SHAPE_ALONG = new Set([SHAPE_TUBE, SHAPE_LINE, SHAPE_CYLINDER])

function unit(v: readonly number[]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2])
  return l > 1e-9 ? [v[0] / l, v[1] / l, v[2] / l] : [1, 0, 0]
}

function perpendicular(x: number, y: number, z: number): [number, number, number] {
  const [ax, ay, az] = Math.abs(x) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  return unit([y * az - z * ay, z * ax - x * az, x * ay - y * ax])
}

/**
 * systemShown says whether system `s` draws in the view: a first-person-only system on the
 * first-person rig, a third-person-only one on a holder seen from outside, an independent one in
 * both; never while scoped when the system is turned off in aimed-down-sight.
 */
export function systemShown(s: IdleSystem, firstPerson: boolean, scoped: boolean): boolean {
  if (scoped && (s.flags & SYSTEM_NO_ADS) !== 0) return false
  if (s.cameraMode === CAMERA_FIRST_PERSON) return firstPerson
  if (s.cameraMode === CAMERA_THIRD_PERSON) return !firstPerson
  return true
}

/**
 * The weapon state the effect's functions import, as the film gives it: the weapon drawn and
 * ready, reloading or not. The magazine is taken as not empty and the holder as not camouflaged
 * (the film's ammo reads are sparse, the camo is not wired here): `primary_ammunition` 1, `camo` 0.
 */
export interface WeaponFxState {
  ready: boolean
  reloading: boolean
  /** The magazine's fraction (`primary_ammunition`, `magazineFraction`); absent: full. */
  ammo?: number
}

/** effectScales are the effect's A and B scales for the weapon state `w` (its functions, `functionValue`). */
export function effectScales(e: IdleEffect, w: WeaponFxState): { scaleA: number; scaleB: number } {
  const imports = { ...(w.reloading ? e.reloadFunctions : undefined), ready: w.ready ? 1 : 0, is_reloading: w.reloading ? 1 : 0, primary_ammunition: w.ammo ?? 1, camo: 0 }
  return { scaleA: functionValue(e.functions, imports, e.scaleA), scaleB: functionValue(e.functions, imports, e.scaleB) }
}

/**
 * A reload of the film, on the frame grid: from its start to the later of its last stage and its
 * start plus the reload clip's length, cut at the first shot after its start (a shot ends a reload,
 * as the first-person rig plays it).
 */
export interface ReloadSpan {
  start: number
  lastStage: number
}

/**
 * reloadingAt says whether frame `frame` falls in one of `spans` (sorted by start), the reload
 * lasting `seconds` (the weapon's reload clip; null: only to its last stage), `shots` the holder's
 * shot frames (sorted).
 */
export function reloadingAt(spans: readonly ReloadSpan[], frame: number, fps: number, seconds: number | null, shots: readonly number[]): boolean {
  let i = -1
  for (let k = 0; k < spans.length && spans[k].start <= frame; k++) i = k
  if (i < 0) return false
  const s = spans[i]
  const end = Math.max(s.lastStage, s.start + Math.max(0, seconds ?? 0) * fps)
  if (frame >= end) return false
  for (const t of shots) if (t > s.start && t <= frame) return false
  return true
}

/** A magazine read of the film: its time (ms) and the rounds loaded. */
export interface MagazineRead {
  ms: number
  rounds: number
}

/**
 * magazineFraction is the engine's `primary_ammunition` at `ms`: the rounds of the film's last magazine
 * read at or before it (`reads` sorted by ms; carried forward until the next one) over the weapon's
 * `rounds loaded maximum` (`size`), in [0, 1]. Before the life's first read the magazine is full (a
 * player spawns full). A weapon of unknown size (an older library, a weapon without a magazine) reads full.
 */
export function magazineFraction(reads: readonly MagazineRead[], ms: number, size: number | undefined): number {
  if (!size || size <= 0) return 1
  let lo = 0
  let hi = reads.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (reads[mid].ms <= ms) lo = mid + 1
    else hi = mid
  }
  if (lo === 0) return 1
  return Math.min(1, Math.max(0, reads[lo - 1].rounds / size))
}