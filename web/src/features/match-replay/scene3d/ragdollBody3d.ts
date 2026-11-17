// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * ragdollBody3d.ts — THE RAGDOLL BODY: its particles (one per major Spartan joint, plus three
 * thickness points placed in front of the pelvis, chest and face), its rigid clusters and its
 * constraints, in Halo world units (1 u = 3.048 m).
 *
 * Three rigid clusters (pelvis, torso, head) hold together by shape matching
 * (`ragdollSolver3d`): they also give these parts' orientation to re-pose the bones
 * (`ragdollBones3d`). The limbs are fixed-length segments; the joint limits are distance
 * bounds (spine, neck, elbows, knees, ankles), hinges (elbows and knees only bend one way), a
 * cone at the hip, and minimum distances that keep arms and legs off the torso. Nothing
 * stricter: the game lets its bodies end up in odd poses, and that is intended.
 */

/** A particle: its name, the Spartan bone it follows (null: a thickness point), radius and mass. */
export interface ParticleDef {
  name: string
  bone: string | null
  radius: number
  mass: number
}

/** The particles, in the state buffers' order. */
export const PARTICLES: readonly ParticleDef[] = [
  { name: 'pelvis', bone: 'b_pelvis', radius: 0.055, mass: 3 },
  { name: 'chest', bone: 'b_spine3', radius: 0.065, mass: 3 },
  { name: 'neck', bone: 'b_neck0', radius: 0.04, mass: 1 },
  { name: 'head', bone: null, radius: 0.05, mass: 1.2 },
  { name: 'lShoulder', bone: 'b_l_upperarm', radius: 0.045, mass: 1 },
  { name: 'lElbow', bone: 'b_l_forearm', radius: 0.032, mass: 0.7 },
  { name: 'lWrist', bone: 'b_l_hand', radius: 0.03, mass: 0.5 },
  { name: 'rShoulder', bone: 'b_r_upperarm', radius: 0.045, mass: 1 },
  { name: 'rElbow', bone: 'b_r_forearm', radius: 0.032, mass: 0.7 },
  { name: 'rWrist', bone: 'b_r_hand', radius: 0.03, mass: 0.5 },
  { name: 'lHip', bone: 'b_l_thigh', radius: 0.045, mass: 1.5 },
  { name: 'lKnee', bone: 'b_l_calf', radius: 0.04, mass: 1 },
  { name: 'lAnkle', bone: 'b_l_foot', radius: 0.032, mass: 0.6 },
  { name: 'lToe', bone: 'b_l_toe', radius: 0.026, mass: 0.3 },
  { name: 'rHip', bone: 'b_r_thigh', radius: 0.045, mass: 1.5 },
  { name: 'rKnee', bone: 'b_r_calf', radius: 0.04, mass: 1 },
  { name: 'rAnkle', bone: 'b_r_foot', radius: 0.032, mass: 0.6 },
  { name: 'rToe', bone: 'b_r_toe', radius: 0.026, mass: 0.3 },
  { name: 'belly', bone: null, radius: 0.05, mass: 1 },
  { name: 'sternum', bone: null, radius: 0.055, mass: 1 },
  { name: 'face', bone: null, radius: 0.035, mass: 0.4 },
]

type Name = (typeof PARTICLES)[number]['name']
const INDEX = new Map(PARTICLES.map((p, i) => [p.name, i]))
/** P: a particle's index by its name. */
export function P(name: Name): number {
  const i = INDEX.get(name)
  if (i === undefined) throw new Error(`unknown particle ${name}`)
  return i
}

/**
 * The thickness points, placed at death from the bones (world axes, `ragdollBake3d`): the head
 * beyond the `b_head` bone along the neck, the belly and sternum in front of the pelvis and
 * chest, the face in front of the head (u).
 */
export const HEAD_REACH = 0.07
export const BELLY_FORWARD = 0.07
export const STERNUM_FORWARD = 0.075
export const FACE_FORWARD = 0.055

/** The rigid clusters: particles (each cluster's first is its pivot for re-posing the bones). */
export const CLUSTERS = {
  pelvis: [P('pelvis'), P('lHip'), P('rHip'), P('belly')],
  chest: [P('chest'), P('neck'), P('lShoulder'), P('rShoulder'), P('sternum'), P('pelvis')],
  head: [P('neck'), P('head'), P('face')],
} as const
export type ClusterName = keyof typeof CLUSTERS
export const CLUSTER_NAMES: readonly ClusterName[] = ['pelvis', 'chest', 'head']

