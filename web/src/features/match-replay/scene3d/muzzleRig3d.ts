// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * muzzleRig3d.ts — THE MUZZLE OF THE 1ST-PERSON RIG (animated arms + weapon), once per rig.
 *
 * First-person shots start from the barrel the camera draws: the animated rig, placed by
 * `firstPersonArms3d.place`. Its muzzle point and barrel axis are measured ONCE, at the idle
 * pose (the frame where the rig has finished loading), in the HOLDER's frame (the space of
 * `holder`'s children, before the grip and before the camera). `muzzlePoseCamera` then
 * transforms it into CAMERA frame exactly as `applyRigGrip` + `place` do for a camera fixed
 * at the origin: no computation repeats per shot or per frame, and a shot's effect stays the
 * same when scrubbing back.
 *
 * The rig's meshes whose material is not an arm (`isArm` false) are the weapon: the muzzle is
 * the front of their vertices, over a ~3 cm slice along the barrel (the same idea as
 * `muzzleOfModel`). The arm pieces placed afterward (`refreshPieces`) are arm meshes, and are
 * excluded from this.
 */
import * as THREE from 'three'

import { ROTATION_RIG_CAMERA } from './premierePersonne3d'
import type { ViewGrip } from './viewGrip3d'

// The front slice of the barrel whose vertex center makes the muzzle (u, ~3 cm, like MUZZLE_SLICE).
const MUZZLE_SLICE = 0.01
// The maximum vertices read per mesh (no sampling): the measurement happens once.
const MUZZLE_STEP_MAX = 5000

// Shared scratch buffers: no vertex is stored, everything happens in these vectors.
const TMP_VERTEX = new THREE.Vector3()
const TMP_RELATIVE = new THREE.Matrix4()
const TMP_MESH = new THREE.Matrix4()
const TMP_AXIS = new THREE.Vector3()
// The barrel axis in the rig's frame when the index does not give it: the front of the camera
// (0,0,-1) brought back into the rig's frame (the inverse of ROTATION_RIG_CAMERA).
const DEFAULT_AXIS = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion().copy(ROTATION_RIG_CAMERA).invert())
const TMP_OFFSET = new THREE.Vector3()
// The rig's aim axis (camera frame, -Z forward): the grip's roll turns around it.
const FORWARD_AXIS = new THREE.Vector3(0, 0, -1)
const TMP_ROLL = new THREE.Quaternion()

/**
 * muzzlePose: the muzzle and the barrel axis of a rig, in the HOLDER's frame (the children of
 * `holder`, including `root`), measured on WEAPON meshes (no arm material) at the rig's
 * current pose (the idle, once the rig has finished loading).
 * - `root`: the rig's scene (`entry.root`), a child of `holder`; its world matrices must be
 *   the pose's (`updateMatrixWorld` is called here).
 * - `isArm`: an arm material; a mesh whose only material is an arm is an arm.
 * - `rigAxis`: the barrel axis in the RIG's frame (`rig.idleWeapon.forward`), normalized; null:
 *   the axis pointing away from the eye once the rig is placed (the inverse of
 *   ROTATION_RIG_CAMERA on -Z).
 * - `out`: `{ muzzle, axis }` filled in the holder's frame. False if there is no weapon mesh.
 */
