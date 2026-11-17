// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * ragdollBody3d.ts — LE CORPS INERTE : ses particules (une par articulation majeure du Spartan, plus
 * trois points d'épaisseur posés devant le bassin, la poitrine et la face), ses blocs rigides et ses
 * contraintes, en unités monde Halo (1 u = 3,048 m).
 *
 * Trois blocs rigides (bassin, buste, tête) tiennent par appariement de forme (`ragdollSolver3d`) :
 * ils donnent aussi l'orientation de ces parties pour reposer les os (`ragdollBones3d`). Les membres
 * sont des segments de longueur fixe ; les limites articulaires sont des bornes de distance (colonne,
 * cou, coudes, genoux, chevilles), des charnières (coudes, genoux ne se plient que d'un côté), un cône
 * à la hanche et des distances minimales qui gardent bras et jambes hors du tronc. Rien de plus
 * strict : le jeu laisse ses corps finir dans des poses étranges, c'est voulu.
 */

/** Une particule : son nom, l'os du Spartan qu'elle suit (null : point d'épaisseur), rayon et masse. */
export interface ParticleDef {
  name: string
  bone: string | null
  radius: number
  mass: number
}

/** Les particules, dans l'ordre des tampons de l'état. */
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
/** P : l'indice d'une particule par son nom. */
export function P(name: Name): number {
  const i = INDEX.get(name)
  if (i === undefined) throw new Error(`particule inconnue ${name}`)
  return i
}

/**
 * Les points d'épaisseur, posés à la mort depuis les os (axes du monde, `ragdollBake3d`) : la tête
 * au-delà de l'os `b_head` le long du cou, le ventre et le sternum devant le bassin et la poitrine,
 * la face devant la tête (u).
 */
export const HEAD_REACH = 0.07
export const BELLY_FORWARD = 0.07
export const STERNUM_FORWARD = 0.075
export const FACE_FORWARD = 0.055

/** Les blocs rigides : particules (le premier de chaque bloc est son pivot pour reposer les os). */
export const CLUSTERS = {
  pelvis: [P('pelvis'), P('lHip'), P('rHip'), P('belly')],
  chest: [P('chest'), P('neck'), P('lShoulder'), P('rShoulder'), P('sternum'), P('pelvis')],
  head: [P('neck'), P('head'), P('face')],
} as const
export type ClusterName = keyof typeof CLUSTERS
export const CLUSTER_NAMES: readonly ClusterName[] = ['pelvis', 'chest', 'head']

/** Les segments de longueur fixe (longueur prise à la mort). */
export const STICKS: readonly (readonly [number, number])[] = [
  [P('lShoulder'), P('lElbow')], [P('lElbow'), P('lWrist')],
  [P('rShoulder'), P('rElbow')], [P('rElbow'), P('rWrist')],
  [P('lHip'), P('lKnee')], [P('lKnee'), P('lAnkle')], [P('lAnkle'), P('lToe')],
  [P('rHip'), P('rKnee')], [P('rKnee'), P('rAnkle')], [P('rAnkle'), P('rToe')],
]

/** Une borne de distance : entre `lo` et `hi` fois la distance à la mort. */
export interface Range {
  a: number
  b: number
  lo: number
  hi: number
}

/**
 * Les bornes : la colonne (ventre-sternum pour la flexion, croisées hanche-épaule pour la torsion et
 * l'inclinaison), le cou (sternum-face, épaules-tête), les coudes et genoux (épaule-poignet,
 * hanche-cheville : de plié au plus à tendu), la cheville (genou-orteil).
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

/** Une borne absolue sur une chaîne de deux segments (coude, genou) : fraction de la chaîne tendue. */
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
 * Les charnières : le milieu (coude, genou) ne passe pas de l'autre côté de la chaîne ; l'axe est pris
 * à la mort et suit le bloc `frame` (le buste pour les bras, le bassin pour les jambes).
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
 * Le cône de la hanche : la cuisse reste à `HIP_CONE` radians d'un axe pris dans le bassin (le bas,
 * penché vers l'avant de `HIP_LEAN`) : flexion avant large, extension arrière courte.
 */
export const HIP_CONE = (80 * Math.PI) / 180
export const HIP_LEAN = (45 * Math.PI) / 180
export const HIPS: readonly (readonly [hip: number, knee: number])[] = [
  [P('lHip'), P('lKnee')],
  [P('rHip'), P('rKnee')],
]

/** Les paires qui ne s'interpénètrent pas (membres contre tronc et entre eux) : somme des rayons. */
const TRUNK = [P('pelvis'), P('chest'), P('belly'), P('sternum'), P('head')]
const ARMS = [P('lElbow'), P('lWrist'), P('rElbow'), P('rWrist')]
export const APART: readonly (readonly [number, number])[] = [
  ...ARMS.flatMap((a) => TRUNK.map((t) => [a, t] as const)),
  [P('lKnee'), P('rKnee')], [P('lAnkle'), P('rAnkle')], [P('lToe'), P('rToe')],
  [P('lKnee'), P('chest')], [P('rKnee'), P('chest')], [P('lKnee'), P('sternum')], [P('rKnee'), P('sternum')],
]