/** The fixed-length segments (length taken at death). */
export const STICKS: readonly (readonly [number, number])[] = [
  [P('lShoulder'), P('lElbow')], [P('lElbow'), P('lWrist')],
  [P('rShoulder'), P('rElbow')], [P('rElbow'), P('rWrist')],
  [P('lHip'), P('lKnee')], [P('lKnee'), P('lAnkle')], [P('lAnkle'), P('lToe')],
  [P('rHip'), P('rKnee')], [P('rKnee'), P('rAnkle')], [P('rAnkle'), P('rToe')],
]

/** A distance bound: between `lo` and `hi` times the distance at death. */
export interface Range {
  a: number
  b: number
  lo: number
  hi: number
}

/**
 * The bounds: the spine (belly-sternum for flexion, crossed hip-shoulder for twist and tilt),
 * the neck (sternum-face, shoulders-head), elbows and knees (shoulder-wrist, hip-ankle: from
 * fully bent to extended), the ankle (knee-toe).
 */
export const RANGES: readonly Range[] = [
  { a: P('belly'), b: P('sternum'), lo: 0.78, hi: 1.12 },
  { a: P('lHip'), b: P('rShoulder'), lo: 0.85, hi: 1.1 },
  { a: P('rHip'), b: P('lShoulder'), lo: 0.85, hi: 1.1 },
  { a: P('sternum'), b: P('face'), lo: 0.7, hi: 1.25 },
  { a: P('lShoulder'), b: P('head'), lo: 0.8, hi: 1.18 },
  { a: P('rShoulder'), b: P('head'), lo: 0.8, hi: 1.18 },
  { a: P('lKnee'), b: P('lToe'), lo: 0.85, hi: 1.12 },
  { a: P('rKnee'), b: P('rToe'), lo: 0.85, hi: 1.12 },
]

/** An absolute bound on a two-segment chain (elbow, knee): fraction of the chain extended. */
export interface ChainRange {
  a: number
  mid: number
  b: number
  lo: number
}
export const CHAIN_RANGES: readonly ChainRange[] = [
  { a: P('lShoulder'), mid: P('lElbow'), b: P('lWrist'), lo: 0.3 },
  { a: P('rShoulder'), mid: P('rElbow'), b: P('rWrist'), lo: 0.3 },
  { a: P('lHip'), mid: P('lKnee'), b: P('lAnkle'), lo: 0.3 },
  { a: P('rHip'), mid: P('rKnee'), b: P('rAnkle'), lo: 0.3 },
]

/**
 * The hinges: the middle (elbow, knee) never crosses to the other side of the chain; the axis
 * is taken at death and follows cluster `frame` (the torso for arms, the pelvis for legs).
 */
export interface Hinge extends ChainRange {
  frame: ClusterName
}
export const HINGES: readonly Hinge[] = [
  { ...CHAIN_RANGES[0], frame: 'chest' },
  { ...CHAIN_RANGES[1], frame: 'chest' },
  { ...CHAIN_RANGES[2], frame: 'pelvis' },
  { ...CHAIN_RANGES[3], frame: 'pelvis' },
]

/**
 * The hip cone: the thigh stays within `HIP_CONE` radians of an axis taken in the pelvis
 * (downward, tilted forward by `HIP_LEAN`): wide forward flexion, short backward extension.
 */
export const HIP_CONE = (80 * Math.PI) / 180
export const HIP_LEAN = (45 * Math.PI) / 180
export const HIPS: readonly (readonly [hip: number, knee: number])[] = [
  [P('lHip'), P('lKnee')],
  [P('rHip'), P('rKnee')],
]

/** The pairs that don't interpenetrate (limbs against the torso and each other): sum of radii. */
const TRUNK = [P('pelvis'), P('chest'), P('belly'), P('sternum'), P('head')]
const ARMS = [P('lElbow'), P('lWrist'), P('rElbow'), P('rWrist')]
export const APART: readonly (readonly [number, number])[] = [
  ...ARMS.flatMap((a) => TRUNK.map((t) => [a, t] as const)),
  [P('lKnee'), P('rKnee')], [P('lAnkle'), P('rAnkle')], [P('lToe'), P('rToe')],
  [P('lKnee'), P('chest')], [P('rKnee'), P('chest')], [P('lKnee'), P('sternum')], [P('rKnee'), P('sternum')],
]
