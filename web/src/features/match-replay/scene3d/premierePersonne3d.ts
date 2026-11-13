import * as THREE from 'three'

export interface ClipPremierePersonne {
  name: string
  action: string
  variant: number
  type: string
  overlay: boolean
  frameCount: number
  frameRate: number
  durationSeconds: number
}

export interface RigPremierePersonne {
  file: string
  bones: number
  triangles: number
  bytes: number
  idleWeapon?: { position: [number, number, number]; forward: [number, number, number] }
  clips: ClipPremierePersonne[]
  actions: { action: string; variant: number; clip: string }[]
  missingActions: unknown[]
}

export interface IndexPremierePersonne {
  schema: number
  weapons: { weapon: string; file: string }[]
  rigs: RigPremierePersonne[]
  failures: unknown[]
  textures: unknown
}

export function rigDeLArme(index: IndexPremierePersonne, cleArme: string | null): RigPremierePersonne | null {
  const fichier = index.weapons.find((arme) => arme.weapon.toLowerCase() === cleArme?.toLowerCase())?.file
  return index.rigs.find((rig) => rig.file === fichier) ?? null
}

export function clipDuRig(rig: RigPremierePersonne, action: string, variant = 0): ClipPremierePersonne | null {
  const nom = rig.actions.find((entree) => entree.action === action && entree.variant === variant)?.clip
  return rig.clips.find((clip) => clip.name === nom) ?? null
}

export function tempsDuClip(clip: ClipPremierePersonne, frame: number, fps: number): number {
  if (fps <= 0 || clip.durationSeconds <= 0) return 0
  return ((frame / fps) % clip.durationSeconds + clip.durationSeconds) % clip.durationSeconds
}

export function dossierPremierePersonne(dossierArmes: string): string {
  return dossierArmes.replace(/\/weapons\/?$/, '/first-person')
}

export function urlRig(dossier: string, fichier: string): string {
  return `${dossier}/${encodeURIComponent(fichier)}`
}

export const ROTATION_RIG_CAMERA = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
