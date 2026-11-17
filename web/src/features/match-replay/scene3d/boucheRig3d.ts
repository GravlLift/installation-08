// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * boucheRig3d.ts — THE FIRST-PERSON RIG'S MUZZLE (animated arms + weapon), measured once per rig.
 *
 * First-person shots leave from the barrel the camera draws: the animated rig, placed by
 * `BrasPremierePersonne3d.placer`. Its muzzle point and barrel axis are measured ONCE, at the idle
 * pose (the frame where the rig is at rest), in the CARRIER's frame (the space of `porteur`'s
 * children, before the grip and before the camera). `boucheRigCamera` then transforms it into the
 * CAMERA frame exactly as `appliquerTenueRig` + `placer` do for a camera held still at the origin:
 * no computation repeats per shot or per frame, and a shot's effect stays the same when rewound.
 *
 * The rig's meshes whose materials are never an arm (`estMateriauBras` false) are the weapon: the
 * muzzle is the front of their vertices, over a ~3cm slice along the barrel (the same idea as
 * `muzzleOfModel`). Arm pieces placed afterward (`actualiserPieces`) are arm meshes, and are
 * excluded from the measurement.
 */
import * as THREE from 'three'

import { ROTATION_RIG_CAMERA } from './premierePersonne3d'
import type { ViewGrip } from './viewGrip3d'

// The barrel's front slice whose vertex centroid makes the muzzle (u, ~3cm, like MUZZLE_SLICE).
const MUZZLE_SLICE = 0.01
// The maximum number of vertices read per mesh (no sub-sampling): the measurement happens once.
const MUZZLE_MAX_STEP = 5000

// Shared scratch buffers: no vertex is stored, everything happens in these vectors.
const SCRATCH_VERTEX = new THREE.Vector3()
const SCRATCH_RELATIVE = new THREE.Matrix4()
const SCRATCH_MESH = new THREE.Matrix4()
const SCRATCH_AXIS = new THREE.Vector3()
// The barrel axis in the rig's frame when the index does not provide one: the camera's forward
// (0,0,-1) brought back into the rig's frame (the inverse of ROTATION_RIG_CAMERA).
const DEFAULT_AXIS = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion().copy(ROTATION_RIG_CAMERA).invert())
const SCRATCH_OFFSET = new THREE.Vector3()
// The rig's aim axis (camera frame, -Z forward): the grip's roll rotates around it.
const FORWARD_AXIS = new THREE.Vector3(0, 0, -1)
const SCRATCH_ROLL = new THREE.Quaternion()

/**
 * boucheRig: a rig's muzzle and barrel axis, in the CARRIER's frame (the children of `porteur`,
 * including `root`), measured on the WEAPON meshes (no arm material), at the rig's current pose
 * (the idle pose, once the rig has finished loading).
 * - `root`: the rig's scene (`entree.root`), a child of `porteur`; its world matrices must be
 *   those of the pose (`updateMatrixWorld` is called here).
 * - `isArm`: an arm material; a mesh with even one arm material counts as an arm.
 * - `axeRig`: the barrel axis in the RIG's frame (`rig.idleWeapon.forward`), normalized; null:
 *   the axis pointing away from the eye once the rig is placed (the inverse of
 *   ROTATION_RIG_CAMERA on -Z).
 * - `out`: `{ bouche, axe }` filled in the carrier's frame. False if there is no weapon mesh.
 */
