// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * fall3d.ts — THE BODY'S FALL AT DEATH: the game's death clips, a function of the time elapsed
 * since death, in a style chosen by the thread kill's source.
 *
 * The game has no standing fall (its deaths are a fall IN THE AIR, `airborne_dead`, and the
 * ground landing, `landing_dead`, each front and back): the body goes from the standing pose
 * (rifle idle) or, if thrown, from the airborne fall, to the ground landing through a crossfade
 * over the fall's duration, then the landing plays out (bounce, body settling). Front or back
 * depending on the impulse (from the killer to the victim when both positions can be read, toward
 * the victim's back otherwise) relative to the victim's facing; the body rotates during the fall
 * to land along the impulse, its root slides along it and launches for thrown kills.
 *
 * The style (`FallKind`) comes from the kill: a splatter (thumbnail `killfeed-60`,
 * `libs/film/killicon/splatter.go`) and an explosion (grenades `killfeed-46..49`, launchers
 * `killfeed-42..45`, families `explosive` / `bomb`) throw the body, melee (thumbnail
 * `killfeed-65`, family `melee`) pushes it, a headshot makes it collapse in place; a bullet makes
 * it fall.
 *
 * No memory: the fall depends only on time and style.
 */
import * as THREE from 'three'

import type { ShotFamily } from '../layers/shotEffects'
import type { ReplayKill } from '../model/killFeedLogic'
import { KILL_SPRITE_SOUND_STEMS, killSourceSpriteStem } from '../sound/replaySound'
import type { SpartanClip } from './clips3d'
import type { ClipMix } from './clipSample3d'
import { smoothstep, type ClipCatalog } from './clipSelect3d'

export type FallKind = 'shot' | 'headshot' | 'melee' | 'blast' | 'splatter'

/** The thread's splatter thumbnail (`libs/film/killicon/splatter.go`). */
const SPLATTER_SPRITE = 'killfeed-60'
const BLAST_FAMILIES: ReadonlySet<ShotFamily> = new Set(['explosive', 'bomb'])

interface FallStyle {
  /** Duration of the fall to the ground (s). */
  seconds: number
  /** The body's slide along the impulse (u). */
  slide: number
  /** The launch at the midpoint of the fall (u). */
  hop: number
  /** Thrown: the fall starts from the game's airborne fall, not the standing pose. */
  thrown: boolean
}

const STYLES: Readonly<Record<FallKind, FallStyle>> = {
  shot: { seconds: 0.6, slide: 0.08, hop: 0, thrown: false },
  headshot: { seconds: 0.45, slide: 0, hop: 0, thrown: false },
  melee: { seconds: 0.5, slide: 0.35, hop: 0.04, thrown: false },
  blast: { seconds: 0.7, slide: 0.9, hop: 0.3, thrown: true },
  splatter: { seconds: 0.6, slide: 1.4, hop: 0.35, thrown: true },
}

/** The game's death clips and the standing pose a non-thrown fall starts from. */
export const DEATH_CLIPS = {
  standing: 'combat:rifle:idle',
  airborne: 'combat:any:airborne_dead',
  airborneBack: 'combat:airborne_dead_back',
  landing: 'combat:any:landing_dead',
  landingBack: 'combat:landing_dead_back',
} as const

/** The fall at an instant: its progress (0 to 1), the root's slide and lift (u). */
export interface FallPose {
  u: number
  slide: number
  lift: number
}

/** fallKindOf: the fall style a thread kill calls for, `family` read from `doc.killEffects`. */
export function fallKindOf(k: Pick<ReplayKill, 'weaponImageUrl' | 'headshot'>, family: ShotFamily): FallKind {
  const stem = killSourceSpriteStem(k.weaponImageUrl)
  if (stem === SPLATTER_SPRITE) return 'splatter'
  const sound = KILL_SPRITE_SOUND_STEMS[stem]
  if (sound?.category === 'melee' || family === 'melee') return 'melee'
  if (sound?.category === 'grenade' || sound?.stem.startsWith('coil_') || BLAST_FAMILIES.has(family)) return 'blast'
  return k.headshot === true ? 'headshot' : 'shot'
}

/** fallSeconds: a style's fall duration (past that, the body is on the ground). */
export function fallSeconds(kind: FallKind): number {
  return STYLES[kind].seconds
}

/** fallPose: the fall `t` seconds after death; standing before, on the ground after its duration. */
export function fallPose(t: number, kind: FallKind, out: FallPose): FallPose {
  const s = STYLES[kind]
  const u = Math.min(1, Math.max(0, t / s.seconds))
  out.u = u
  out.slide = s.slide * (1 - (1 - u) * (1 - u))
  out.lift = s.hop * 4 * u * (1 - u)
  return out
}

/** fallPlacement: where to place the body's root (three.js axes): at feet `at`, slid along impulse `dir` and raised. */
export function fallPlacement(at: THREE.Vector3, dir: THREE.Vector3, p: FallPose, pos: THREE.Vector3): void {
  pos.copy(at).addScaledVector(dir, p.slide)
  pos.y += p.lift
}

/** fallsBackward: does impulse `dir` (horizontal, three.js axes) point toward the back of a victim heading `facing` (three.js axes)? */
export function fallsBackward(dir: THREE.Vector3, facing: THREE.Vector3): boolean {
  return dir.dot(facing) < 0
}

/**
 * fallHeading: the body's heading (degrees) at fall progress `u`: the victim's heading `h` at the
 * start, rotated during the fall so the body lands along impulse `dir` (three.js axes): facing
 * it, or back to it if falling backward (whichever is shorter, at most a quarter turn).
 */
export function fallHeading(h: number, dir: THREE.Vector3, backward: boolean, u: number): number {
  const s = backward ? -1 : 1
  const target = (Math.atan2(-dir.z * s, dir.x * s) * 180) / Math.PI
  const step = ((target - h + 540) % 360) - 180
  return h + step * smoothstep(u, 0, 1)
}

/**
 * deathMix writes to `out` the body's clips `t` seconds after death: the starting pose (standing,
 * or the airborne fall for a thrown kill) crossfaded to the ground landing over the fall, then
 * the landing played from the end of the fall. Returns `out` (empty with no death clips).
 */
export function deathMix(t: number, kind: FallKind, backward: boolean, cat: ClipCatalog, out: ClipMix): ClipMix {
  const s = STYLES[kind]
  out.baseCount = 0
  out.overCount = 0
  const start = cat.get(s.thrown ? (backward ? DEATH_CLIPS.airborneBack : DEATH_CLIPS.airborne) : DEATH_CLIPS.standing)
  const land = cat.get(backward ? DEATH_CLIPS.landingBack : DEATH_CLIPS.landing)
  if (!start || !land) return out
  const w = smoothstep(t / s.seconds, 0, 1)
  pushOnce(out, start, s.thrown ? Math.max(0, t) : 0, 1 - w)
  pushOnce(out, land, Math.max(0, t - s.seconds), w)
  return out
}

function pushOnce(out: ClipMix, clip: SpartanClip, time: number, weight: number): void {
  if (weight <= 0) return
  const l = out.base[out.baseCount++]
  l.clip = clip
  l.time = time
  l.weight = weight
  l.loop = false
}
