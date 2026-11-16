/**
 * glowAnimation3d.ts — THE MOVING LIGHT of the map's self-lit surfaces: a holographic sign's
 * scrolling picture and flicker, a neon's pulse, a screen's scroll.
 *
 * WHAT IS THE GAME'S. Only what a material's own animated parameters declare, at their rates and
 * amounts: the build reads them (himap `emissif_fonctions.go`) into the GLB's material extras
 * (`emissionAnim`), each a periodic function of time that multiplies the light (`force`: its
 * intensity, amount or opacity), sets one component of its texture's transform (`uv`), or picks
 * its color along a gradient (`couleur`). A GLB without them draws the still light.
 *
 * DETERMINISM. Everything is a pure function of MATCH seconds (`glowStateAt`): the screen and the
 * video export pass the replay's own time, never a wall clock, so the same time draws the same
 * frame. Random waves (noise, jitter, wander, spark) hash the time step and the material.
 *
 * COST. No pass, no shader change, no texture: per frame and per animated material, a few
 * function evaluations and the uniforms three already has (emissive color and intensity, or the
 * basic color, and the texture's uv transform). Off (`setEnabled(false)`), the materials get their
 * still values back once and nothing runs per frame.
 */
import * as THREE from 'three'

import { glowLevel, imageGlowLevel } from './lighting'

/** A periodic sub-function: wave(frequence x input + phase), brought into [min, max]. */
export interface GamePeriodic { onde: number; frequence: number; phase: number; min: number; max: number }

/** A game mapping function: min + (max - min) x its first periodic sub-function. */
export interface GameFunction { type: number; plage?: boolean; min: number; max: number; periodiques?: GamePeriodic[] }

/** One animated parameter of a light, as the build writes it (`emissionAnim`). */
export interface GlowAnimSpec {
  cible: 'force' | 'uv' | 'couleur'
  /** uv: 0 scale x, 1 scale y, 2 offset x, 3 offset y (KHR_texture_transform's scale and offset). */
  composante?: number
  /** Seconds per unit of the function's input. */
  periode: number
  fonction: GameFunction
  /** couleur: the gradient's colors, linear RGB. */
  couleurs?: [number, number, number][]
}

/** The user-data key marking a view material the animator drives (its entry's rank). */
const GLOW_ENTRY = 'glowAnimEntry'

/** The game's periodic function type (the only one the build writes). */
const PERIODIC = 3

function fract(x: number): number {
  return x - Math.floor(x)
}