export function boucheRig(
  root: THREE.Object3D,
  porteur: THREE.Object3D,
  isArm: (material: THREE.Material) => boolean,
  axeRig: THREE.Vector3 | null,
  out: { bouche: THREE.Vector3; axe: THREE.Vector3 },
): boolean {
  root.updateMatrixWorld(true)
  porteur.updateMatrixWorld(true)
  const toCarrier = SCRATCH_RELATIVE.copy(porteur.matrixWorld).invert()
  const axis = SCRATCH_AXIS.copy(axeRig ?? DEFAULT_AXIS).normalize()
  let front = -Infinity
  const sum = new THREE.Vector3()
  // First pass: the furthest point along the barrel; second pass: that front's slice.
  let n = 0
  for (const pass of [0, 1]) {
    if (pass === 1 && front === -Infinity) return false
    sum.set(0, 0, 0)
    n = 0
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const materials = Array.isArray(o.material) ? o.material : [o.material]
      if (materials.some(isArm)) return
      // Mesh-local vertex -> world -> carrier's frame.
      const rel = SCRATCH_MESH.multiplyMatrices(toCarrier, o.matrixWorld)
      const pos = (o.geometry as THREE.BufferGeometry).getAttribute('position')
      const stride = Math.max(1, Math.ceil(pos.count / MUZZLE_MAX_STEP))
      for (let i = 0; i < pos.count; i += stride) {
        const v = SCRATCH_VERTEX
        if (o instanceof THREE.SkinnedMesh) o.getVertexPosition(i, v)
        else v.fromBufferAttribute(pos, i)
        v.applyMatrix4(rel)
        const t = v.dot(axis)
        if (pass === 0) {
          if (t > front) front = t
        } else if (t >= front - MUZZLE_SLICE) {
          sum.add(v)
          n++
        }
      }
    })
  }
  if (n === 0) return false
  out.bouche.copy(sum).divideScalar(n)
  // The muzzle sits in FRONT of the barrel: the slice's point is pushed onto its front plane.
  out.bouche.addScaledVector(axis, front - out.bouche.dot(axis))
  out.axe.copy(axis)
  return true
}

/**
 * boucheRigCamera: a rig's muzzle (carrier's frame, `st`) in the CAMERA frame (x to the right, y
 * up, -z forward), composed exactly as `appliquerTenueRig` + `placer` do for a camera held still
 * at the origin: the point rotated by `ROTATION_RIG_CAMERA`, plus the grip's roll around the
 * barrel (as `appliquerTenueRig` does), plus the grip's translation (x, y, -z).
 * `out` is filled, with no allocation per call.
 */
export function boucheRigCamera(st: { bouche: THREE.Vector3; axe: THREE.Vector3 }, grip: ViewGrip, out: THREE.Vector3): THREE.Vector3 {
  out.copy(st.bouche).applyQuaternion(ROTATION_RIG_CAMERA)
  if (grip.roll) out.applyQuaternion(SCRATCH_ROLL.setFromAxisAngle(FORWARD_AXIS, grip.roll))
  if (grip.x || grip.y || grip.z) out.add(SCRATCH_OFFSET.set(grip.x, grip.y, -grip.z))
  return out
}

/**
 * The muzzle and barrel axis in the LOCAL frame of the object carrying the muzzle: the mesh for a
 * plain mesh, the bone whose front slice carries the most skin weight for a `SkinnedMesh`. This
 * is the point and axis that follow the rig as it is animated and posed: `boucheMondeRig` brings
 * them back to world space at the rendered frame.
 */
export interface BoucheLocale {
  porteurLocal: THREE.Object3D
  point: THREE.Vector3
  axe: THREE.Vector3
}

/**
 * boucheRigLocale: a rig's muzzle and barrel axis, expressed in the LOCAL frame of the object
 * carrying the muzzle (a mesh, or the dominant carrier bone of a `SkinnedMesh`), at the current
 * pose. Weapon meshes are those with no arm material (`isArm`); with no weapon mesh, false.
 * Measured once at load time, like `boucheRig`: `out` is filled, with no allocation constraint
 * (the measurement happens at load, not per frame).
 */
