// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * ragdollStart3d.ts — CE QUE LE FILM DIT D'UNE MORT AU CORPS INERTE : la pose de la victime à son
 * dernier instant en vie (les clips que la vue jouait, `motion3d`, le cap et le tangage du film),
 * ses pieds et sa vitesse, et ce qui la pousse (`ragdollKick3d`) : l'œil du tueur, l'explosion relue
 * près de la mort, le véhicule qui l'écrase.
 *
 * Le squelette de travail est une copie du Spartan hors de la scène, posée ici puis lue par la
 * cuisson (`ragdollBake3d`) : la pose de départ est exactement celle que la vue montrait, le corps ne
 * saute pas quand il devient inerte.
 */
import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'

import type { ActionContext } from './actionScene3d'
import { EYE_HEIGHT } from './body3d'
import { spartanClipsOf } from './clips3d'
import { newClipMix } from './clipSample3d'
import type { Death3d } from './deaths3d'
import { deathMix } from './fall3d'
import type { Motion3d } from './motion3d'
import { poseSpartan, spartanYaw, type SpartanRig } from './pose3d'
import type { RagdollStart } from './ragdollBake3d'
import { bonesOf } from './ragdollBones3d'
import type { KickInput, KickKind, Vec3 } from './ragdollKick3d'
import type { TriangleSource } from './ragdollPatch3d'
import { rigOf } from './spartan3d'
import { toThree } from './tracks3d'

/** Le squelette de travail d'une source du Spartan. */
export interface Scratch {
  root: THREE.Object3D
  rig: SpartanRig
  bones: THREE.Bone[]
  names: string[]
}

/** makeScratch : une copie de travail du Spartan `source` (hors scène), null sans ses os. */
export function makeScratch(source: THREE.Object3D): Scratch | null {
  const root = cloneSkinned(source)
  const rig = rigOf(root, source)
  if (!rig) return null
  const bones = bonesOf(root)
  return { root, rig, bones, names: bones.map((b) => b.name) }
}

/** Jusqu'où chercher en arrière le dernier instant en vie (s), et à quel pas (images). */
const ALIVE_LOOKBACK = 1
const ALIVE_STEP = 0.25
/** La fenêtre de la vitesse héritée (images du film). */
const VELOCITY_FRAMES = 1
/** Une explosion compte pour une mort si elle tombe dans cette fenêtre (s) et à cette distance (u). */
const BLAST_BEFORE = 0.8
const BLAST_AFTER = 0.3
const BLAST_REACH = 4
/** Le point de détonation se pose un peu au-dessus du sol trouvé (u). */
const BLAST_LIFT = 0.1

/** aliveBefore : la dernière image (pas de `ALIVE_STEP`) où la victime est en vie, au plus `start` ; null. */
export function aliveBefore(ctx: ActionContext, xuid: string, start: number): number | null {
  const fps = Math.max(1, ctx.inputs().framesPerSecond)
  for (let f = start; f >= start - ALIVE_LOOKBACK * fps; f -= ALIVE_STEP) {
    if (ctx.tracks.sample(xuid, f)) return f
  }
  return null
}

/**
 * startOf pose le squelette de travail à la mort `d` et rend ce que la cuisson lit ; null quand la
 * victime n'est pas relue en vie juste avant sa mort ou sans corps.
 */
