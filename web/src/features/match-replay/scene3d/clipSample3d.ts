// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * clipSample3d.ts — THE GAME'S CLIPS POSED ON A SPARTAN COPY, at an imposed time.
 *
 * No clock and no `AnimationMixer`: the pose is a pure function of the requested mix (`ClipMix`,
 * drawn from the replay frame by `clipSelect3d`). Each call restarts from the rest pose of every
 * bone the clips animate, then:
 *   1. the BASE layers (locomotion, stances, jump...) blend in a weighted average (their weights
 *      sum to 1; a bone none of them animates keeps rest for the missing share);
 *   2. the OVER layers (melee, throw, put-away...) replace, at their weight, the bones they
 *      animate (the others keep the base).
 * Same mix = same pose down to the bit, regardless of which frames were visited before.
 *
 * Tracks are bound to bones once (by name); a sample reads two neighboring keys (one per clip
 * frame): spherical interpolation for rotations, linear for translations. A looping clip wraps
 * from its last frame to the first; a once-played clip holds its edges. No per-frame
 * allocation: per-copy buffers.
 */
import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'

import { type SpartanClip, type SpartanClips } from './clips3d'

/** A layer of the mix: a clip, its time (s), its weight, and whether it loops. */
export interface ClipLayer {
  clip: SpartanClip | null
  time: number
  weight: number
  loop: boolean
}

/** A frame's mix: base layers (weights summing to 1) then over layers. */
export interface ClipMix {
  base: ClipLayer[]
  baseCount: number
  over: ClipLayer[]
  overCount: number
}

/** newClipMix: an empty mix at the given capacities (reused from one frame to the next). */
export function newClipMix(baseCapacity = 16, overCapacity = 4): ClipMix {
  const layer = (): ClipLayer => ({ clip: null, time: 0, weight: 0, loop: false })
  return {
    base: Array.from({ length: baseCapacity }, layer),
    baseCount: 0,
    over: Array.from({ length: overCapacity }, layer),
    overCount: 0,
  }
}

/** A clip's bindings to a copy: each track's bone index (-1: bone absent from the copy). */
type Binding = Int16Array

export class ClipRig {
  private _bones: THREE.Bone[]
  /** Bones animated by at least one clip, in buffer order. */
  get bones(): readonly THREE.Bone[] { return this._bones }
  private restQ: Float32Array
  private restT: Float32Array
  private q: Float32Array
  private t: Float32Array
  private wq: Float32Array
  private wt: Float32Array
  private readonly byName: Map<string, THREE.Bone>
  private readonly index: Map<string, number>
  private readonly bindings = new Map<SpartanClip, Binding>()
  private readonly sample = new Float32Array(4)
  readonly clips: SpartanClips

  /** `root`: the copy at rest; `clips`: its source's catalog. */
  constructor(root: THREE.Object3D, clips: SpartanClips) {
    this.clips = clips
    this.byName = new Map<string, THREE.Bone>()
    root.traverse((o) => {
      if (o instanceof THREE.Bone && !this.byName.has(o.name)) this.byName.set(o.name, o)
    })
    this._bones = clips.bones().flatMap((n) => this.byName.get(n) ?? [])
    const n = this._bones.length
    this.restQ = new Float32Array(4 * n)
    this.restT = new Float32Array(3 * n)
    this._bones.forEach((b, i) => {
      b.quaternion.toArray(this.restQ, 4 * i)
      b.position.toArray(this.restT, 3 * i)
    })
    this.q = new Float32Array(4 * n)
    this.t = new Float32Array(3 * n)
    this.wq = new Float32Array(n)
    this.wt = new Float32Array(n)
    this.index = new Map(this._bones.map((b, i) => [b.name, i]))
    for (const name of clips.names()) {
      const clip = clips.get(name) as SpartanClip
      this.bindings.set(clip, this.bind(clip))
    }
  }

  /** bind: the clip's tracks' bone indices (-1 when the bone is absent from the copy). */
  private bind(clip: SpartanClip): Binding {
    return Int16Array.from(clip.tracks, (tr) => this.index.get(tr.bone) ?? -1)
  }

