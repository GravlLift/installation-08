// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * ragdollBake3d.ts — BAKING A DEATH: the ragdoll simulated ONCE, at a fixed step, from the
 * victim's exact pose at death, to rest (at most `MAX_SECONDS`), and stored as a track: the
 * pelvis position and the local rotation of each driven bone, `SAMPLE_RATE` times per second,
 * rotations quantized to 16 bits. Past the track, the last pose holds.
 *
 * The view replays the track at the frame's fractional instant (`poseBake`): the pose is a
 * function of the frame, forward as backward, paused as in slow motion. Same input, same track
 * to the bit (fixed step, fixed iterations, stable seed).
 *
 * Baking is a job advanced in slices (`RagdollJob.advance`, up to a deadline): the page does not
 * block. The map around the body (`ragdollPatch3d`) is reread when the body nears the edge of the
 * loaded chunk.
 */
import * as THREE from 'three'

import { BELLY_FORWARD, FACE_FORWARD, HEAD_REACH, P, PARTICLES, STERNUM_FORWARD } from './ragdollBody3d'
import { DRIVEN, driveBones, pelvisLocal, readDeathFrame, type DeathFrame, type SimFrame } from './ragdollBones3d'
import { kickVelocities, type KickInput } from './ragdollKick3d'
import { TrianglePatch, type TriangleSource } from './ragdollPatch3d'
import { STEP_SECONDS, broken, createRagdoll, kickRagdoll, maxStep, stepRagdoll, type RagdollState } from './ragdollSolver3d'

/** The track's rate (frames per second) and its max duration (s). */
export const SAMPLE_RATE = 30
export const MAX_SECONDS = 4
const STEPS_PER_SAMPLE = Math.round(1 / (SAMPLE_RATE * STEP_SECONDS))
const MAX_STEPS = Math.round(MAX_SECONDS / STEP_SECONDS)
/** Rest: after `REST_AFTER` s, every step under `REST_STEP` u for `REST_HOLD` s. */
const REST_AFTER = 0.5
const REST_STEP = 0.06 * STEP_SECONDS
const REST_HOLD = 0.3
/** The map chunk read around the pelvis (half-side, u), reread when a particle comes within `PATCH_MARGIN` of its edge. */
const PATCH_HALF = 1.5
const PATCH_MARGIN = 0.3
const MAX_PATCHES = 12
const QUANT = 32767

/** A baked death. */
export interface RagdollBake {
  /** The bone names (shared by bakes of the same skeleton) and the death pose (7 per bone). */
  names: readonly string[]
  base: Float32Array
  /** The index (into `names`) of each driven bone (`ragdollBones3d.DRIVEN`). */
  index: Int16Array
  count: number
  /** 4 per driven bone and per sample. */
  rot: Int16Array
  /** The pelvis's local position, 3 per sample. */
  pelvis: Float32Array
  /** The skeleton's root during the bake: its feet (three axes) and its yaw (radians). */
  feet: THREE.Vector3
  yaw: number
  /** The simulated time (s); whether it rested before `MAX_SECONDS`. */
  seconds: number
  rested: boolean
  /** Measurements: compute time (ms), map chunks read, and triangles. */
  stats: { ms: number; patches: number; triangles: number }
}

/** What a bake reads at the start. */
export interface RagdollStart {
  /** The work skeleton's bones posed at death (`bonesOf`, world matrices up to date) and their names. */
  bones: readonly THREE.Bone[]
  names: string[]
  feet: THREE.Vector3
  yaw: number
  kick: KickInput
  world: TriangleSource
}

/** RagdollJob: a bake in progress (see the header). */
export class RagdollJob {
  private readonly frame: DeathFrame
  private readonly state: RagdollState
  private readonly x0: Float64Array
  private readonly world: TriangleSource
  private patch: TrianglePatch | null = null
  private patches = 0
  private triangles = 0
  private steps = 0
  private calm = 0
  private samples = 0
  private ms = 0
  private readonly rot: Int16Array
  private readonly pelvis: Float32Array
  private readonly feet: THREE.Vector3
  private readonly yaw: number
  private readonly deltas = DRIVEN.map(() => new THREE.Quaternion())
  private readonly locals = new Float64Array(4 * DRIVEN.length)
  private readonly sim: SimFrame
  private result: RagdollBake | null = null
  /** The bake was abandoned (a non-finite state): it will return nothing. */
  failed = false

