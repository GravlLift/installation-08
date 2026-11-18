// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'

export interface FirstPersonClip {
  name: string
  action: string
  variant: number
  type: string
  overlay: boolean
  frameCount: number
  frameRate: number
  durationSeconds: number
}

export interface FirstPersonRig {
  file: string
  bones: number
  triangles: number
  bytes: number
  idleWeapon?: { position: [number, number, number]; forward: [number, number, number] }
  clips: FirstPersonClip[]
  actions: { action: string; variant: number; clip: string }[]
  missingActions: unknown[]
}

/**
 * A marker a weapon's idle effect emits at, on the rig: its bone, and its offset and rotation (quaternion
 * x, y, z, w; absent in a library before schema 5: none) in that bone's frame (GLB axes).
 */
export interface RigEffectMarker {
  marker: string
  bone: string
  position: [number, number, number]
  rotation?: [number, number, number, number]
}

export interface FirstPersonIndex {
  schema: number
  weapons: { weapon: string; file: string; effectMarkers?: RigEffectMarker[] }[]
  rigs: FirstPersonRig[]
  failures: unknown[]
  textures: unknown
}

export function rigForWeapon(index: FirstPersonIndex, weaponKey: string | null): FirstPersonRig | null {
  const file = index.weapons.find((w) => w.weapon.toLowerCase() === weaponKey?.toLowerCase())?.file
  return index.rigs.find((rig) => rig.file === file) ?? null
}

export function clipOfRig(rig: FirstPersonRig, action: string, variant = 0): FirstPersonClip | null {
  const name = rig.actions.find((entry) => entry.action === action && entry.variant === variant)?.clip
  return rig.clips.find((clip) => clip.name === name) ?? null
}

export function clipTime(clip: FirstPersonClip, frame: number, fps: number): number {
  if (fps <= 0 || clip.durationSeconds <= 0) return 0
  return ((frame / fps) % clip.durationSeconds + clip.durationSeconds) % clip.durationSeconds
}

export function firstPersonFolder(weaponsFolder: string): string {
  return weaponsFolder.replace(/\/weapons\/?$/, '/first-person')
}

export function rigUrl(folder: string, file: string): string {
  return `${folder}/${encodeURIComponent(file)}`
}

export const ROTATION_RIG_CAMERA = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
