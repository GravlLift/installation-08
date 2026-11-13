/**
 * muzzle3d.ts — LA BOUCHE DE L'ARME TENUE, d'où partent les tirs de la scène 3D.
 *
 * Un tir part du canon du modèle que le Spartan du tireur tient à l'image du tir : la pose de cette
 * image (cap du tir, tangage, clips du jeu de cette image) est rejouée sur une copie d'os seule,
 * jamais dessinée (`MuzzleProbe`), et la bouche est le devant de la boîte du modèle le long du canon,
 * porté comme l'avatar le porte (`GRIP_TO_WEAPON` sur `b_r_grip`). Le résultat ne dépend que de
 * l'image du tir : le calque le calcule une fois par tir. En 1re personne, l'arme est portée par le
 * cône de visée à la tenue de `viewGrip3d` (`viewMuzzle`).
 *
 * L'éclair, lui, se pose au bout du modèle que la scène dessine à l'image affichée (`drawnMuzzle`) :
 * il suit l'arme à l'écran, quelle que soit la caméra.
 */
import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'

import { GRIP_TO_WEAPON, MODEL_TURN, type DrawnWeapon } from './avatar3d'
import { poseSpartan, type SpartanPose, type SpartanRig } from './pose3d'
import { recoilActive, type Recoil } from './recoil3d'
import { recoilArms, recoilPoint } from './recoilPose3d'
import { rigOf } from './spartan3d'
import type { ViewGrip } from './viewGrip3d'

const muzzles = new WeakMap<THREE.Object3D, THREE.Vector3>()
const toLocal = new THREE.Matrix4()

// L'épaisseur de la tranche avant du modèle dont le centre fait la bouche (u, ~3 cm) : le bout du
// canon, pas le milieu de la section (un chargeur sous l'arme le tirerait vers le bas).
const MUZZLE_SLICE = 0.01

/**
 * muzzleOfModel : la bouche d'un modèle d'arme dans son repère (X vers la bouche, origine à la
 * poignée) : le point le plus avancé le long du canon, centré sur les sommets de la tranche avant
 * (`MUZZLE_SLICE`). Une fois par modèle.
 */
export function muzzleOfModel(model: THREE.Object3D): THREE.Vector3 {
  const known = muzzles.get(model)
  if (known) return known
  // Sommet par sommet, dans le repère du modèle : une boîte monde ramenée ensuite serait gonflée.
  let front = -Infinity
  forEachVertex(model, (v) => {
    front = Math.max(front, v.x)
  })
  const sum = new THREE.Vector3()
  let n = 0
  forEachVertex(model, (v) => {
    if (v.x < front - MUZZLE_SLICE) return
    sum.add(v)
    n++
  })
  const m = n === 0 ? new THREE.Vector3() : sum.divideScalar(n).setX(front)
  muzzles.set(model, m)
  return m
}

/** forEachVertex : chaque sommet des maillages de `model`, dans le repère de `model`. */
function forEachVertex(model: THREE.Object3D, visit: (v: THREE.Vector3) => void): void {
  model.updateMatrixWorld(true)
  toLocal.copy(model.matrixWorld).invert()
  const rel = new THREE.Matrix4()
  const v = new THREE.Vector3()
  model.traverse((o) => {
    const pos = o instanceof THREE.Mesh ? (o.geometry as THREE.BufferGeometry).getAttribute('position') : undefined
    if (!pos) return
    rel.multiplyMatrices(toLocal, o.matrixWorld)
    for (let i = 0; i < pos.count; i++) visit(v.fromBufferAttribute(pos, i).applyMatrix4(rel))
  })
}

/**
 * muzzleWorld : la bouche en monde d'une arme tenue par l'os de poignée en `grip` (monde),
 * d'orientation monde `gripQ` : l'arme y est portée comme l'avatar la porte (`GRIP_TO_WEAPON`).
 */
export function muzzleWorld(grip: THREE.Vector3, gripQ: THREE.Quaternion, local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(local).applyQuaternion(GRIP_TO_WEAPON).applyQuaternion(gripQ).add(grip)
}

