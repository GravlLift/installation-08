// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * ragdollBake3d.ts — LA CUISSON D'UNE MORT : le corps inerte simulé UNE fois, au pas fixe, depuis la
 * pose exacte de la victime à sa mort, jusqu'au repos (au plus `MAX_SECONDS`), et rangé en piste :
 * la place du bassin et la rotation locale de chaque os conduit, `SAMPLE_RATE` fois par seconde,
 * rotations quantifiées sur 16 bits. Au-delà de la piste, la dernière pose tient.
 *
 * La vue rejoue la piste à l'instant fractionnaire de l'image (`poseBake`) : la pose est une fonction
 * de l'image, en avant comme en arrière, à l'arrêt comme au ralenti. Même entrée, même piste au bit
 * près (pas fixe, itérations fixes, germe stable).
 *
 * La cuisson est un travail qu'on avance par tranches (`RagdollJob.advance`, jusqu'à une échéance) :
 * la page ne se bloque pas. La carte autour du corps (`ragdollPatch3d`) est relue quand le corps
 * s'approche du bord du morceau lu.
 */
import * as THREE from 'three'

import { BELLY_FORWARD, FACE_FORWARD, HEAD_REACH, P, PARTICLES, STERNUM_FORWARD } from './ragdollBody3d'
import { DRIVEN, driveBones, pelvisLocal, readDeathFrame, type DeathFrame, type SimFrame } from './ragdollBones3d'
import { kickVelocities, type KickInput } from './ragdollKick3d'
import { TrianglePatch, type TriangleSource } from './ragdollPatch3d'
import { STEP_SECONDS, broken, createRagdoll, kickRagdoll, maxStep, stepRagdoll, type RagdollState } from './ragdollSolver3d'

/** La cadence de la piste (images par seconde) et sa durée au plus (s). */
export const SAMPLE_RATE = 30
export const MAX_SECONDS = 4
const STEPS_PER_SAMPLE = Math.round(1 / (SAMPLE_RATE * STEP_SECONDS))
const MAX_STEPS = Math.round(MAX_SECONDS / STEP_SECONDS)
/** Le repos : après `REST_AFTER` s, tout pas sous `REST_STEP` u pendant `REST_HOLD` s. */
const REST_AFTER = 0.5
const REST_STEP = 0.06 * STEP_SECONDS
const REST_HOLD = 0.3
/** Le morceau de carte lu autour du bassin (demi-côté, u), relu quand une particule passe à `PATCH_MARGIN` de son bord. */
const PATCH_HALF = 1.5
const PATCH_MARGIN = 0.3
const MAX_PATCHES = 12
const QUANT = 32767

/** Une mort cuite. */
export interface RagdollBake {
  /** Les noms des os (partagés par les cuissons d'un même squelette) et la pose de la mort (7 par os). */
  names: readonly string[]
  base: Float32Array
  /** L'indice (dans `names`) de chaque os conduit (`ragdollBones3d.DRIVEN`). */
  index: Int16Array
  count: number
  /** 4 par os conduit et par échantillon. */
  rot: Int16Array
  /** La place locale du bassin, 3 par échantillon. */
  pelvis: Float32Array
  /** La racine du squelette pendant la cuisson : ses pieds (axes three) et son lacet (radians). */
  feet: THREE.Vector3
  yaw: number
  /** Le temps simulé (s) ; au repos avant `MAX_SECONDS` ou non. */
  seconds: number
  rested: boolean
  /** Mesures : temps de calcul (ms), morceaux de carte lus et triangles. */
  stats: { ms: number; patches: number; triangles: number }
}

/** Ce qu'une cuisson lit au départ. */
export interface RagdollStart {
  /** Les os du squelette de travail posé à la mort (`bonesOf`, matrices monde à jour) et leurs noms. */
  bones: readonly THREE.Bone[]
  names: string[]
  feet: THREE.Vector3
  yaw: number
  kick: KickInput
  world: TriangleSource
}

/** RagdollJob : une cuisson en cours (cf. l'en-tête). */
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
  /** La cuisson a été abandonnée (état non fini) : elle ne rendra rien. */
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

  /** start : la cuisson d'une mort, null si le squelette n'a pas les os conduits ou les os des particules. */
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

  /** advance avance la cuisson jusqu'à l'échéance `deadline` (`performance.now()`) ; rend la cuisson finie, ou null. */
  advance(deadline: number): RagdollBake | null {
    if (this.result || this.failed) return this.result
    const t0 = performance.now()
    while (!this.finished()) {
      this.step()
      if (broken(this.state)) {
        // Garde-fou : un état non fini (triangle dégénéré mal lu...) abandonne la cuisson ; le corps
        // tombe alors par les clips de mort du jeu.
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

  /** ensurePatch relit la carte autour du bassin quand une particule approche du bord du morceau. */
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
 * particlesOf : les places (axes du monde) des particules sur le squelette posé : les os nommés, puis
 * les points d'épaisseur ; null s'il manque un os.
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
 * poseBake pose les os `bones` (alignés sur `bake.names`) à `t` secondes de la mort : la pose de la
 * mort pour tous, puis les os conduits et le bassin lus entre les deux échantillons voisins. La racine
 * (pieds, lacet) est à poser par l'appelant (`bake.feet`, `bake.yaw`).
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

/** bakeBytes : la mémoire tenue par une cuisson (octets des tampons qu'elle possède). */
export function bakeBytes(b: RagdollBake): number {
  return b.rot.byteLength + b.pelvis.byteLength + b.base.byteLength
}