export function muzzlePose(
  root: THREE.Object3D,
  holder: THREE.Object3D,
  isArm: (material: THREE.Material) => boolean,
  rigAxis: THREE.Vector3 | null,
  out: { muzzle: THREE.Vector3; axis: THREE.Vector3 },
): boolean {
  root.updateMatrixWorld(true)
  holder.updateMatrixWorld(true)
  const toHolder = TMP_RELATIVE.copy(holder.matrixWorld).invert()
  const axis = TMP_AXIS.copy(rigAxis ?? DEFAULT_AXIS).normalize()
  let front = -Infinity
  const sum = new THREE.Vector3()
  // First pass: the frontmost point along the barrel; second pass: that front's slice.
  let n = 0
  for (const pass of [0, 1]) {
    if (pass === 1 && front === -Infinity) return false
    sum.set(0, 0, 0)
    n = 0
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const materials = Array.isArray(o.material) ? o.material : [o.material]
      if (materials.some(isArm)) return
      // Mesh-local vertex -> world -> holder's frame.
      const relative = TMP_MESH.multiplyMatrices(toHolder, o.matrixWorld)
      const pos = (o.geometry as THREE.BufferGeometry).getAttribute('position')
      const step = Math.max(1, Math.ceil(pos.count / MUZZLE_STEP_MAX))
      for (let i = 0; i < pos.count; i += step) {
        const v = TMP_VERTEX
        if (o instanceof THREE.SkinnedMesh) o.getVertexPosition(i, v)
        else v.fromBufferAttribute(pos, i)
        v.applyMatrix4(relative)
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
  out.muzzle.copy(sum).divideScalar(n)
  // The muzzle is at the FRONT of the barrel: the slice's point is pushed onto its front plane.
  out.muzzle.addScaledVector(axis, front - out.muzzle.dot(axis))
  out.axis.copy(axis)
  return true
}

/**
 * muzzlePoseCamera: a rig's muzzle (holder's frame, `st`) in CAMERA frame (x right, y up, -z
 * forward), composed exactly as `applyRigGrip` + `place` do for a camera fixed at the origin:
 * the point rotated by `ROTATION_RIG_CAMERA`, plus the grip's roll around the barrel (like
 * `applyRigGrip`), plus the grip's translation (x, y, -z). `out` is filled, with no
 * allocation per call.
 */
export function muzzlePoseCamera(st: { muzzle: THREE.Vector3; axis: THREE.Vector3 }, grip: ViewGrip, out: THREE.Vector3): THREE.Vector3 {
  out.copy(st.muzzle).applyQuaternion(ROTATION_RIG_CAMERA)
  if (grip.roll) out.applyQuaternion(TMP_ROLL.setFromAxisAngle(FORWARD_AXIS, grip.roll))
  if (grip.x || grip.y || grip.z) out.add(TMP_OFFSET.set(grip.x, grip.y, -grip.z))
  return out
}

/**
 * The muzzle and the barrel axis in the LOCAL frame of the object carrying the muzzle: the
 * mesh for a plain mesh, the bone whose front slice carries the most skin weight for a
 * `SkinnedMesh`. This is the point and axis that follow the rig as it is animated and posed:
 * `muzzleWorldPose` brings them back to world space at the rendered frame.
 */
export interface MuzzleLocal {
  localHolder: THREE.Object3D
  point: THREE.Vector3
  axis: THREE.Vector3
}

/**
 * muzzleLocalPose: the muzzle and the barrel axis of a rig, expressed in the LOCAL frame of the
 * object carrying the muzzle (mesh, or the dominant carrying bone of a `SkinnedMesh`), at the
 * current pose. Weapon meshes are those with no arm material (`isArm`); without a weapon
 * mesh, false. Measured once at load, like `muzzlePose`: `out` is filled, with no allocation
 * constraint (the measurement happens at load, not per frame).
 */
export function muzzleLocalPose(
  root: THREE.Object3D,
  holder: THREE.Object3D,
  isArm: (material: THREE.Material) => boolean,
  rigAxis: THREE.Vector3 | null,
  out: MuzzleLocal,
): boolean {
  root.updateMatrixWorld(true)
  holder.updateMatrixWorld(true)
  const toHolder = TMP_RELATIVE.copy(holder.matrixWorld).invert()
  const axis = TMP_AXIS.copy(rigAxis ?? DEFAULT_AXIS).normalize()
  const isWeapon = (o: THREE.Mesh) => (Array.isArray(o.material) ? o.material : [o.material]).every((m) => !isArm(m))
  const localVertex = (o: THREE.Mesh, i: number, v: THREE.Vector3, relative: THREE.Matrix4): THREE.Vector3 => {
    if (o instanceof THREE.SkinnedMesh) o.getVertexPosition(i, v)
    else v.fromBufferAttribute((o.geometry as THREE.BufferGeometry).getAttribute('position'), i)
    return v.applyMatrix4(relative)
  }
  // First pass: the frontmost point along the barrel (holder's frame).
  let front = -Infinity
  const v = TMP_VERTEX
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !isWeapon(o)) return
    const relative = TMP_MESH.multiplyMatrices(toHolder, o.matrixWorld)
    const pos = (o.geometry as THREE.BufferGeometry).getAttribute('position')
    const step = Math.max(1, Math.ceil(pos.count / MUZZLE_STEP_MAX))
    for (let i = 0; i < pos.count; i += step) {
      if (localVertex(o, i, v, relative).dot(axis) > front) front = v.dot(axis)
    }
  })
  if (front === -Infinity) return false
  // Second pass: the front slice — the carrying object is the one whose slice carries the most
  // weight (vertex count for a mesh, sum of skin weights for a bone).
  const weights = new Map<THREE.Object3D, number>()
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !isWeapon(o)) return
    const relative = TMP_MESH.multiplyMatrices(toHolder, o.matrixWorld)
    const pos = (o.geometry as THREE.BufferGeometry).getAttribute('position')
    const step = Math.max(1, Math.ceil(pos.count / MUZZLE_STEP_MAX))
    if (o instanceof THREE.SkinnedMesh) {
      const boneIdx = o.geometry.getAttribute('skinIndex') as THREE.BufferAttribute
      const w = o.geometry.getAttribute('skinWeight') as THREE.BufferAttribute
      for (let i = 0; i < pos.count; i += step) {
        if (localVertex(o, i, v, relative).dot(axis) < front - MUZZLE_SLICE) continue
        for (let k = 0; k < 4; k++) {
          const ownerBone = o.skeleton.bones[boneIdx.getX(i + k)]
          if (ownerBone) weights.set(ownerBone, (weights.get(ownerBone) ?? 0) + w.getX(i + k))
        }
      }
    } else {
      let n = 0
      for (let i = 0; i < pos.count; i += step) if (localVertex(o, i, v, relative).dot(axis) >= front - MUZZLE_SLICE) n++
      if (n > 0) weights.set(o, (weights.get(o) ?? 0) + n)
    }
  })
  let localHolder: THREE.Object3D | null = null
  let maxWeight = 0
  for (const [p, w] of weights) if (w > maxWeight) { maxWeight = w; localHolder = p }
  if (!localHolder) return false
  // The center of the slice belonging to this holder, pushed onto its front plane.
  const center = new THREE.Vector3()
  let n = 0
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !isWeapon(o)) return
    const belongs = o === localHolder || (o instanceof THREE.SkinnedMesh && (o.skeleton.bones as THREE.Object3D[]).includes(localHolder))
    if (!belongs) return
    const relative = TMP_MESH.multiplyMatrices(toHolder, o.matrixWorld)
    const pos = (o.geometry as THREE.BufferGeometry).getAttribute('position')
    const step = Math.max(1, Math.ceil(pos.count / MUZZLE_STEP_MAX))
    for (let i = 0; i < pos.count; i += step) if (localVertex(o, i, v, relative).dot(axis) >= front - MUZZLE_SLICE) { center.add(v); n++ }
  })
  if (n === 0) return false
  center.divideScalar(n)
  center.addScaledVector(axis, front - center.dot(axis))
  // Carries the point and axis back into the holder's local frame (the inverse of its passage
  // to the holder). `toHolder` lives in TMP_RELATIVE: the product uses a different buffer.
  const localMatrix = TMP_MESH.multiplyMatrices(toHolder, localHolder.matrixWorld).invert()
  out.localHolder = localHolder
  out.point.copy(center).applyMatrix4(localMatrix)
  out.axis.copy(axis).transformDirection(localMatrix)
  return true
}

/**
 * muzzleWorldPose: the muzzle (`point`, local frame of the holder `localHolder`) and the
 * barrel axis (`axis`, same) in WORLD space, read at the rendered frame: the holder's world
 * matrix is refreshed along its chain (`updateWorldMatrix`). No shot or frame allocates:
 * `outPos` and `outAxis` are filled.
 */
export function muzzleWorldPose(
  localHolder: THREE.Object3D,
  point: THREE.Vector3,
  axis: THREE.Vector3,
  outPos: THREE.Vector3,
  outAxis: THREE.Vector3,
): void {
  localHolder.updateWorldMatrix(true, false)
  outPos.copy(point).applyMatrix4(localHolder.matrixWorld)
  outAxis.copy(axis).transformDirection(localHolder.matrixWorld)
}