  /**
   * ensureClip makes `clip` driveable on this rig: a no-op when it is already bound. Otherwise it
   * finds, by name under the rig's root, every bone its tracks name that this rig does not drive
   * yet, appends them (their rest is captured from their current pose: they have never been driven
   * by a clip), grows the per-bone buffers, and binds the clip.
   */
  ensureClip(clip: SpartanClip): void {
    if (this.bindings.has(clip)) return
    const fresh: THREE.Bone[] = []
    for (const tr of clip.tracks) {
      if (this.index.has(tr.bone)) continue
      const bone = this.byName.get(tr.bone)
      if (!bone) continue
      this.index.set(tr.bone, this._bones.length)
      this._bones.push(bone)
      fresh.push(bone)
    }
    if (fresh.length > 0) this.grow(fresh)
    this.bindings.set(clip, this.bind(clip))
  }

  /** grow: the per-bone buffers grown to cover `fresh` (their rest captured from the current pose). */
  private grow(fresh: THREE.Bone[]): void {
    const n0 = this._bones.length - fresh.length
    const n = this._bones.length
    const restQ = new Float32Array(4 * n)
    const restT = new Float32Array(3 * n)
    restQ.set(this.restQ.subarray(0, 4 * n0))
    restT.set(this.restT.subarray(0, 3 * n0))
    fresh.forEach((bone, j) => {
      const i = n0 + j
      bone.quaternion.toArray(restQ, 4 * i)
      bone.position.toArray(restT, 3 * i)
    })
    const q = new Float32Array(4 * n)
    const t = new Float32Array(3 * n)
    q.set(this.q.subarray(0, 4 * n0))
    t.set(this.t.subarray(0, 3 * n0))
    const wq = new Float32Array(n)
    const wt = new Float32Array(n)
    wq.set(this.wq.subarray(0, n0))
    wt.set(this.wt.subarray(0, n0))
    this.restQ = restQ
    this.restT = restT
    this.q = q
    this.t = t
    this.wq = wq
    this.wt = wt
  }

  /** apply poses the copy's bones for mix `mix` (see the header). */
  apply(mix: ClipMix): void {
    this.wq.fill(0)
    this.wt.fill(0)
    for (let i = 0; i < mix.baseCount; i++) {
      const c = mix.base[i].clip
      if (c) this.ensureClip(c)
      this.blendBase(mix.base[i])
    }
    this.settleBase()
    for (let i = 0; i < mix.overCount; i++) {
      const c = mix.over[i].clip
      if (c) this.ensureClip(c)
      this.blendOver(mix.over[i])
    }
    this.bones.forEach((b, i) => {
      b.quaternion.fromArray(this.q, 4 * i)
      b.position.fromArray(this.t, 3 * i)
    })
  }

  /** blendBase adds a base layer to the weighted average in progress. */
  private blendBase(layer: ClipLayer): void {
    const clip = layer.clip
    if (!clip || layer.weight <= 0) return
    const bind = this.bindings.get(clip) as Binding
    const at = framePosition(clip, layer.time, layer.loop)
    clip.tracks.forEach((tr, k) => {
      const b = bind[k]
      if (b < 0) return
      sampleTrack(tr, at, clip.frames, layer.loop, this.sample)
      if (tr.size === 4) accumulate(this.q, this.wq, b, 4, this.sample, layer.weight)
      else accumulate(this.t, this.wt, b, 3, this.sample, layer.weight)
    })
  }

  /** settleBase: the weight share no layer gave a bone returns to its rest pose. */
  private settleBase(): void {
    for (let b = 0; b < this.bones.length; b++) {
      settle(this.q, this.wq[b], b, 4, this.restQ)
      settle(this.t, this.wt[b], b, 3, this.restT)
    }
  }

  /** blendOver replaces, at the layer's weight, the bones it animates. */
  private blendOver(layer: ClipLayer): void {
    const clip = layer.clip
    if (!clip || layer.weight <= 0) return
    const bind = this.bindings.get(clip) as Binding
    const at = framePosition(clip, layer.time, layer.loop)
    const w = Math.min(1, layer.weight)
    clip.tracks.forEach((tr, k) => {
      const b = bind[k]
      if (b < 0) return
      sampleTrack(tr, at, clip.frames, layer.loop, this.sample)
      if (tr.size === 4) slerpFlat(this.q, 4 * b, this.q, 4 * b, this.sample, 0, w)
      else for (let c = 0; c < 3; c++) this.t[3 * b + c] += (this.sample[c] - this.t[3 * b + c]) * w
    })
  }
}

