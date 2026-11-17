// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * pose3d.ts — THE GAME SPARTAN'S POSE in the 3D scene: its bones found by name (the game's own,
 * `b_pelvis`, `b_spine2`, ...), then at each frame the heading on the root, the game's clips
 * (`clipSample3d`, mix chosen by `clipSelect3d`) and, on top, the aim's pitch spread over the torso.
 *
 * The pose is a FUNCTION OF THE FRAME: clips start back from the rest pose of the bones they
 * animate, the pitch adds to what they placed; nothing accumulates from one frame to the next;
 * rewinding the replay renders the same pose.
 *
 * Model frame (GLB `spartan`, three.js axes): feet at the origin, Y up, facing
 * `SPARTAN_FORWARD`, its right toward `SPARTAN_RIGHT`. Clips aim straight ahead (`SPARTAN_FORWARD`):
 * the pitch rotates the torso around the model's right, and everything the upper torso carries (arms,
 * weapon, head) follows it by the whole pitch. The `b_aim_pitch` / `b_aim_yaw` bones carry no vertex.
 */
import * as THREE from 'three'

import { newClipMix, type ClipMix, type ClipRig } from './clipSample3d'
import { aimDirThree } from './tracks3d'

/** The model's facing at rest (measured on the GLB's feet, head and hands). */
export const SPARTAN_FORWARD = new THREE.Vector3(1, 0, 0)
const UP = new THREE.Vector3(0, 1, 0)
/** The model's right; rotating by +θ around it raises the facing. */
export const SPARTAN_RIGHT = SPARTAN_FORWARD.clone().cross(UP)

/** The bones a copy must carry: the pelvis (clips' root), the pitch's torso, the weapon grip. */
export const SPARTAN_BONES = {
  pelvis: 'b_pelvis',
  spine1: 'b_spine1',
  spine2: 'b_spine2',
  spine3: 'b_spine3',
  rightGrip: 'b_r_grip',
} as const

/**
 * The clavicles, from which both arms extend: the weapon's recoil (`recoilPose3d`) moves them
 * with a single motion, after the clips. Optional: without them, the weapon recoils alone in the hand.
 */
const ARM_BONES = { left: 'b_l_clav', right: 'b_r_clav' } as const

/**
 * The share of the pitch carried by each bone, bottom to top; they sum to 1: the upper torso,
 * and with it the arms and weapon, rotates by the whole pitch.
 */
const PITCH_SHARES: readonly (readonly [keyof typeof SPARTAN_BONES, number])[] = [
  ['spine1', 0.2],
  ['spine2', 0.4],
  ['spine3', 0.4],
]
/** The pitch's maximum (degrees); beyond it the pose holds. */
export const PITCH_LIMIT = 75

export interface SpartanRig {
  root: THREE.Object3D
  rightGrip: THREE.Bone
  /** The pitch's bones, bottom to top (`PITCH_SHARES`). */
  joints: THREE.Bone[]
  /** The game's clips bound to this copy; null: the copy stays at rest under the pitch. */
  clips: ClipRig | null
  /** The bones the pose touches outside the clips, and their rest pose (with no clips: the whole pitch). */
  rest: [THREE.Bone, THREE.Quaternion][]
  /** The clavicles (`ARM_BONES`), empty if the copy has none: the recoil moves them. */
  arms: THREE.Bone[]
  /** Their whole rest pose (position, orientation, scale): every pose starts back from it before the clips. */
  armRest: [THREE.Bone, THREE.Vector3, THREE.Quaternion, THREE.Vector3][]
}

export interface SpartanPose {
  /** Heading (degrees, 0 = Halo +X, 90 = Halo +Y). */
  h: number
  /** Pitch (degrees, positive upward). */
  p: number
  /** The frame's clip mix (`clipSelect3d`); absent or null: the rest pose. */
  mix?: ClipMix | null
}