/** hash01: a value in [0, 1) for an integer step and a seed (the same pair, the same value). */
export function hash01(step: number, seed: number): number {
  let h = Math.imul(step | 0, 0x27d4eb2d) ^ Math.imul((seed | 0) + 0x9e3779b9, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** smoothNoise: a value noise, one random value per unit of x, eased between them. */
function smoothNoise(x: number, seed: number): number {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  return hash01(i, seed) * (1 - u) + hash01(i + 1, seed) * u
}

/**
 * periodicWave: the game's periodic waves in [0, 1] at x (cycles): one, zero, cosine, diagonal
 * (triangle) wave, slide (sawtooth), noise, jitter, wander, spark. The "variable period" variants
 * (3, 5, 7) are drawn at their fixed period.
 */
export function periodicWave(onde: number, x: number, seed: number): number {
  switch (onde) {
    case 0: return 1
    case 1: return 0
    case 2: case 3: return 0.5 - 0.5 * Math.cos(2 * Math.PI * x)
    case 4: case 5: return 1 - Math.abs(2 * fract(x) - 1)
    case 6: case 7: return fract(x)
    case 8: return smoothNoise(x * 4, seed)
    case 9: return hash01(Math.floor(x * 4), seed)
    case 10: return smoothNoise(x, seed)
    case 11: return hash01(Math.floor(x), seed) > 0.8 ? 1 - fract(x) : 0
    default: return 1
  }
}

/**
 * evalGameFunction: the function's value at `seconds` (input = seconds / period), null when it is
 * not a periodic function with a sub-function. A ranged function (two sub-functions) is drawn on
 * its first, the range input being unknown here (0).
 */
export function evalGameFunction(spec: GlowAnimSpec, seconds: number, seed: number): number | null {
  const f = spec.fonction
  const sub = f.periodiques?.[0]
  if (f.type !== PERIODIC || !sub) return null
  const input = spec.periode > 0 ? seconds / spec.periode : seconds
  const v = sub.min + (sub.max - sub.min) * periodicWave(sub.onde, sub.frequence * input + sub.phase, seed)
  return f.min + (f.max - f.min) * v
}

/** gradientAt: the color at position `p` (clamped to [0, 1]) along `colors`. */
export function gradientAt(colors: readonly [number, number, number][], p: number): [number, number, number] {
  if (colors.length === 1) return [...colors[0]]
  const x = Math.min(1, Math.max(0, p)) * (colors.length - 1)
  const i = Math.min(colors.length - 2, Math.floor(x))
  const u = x - i
  const a = colors[i]
  const b = colors[i + 1]
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]
}

/** The animated state of a light at an instant: a force factor, its color (null: still), its uv transform. */
export interface GlowState {
  force: number
  color: [number, number, number] | null
  /** scale x, scale y, offset x, offset y. */
  uv: [number, number, number, number]
}

/** glowStateAt: the state of a light whose still uv transform is `uv`, at match `seconds`. Pure. */
export function glowStateAt(specs: readonly GlowAnimSpec[], uv: readonly [number, number, number, number], seconds: number, seed: number): GlowState {
  const state: GlowState = { force: 1, color: null, uv: [uv[0], uv[1], uv[2], uv[3]] }
  specs.forEach((spec, k) => {
    const v = evalGameFunction(spec, seconds, seed + k * 7919)
    if (v === null) return
    if (spec.cible === 'force') state.force *= Math.max(0, v)
    // The build leaves a zero component out (scale x).
    else if (spec.cible === 'uv' && (spec.composante ?? 0) >= 0 && (spec.composante ?? 0) < 4) state.uv[spec.composante ?? 0] = v
    else if (spec.cible === 'couleur' && spec.couleurs && spec.couleurs.length > 0) state.color = gradientAt(spec.couleurs, v)
  })
  return state
}

/** readGlowAnim: the animated parameters of a material's extras, null without any it can draw. */
export function readGlowAnim(extras: { emissionAnim?: unknown } | undefined): GlowAnimSpec[] | null {
  const list = extras?.emissionAnim
  if (!Array.isArray(list)) return null
  const specs = list.filter((s): s is GlowAnimSpec => !!s && typeof s === 'object' && ['force', 'uv', 'couleur'].includes((s as GlowAnimSpec).cible) && typeof (s as GlowAnimSpec).fonction === 'object')
  return specs.length > 0 ? specs : null
}

/** One material the animator drives: its still light, and how to write a state into it. */
interface Entry {
  material: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial
  specs: GlowAnimSpec[]
  seed: number
  /** The game's color (linear) and force, as the GLB carries them. */
  color: THREE.Color
  force: number
  image: boolean
  texture: THREE.Texture | null
  uv: [number, number, number, number]
}

/** The light a game color and force draw at in the view: what `glowOf` (mapModel) gives a still one. */
function viewLight(color: THREE.Color, force: number, image: boolean, out: THREE.Color): number {
  out.copy(color)
  if (!image) return glowLevel(force)
  const brightest = Math.max(out.r, out.g, out.b)
  if (!(brightest > 0)) return 0
  out.multiplyScalar(1 / brightest)
  return imageGlowLevel(brightest * force)
}

/**
 * GlowAnimator: the animated self-lit materials of a model. `update(seconds)` writes each one's
 * state at that match time; `setEnabled(false)` restores the still light once.
 */
export class GlowAnimator {
  private readonly entries: Entry[] = []
  private enabled = true
  private readonly scratch = new THREE.Color()
  private readonly tint = new THREE.Color()

  get size(): number {
    return this.entries.length
  }

  /**
   * add registers a view material drawing the light of `source` (the GLB's material) with the
   * game's animated parameters `specs`. A texture whose uv moves gets its own copy (the GLB's may
   * be shared), sharing the image.
   */
  add(material: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial, source: THREE.MeshStandardMaterial, specs: GlowAnimSpec[], image: boolean, seed: number): void {
    if (this.entries.some((e) => e.material === material)) return
    // The light's picture: an additive material's map, a lit one's emissive map.
    const basic = material instanceof THREE.MeshBasicMaterial
    let texture = basic ? material.map : (material as THREE.MeshStandardMaterial).emissiveMap
    if (texture && specs.some((s) => s.cible === 'uv')) {
      texture = texture.clone()
      if (basic) material.map = texture
      else (material as THREE.MeshStandardMaterial).emissiveMap = texture
    }
    const uv: [number, number, number, number] = texture ? [texture.repeat.x, texture.repeat.y, texture.offset.x, texture.offset.y] : [1, 1, 0, 0]
    // The mark a probe's copy of the material keeps (`adoptCopies`).
    material.userData[GLOW_ENTRY] = this.entries.length
    this.entries.push({ material, specs, seed, color: source.emissive.clone(), force: source.emissiveIntensity, image, texture, uv })
  }

  /**
   * adoptCopies drives the copies the lighting made of registered materials (one per environment
   * probe, `assignProbes`) among `meshes`' materials: a copy keeps its original's user data, so its
   * mark. The copy shares its original's texture, whose transform the original's entry already
   * writes.
   */
  adoptCopies(meshes: readonly THREE.Mesh[]): void {
    const known = new Set<THREE.Material>(this.entries.map((e) => e.material))
    for (const mesh of meshes) {
      for (const m of [mesh.material].flat()) {
        const k = m.userData[GLOW_ENTRY]
        if (known.has(m) || typeof k !== 'number' || !this.entries[k]) continue
        if (!(m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshBasicMaterial)) continue
        known.add(m)
        this.entries.push({ ...this.entries[k], material: m, texture: null })
      }
    }
  }

  /** update writes every material's state at match `seconds`; nothing while disabled. */
  update(seconds: number): void {
    if (!this.enabled) return
    for (const e of this.entries) this.write(e, glowStateAt(e.specs, e.uv, seconds, e.seed))
  }

  /** setEnabled: off, the still light is written back once and `update` does nothing. */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return
    this.enabled = on
    if (!on) for (const e of this.entries) this.write(e, { force: 1, color: null, uv: e.uv })
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  private write(e: Entry, s: GlowState): void {
    const color = s.color ? this.tint.setRGB(s.color[0], s.color[1], s.color[2]) : e.color
    const level = viewLight(color, e.force * s.force, e.image, this.scratch)
    if (e.material instanceof THREE.MeshBasicMaterial) e.material.color.copy(this.scratch).multiplyScalar(level)
    else {
      e.material.emissive.copy(this.scratch)
      e.material.emissiveIntensity = level
    }
    if (e.texture) {
      e.texture.repeat.set(s.uv[0], s.uv[1])
      e.texture.offset.set(s.uv[2], s.uv[3])
    }
  }
}
