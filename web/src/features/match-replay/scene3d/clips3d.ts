// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * clips3d.ts — the SPARTAN'S GAME ANIMATIONS, read from its GLB (`spartan.glb`, one glTF
 * animation per game name, `posture:class[:type]:action`, cf. `meshproto.AnimationsSpartan`).
 *
 * Each animation is authored IN PLACE at its own rate: one track per bone and per property
 * (rotation, translation), either a single key (fixed bone) or one key per animation frame. The
 * per-frame root motion (glTF axes = model frame) is not on the skeleton: it lives in the
 * animation's extras (`levelupAnimation.rootMotion`), which GLTFLoader does not copy into
 * `AnimationClip.userData`, so it is read from the GLB's JSON directly. It gives a cycle's
 * stride length, from which a locomotion clip's time is derived from the distance traveled.
 *
 * A Spartan source's catalog is stored next to it (`registerSpartanClips`): any copy of that
 * source (`spartan3d`, the muzzle probe) finds it again with no other path.
 */
import type * as THREE from 'three'

/** The key of an animation's extras (`himap.CleAnimationGLB`). */
const EXTRAS_KEY = 'levelupAnimation'
/** The default frame rate of older GLBs. */
export const CLIP_FPS = 30

/** One track of a clip: a bone, a property, its values (1 key, or one per frame). */
export interface ClipTrack {
  bone: string
  /** 4: rotation (quaternion x, y, z, w), 3: translation. */
  size: 3 | 4
  values: Float32Array
  /** 1 (fixed bone) or the clip's frame count. */
  keys: number
}

/** A game animation ready to sample. */
export interface SpartanClip {
  name: string
  /** Frame count. */
  frames: number
  /** The clip's rate (frames/s). */
  frameRate: number
  /** A looped cycle's duration (s): `frames / frameRate` (the last frame returns to the first). */
  cycle: number
  /** Duration played once (s): `(frames - 1) / frameRate`. */
  once: number
  /** Ground distance traveled by one cycle (u), 0 for an in-place clip. */
  stride: number
  /**
   * The phase (fraction of the cycle, [0, 1)) where the left foot leads furthest in the
   * direction of travel: the shared reference that syncs blended locomotion clips. 0 for an
   * in-place clip; measured on the skeleton by `measureSyncPhases` (`clipSample3d`).
   */
  sync: number
  /** The direction of a cycle's travel (x, z of the model frame, unit vector), [0, 0] in place. */
  dir: readonly [number, number]
  tracks: ClipTrack[]
}

export class SpartanClips {
  private readonly byName = new Map<string, SpartanClip>()

  readonly weaponClips?: WeaponClips

  constructor(clips: readonly SpartanClip[], weaponClips?: WeaponClips) {
    this.weaponClips = weaponClips
    for (const c of clips) this.byName.set(c.name, c)
  }

  /** get: clip `name`, undefined when the GLB doesn't carry it. */
  get(name: string): SpartanClip | undefined {
    return this.byName.get(name)
  }

  /** names: the clip names, in the GLB's order. */
  names(): string[] {
    return [...this.byName.keys()]
  }

  /** bones: the bones the clips animate, each once. */
  bones(): string[] {
    const out = new Set<string>()
    for (const c of this.byName.values()) for (const t of c.tracks) out.add(t.bone)
    return [...out]
  }
}

/** Clip names by weapon and by class, published in the GLB's extras. */
export interface WeaponClips {
  weapons: { weapon: string; class: string; reload?: string }[]
  classes: { class: string; reload?: string }[]
}

/** The animation as the GLB's JSON describes it (name, extras). */
export interface GltfAnimationJson {
  name?: string
  extras?: Record<string, unknown>
}

/**
 * clipsOf: the catalog of `animations` (GLTFLoader's) whose `json` is the GLB's list in the same
 * order. A track that has neither one key nor one key per frame, or that carries neither
 * rotation nor translation, is dropped (logged): the sampler reads per frame.
 */