/** findBones: `root`'s bones named by `names`, null if any is missing. */
export function findBones<K extends string>(
  root: THREE.Object3D,
  names: Readonly<Record<K, string>>,
): Record<K, THREE.Bone> | null {
  const byName = new Map<string, THREE.Bone>()
  root.traverse((o) => {
    if (o instanceof THREE.Bone && !byName.has(o.name)) byName.set(o.name, o)
  })
  const out: Partial<Record<K, THREE.Bone>> = {}
  for (const k of Object.keys(names) as K[]) {
    const bone = byName.get(names[k])
    if (!bone) return null
    out[k] = bone
  }
  return out as Record<K, THREE.Bone>
}

/**
 * rigSpartan: the driven bones of a Spartan copy, bound to its clips `clips` (null: no clips).
 * Null without `SPARTAN_BONES`'s bones. The copy must be at rest.
 */
export function rigSpartan(root: THREE.Object3D, clips: ClipRig | null): SpartanRig | null {
  const b = findBones(root, SPARTAN_BONES)
  if (!b) return null
  const joints = PITCH_SHARES.map(([name]) => b[name])
  const clav = findBones(root, ARM_BONES)
  const arms = clav ? [clav.left, clav.right] : []
  return {
    root,
    rightGrip: b.rightGrip,
    joints,
    clips,
    rest: joints.map((bone) => [bone, bone.quaternion.clone()]),
    arms,
    armRest: arms.map((bone) => [bone, bone.position.clone(), bone.quaternion.clone(), bone.scale.clone()]),
  }
}

/** spartanYaw: the root's rotation around Y (radians) that turns the facing toward heading `h`. */
export function spartanYaw(h: number): number {
  const d = aimDirThree(h, 0)
  return Math.atan2(-d[2], d[0]) - Math.atan2(-SPARTAN_FORWARD.z, SPARTAN_FORWARD.x)
}

/** The empty mix: all the clips' bones at their rest pose. */
const REST: ClipMix = newClipMix(0, 0)
const turn = new THREE.Quaternion()
const parentQ = new THREE.Quaternion()
const parentInv = new THREE.Quaternion()

/**
 * poseSpartan poses the copy: heading on the root, mix's clips (or rest), then the pitch added to
 * the torso around the model's right.
 */
export function poseSpartan(rig: SpartanRig, pose: SpartanPose): void {
  rig.root.rotation.set(0, spartanYaw(pose.h), 0)
  for (const [bone, q] of rig.rest) bone.quaternion.copy(q)
  // A previous frame's recoil does not survive: the clavicles start back from their rest pose.
  for (const [bone, t, q, s] of rig.armRest) {
    bone.position.copy(t)
    bone.quaternion.copy(q)
    bone.scale.copy(s)
  }
  // With no mix, the clips' bones also return to rest: the pose depends only on `pose`.
  rig.clips?.apply(pose.mix ?? REST)
  const pitch = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(pose.p, -PITCH_LIMIT, PITCH_LIMIT))
  PITCH_SHARES.forEach(([, share], i) => bendInModel(rig.joints[i], rig.root, pitch * share))
  rig.root.updateMatrixWorld(true)
}

/**
 * bendInModel rotates `bone` by `angle` around the model's right (`root`'s frame), on top of its
 * current orientation: local' = P⁻¹ · R · P · local, P being its parent's orientation in the
 * model's frame (read off local quaternions, with no matrix or allocation).
 */
function bendInModel(bone: THREE.Bone, root: THREE.Object3D, angle: number): void {
  if (angle === 0) return
  parentQ.identity()
  for (let o = bone.parent; o && o !== root; o = o.parent) parentQ.premultiply(o.quaternion)
  turn.setFromAxisAngle(SPARTAN_RIGHT, angle)
  // P⁻¹ · R · P, then applied to the left of the local orientation.
  turn.premultiply(parentInv.copy(parentQ).invert()).multiply(parentQ)
  bone.quaternion.premultiply(turn)
}
