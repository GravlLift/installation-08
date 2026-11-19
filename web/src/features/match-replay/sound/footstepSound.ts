// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * footstepSound.ts — WHEN A FOOT STEP SOUNDS, FROM THE FILM'S OWN MOTION.
 *
 * THE SOURCE IS THE TRACK ITSELF: a player's positions per frame give a horizontal ground speed,
 * and the film's movement stances give the two states the speed cannot, the AIR (`jumpDerived`)
 * and the SLIDE (`slide`). No foot step sound is invented: an event is emitted only where the film
 * puts the player on the ground and moving, and only as many as the distance walked allows
 * (one step per stride). The take is drawn deterministically at construction — seeded by the
 * event's time and the player's xuid — so the live player and the export draw the SAME file.
 *
 * WHAT IS MEASURED AND WHAT IS NOT. The film publishes a position, a frame interval, and the
 * stances; it does NOT publish a foot fall rate nor a per-frame surface. The gaits below are
 * therefore ESTIMATED constants, chosen so the cadence reads right at typical Spartan speeds,
 * and the surface is a parameter the caller fixes ("default" until a later task picks it per
 * material). The constants name their kind of authority in a comment.
 */
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { botKey } from '../../../lib/replay/rosterLogic'
import { covers } from '../model/replaySpans'
import { falloffOf, layersOf, type FootstepEntry, type FootstepManifest } from './footstepManifest'
import type { ReplaySoundEvent } from './replaySoundVariants'

/** The gaits a ground step takes on. */
export type FootstepGait = 'walk' | 'run' | 'sprint'

/** One timed foot sound, before the take is drawn. */
export interface FootstepTimedEvent {
  timeMs: number
  kind: 'step' | 'slide' | 'land' | 'jump'
  action: string
  xuid: string
  position: { x: number; y: number; z?: number }
}

/** What the pure function reads for one player. */
export interface FootstepInput {
  points: ReadonlyArray<{ t: number; x: number; y: number; z?: number }>
  stances: ReadonlyArray<{ kind: string; t0: number; t1: number }>
  frameIntervalMs: number
  xuid: string
  surface: string
}

// -- SPEED THRESHOLDS, in world units per second (the film's positions are world units, 1 u =
//    3.048 m). MEASURED on a 4v4 film (05dfe4e9, 111k frame-to-frame speeds): the horizontal speed
//    peaks at 2.0-2.5 u/s (running) and 2.75-3.25 u/s (sprinting), with a shoulder at 1.5-1.75 u/s
//    (crouching, strafing). The thresholds sit between the peaks; the game picks the gait from its
//    animation, which the film does not publish. --
const RUN_MIN_SPEED = 1.8
const SPRINT_MIN_SPEED = 2.7
// Below this horizontal speed a step is not heard (a shuffle, a slide in place). ESTIMATED.
const MIN_STEP_SPEED = 0.5

// -- STRIDE (world units) BETWEEN TWO FOOT STEPS of a gait. ESTIMATED: the film gives the position,
//    not the foot fall rate; a stride distance is the one quantity that turns a speed into a
//    cadence, and these give about two steps a second at each gait's measured speed. --
const STRIDE: Record<FootstepGait, number> = { walk: 0.8, run: 1.1, sprint: 1.4 }
// A slide foot-scrape every this distance (world units). ESTIMATED, same reason as the strides.
const SLIDE_STRIDE = 1

// -- LANDING FALL HEIGHTS (world units). ESTIMATED: a fall beyond LAND_SOFT plays the soft
//    landing, beyond LAND_HARD the hard one. A track without Z never reaches here, so a landing is
//    only ever detected where the film carries a vertical axis. --
const LAND_SOFT = 0.4
const LAND_HARD = 1.8

// -- THE LEVEL OF A TAKE WITHOUT ITS OWN (a manifest older than version 3, which did not carry the
//    game's authored volumes). A placement choice, not a measurement. Version 3 takes play at the
//    volume the game's mix hierarchy authors for them (walk -29 dB, run -11 and -20 dB, sprint
//    -9.5 and -14 dB, slides -7 dB). --
export const FOOTSTEP_GAIN_DB = -3