  private constructor(frame: DeathFrame, x0: Float64Array, s: RagdollStart) {
    this.frame = frame
    this.x0 = x0
    this.world = s.world
    this.feet = s.feet.clone()
    this.yaw = s.yaw
    this.state = createRagdoll(x0)
    kickRagdoll(this.state, kickVelocities(s.kick, x0))
    const maxSamples = Math.ceil(MAX_STEPS / STEPS_PER_SAMPLE) + 1
    this.rot = new Int16Array(4 * DRIVEN.length * maxSamples)
    this.pelvis = new Float32Array(3 * maxSamples)
    this.sim = { clusters: { pelvis: new THREE.Quaternion(), chest: new THREE.Quaternion(), head: new THREE.Quaternion() }, x: this.state.x }
  }

  /** start: a death's bake, null if the skeleton lacks the driven bones or the particle bones. */
  static start(s: RagdollStart): RagdollJob | null {
    const t0 = performance.now()
    const frame = readDeathFrame(s.bones, s.names)
    const x0 = frame && particlesOf(s.bones)
    if (!frame || !x0) return null
    const job = new RagdollJob(frame, x0, s)
    job.record()
    job.ms += performance.now() - t0
    return job
  }

  /** advance moves the bake forward to deadline `deadline` (`performance.now()`); returns the finished bake, or null. */
  advance(deadline: number): RagdollBake | null {
    if (this.result || this.failed) return this.result
    const t0 = performance.now()
    while (!this.finished()) {
      this.step()
      if (broken(this.state)) {
        // Safety net: a non-finite state (a mis-read degenerate triangle...) abandons the bake;
        // the body then falls through the game's death clips.
        this.failed = true
        return null
      }
      if ((this.steps & 7) === 0 && performance.now() >= deadline) break
    }
    this.ms += performance.now() - t0
    if (this.finished()) this.result = this.bake()
    return this.result
  }

  private finished(): boolean {
    return this.steps >= MAX_STEPS || this.calm >= REST_HOLD / STEP_SECONDS
  }

  private step(): void {
    this.ensurePatch()
    stepRagdoll(this.state, this.patch)
    this.steps++
    const resting = this.steps * STEP_SECONDS >= REST_AFTER && maxStep(this.state) < REST_STEP
    this.calm = resting ? this.calm + 1 : 0
    if (this.steps % STEPS_PER_SAMPLE === 0 || this.finished()) this.record()
  }

  /** ensurePatch rereads the map around the pelvis when a particle nears the chunk's edge. */
  private ensurePatch(): void {
    const x = this.state.x
    if (this.patch) {
      let inside = true
      for (let i = 0; i < PARTICLES.length && inside; i++) inside = this.patch.inside(x[3 * i], x[3 * i + 1], x[3 * i + 2], PATCH_MARGIN)
      if (inside || this.patches >= MAX_PATCHES) return
    }
    const c = new THREE.Vector3(x[3 * P('pelvis')], x[3 * P('pelvis') + 1], x[3 * P('pelvis') + 2])
    const box = new THREE.Box3(c.clone().subScalar(PATCH_HALF), c.clone().addScalar(PATCH_HALF))
    const tris = this.world.trianglesIn(box)
    this.patch = new TrianglePatch(tris, box)
    this.patches++
    this.triangles += this.patch.count
  }

  private record(): void {
    const s = this.state
    for (const name of ['pelvis', 'chest', 'head'] as const) this.sim.clusters[name].fromArray(s.clusters[name].rot)
    driveBones(this.frame, this.x0, this.sim, this.deltas, this.locals)
    const o = 4 * DRIVEN.length * this.samples
    for (let i = 0; i < this.locals.length; i++) this.rot[o + i] = Math.round(this.locals[i] * QUANT)
    pelvisLocal(this.frame, s.x, v).toArray(this.pelvis, 3 * this.samples)
    this.samples++
  }

  private bake(): RagdollBake {
    const n = this.samples
    return {
      names: this.frame.names,
      base: this.frame.base,
      index: this.frame.index,
      count: n,
      rot: this.rot.slice(0, 4 * DRIVEN.length * n),
      pelvis: this.pelvis.slice(0, 3 * n),
      feet: this.feet,
      yaw: this.yaw,
      seconds: this.steps * STEP_SECONDS,
      rested: this.steps < MAX_STEPS,
      stats: { ms: this.ms, patches: this.patches, triangles: this.triangles },
    }
  }
}

