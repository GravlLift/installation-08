/**
 * spartanClips.ts — DES CLIPS DE TEST au format de `clips3d` : de petits clips synthétiques, sans
 * GLB, pour le squelette du jeu de `spartanSkeleton` (os et repos réels).
 *
 * `fakeClip` fabrique un clip (images, foulée, sens, pistes) ; `fixtureClips` un catalogue qui tient
 * l'arme droit devant à l'attente (la poignée orientée pour que `GRIP_TO_WEAPON` vise l'avant du
 * modèle), balance les cuisses en locomotion (pied gauche devant au quart du cycle), abaisse le
 * bassin accroupi, et couche le corps à l'arrivée au sol de face (+X) et de dos (-X) ;
 * `motionCatalog` le catalogue sans pistes de la sélection (`clipSelect3d`, `motion3d`).
 */
import * as THREE from 'three'

import { CLIP_FPS, SpartanClips, type ClipTrack, type SpartanClip } from '../scene3d/clips3d'
import { GRIP_TO_WEAPON } from '../scene3d/avatar3d'

const RIGHT = new THREE.Vector3(0, 0, 1)

/** fakeClip : un clip de `frames` images, de foulée `stride` (u par cycle) dans le sens `dir`. */
export function fakeClip(
  name: string,
  frames: number,
  opts: { stride?: number; dir?: readonly [number, number]; sync?: number; tracks?: ClipTrack[] } = {},
): SpartanClip {
  const stride = opts.stride ?? 0
  return {
    name,
    frames,
    frameRate: CLIP_FPS,
    cycle: frames / CLIP_FPS,
    once: (frames - 1) / CLIP_FPS,
    stride,
    sync: opts.sync ?? 0,
    dir: stride > 0 ? opts.dir ?? [1, 0] : [0, 0],
    tracks: opts.tracks ?? [],
  }
}

/** fakeCatalog : un catalogue de clips sans pistes, pour la sélection. */
export function fakeCatalog(clips: readonly SpartanClip[]): SpartanClips {
  return new SpartanClips(clips)
}

function named(root: THREE.Object3D, name: string): THREE.Bone {
  return root.getObjectByName(name) as THREE.Bone
}

/** modelTurn : la rotation locale de `bone` qui le tourne de `q` dans le repère du modèle (racine). */
function modelTurn(root: THREE.Object3D, bone: THREE.Bone, q: THREE.Quaternion): THREE.Quaternion {
  root.updateMatrixWorld(true)
  const parent = (bone.parent as THREE.Object3D).getWorldQuaternion(new THREE.Quaternion())
  return parent.clone().invert().multiply(q).multiply(parent).multiply(bone.quaternion)
}

function constant(bone: string, q: THREE.Quaternion): ClipTrack {
  return { bone, size: 4, values: Float32Array.from(q.toArray()), keys: 1 }
}

/** holdTrack : la poignée droite tournée pour que l'arme portée vise l'avant du modèle, haut en haut. */
export function holdTrack(root: THREE.Object3D): ClipTrack {
  const grip = named(root, 'b_r_grip')
  const parent = (grip.parent as THREE.Object3D).getWorldQuaternion(new THREE.Quaternion())
  return constant('b_r_grip', parent.invert().multiply(GRIP_TO_WEAPON.clone().invert()))
}

/** swingTracks : les cuisses balancées autour de la droite du modèle, gauche devant au quart du cycle. */
export function swingTracks(root: THREE.Object3D, frames: number, amplitude = 0.5): ClipTrack[] {
  const thigh = (name: string, sign: number): ClipTrack => {
    const bone = named(root, name)
    const values = new Float32Array(4 * frames)
    for (let k = 0; k < frames; k++) {
      const a = sign * amplitude * Math.sin((2 * Math.PI * k) / frames)
      modelTurn(root, bone, new THREE.Quaternion().setFromAxisAngle(RIGHT, a)).toArray(values, 4 * k)
    }
    return { bone: name, size: 4, values, keys: frames }
  }
  return [thigh('b_l_thigh', 1), thigh('b_r_thigh', -1)]
}

/** lieTracks : le bassin couché vers `sign` × X du modèle et descendu au ras du sol. */
function lieTracks(root: THREE.Object3D, sign: number): ClipTrack[] {
  const pelvis = named(root, 'b_pelvis')
  const turn = new THREE.Quaternion().setFromAxisAngle(RIGHT, -sign * (Math.PI / 2))
  const t = pelvis.position.clone().setY(0.07)
  return [
    constant('b_pelvis', modelTurn(root, pelvis, turn)),
    { bone: 'b_pelvis', size: 3, values: Float32Array.from(t.toArray()), keys: 1 },
  ]
}

