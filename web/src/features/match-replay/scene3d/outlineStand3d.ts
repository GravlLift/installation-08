// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * outlineStand3d.ts — LA SILHOUETTE EN BÂTONS d'un joueur lointain, pour le masque du contour
 * d'équipe (`outline3d`) : une quinzaine d'ellipsoïdes posés sur les os du Spartan à l'image (tronc,
 * épaules, tête, membres) et le long de l'arme en main, en un seul appel de dessin. Elle suit la pose
 * (accroupi, glissade, visée) comme l'armure entière, que le masque d'un joueur de quelques texels ne
 * distingue plus, sans en payer les dizaines d'appels de dessin.
 */
import * as THREE from 'three'

/** Les segments de la silhouette : d'un os à un autre, au rayon (u) qui couvre l'armure. */
export const STAND_LIMBS: readonly (readonly [string, string, number])[] = [
  ['b_pelvis', 'b_spine3', 0.09],
  ['b_l_upperarm', 'b_r_upperarm', 0.055],
  ['b_spine3', 'b_neck0', 0.07],
  ['b_neck0', 'b_helmet', 0.07],
  ['b_l_thigh', 'b_l_calf', 0.055],
  ['b_l_calf', 'b_l_foot', 0.045],
  ['b_l_foot', 'b_l_toe', 0.035],
  ['b_r_thigh', 'b_r_calf', 0.055],
  ['b_r_calf', 'b_r_foot', 0.045],
  ['b_r_foot', 'b_r_toe', 0.035],
  ['b_l_upperarm', 'b_l_forearm', 0.04],
  ['b_l_forearm', 'b_l_hand', 0.035],
  ['b_r_upperarm', 'b_r_forearm', 0.04],
  ['b_r_forearm', 'b_r_hand', 0.035],
]
/** L'os qui porte l'arme en main (`avatar3d`), et l'épaisseur de l'arme (u). */
const GRIP_BONE = 'b_r_grip'
const WEAPON_RADIUS = 0.035
const PARTS = STAND_LIMBS.length + 1
/** Un ellipsoïde de rayon 1, étiré le long de Y sur chaque segment. */
const UNIT = new THREE.SphereGeometry(1, 8, 6)

/** Les os d'un squelette par nom, relevés une fois par squelette (une copie du Spartan en a un). */
const bonesBySkeleton = new WeakMap<THREE.Skeleton, Map<string, THREE.Bone>>()
/** Les deux bouts de l'arme dans son propre repère (X = canon), relevés une fois par modèle. */
const barrelByModel = new WeakMap<THREE.Object3D, [THREE.Vector3, THREE.Vector3]>()

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _mid = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _scale = new THREE.Vector3()
const _turn = new THREE.Quaternion()
const _matrix = new THREE.Matrix4()
const _box = new THREE.Box3()
const UP = new THREE.Vector3(0, 1, 0)

/** skeletonOf : le squelette du premier maillage à peau sous `root`, null sans Spartan. */
export function skeletonOf(root: THREE.Object3D): THREE.Skeleton | null {
  const stack: THREE.Object3D[] = [root]
  for (let o = stack.pop(); o; o = stack.pop()) {
    if (o instanceof THREE.SkinnedMesh) return o.skeleton
    for (const c of o.children) stack.push(c)
  }
  return null
}

function bonesOf(skeleton: THREE.Skeleton): Map<string, THREE.Bone> {
  let bones = bonesBySkeleton.get(skeleton)
  if (!bones) {
    bones = new Map()
    for (const b of skeleton.bones) if (!bones.has(b.name)) bones.set(b.name, b)
    bonesBySkeleton.set(skeleton, bones)
  }
  return bones
}

/** StandFigure : la silhouette en bâtons d'un joueur, un maillage instancié réutilisé d'image en image. */
export class StandFigure {
  readonly mesh = new THREE.InstancedMesh(UNIT, undefined, PARTS)

  constructor() {
    this.mesh.matrixAutoUpdate = false
    this.mesh.matrixWorldAutoUpdate = false
    this.mesh.frustumCulled = false
  }

  /**
   * pose pose la silhouette sur les os de `skeleton` (matrices du monde à jour) et sur l'arme portée
   * par sa poignée ; un os absent laisse son segment de côté.
   */
  pose(skeleton: THREE.Skeleton): void {
    const bones = bonesOf(skeleton)
    let n = 0
    for (const [from, to, r] of STAND_LIMBS) {
      const a = bones.get(from)
      const b = bones.get(to)
      if (!a || !b) continue
      this.segment(n++, _a.setFromMatrixPosition(a.matrixWorld), _b.setFromMatrixPosition(b.matrixWorld), r)
    }
    const grip = bones.get(GRIP_BONE)
    const weapon = grip?.children.find((c) => !(c instanceof THREE.Bone) && c.visible)
    if (weapon) {
      const [from, to] = barrelOf(weapon)
      this.segment(n++, _a.copy(from).applyMatrix4(weapon.matrixWorld), _b.copy(to).applyMatrix4(weapon.matrixWorld), WEAPON_RADIUS)
    }
    this.mesh.count = n
    this.mesh.instanceMatrix.needsUpdate = true
  }

  /** segment pose l'ellipsoïde `i` de `a` à `b` (monde), au rayon `r`. */
  private segment(i: number, a: THREE.Vector3, b: THREE.Vector3, r: number): void {
    _dir.subVectors(b, a)
    const half = _dir.length() / 2
    if (half > 1e-6) _turn.setFromUnitVectors(UP, _dir.multiplyScalar(1 / (2 * half)))
    else _turn.identity()
    _mid.addVectors(a, b).multiplyScalar(0.5)
    this.mesh.setMatrixAt(i, _matrix.compose(_mid, _turn, _scale.set(r, half + r, r)))
  }
}

/** barrelOf : les deux bouts de l'arme `model` le long de son X, au milieu de sa section. */
function barrelOf(model: THREE.Object3D): [THREE.Vector3, THREE.Vector3] {
  const known = barrelByModel.get(model)
  if (known) return known
  _box.makeEmpty()
  const toModel = _matrix.copy(model.matrixWorld).invert()
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
    const local = new THREE.Box3().copy(o.geometry.boundingBox as THREE.Box3)
    _box.union(local.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toModel, o.matrixWorld)))
  })
  const c = _box.isEmpty() ? new THREE.Vector3() : _box.getCenter(new THREE.Vector3())
  const ends: [THREE.Vector3, THREE.Vector3] = _box.isEmpty()
    ? [c.clone(), c.clone()]
    : [new THREE.Vector3(_box.min.x, c.y, c.z), new THREE.Vector3(_box.max.x, c.y, c.z)]
  barrelByModel.set(model, ends)
  return ends
}