/** gaitOf — the gait of a horizontal ground speed. */
function gaitOf(speed: number): FootstepGait {
  if (speed >= SPRINT_MIN_SPEED) return 'sprint'
  if (speed >= RUN_MIN_SPEED) return 'run'
  return 'walk'
}

/** at — a track point as a sound's place: x, y, and z when the film carries it. */
function at(p: { x: number; y: number; z?: number }): FootstepTimedEvent['position'] {
  return p.z === undefined ? { x: p.x, y: p.y } : { x: p.x, y: p.y, z: p.z }
}

/** coversAny — does any span cover the frame? */
function coversAny(spans: ReadonlyArray<{ t0: number; t1: number }>, frame: number): boolean {
  for (const s of spans) if (covers(s, frame)) return true
  return false
}

/**
 * footstepTimedEvents — the timed foot sounds of one player's track. PURE: same input, same
 * events, no clock, no take, no randomness.
 */
export function footstepTimedEvents(input: FootstepInput): FootstepTimedEvent[] {
  const { points, stances, frameIntervalMs, xuid } = input
  const out: FootstepTimedEvent[] = []
  if (points.length < 2 || frameIntervalMs <= 0) return out

  const airborne = stances.filter((s) => s.kind === 'jumpDerived')
  const slides = stances.filter((s) => s.kind === 'slide')

  let inAir = false
  let peakZ: number | null = null
  let sliding = false
  let stepAcc = 0
  let slideAcc = 0

  for (let i = 1; i < points.length; i++) {
    const p = points[i]
    const prev = points[i - 1]
    const dt = (p.t - prev.t) * frameIntervalMs
    if (dt <= 0) continue
    const dist = Math.hypot(p.x - prev.x, p.y - prev.y)
    const speed = dist / (dt / 1000)
    const air = coversAny(airborne, p.t)
    const slide = coversAny(slides, p.t)
    const timeMs = p.t * frameIntervalMs

    if (air) {
      if (!inAir) {
        // Entering the air: the jump-up, at the take-off frame.
        out.push({ timeMs: prev.t * frameIntervalMs, kind: 'jump', action: 'jumpup', xuid, position: at(prev) })
        inAir = true
        peakZ = p.z ?? null
      } else if (p.z !== undefined && (peakZ === null || p.z > peakZ)) {
        peakZ = p.z
      }
      // The slide span ends at the take-off: the slide_outof.
      if (sliding) out.push({ timeMs, kind: 'slide', action: 'slide_outof', xuid, position: at(p) })
      stepAcc = 0
      slideAcc = 0
      sliding = false
      continue
    }

    if (inAir) {
      // Landing: judge the fall by the height gained in the air and the ground regained.
      if (peakZ !== null && p.z !== undefined) {
        const fall = peakZ - p.z
        if (fall > LAND_HARD) out.push({ timeMs, kind: 'land', action: 'landhard', xuid, position: at(p) })
        else if (fall > LAND_SOFT) out.push({ timeMs, kind: 'land', action: 'land', xuid, position: at(p) })
      }
      inAir = false
      peakZ = null
      stepAcc = 0
      slideAcc = 0
    }

    if (slide) {
      if (!sliding) {
        // The slide begins: the slide_into, then the surface slide scrape per distance.
        out.push({ timeMs, kind: 'slide', action: 'slide_into', xuid, position: at(p) })
        sliding = true
        slideAcc = 0
      }
      slideAcc += dist
      if (slideAcc >= SLIDE_STRIDE) {
        slideAcc -= SLIDE_STRIDE
        out.push({ timeMs, kind: 'slide', action: 'slide', xuid, position: at(p) })
      }
    } else {
      // The slide ends: the slide_outof, at the last sliding frame.
      if (sliding) out.push({ timeMs, kind: 'slide', action: 'slide_outof', xuid, position: at(p) })
      sliding = false
      if (speed >= MIN_STEP_SPEED) {
        const gait = gaitOf(speed)
        stepAcc += dist
        if (stepAcc >= STRIDE[gait]) {
          stepAcc -= STRIDE[gait]
          out.push({ timeMs, kind: 'step', action: gait, xuid, position: at(p) })
        }
      } else {
        stepAcc = 0
      }
    }
  }
  return out
}