export function startOf(ctx: ActionContext, motion: Motion3d, scratch: Scratch, world: TriangleSource, d: Death3d): RagdollStart | null {
  const body = d.body
  if (!body) return null
  const alive = aliveBefore(ctx, d.victim, body.start)
  const s = alive === null ? null : ctx.tracks.sample(d.victim, alive)
  if (alive === null || !s) return null
  const feet = ctx.playerFeet(d.victim, alive) ?? d.at.clone()
  const mix = newClipMix()
  const clips = scratch.rig.clips?.clips ?? spartanClipsOf(scratch.root)
  const posed = motion.at(d.victim, alive, false, mix) ?? (clips ? deathMix(0, 'shot', false, clips, mix) : null)
  scratch.root.position.copy(feet)
  poseSpartan(scratch.rig, { h: s.h, p: s.p, mix: posed })
  const fps = Math.max(1, ctx.inputs().framesPerSecond)
  const kick: KickInput = {
    kind: kickKindOf(d),
    velocity: velocityOf(ctx, d.victim, alive, fps),
    from: d.from ? [d.from.x, d.from.y + EYE_HEIGHT, d.from.z] : null,
    dir: [body.fall.dir.x, body.fall.dir.y, body.fall.dir.z],
    blast: body.fall.kind === 'blast' ? blastOf(ctx, d, feet.y) : null,
    vehicle: body.fall.kind === 'splatter' ? velocityOf(ctx, d.killer, d.frame, fps) : null,
    seed: seedOf(d),
  }
  return { bones: scratch.bones, names: scratch.names, feet, yaw: spartanYaw(s.h), kick, world }
}

/** kickKindOf : le style du kill, sans poussée quand la victime est son propre tueur (chute, suicide). */
export function kickKindOf(d: Pick<Death3d, 'killer' | 'victim' | 'body'>): KickKind {
  if (!d.body || !d.killer || d.killer === d.victim) return 'none'
  return d.body.fall.kind
}

/** velocityOf : la vitesse des pieds d'un joueur (véhicule compris) à l'image `f` (u/s, axes three) ; nulle sans relevé. */
function velocityOf(ctx: ActionContext, xuid: string, f: number, fps: number): Vec3 {
  const now = ctx.playerFeet(xuid, f)
  const before = ctx.playerFeet(xuid, f - VELOCITY_FRAMES)
  if (!now || !before) return [0, 0, 0]
  const k = fps / VELOCITY_FRAMES
  return [(now.x - before.x) * k, (now.y - before.y) * k, (now.z - before.z) * k]
}

/**
 * blastOf : la détonation publiée (`Projectile.detoT/detoX/detoY`) la plus proche de la victime dans
 * la fenêtre de la mort, posée sur le sol sous elle (axes three) ; null sans détonation relue.
 */
function blastOf(ctx: ActionContext, d: Death3d, feetY: number): Vec3 | null {
  const fps = Math.max(1, ctx.inputs().framesPerSecond)
  const [vx, , vz] = [d.at.x, d.at.y, d.at.z]
  let best: { x: number; y: number; dist: number } | null = null
  for (const pr of ctx.doc.projectiles) {
    if (pr.detoT < d.frame - BLAST_BEFORE * fps || pr.detoT > d.frame + BLAST_AFTER * fps) continue
    const [tx, , tz] = toThree(pr.detoX, pr.detoY, 0)
    const dist = Math.hypot(tx - vx, tz - vz)
    if (dist <= BLAST_REACH && (!best || dist < best.dist)) best = { x: pr.detoX, y: pr.detoY, dist }
  }
  if (!best) return null
  const [x, , z] = toThree(best.x, best.y, 0)
  // Un rayon direct, pas `Ground.floorY` : son cache rend la hauteur lue en premier dans sa case, et
  // la cuisson doit être la même quel que soit ce que la vue a demandé avant.
  const floor = ctx.ground.hit(new THREE.Vector3(x, feetY + BLAST_PROBE_UP, z), DOWN, BLAST_PROBE_UP + BLAST_PROBE_DOWN)
  return [x, (floor?.y ?? feetY) + BLAST_LIFT, z]
}

const DOWN = new THREE.Vector3(0, -1, 0)
/** Le rayon qui pose la détonation sur le sol part de là au-dessus des pieds de la victime et descend jusque-là sous eux (u). */
const BLAST_PROBE_UP = 0.6
const BLAST_PROBE_DOWN = 2

/** seedOf : le germe stable d'une mort (son image et sa victime). */
export function seedOf(d: Pick<Death3d, 'frame' | 'victim'>): number {
  let h = Math.imul(Math.round(d.frame * 4) | 0, 2654435761) >>> 0
  for (let i = 0; i < d.victim.length; i++) h = Math.imul(h ^ d.victim.charCodeAt(i), 16777619) >>> 0
  return h
}