/**
 * measureSyncPhases measures the sync phase (`SpartanClip.sync`) of each moving clip: the frame
 * where the left foot (`b_l_foot`) leads furthest ahead of the right one in the direction of
 * travel. Poses a copy of `source`'s bones (never `source` itself); once per catalog.
 */
export function measureSyncPhases(source: THREE.Object3D, clips: SpartanClips): void {
  const root = cloneSkinned(source)
  const left = root.getObjectByName('b_l_foot')
  const right = root.getObjectByName('b_r_foot')
  if (!left || !right) return
  const rig = new ClipRig(root, clips)
  const mix = newClipMix(1, 0)
  const layer = mix.base[0]
  mix.baseCount = 1
  layer.weight = 1
  layer.loop = true
  const l = new THREE.Vector3()
  const r = new THREE.Vector3()
  for (const name of clips.names()) {
    const clip = clips.get(name) as SpartanClip
    if (clip.stride === 0) continue
    let best = -Infinity
    for (let k = 0; k < clip.frames; k++) {
      layer.clip = clip
      layer.time = k / clip.frameRate
      rig.apply(mix)
      root.updateMatrixWorld(true)
      left.getWorldPosition(l).sub(right.getWorldPosition(r))
      const lead = l.x * clip.dir[0] + l.z * clip.dir[1]
      if (lead > best) {
        best = lead
        clip.sync = k / clip.frames
      }
    }
  }
}

/** slerpFlat: `THREE.Quaternion.slerpFlat` over typed arrays (its types only accept `number[]`). */
function slerpFlat(dst: Float32Array, d: number, a: Float32Array, ai: number, b: Float32Array, bi: number, t: number): void {
  THREE.Quaternion.slerpFlat(dst as unknown as number[], d, a as unknown as number[], ai, b as unknown as number[], bi, t)
}

/** framePosition: the fractional position (in clip frames) of time `time` (s). */
export function framePosition(clip: SpartanClip, time: number, loop: boolean): number {
  const p = time * clip.frameRate
  if (loop) return p - clip.frames * Math.floor(p / clip.frames)
  return Math.min(Math.max(p, 0), clip.frames - 1)
}

/** sampleTrack writes into `out` the value of `tr` at position `at` (frames). */
function sampleTrack(tr: { size: 3 | 4; values: Float32Array; keys: number }, at: number, frames: number, loop: boolean, out: Float32Array): void {
  const s = tr.size
  if (tr.keys === 1) {
    for (let c = 0; c < s; c++) out[c] = tr.values[c]
    return
  }
  const i0 = Math.floor(at)
  const u = at - i0
  const i1 = loop ? (i0 + 1) % frames : Math.min(i0 + 1, frames - 1)
  if (s === 4) {
    slerpFlat(out, 0, tr.values, 4 * i0, tr.values, 4 * i1, u)
    return
  }
  for (let c = 0; c < 3; c++) out[c] = tr.values[3 * i0 + c] + (tr.values[3 * i1 + c] - tr.values[3 * i0 + c]) * u
}

/**
 * accumulate adds value `v` at weight `w` into bone `b`'s average: the first contribution is
 * copied, the following ones blended pro rata (spherical rotation, linear translation).
 */
function accumulate(acc: Float32Array, weights: Float32Array, b: number, size: 3 | 4, v: Float32Array, w: number): void {
  const total = weights[b] + w
  const k = w / total
  weights[b] = total
  const o = size * b
  if (size === 4) {
    if (k === 1) for (let c = 0; c < 4; c++) acc[o + c] = v[c]
    else slerpFlat(acc, o, acc, o, v, 0, k)
    return
  }
  for (let c = 0; c < 3; c++) acc[o + c] = k === 1 ? v[c] : acc[o + c] + (v[c] - acc[o + c]) * k
}

/** settle: a bone at weight `w` < 1 joins its rest pose for `1 - w`; with no weight, it is at rest. */
function settle(acc: Float32Array, w: number, b: number, size: 3 | 4, rest: Float32Array): void {
  const o = size * b
  if (w >= 1 - 1e-6) return
  if (w <= 0) {
    for (let c = 0; c < size; c++) acc[o + c] = rest[o + c]
    return
  }
  if (size === 4) slerpFlat(acc, o, rest, o, acc, o, w)
  else for (let c = 0; c < 3; c++) acc[o + c] = rest[o + c] + (acc[o + c] - rest[o + c]) * w
}