export function clipsOf(animations: readonly THREE.AnimationClip[], json: readonly GltfAnimationJson[], weaponClips?: WeaponClips): SpartanClips {
  const out: SpartanClip[] = []
  animations.forEach((a, i) => {
    const extras = json[i]?.name === a.name ? (json[i].extras?.[EXTRAS_KEY] as AnimationExtras | undefined) : undefined
    const frames = extras?.frameCount ?? 0
    if (frames < 1) {
      console.warn('3D replay: animation with no frame count, dropped', a.name)
      return
    }
    const frameRate = extras?.frameRate && extras.frameRate > 0 ? extras.frameRate : CLIP_FPS
    const travel = travelOf(extras?.rootMotion ?? [])
    out.push({
      name: a.name,
      frames,
      frameRate,
      cycle: frames / frameRate,
      once: (frames - 1) / frameRate,
      stride: travel.stride,
      sync: 0,
      dir: travel.dir,
      tracks: tracksOf(a, frames),
    })
  })
  return new SpartanClips(out, weaponClips)
}

interface AnimationExtras {
  frameCount?: number
  frameRate?: number
  rootMotion?: readonly (readonly number[])[]
}

/** Below this (u per cycle), a clip is in place: its steps don't scale to distance. */
const STILL_STRIDE = 0.05

/**
 * travelOf: a cycle's ground distance (sum of per-frame horizontal displacements, u) and its
 * direction (unit vector, [0, 0] for an in-place clip).
 */
function travelOf(rootMotion: readonly (readonly number[])[]): { stride: number; dir: [number, number] } {
  let x = 0
  let z = 0
  for (const d of rootMotion) {
    x += d[0] ?? 0
    z += d[2] ?? 0
  }
  const stride = Math.hypot(x, z)
  return stride < STILL_STRIDE ? { stride: 0, dir: [0, 0] } : { stride, dir: [x / stride, z / stride] }
}

const PROPERTY_SIZE: Readonly<Record<string, 3 | 4>> = { quaternion: 4, position: 3 }

/**
 * tracksOf: the readable tracks of `a`. A unit scale (shoulder and forearm helper bones carry
 * one, constant, in every clip) is the resting value: dropped silently. Other dropped tracks are
 * logged in one line per clip.
 */
function tracksOf(a: THREE.AnimationClip, frames: number): ClipTrack[] {
  const out: ClipTrack[] = []
  const dropped: string[] = []
  for (const t of a.tracks) {
    const dot = t.name.lastIndexOf('.')
    const property = t.name.slice(dot + 1)
    if (property === 'scale' && isUnit(t.values)) continue
    const size = PROPERTY_SIZE[property]
    const keys = t.times.length
    if (!size || (keys !== 1 && keys !== frames)) {
      dropped.push(`${t.name} (${keys})`)
      continue
    }
    out.push({ bone: t.name.slice(0, dot), size, values: Float32Array.from(t.values), keys })
  }
  if (dropped.length > 0) console.warn('3D replay: dropped animation tracks', a.name, dropped.join(', '))
  return out
}

/** UNIT_SCALE_EPS: the deviation from 1 below which a float-baked scale counts as unit. */
const UNIT_SCALE_EPS = 1e-4

function isUnit(values: ArrayLike<number>): boolean {
  for (let i = 0; i < values.length; i++) if (Math.abs(values[i] - 1) > UNIT_SCALE_EPS) return false
  return true
}

const registry = new WeakMap<THREE.Object3D, SpartanClips>()

/** registerSpartanClips stores catalog `clips` for Spartan source `source`. */
export function registerSpartanClips(source: THREE.Object3D, clips: SpartanClips): void {
  registry.set(source, clips)
}

/** spartanClipsOf: the catalog stored for `source`, null with no animation. */
export function spartanClipsOf(source: THREE.Object3D): SpartanClips | null {
  return registry.get(source) ?? null
}