/**
 * drawnMuzzle : la bouche (monde, dans `pos`) et l'axe du canon (monde, unitaire, dans `barrel`) du
 * modèle d'arme dessiné `drawn`, là où la dernière pose l'a placé, en 1re personne comme en 3e.
 */
export function drawnMuzzle(drawn: DrawnWeapon, pos: THREE.Vector3, barrel: THREE.Vector3): void {
  drawn.model.updateWorldMatrix(true, false)
  const m = drawn.model.matrixWorld
  pos.copy(muzzleOfModel(drawn.source)).applyMatrix4(m)
  barrel.setFromMatrixColumn(m, 0).normalize()
}

const aimBasis = new THREE.Matrix4()
const aimQ = new THREE.Quaternion()
const turnQ = new THREE.Quaternion()
const gripAt = new THREE.Vector3()
const ORIGIN = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)
// L'axe de la visée dans le repère du cône : la tenue en 1re personne roule autour de lui.
const AIM_AXIS = new THREE.Vector3(0, 0, 1)

/**
 * viewMuzzle : la bouche (monde) de l'arme tenue en 1re personne, posée comme `showWeapon` la pose :
 * portée par le cône de visée, qui part de l'œil `eye` et regarde le long de `dir` (unitaire), à la
 * tenue `view` (`viewGrip3d`), tournée de `MODEL_TURN` ; `local` : la bouche dans le repère du modèle,
 * déplacée par le recul de l'image (`recoilPoint`) quand l'arme recule, comme `showWeapon` la déplace.
 */
export function viewMuzzle(eye: THREE.Vector3, dir: THREE.Vector3, view: ViewGrip, local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  // Le cône regarde comme `Object3D.lookAt` le tourne : son +Z vers la cible.
  aimQ.setFromRotationMatrix(aimBasis.lookAt(dir, ORIGIN, UP))
  turnQ.setFromAxisAngle(AIM_AXIS, view.roll).multiply(MODEL_TURN)
  return out.copy(local).applyQuaternion(turnQ).add(gripAt.set(view.x, view.y, view.z)).applyQuaternion(aimQ).add(eye)
}

/**
 * MuzzleProbe — une copie des os du Spartan (sans maillage), posée à la demande pour lire où la
 * main droite tient l'arme à une image donnée. Chaque appel repart du repos (`poseSpartan`) :
 * aucun état ne passe d'un tir à l'autre.
 */
export class MuzzleProbe {
  private source: THREE.Object3D | null = null
  private rig: SpartanRig | null = null
  private readonly grip = new THREE.Vector3()
  private readonly gripQ = new THREE.Quaternion()
  private readonly kicked = new THREE.Vector3()

  /**
   * at : la bouche (axes three) de `weapon` tenu par le Spartan `source`, pieds en `feet`, dans la
   * pose `pose` (cap, tangage, clips de l'image du tir, recul de l'arme posé comme l'avatar le pose) ;
   * null si `source` n'a pas les os du Spartan.
   */
  at(
    source: THREE.Object3D,
    weapon: THREE.Object3D,
    feet: THREE.Vector3,
    pose: SpartanPose & { recoil?: Recoil | null },
    out: THREE.Vector3,
  ): THREE.Vector3 | null {
    if (source !== this.source) this.rebuild(source)
    const rig = this.rig
    if (!rig) return null
    rig.root.position.copy(feet)
    poseSpartan(rig, pose)
    let local = muzzleOfModel(weapon)
    if (recoilActive(pose.recoil) && !recoilArms(rig.arms, rig.rightGrip, GRIP_TO_WEAPON, pose.recoil)) {
      local = recoilPoint(local, pose.recoil, this.kicked)
    }
    rig.rightGrip.getWorldPosition(this.grip)
    rig.rightGrip.getWorldQuaternion(this.gripQ)
    return muzzleWorld(this.grip, this.gripQ, local, out)
  }

  private rebuild(source: THREE.Object3D): void {
    this.source = source
    const root = cloneSkinned(source)
    // Les os seuls : les maillages et leurs squelettes copiés ne servent à rien ici.
    const meshes: THREE.SkinnedMesh[] = []
    root.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) meshes.push(o)
    })
    for (const m of meshes) {
      m.skeleton.dispose()
      m.removeFromParent()
    }
    this.rig = rigOf(root, source)
  }
}