export function boucheRigLocale(
  root: THREE.Object3D,
  porteur: THREE.Object3D,
  isArm: (material: THREE.Material) => boolean,
  axeRig: THREE.Vector3 | null,
  out: BoucheLocale,
): boolean {
  root.updateMatrixWorld(true)
  porteur.updateMatrixWorld(true)
  const toCarrier = SCRATCH_RELATIVE.copy(porteur.matrixWorld).invert()
  const axis = SCRATCH_AXIS.copy(axeRig ?? DEFAULT_AXIS).normalize()
  const isWeapon = (o: THREE.Mesh) => (Array.isArray(o.material) ? o.material : [o.material]).every((m) => !isArm(m))
  const localVertex = (o: THREE.Mesh, i: number, v: THREE.Vector3, rel: THREE.Matrix4): THREE.Vector3 => {
    if (o instanceof THREE.SkinnedMesh) o.getVertexPosition(i, v)
    else v.fromBufferAttribute((o.geometry as THREE.BufferGeometry).getAttribute('position'), i)
    return v.applyMatrix4(rel)
  }
  // First pass: the furthest point along the barrel (carrier's frame).
  let front = -Infinity
  const v = SCRATCH_VERTEX
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !isWeapon(o)) return
    const rel = SCRATCH_MESH.multiplyMatrices(toCarrier, o.matrixWorld)
    const pos = (o.geometry as THREE.BufferGeometry).getAttribute('position')
    const stride = Math.max(1, Math.ceil(pos.count / MUZZLE_MAX_STEP))
    for (let i = 0; i < pos.count; i += stride) {
      if (localVertex(o, i, v, rel).dot(axis) > front) front = v.dot(axis)
    }
  })
  if (front === -Infinity) return false
  // Second pass: the front slice — the carrier object is the one whose slice carries the most
  // weight (vertex count for a mesh, sum of skin weights for a bone).
  const weight = new Map<THREE.Object3D, number>()
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !isWeapon(o)) return
    const rel = SCRATCH_MESH.multiplyMatrices(toCarrier, o.matrixWorld)
    const pos = (o.geometry as THREE.BufferGeometry).getAttribute('position')
    const stride = Math.max(1, Math.ceil(pos.count / MUZZLE_MAX_STEP))
    if (o instanceof THREE.SkinnedMesh) {
      const boneIndices = o.geometry.getAttribute('skinIndex') as THREE.BufferAttribute
      const boneWeights = o.geometry.getAttribute('skinWeight') as THREE.BufferAttribute
      for (let i = 0; i < pos.count; i += stride) {
        if (localVertex(o, i, v, rel).dot(axis) < front - MUZZLE_SLICE) continue
        for (let k = 0; k < 4; k++) {
          const bone = o.skeleton.bones[boneIndices.getX(i + k)]
          if (bone) weight.set(bone, (weight.get(bone) ?? 0) + boneWeights.getX(i + k))
        }
      }
    } else {
      let n = 0
      for (let i = 0; i < pos.count; i += stride) if (localVertex(o, i, v, rel).dot(axis) >= front - MUZZLE_SLICE) n++
      if (n > 0) weight.set(o, (weight.get(o) ?? 0) + n)
    }
  })
  let localCarrier: THREE.Object3D | null = null
  let maxWeight = 0
  for (const [p, w] of weight) if (w > maxWeight) { maxWeight = w; localCarrier = p }
  if (!localCarrier) return false
  // The center of the slice that belongs to this carrier, pushed onto its front plane.
  const center = new THREE.Vector3()
  let n = 0
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !isWeapon(o)) return
    const belongs = o === localCarrier || (o instanceof THREE.SkinnedMesh && (o.skeleton.bones as THREE.Object3D[]).includes(localCarrier))
    if (!belongs) return
    const rel = SCRATCH_MESH.multiplyMatrices(toCarrier, o.matrixWorld)
    const pos = (o.geometry as THREE.BufferGeometry).getAttribute('position')
    const stride = Math.max(1, Math.ceil(pos.count / MUZZLE_MAX_STEP))
    for (let i = 0; i < pos.count; i += stride) if (localVertex(o, i, v, rel).dot(axis) >= front - MUZZLE_SLICE) { center.add(v); n++ }
  })
  if (n === 0) return false
  center.divideScalar(n)
  center.addScaledVector(axis, front - center.dot(axis))
  // Brings the point and axis back into the carrier's local frame (the inverse of its pass to the carrier).
  // `toCarrier` lives in SCRATCH_RELATIVE: the product happens in a different scratch buffer.
  const localMatrix = SCRATCH_MESH.multiplyMatrices(toCarrier, localCarrier.matrixWorld).invert()
  out.porteurLocal = localCarrier
  out.point.copy(center).applyMatrix4(localMatrix)
  out.axe.copy(axis).transformDirection(localMatrix)
  return true
}

/**
 * boucheMondeRig: the muzzle (`point`, local frame of carrier `porteurLocal`) and barrel axis
 * (`axe`, same) in WORLD space, read at the rendered frame: the carrier's world matrix is
 * refreshed along its chain (`updateWorldMatrix`). Neither a shot nor a frame allocates: `outPos`
 * and `outAxe` are filled.
 */
export function boucheMondeRig(
  porteurLocal: THREE.Object3D,
  point: THREE.Vector3,
  axe: THREE.Vector3,
  outPos: THREE.Vector3,
  outAxe: THREE.Vector3,
): void {
  porteurLocal.updateWorldMatrix(true, false)
  outPos.copy(point).applyMatrix4(porteurLocal.matrixWorld)
  outAxe.copy(axe).transformDirection(porteurLocal.matrixWorld)
}