/** crouchTracks : le bassin descendu de `drop` (u). */
function crouchTracks(root: THREE.Object3D, drop: number): ClipTrack[] {
  const p = named(root, 'b_pelvis').position.clone()
  p.y -= drop
  return [{ bone: 'b_pelvis', size: 3, values: Float32Array.from(p.toArray()), keys: 1 }]
}

const DIRS: readonly (readonly [string, number])[] = [
  ['front', 0], ['frontleft', 45], ['left', 90], ['backleft', 135],
  ['back', 180], ['backright', -135], ['right', -90], ['frontright', -45],
]
const dirOf = (deg: number): [number, number] => [Math.cos((deg * Math.PI) / 180), -Math.sin((deg * Math.PI) / 180)]

/**
 * motionCatalog : le catalogue de la SÉLECTION (clips sans pistes, images et foulées du GLB) : le
 * fusil complet (huit directions, postures, actions), le pistolet en quatre directions et le
 * marteau à l'avant seul.
 */
export function motionCatalog(): SpartanClips {
  const clips: SpartanClip[] = [
    fakeClip('combat:rifle:idle', 156),
    fakeClip('sprint:rifle:locomote', 17, { stride: 1.632, sync: 0.82 }),
    fakeClip('crouch:rifle:idle', 156),
    fakeClip('crouch:rifle:slide', 13),
    fakeClip('combat:rifle:airborne_arc', 90),
    fakeClip('combat:rifle:land_hard', 43),
    fakeClip('combat:rifle:clamber_enter', 10),
    fakeClip('combat:rifle:clamber_exit', 12),
    fakeClip('combat:rifle:melee_strike_1', 34),
    fakeClip('combat:rifle:throw_grenade', 72),
    fakeClip('combat:rifle:reload_1', 59),
    fakeClip('combat:rifle:put_away', 5),
    fakeClip('combat:rifle:ready', 14),
    fakeClip('combat:pistol:idle', 156),
    fakeClip('combat:pistol:ready', 14),
    fakeClip('combat:hammer:idle', 156),
    fakeClip('combat:hammer:locomote_run_front', 22, { stride: 1.533 }),
  ]
  for (const [d, a] of DIRS) {
    clips.push(fakeClip(`combat:rifle:locomote_walk_${d}`, 26, { stride: 0.94, dir: dirOf(a), sync: 0.1 }))
    clips.push(fakeClip(`combat:rifle:locomote_run_${d}`, 22, { stride: d === 'front' ? 1.533 : 1.386, dir: dirOf(a), sync: 0.3 }))
  }
  for (const d of ['front', 'back', 'left', 'right']) {
    clips.push(fakeClip(`crouch:rifle:locomote_walk_${d}`, 28, { stride: 0.618 }))
    clips.push(fakeClip(`combat:pistol:locomote_run_${d}`, 22, { stride: 1.533 }))
    clips.push(fakeClip(`combat:pistol:locomote_walk_${d}`, 26, { stride: 0.94 }))
  }
  return new SpartanClips(clips)
}

/** fixtureClips : le catalogue de test du squelette `root` (cf. l'en-tête). */
export function fixtureClips(root: THREE.Object3D): SpartanClips {
  const hold = holdTrack(root)
  return new SpartanClips([
    fakeClip('combat:rifle:idle', 4, { tracks: [hold] }),
    fakeClip('combat:rifle:locomote_run_front', 22, { stride: 1.533, sync: 0.25, tracks: [hold, ...swingTracks(root, 22)] }),
    fakeClip('combat:rifle:locomote_walk_front', 26, { stride: 0.94, sync: 0.25, tracks: [hold, ...swingTracks(root, 26, 0.3)] }),
    fakeClip('crouch:rifle:idle', 4, { tracks: [hold, ...crouchTracks(root, 0.2)] }),
    fakeClip('combat:any:landing_dead', 34, { tracks: lieTracks(root, 1) }),
    fakeClip('combat:landing_dead_back', 60, { tracks: lieTracks(root, -1) }),
    fakeClip('combat:any:airborne_dead', 149),
    fakeClip('combat:airborne_dead_back', 149),
  ])
}
