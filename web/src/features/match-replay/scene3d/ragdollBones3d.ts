/**
 * ragdollBones3d.ts — DU CORPS INERTE AUX OS DU SPARTAN : quels os la simulation conduit, comment
 * leur orientation se tire des particules, et la pose d'une copie depuis une cuisson.
 *
 * Seuls les os majeurs sont conduits (bassin, colonne, cou, tête, bras, avant-bras, cuisses,
 * mollets, pieds). Chacun tourne, dans le monde, d'une rotation depuis la mort : celle de son bloc
 * rigide (bassin, buste, tête), un mélange de deux blocs pour la colonne et le cou, ou, pour un
 * membre, la rotation la plus courte qui amène son segment (de la mort, porté par son parent conduit)
 * sur le segment simulé : la torsion du membre reste celle de la mort. Les os non conduits (doigts,
 * os de torsion, aides, attaches d'armure) gardent leur rotation locale de la mort et suivent leur
 * parent. Seules les rotations changent (et la place du bassin) : les longueurs des os sont celles du
 * modèle.
 */
import * as THREE from 'three'

import { P, type ClusterName } from './ragdollBody3d'

type Rule =
  | { kind: 'cluster'; cluster: ClusterName }
  | { kind: 'blend'; from: ClusterName; to: ClusterName; share: number }
  | { kind: 'swing'; base: ClusterName | string; a: number; b: number }

/** Les os conduits, parents avant enfants, et leur règle. */
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

/** bonesOf : les os de `root` par nom (le premier de chaque nom), dans l'ordre du parcours. */
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
 * La pose de la mort, lue une fois sur le squelette posé : les rotations et places locales de tous
 * les os, et pour chaque os conduit sa rotation monde, et de quoi recomposer la rotation monde de son
 * parent depuis l'os conduit le plus proche au-dessus de lui.
 */
export interface DeathFrame {
  names: string[]
  /** 7 par os : quaternion local (4), place locale (3). */
  base: Float32Array
  /** L'indice (dans `names`) de chaque os conduit. */
  index: Int16Array
  world0: THREE.Quaternion[]
  /** L'os conduit au-dessus (indice dans `DRIVEN`), -1 : aucun. */
  anchor: Int16Array
  /** La chaîne de l'ancre au parent (ancre exclue), ou la rotation monde du parent sans ancre. */
  chain: THREE.Quaternion[]
  /** L'inverse de la matrice monde du parent du bassin (constante : il n'est pas conduit). */
  pelvisParentInv: THREE.Matrix4
}

/**
 * readDeathFrame lit la pose de la mort des os `bones` (`bonesOf`, matrices à jour) ; `names` est la
 * liste de leurs noms, partagée par toutes les cuissons d'un même squelette. Null s'il manque un os
 * conduit.
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

/** Les rotations des blocs depuis la mort, et les places des particules. */
export interface SimFrame {
  clusters: Record<ClusterName, THREE.Quaternion>
  x: Float64Array
}

const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()
const swing = new THREE.Quaternion()
const parentQ = new THREE.Quaternion()

/**
 * driveBones écrit, pour chaque os conduit, sa rotation LOCALE à l'image simulée `sim` (dans `out`,
 * 4 par os) ; `x0` : les particules à la mort. `deltas` : tampon des rotations monde depuis la mort.
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

/** pelvisLocal : la place locale du bassin pour la particule du bassin `x` (axes du monde). */
export function pelvisLocal(f: DeathFrame, x: Float64Array, out: THREE.Vector3): THREE.Vector3 {
  return out.set(x[3 * P('pelvis')], x[3 * P('pelvis') + 1], x[3 * P('pelvis') + 2]).applyMatrix4(f.pelvisParentInv)
}