const v = new THREE.Vector3()

/**
 * particlesOf: the particles' positions (world axes) on the posed skeleton: the named bones, then
 * the thickness points; null if a bone is missing.
 */
export function particlesOf(bones: readonly THREE.Bone[]): Float64Array | null {
  const byName = new Map(bones.map((b) => [b.name, b]))
  const x = new Float64Array(3 * PARTICLES.length)
  for (let i = 0; i < PARTICLES.length; i++) {
    const bone = PARTICLES[i].bone
    if (bone === null) continue
    const b = byName.get(bone)
    if (!b) return null
    b.getWorldPosition(v).toArray(x, 3 * i)
  }
  const head = byName.get('b_head')
  if (!head) return null
  const at = (i: number) => new THREE.Vector3(x[3 * i], x[3 * i + 1], x[3 * i + 2])
  const headBase = head.getWorldPosition(new THREE.Vector3())
  const neckUp = headBase.clone().sub(at(P('neck'))).normalize()
  at(P('neck')).copy(headBase).addScaledVector(neckUp, HEAD_REACH).toArray(x, 3 * P('head'))
  const fwd = (up: THREE.Vector3, right: THREE.Vector3) => up.clone().cross(right).normalize()
  const pelvisFwd = fwd(at(P('chest')).sub(at(P('pelvis'))), at(P('rHip')).sub(at(P('lHip'))))
  const chestFwd = fwd(at(P('neck')).sub(at(P('chest'))), at(P('rShoulder')).sub(at(P('lShoulder'))))
  at(P('pelvis')).addScaledVector(pelvisFwd, BELLY_FORWARD).toArray(x, 3 * P('belly'))
  at(P('chest')).addScaledVector(chestFwd, STERNUM_FORWARD).toArray(x, 3 * P('sternum'))
  const faceFwd = chestFwd.clone().addScaledVector(neckUp, -chestFwd.dot(neckUp)).normalize()
  at(P('head')).addScaledVector(faceFwd, FACE_FORWARD).toArray(x, 3 * P('face'))
  return x
}

const qa = new THREE.Quaternion()
const qb = new THREE.Quaternion()

/**
 * poseBake poses bones `bones` (aligned with `bake.names`) at `t` seconds from death: the death
 * pose for all of them, then the driven bones and the pelvis read between the two neighboring
 * samples. The root (feet, yaw) is for the caller to place (`bake.feet`, `bake.yaw`).
 */
export function poseBake(bake: RagdollBake, t: number, bones: readonly (THREE.Bone | undefined)[]): void {
  for (let i = 0; i < bones.length; i++) {
    const b = bones[i]
    if (!b) continue
    b.quaternion.fromArray(bake.base, 7 * i)
    b.position.fromArray(bake.base, 7 * i + 4)
  }
  const s = Math.min(Math.max(t * SAMPLE_RATE, 0), bake.count - 1)
  const i0 = Math.floor(s)
  const i1 = Math.min(i0 + 1, bake.count - 1)
  const u = s - i0
  const per = 4 * DRIVEN.length
  for (let k = 0; k < DRIVEN.length; k++) {
    const b = bones[bake.index[k]]
    if (!b) continue
    dequant(bake.rot, per * i0 + 4 * k, qa)
    dequant(bake.rot, per * i1 + 4 * k, qb)
    b.quaternion.copy(qa).slerp(qb, u)
  }
  const pelvis = bones[bake.index[0]]
  if (pelvis) {
    const p = bake.pelvis
    pelvis.position.set(
      p[3 * i0] + (p[3 * i1] - p[3 * i0]) * u,
      p[3 * i0 + 1] + (p[3 * i1 + 1] - p[3 * i0 + 1]) * u,
      p[3 * i0 + 2] + (p[3 * i1 + 2] - p[3 * i0 + 2]) * u,
    )
  }
}

function dequant(rot: Int16Array, o: number, out: THREE.Quaternion): void {
  out.set(rot[o] / QUANT, rot[o + 1] / QUANT, rot[o + 2] / QUANT, rot[o + 3] / QUANT).normalize()
}

/** bakeBytes: the memory a bake holds (bytes of the buffers it owns). */
export function bakeBytes(b: RagdollBake): number {
  return b.rot.byteLength + b.pelvis.byteLength + b.base.byteLength
}