/** entryFor — the manifest entry of a timed event for a surface. */
function entryFor(manifest: FootstepManifest, surface: string, kind: FootstepTimedEvent['kind'], action: string): FootstepEntry | undefined {
  switch (kind) {
    case 'step':
      return manifest.feet[surface]?.[action]
    case 'slide':
      if (action === 'slide_into' || action === 'slide_outof') return manifest.movement[action]
      return manifest.feet[surface]?.slide
    case 'land':
      return manifest.movement[action]
    case 'jump':
      return manifest.movement.jumpup
  }
}

/** pickTake — the take of an event's layer, DETERMINISTIC: seeded by time, xuid and layer, so live and export agree. */
function pickTake<T>(e: FootstepTimedEvent, layer: number, takes: readonly T[]): T {
  if (takes.length <= 1) return takes[0]
  return takes[fnv1a(e.timeMs, e.xuid, e.kind, layer === 0 ? e.action : `${e.action}#${layer}`) % takes.length]
}

/** fnv1a — a 32-bit FNV-1a fold of the event's identity, stable across runs and builds. */
function fnv1a(timeMs: number, xuid: string, kind: string, action: string): number {
  let h = 0x811c9dc5
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 15) + (h << 16))) >>> 0
    }
  }
  feed(`${timeMs}|${xuid}|${kind}|${action}`)
  return h >>> 0
}

/**
 * footstepReplayEvents — the timed events as the track plays them, as the game plays them: one
 * take drawn from every layer the game sounds together (a run step is three), each at the volume
 * the game authors for it and with its own distance falloff. Every player's steps are placed but
 * the followed player's own (full and centered, no place); with nobody followed (the free camera,
 * the 2D view) every step is placed, so none plays full and centered behind the camera.
 */
export function footstepReplayEvents(
  manifest: FootstepManifest,
  surface: string,
  events: readonly FootstepTimedEvent[],
  followed: string | null,
): ReplaySoundEvent[] {
  const out: ReplaySoundEvent[] = []
  for (const e of events) {
    const layers = layersOf(entryFor(manifest, surface, e.kind, e.action))
    if (!layers) continue
    const own = followed !== null && e.xuid === followed
    layers.forEach((takes, i) => {
      const take = pickTake(e, i, takes)
      const ev: ReplaySoundEvent = { ms: e.timeMs, stem: take.stem, gainDb: take.gainDb ?? FOOTSTEP_GAIN_DB, footstep: true }
      if (take.reverbDb !== undefined) ev.reverbDb = take.reverbDb
      if (!own) {
        ev.at = e.position
        const falloff = falloffOf(manifest, take)
        if (falloff) ev.falloff = falloff
      }
      out.push(ev)
    })
  }
  return out
}

/** The xuid a track plays under: its real xuid, or its bot key. */
function trackIdentity(track: { xuid?: string; bot?: string }): string {
  return track.xuid || (track.bot ? botKey(track.bot) : '')
}

/**
 * footstepSoundEvents — every player's foot sounds for a match, sorted by time. The surface is a
 * single parameter the caller fixes ("default" for now); a later task can pick it per material.
 */
export function footstepSoundEvents(
  manifest: FootstepManifest,
  doc: ReplayDocumentReady,
  surface: string,
  followed: string | null,
): ReplaySoundEvent[] {
  const frameIntervalMs = doc.frameIntervalMs ?? 0
  if (frameIntervalMs <= 0) return []
  const out: ReplaySoundEvent[] = []
  for (const track of doc.tracks) {
    const xuid = trackIdentity(track)
    if (!xuid) continue
    const stances = doc.stances.filter((s) => s.slot === track.slot)
    const timed = footstepTimedEvents({ points: track.points, stances, frameIntervalMs, xuid, surface })
    if (timed.length > 0) out.push(...footstepReplayEvents(manifest, surface, timed, followed))
  }
  return out.sort((a, b) => a.ms - b.ms)
}
