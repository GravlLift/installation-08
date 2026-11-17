// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * ragdollBones3d.ts — FROM THE RAGDOLL TO THE SPARTAN'S BONES: which bones the simulation
 * drives, how their orientation is derived from the particles, and posing a copy from a bake.
 *
 * Only the major bones are driven (pelvis, spine, neck, head, upper arms, forearms, thighs,
 * calves, feet). Each one rotates, in world space, by a rotation from the death: that of its
 * rigid cluster (pelvis, chest, head), a blend of two clusters for the spine and neck, or, for a
 * limb, the shortest rotation that brings its segment (from the death, carried by its driven
 * parent) onto the simulated segment: the limb's twist stays the death's own. Undriven bones
 * (fingers, twist bones, helpers, armor attachments) keep their local rotation from the death
 * and follow their parent. Only rotations change (and the pelvis's position): bone lengths are
 * the model's own.
 */
import * as THREE from 'three'

import { P, type ClusterName } from './ragdollBody3d'

type Rule =
  | { kind: 'cluster'; cluster: ClusterName }
  | { kind: 'blend'; from: ClusterName; to: ClusterName; share: number }
  | { kind: 'swing'; base: ClusterName | string; a: number; b: number }

/** The driven bones, parents before children, and their rule. */
export const DRIVEN: readonly { bone: string; rule: Rule }[] = [
  { bone: 'b_pelvis', rule: { kind: 'cluster', cluster: 'pelvis' } },
  { bone: 'b_spine1', rule: { kind: 'blend', from: 'pelvis', to: 'chest', share: 1 / 3 } },
  { bone: 'b_spine2', rule: { kind: 'blend', from: 'pelvis', to: 'chest', share: 2 / 3 } },
  { bone: 'b_spine3', rule: { kind: 'cluster', cluster: 'chest' } },
  { bone: 'b_neck0', rule: { kind: 'blend', from: 'chest', to: 'head', share: 1 / 3 } },
  { bone: 'b_neck1', rule: { kind: 'blend', from: 'chest', to: 'head', share: 2 / 3 } },
  { bone: 'b_head', rule: { kind: 'cluster', cluster: 'head' } },
  { bone: 'b_l_upperarm', rule: { kind: 'swing', base: 'chest', a: P('lShoulder'), b: P('lElbow') } },
  { bone: 'b_l_forearm', rule: { kind: 'swing', base: 'b_l_upperarm', a: P('lElbow'), b: P('lWrist') } },
  { bone: 'b_r_upperarm', rule: { kind: 'swing', base: 'chest', a: P('rShoulder'), b: P('rElbow') } },
  { bone: 'b_r_forearm', rule: { kind: 'swing', base: 'b_r_upperarm', a: P('rElbow'), b: P('rWrist') } },
  { bone: 'b_l_thigh', rule: { kind: 'swing', base: 'pelvis', a: P('lHip'), b: P('lKnee') } },
  { bone: 'b_l_calf', rule: { kind: 'swing', base: 'b_l_thigh', a: P('lKnee'), b: P('lAnkle') } },
  { bone: 'b_l_foot', rule: { kind: 'swing', base: 'b_l_calf', a: P('lAnkle'), b: P('lToe') } },
  { bone: 'b_r_thigh', rule: { kind: 'swing', base: 'pelvis', a: P('rHip'), b: P('rKnee') } },
  { bone: 'b_r_calf', rule: { kind: 'swing', base: 'b_r_thigh', a: P('rKnee'), b: P('rAnkle') } },
  { bone: 'b_r_foot', rule: { kind: 'swing', base: 'b_r_calf', a: P('rAnkle'), b: P('rToe') } },
]
const DRIVEN_INDEX = new Map(DRIVEN.map((d, i) => [d.bone, i]))

/** bonesOf: `root`'s bones by name (the first of each name), in traversal order. */
export function bonesOf(root: THREE.Object3D): THREE.Bone[] {
  const seen = new Set<string>()
  const out: THREE.Bone[] = []
  root.traverse((o) => {
    if (o instanceof THREE.Bone && !seen.has(o.name)) {
      seen.add(o.name)
      out.push(o)
    }
  })
  return out
}

/**
 * The death's pose, read once on the posed skeleton: the local rotations and positions of every
 * bone, and for each driven bone its world rotation, plus enough to recompose its parent's
 * world rotation from the nearest driven bone above it.
 */
export interface DeathFrame {
  names: string[]
  /** 7 per bone: local quaternion (4), local position (3). */
  base: Float32Array
  /** The index (in `names`) of each driven bone. */
  index: Int16Array
  world0: THREE.Quaternion[]
  /** The driven bone above it (index into `DRIVEN`), -1: none. */
  anchor: Int16Array
  /** The chain from the anchor to the parent (anchor excluded), or the parent's world rotation with no anchor. */
  chain: THREE.Quaternion[]
  /** The inverse of the pelvis's parent's world matrix (constant: it isn't driven). */
  pelvisParentInv: THREE.Matrix4
}

/**
 * readDeathFrame reads the death's pose from bones `bones` (`bonesOf`, matrices up to date);
 * `names` is the list of their names, shared by every bake of the same skeleton. Null if a
 * driven bone is missing.
 */
export function readDeathFrame(bones: readonly THREE.Bone[], names: string[]): DeathFrame | null {
  const byName = new Map(bones.map((b, i) => [b.name, i]))
  const index = Int16Array.from(DRIVEN, (d) => byName.get(d.bone) ?? -1)
  if (index.some((i) => i < 0)) return null
  const base = new Float32Array(7 * bones.length)
  bones.forEach((b, i) => {
    b.quaternion.toArray(base, 7 * i)
    b.position.toArray(base, 7 * i + 4)
  })
  const drivenBones = new Set(DRIVEN.map((d) => byName.get(d.bone) as number).map((i) => bones[i]))
  const anchor = new Int16Array(DRIVEN.length)
  const chain = DRIVEN.map((_, k) => {
    const bone = bones[index[k]]
    const q = new THREE.Quaternion()
    let o = bone.parent
    while (o && !(o instanceof THREE.Bone && drivenBones.has(o))) {
      q.premultiply(o.quaternion)
      o = o.parent
    }
    anchor[k] = o ? (DRIVEN_INDEX.get(o.name) as number) : -1
    return o ? q : (bone.parent as THREE.Object3D).getWorldQuaternion(new THREE.Quaternion())
  })
  const pelvis = bones[index[0]]
  return {
    names, base, index, anchor, chain,
    world0: DRIVEN.map((_, k) => bones[index[k]].getWorldQuaternion(new THREE.Quaternion())),
    pelvisParentInv: (pelvis.parent as THREE.Object3D).matrixWorld.clone().invert(),
  }
}

/** Cluster rotations since the death, and the particles' positions. */
export interface SimFrame {
  clusters: Record<ClusterName, THREE.Quaternion>
  x: Float64Array
}

const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()
const swing = new THREE.Quaternion()
const parentQ = new THREE.Quaternion()

/**
 * driveBones writes, for each driven bone, its LOCAL rotation at simulated frame `sim` (into
 * `out`, 4 per bone); `x0`: the particles at death. `deltas`: scratch buffer of world rotations
 * since the death.
 */
export function driveBones(f: DeathFrame, x0: Float64Array, sim: SimFrame, deltas: THREE.Quaternion[], out: Float64Array): void {
  const world: THREE.Quaternion[] = []
  DRIVEN.forEach((d, k) => {
    const D = deltas[k]
    const r = d.rule
    if (r.kind === 'cluster') D.copy(sim.clusters[r.cluster])
    else if (r.kind === 'blend') D.copy(sim.clusters[r.from]).slerp(sim.clusters[r.to], r.share)
    else {
      const base = r.base in sim.clusters ? sim.clusters[r.base as ClusterName] : deltas[DRIVEN_INDEX.get(r.base) as number]
      segment(x0, r.a, r.b, tmpA).applyQuaternion(base)
      segment(sim.x, r.a, r.b, tmpB)
      swing.setFromUnitVectors(tmpA, tmpB)
      D.copy(swing).multiply(base)
    }
    const w = D.clone().multiply(f.world0[k])
    world.push(w)
    const a = f.anchor[k]
    parentQ.copy(a < 0 ? f.chain[k] : world[a].clone().multiply(f.chain[k]))
    parentQ.invert().multiply(w).toArray(out, 4 * k)
  })
}

function segment(x: Float64Array, a: number, b: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(x[3 * b] - x[3 * a], x[3 * b + 1] - x[3 * a + 1], x[3 * b + 2] - x[3 * a + 2]).normalize()
}

/** pelvisLocal: the pelvis's local position for pelvis particle `x` (world axes). */
export function pelvisLocal(f: DeathFrame, x: Float64Array, out: THREE.Vector3): THREE.Vector3 {
  return out.set(x[3 * P('pelvis')], x[3 * P('pelvis') + 1], x[3 * P('pelvis') + 2]).applyMatrix4(f.pelvisParentInv)
}
