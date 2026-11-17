// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * ragdollStart3d.ts — WHAT THE FILM SAYS ABOUT A DEATH, FOR THE RAGDOLL: the victim's pose at
 * their last instant alive (the clips the view was playing, `motion3d`, the film's heading and
 * pitch), their feet and velocity, and what pushes them (`ragdollKick3d`): the killer's eye, the
 * explosion read near the death, the vehicle running them down.
 *
 * The working skeleton is a copy of the Spartan outside the scene, posed here then read by the
 * bake (`ragdollBake3d`): the starting pose is exactly the one the view was showing, the body
 * does not jump when it becomes a ragdoll.
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

/** A Spartan source's working skeleton. */
export interface Scratch {
  root: THREE.Object3D
  rig: SpartanRig
  bones: THREE.Bone[]
  names: string[]
}

/** makeScratch: a working copy of Spartan `source` (outside the scene), null without its bones. */
export function makeScratch(source: THREE.Object3D): Scratch | null {
  const root = cloneSkinned(source)
  const rig = rigOf(root, source)
  if (!rig) return null
  const bones = bonesOf(root)
  return { root, rig, bones, names: bones.map((b) => b.name) }
}

/** How far back to search for the last instant alive (s), and at what step (frames). */
const ALIVE_LOOKBACK = 1
const ALIVE_STEP = 0.25
/** The inherited velocity's window (film frames). */
const VELOCITY_FRAMES = 1
/** An explosion counts toward a death if it falls within this window (s) and this distance (u). */
const BLAST_BEFORE = 0.8
const BLAST_AFTER = 0.3
const BLAST_REACH = 4
/** The detonation point is placed a bit above the found ground (u). */
const BLAST_LIFT = 0.1

/** aliveBefore: the last frame (step `ALIVE_STEP`) where the victim is alive, at most `start`; null otherwise. */
export function aliveBefore(ctx: ActionContext, xuid: string, start: number): number | null {
  const fps = Math.max(1, ctx.inputs().framesPerSecond)
  for (let f = start; f >= start - ALIVE_LOOKBACK * fps; f -= ALIVE_STEP) {
    if (ctx.tracks.sample(xuid, f)) return f
  }
  return null
}

/**
 * startOf poses the working skeleton at death `d` and returns what the bake reads; null when the
 * victim is not read alive just before their death, or with no body.
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

/** kickKindOf: the kill's style, no push when the victim is their own killer (a fall, a suicide). */
export function kickKindOf(d: Pick<Death3d, 'killer' | 'victim' | 'body'>): KickKind {
  if (!d.body || !d.killer || d.killer === d.victim) return 'none'
  return d.body.fall.kind
}

/** velocityOf: a player's feet velocity (vehicle included) at frame `f` (u/s, three.js axes); zero with no reading. */
function velocityOf(ctx: ActionContext, xuid: string, f: number, fps: number): Vec3 {
  const now = ctx.playerFeet(xuid, f)
  const before = ctx.playerFeet(xuid, f - VELOCITY_FRAMES)
  if (!now || !before) return [0, 0, 0]
  const k = fps / VELOCITY_FRAMES
  return [(now.x - before.x) * k, (now.y - before.y) * k, (now.z - before.z) * k]
}

/**
 * blastOf: the published detonation (`Projectile.detoT/detoX/detoY`) closest to the victim within
 * the death's window, placed on the ground below it (three.js axes); null with no detonation read.
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
  // A direct ray, not `Ground.floorY`: its cache returns the first height read into its cell, and
  // the bake must be the same regardless of what the view asked for before.
  const floor = ctx.ground.hit(new THREE.Vector3(x, feetY + BLAST_PROBE_UP, z), DOWN, BLAST_PROBE_UP + BLAST_PROBE_DOWN)
  return [x, (floor?.y ?? feetY) + BLAST_LIFT, z]
}

const DOWN = new THREE.Vector3(0, -1, 0)
/** The ray that places the detonation on the ground starts this far above the victim's feet and goes down this far below them (u). */
const BLAST_PROBE_UP = 0.6
const BLAST_PROBE_DOWN = 2

/** seedOf: a death's stable seed (its frame and its victim). */
export function seedOf(d: Pick<Death3d, 'frame' | 'victim'>): number {
  let h = Math.imul(Math.round(d.frame * 4) | 0, 2654435761) >>> 0
  for (let i = 0; i < d.victim.length; i++) h = Math.imul(h ^ d.victim.charCodeAt(i), 16777619) >>> 0
  return h
}
