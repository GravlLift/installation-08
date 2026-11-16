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
import { footStems, movementStems, type FootstepManifest } from './footstepManifest'
import type { ReplaySoundEvent } from './replaySoundVariants'

/** The gaits a ground step takes on. */
export type FootstepGait = 'walk' | 'run' | 'sprint'

/** One timed foot sound, before the take is drawn. */
export interface FootstepTimedEvent {
  timeMs: number
  kind: 'step' | 'slide' | 'land' | 'jump'
  action: string
  xuid: string
  position: { x: number; y: number }
}

/** What the pure function reads for one player. */
export interface FootstepInput {
  points: ReadonlyArray<{ t: number; x: number; y: number; z?: number }>
  stances: ReadonlyArray<{ kind: string; t0: number; t1: number }>
  frameIntervalMs: number
  xuid: string
  surface: string
}

// -- SPEED THRESHOLDS (m/s). ESTIMATED: the film publishes a speed, not a gait; these split the
//    gaits where the cadence reads right at typical Spartan speeds. --
const RUN_MIN_SPEED = 3
const SPRINT_MIN_SPEED = 5
// Below this horizontal speed a step is not heard (a shuffle, a slide in place). ESTIMATED.
const MIN_STEP_SPEED = 0.5

// -- STRIDE (m) BETWEEN TWO FOOT STEPS of a gait. ESTIMATED: the film gives the position, not the
//    foot fall rate; a stride distance is the one quantity that turns a speed into a cadence, and
//    these read as a natural stride per gait. --
const STRIDE: Record<FootstepGait, number> = { walk: 0.8, run: 1.1, sprint: 1.4 }
// A slide foot-scrape every this distance (m). ESTIMATED, same reason as the strides.
const SLIDE_STRIDE = 1

// -- LANDING FALL HEIGHTS (m). ESTIMATED: a fall beyond LAND_SOFT plays the soft landing, beyond
//    LAND_HARD the hard one. A track without Z never reaches here, so a landing is only ever
//    detected where the film carries a vertical axis. --
const LAND_SOFT = 0.4
const LAND_HARD = 1.8

// -- THE LEVEL OF THE FOOT STEPS in the mix. A fixed duck, NOT a measurement: it is a placement
//    choice, the footsteps sitting in the effects family a touch under the gunfire. --
export const FOOTSTEP_GAIN_DB = -3

/** gaitOf — the gait of a horizontal ground speed. */
function gaitOf(speed: number): FootstepGait {
  if (speed >= SPRINT_MIN_SPEED) return 'sprint'
  if (speed >= RUN_MIN_SPEED) return 'run'
  return 'walk'
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
        out.push({ timeMs: prev.t * frameIntervalMs, kind: 'jump', action: 'jumpup', xuid, position: { x: prev.x, y: prev.y } })
        inAir = true
        peakZ = p.z ?? null
      } else if (p.z !== undefined && (peakZ === null || p.z > peakZ)) {
        peakZ = p.z
      }
      stepAcc = 0
      slideAcc = 0
      sliding = false
      continue
    }

    if (inAir) {
      // Landing: judge the fall by the height gained in the air and the ground regained.
      if (peakZ !== null && p.z !== undefined) {
        const fall = peakZ - p.z
        if (fall > LAND_HARD) out.push({ timeMs, kind: 'land', action: 'landhard', xuid, position: { x: p.x, y: p.y } })
        else if (fall > LAND_SOFT) out.push({ timeMs, kind: 'land', action: 'land', xuid, position: { x: p.x, y: p.y } })
      }
      inAir = false
      peakZ = null
      stepAcc = 0
      slideAcc = 0
    }

    if (slide) {
      if (!sliding) {
        // The slide begins: the slide_into, then the surface slide scrape per distance.
        out.push({ timeMs, kind: 'slide', action: 'slide_into', xuid, position: { x: p.x, y: p.y } })
        sliding = true
        slideAcc = 0
      }
      slideAcc += dist
      if (slideAcc >= SLIDE_STRIDE) {
        slideAcc -= SLIDE_STRIDE
        out.push({ timeMs, kind: 'slide', action: 'slide', xuid, position: { x: p.x, y: p.y } })
      }
    } else {
      sliding = false
      if (speed >= MIN_STEP_SPEED) {
        const gait = gaitOf(speed)
        stepAcc += dist
        if (stepAcc >= STRIDE[gait]) {
          stepAcc -= STRIDE[gait]
          out.push({ timeMs, kind: 'step', action: gait, xuid, position: { x: p.x, y: p.y } })
        }
      } else {
        stepAcc = 0
      }
    }
  }
  return out
}

/** stemsFor — the playable stems of a timed event for a surface, or `null` when none were extracted. */
function stemsFor(manifest: FootstepManifest, surface: string, kind: FootstepTimedEvent['kind'], action: string): string[] | null {
  switch (kind) {
    case 'step':
      return footStems(manifest, surface, action)
    case 'slide':
      return action === 'slide_into' ? movementStems(manifest, 'slide_into') : footStems(manifest, surface, 'slide')
    case 'land':
      return movementStems(manifest, action)
    case 'jump':
      return movementStems(manifest, 'jumpup')
  }
}

/** pickFootstem — the take of an event, DETERMINISTIC: seeded by time and xuid, so live and export agree. */
function pickFootstem(e: FootstepTimedEvent, stems: string[]): string {
  if (stems.length <= 1) return stems[0]
  return stems[fnv1a(e.timeMs, e.xuid, e.kind, e.action) % stems.length]
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
 * footstepReplayEvents — the timed events as the track plays them: one take drawn, a fixed level
 * gain, and a place for every player but the followed one (whose own footsteps are his: full and
 * centered, no place).
 */
export function footstepReplayEvents(
  manifest: FootstepManifest,
  surface: string,
  events: readonly FootstepTimedEvent[],
  followed: string | null,
): ReplaySoundEvent[] {
  const out: ReplaySoundEvent[] = []
  for (const e of events) {
    const stems = stemsFor(manifest, surface, e.kind, e.action)
    if (!stems) continue
    const ev: ReplaySoundEvent = { ms: e.timeMs, stem: pickFootstem(e, stems), gainDb: FOOTSTEP_GAIN_DB }
    if (followed !== null && e.xuid !== followed) ev.at = e.position
    out.push(ev)
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
