// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * vehicleEngineSound.ts — THE SOUND PLAN OF THE VEHICLE ENGINES: which families sound,
 * when an engine runs, and how its clips chain. PURE LOGIC, without Web Audio nor
 * React — the real-time playback lives in `vehicleEnginePlayer.ts`, the export mixing in
 * `vehicleEngineMix.ts`, the two consume THIS plan.
 *
 * # WHY A SEPARATE MODULE, AND NOT `replaySound.ts`
 *
 * The track of the replay is a sequence of one-shot EVENTS (a shot, a kill, a jingle) that the
 * cursor triggers on the way. An engine is not an event: it is a CONTINUOUS STATE —
 * it starts, loops as long as the vehicle is occupied, and stops. The event player
 * (`ReplayAudioPlayer.play`, held envelope + fade) does not know how to hold a state, and teaching
 * it would break its only rule ("the duration played is that of the file").
 *
 * # THE CONTRACT OF THE BANK (HANDOFF SFX_vehicles, 2026-09-04 — NON-NEGOTIABLE)
 *
 *   enter -> loop x N -> exit
 *
 *  - The LOOPS loop without a click: the fade is IN THE FILE (`loop = true` on the
 *    source, nothing to add at the loop point).
 *  - The JUNCTIONS between clips are done by a 150 ms crossfade AT CONSTANT POWER
 *    (sin/cos, never linear — a linear fade between decorrelated signals digs the energy
 *    by exactly 3 dB at the junction, measured on the Warthog and the Chopper during the production).
 *  - THE ENDS ARE ENGRAVED: each `exit` ends at zero by itself. NO output envelope
 *    to add — that is the exact opposite of the rule of the event sounds.
 *
 * # THE ENGINE ONLY SOUNDS IF THE VEHICLE REALLY MOVES (user decision of 2026-11-02)
 *
 * A vehicle occupied but stationary is SILENT: no idle clip ("we're not going to
 * put it in, it simplifies things"). The episode starts at the first real movement and ends at the last;
 * a stop shorter than `ENGINE_STOP_MERGE_MS` changes nothing (the run continues), a stop
 * longer turns off the loop by a fade (`ENGINE_STOP_FADE_S`) and rekindles it by a fade
 * (`ENGINE_RESTART_FADE_S`), without replaying `enter` nor `exit` (2 to 7 s each: replaying them
 * at each stop would narrate an engine that is cut and restarted).
 *
 * # THE BOOST IS NOT WIRED, AND THAT IS A MEASUREMENT, NOT A FORGET (first CI of the work site: 2026-09-05)
 *
 * Framing decision of 2026-09-04: wire the boost ONLY for ghost and chopper
 * (wraith_boost is REFUTED by the user — the clip is not a boost; banshee has no
 * clip), with a numerical gate written BEFORE the measurement: a boost = sustained speed
 * > k x clean cruise regime of the vehicle for >= N frames, and a vehicle WITHOUT boost
 * (mongoose, warthog) must produce NO detection.
 *
 * MEASUREMENT (2026-09-04, demo artifacts 0d76e8f1 and fccc61cd, speed = distance between
 * samples / dt, cruise = median of the speeds in motion during the occupation):
 *  - k = 1.3, N = 15 frames (1.5 s): the WITNESS mongoose detects (1.5 s on 0d76e8f1,
 *    2.7 s on fccc61cd) — false positives, gate invalid;
 *  - k = 1.5: clean witness, but the ONLY ghost occupied of the corpus (slot 777) detects
 *    NOTHING either (cruise 8.72, p90 9.10 — the trajectory sampled at 10 Hz smooths
 *    the boost under the noise of driving).
 * No (k, N) couple therefore separates a boost from a slope descent on these data: the
 * detection by speed IS NOT RELIABLE, and the framing (§4) then prescribes to deliver WITHOUT
 * boost. The clips `ghost_boost`/`chopper_boost` stay in the source bank, not copied —
 * a file delivered that nothing plays would be a dead asset (assets guardrail). Condition of
 * resume: a measurement of the boost that does not go through the speed (a field of the film, or a
 * finer sampling).
 */
import type { ReplayVehicleTrackReady } from '../../../lib/replay/replayNormalize'
import { vehicleIsDecor } from '../model/vehiclesLayer'

/**
 * THE ENGINE BUS IS AT 0.85 x THE MASTER (user decision of 2026-09-04: "the engines
 * must not be at the level of the other sounds"). A single gain node, placed between the
 * engine sources and the master: the engines therefore follow the set volume, the distance chain
 * and the recording tap like everyone, 15% in restraint.
 */
export const VEHICLE_ENGINE_BUS_GAIN = 0.85

/** Crossfade at the junctions between clips, in seconds (contract of the bank, §2). */
export const ENGINE_CROSSFADE_S = 0.15

/**
 * Emergency stop ramp, in seconds: pause, sound cut, unmount. It is NOT a
 * musical output envelope (forbidden by the contract) — it is the minimal anti-click of a
 * stop that the timeline did not narrate, same duration as `VOLUME_RAMP_S` of the player.
 */
export const ENGINE_STOP_RAMP_S = 0.02

/**
 * An OCCUPATION HOLE shorter than this does not cut the engine (framing decision n° 1):
 * the episodes of the same vehicle MERGE. A driver who gets down for two seconds to
 * pick up a flag does not turn off the engine to the ear of the spectator.
 */
export const ENGINE_RIDE_GAP_MERGE_MS = 2_000

/**
 * Above this horizontal speed (units of the film per second, distance between two
 * samples / dt), the vehicle MOVES. Measurement on 500 replays (2026-11-02, drivers of
 * land vehicles): at the stop the speed stays under 0.05; the cruise goes from 3 to 12. The
 * threshold of 1 keeps out the drift of a placed or pushed vehicle without counting it as a movement.
 */
export const VEHICLE_MOVE_SPEED = 1

/**
 * A stop shorter than this (ms) does not cut the loop: a driver who brakes then
 * restarts does not make the engine blink. Longer, the loop fades out.
 */
export const ENGINE_STOP_MERGE_MS = 1_500

/**
 * A movement (after the merging of the short stops) shorter than this (ms) lights nothing: a
 * vehicle bumped by an explosion did not start.
 */
export const ENGINE_MOVE_MIN_MS = 500

/** Fade-out of the loop when the vehicle stops, in seconds. */
export const ENGINE_STOP_FADE_S = 0.6

/** Fade-in of the loop when the vehicle restarts, in seconds. */
export const ENGINE_RESTART_FADE_S = 0.3

/** The clips of a family. */
export interface EngineStems {
  enter: string
  loop: string
  exit: string
}

/**
 * THE FAMILY -> STEMS TABLE, aligned on `family` of the document (`VehicleTrack.family`) and on
 * the files `static/sounds/halo_infinite/vehicle_<family>_<clip>.ogg` (guardrail
 * `replaySoundAssets.guard.test.ts`: manifest and folder are the same list). A family
 * absent from this table (turrets, unresolved chassis) is a CLEAN SILENCE.
 *
 * THE FALCON SOUNDS SINCE 2026-09-24: it came out of the DECOR families
 * (`NON_PLAYABLE_FAMILIES`, user decision "the Falcon it depends"), and an occupied Falcon
 * plays its engine like any vehicle. A Falcon without an occupant has no engine, whether it is
 * parked, a map decor (`vehicleIsScenery`, lot M7) or hovering as a Behemoth decor.
 */
export const VEHICLE_ENGINE_STEMS: Readonly<Record<string, EngineStems>> = {
  warthog: { enter: 'vehicle_warthog_enter', loop: 'vehicle_warthog_loop', exit: 'vehicle_warthog_exit' },
  scorpion: { enter: 'vehicle_scorpion_enter', loop: 'vehicle_scorpion_loop', exit: 'vehicle_scorpion_exit' },
  mongoose: { enter: 'vehicle_mongoose_enter', loop: 'vehicle_mongoose_loop', exit: 'vehicle_mongoose_exit' },
  chopper: { enter: 'vehicle_chopper_enter', loop: 'vehicle_chopper_loop', exit: 'vehicle_chopper_exit' },
  falcon: { enter: 'vehicle_falcon_enter', loop: 'vehicle_falcon_loop', exit: 'vehicle_falcon_exit' },
  banshee: { enter: 'vehicle_banshee_enter', loop: 'vehicle_banshee_loop', exit: 'vehicle_banshee_exit' },
  wraith: { enter: 'vehicle_wraith_enter', loop: 'vehicle_wraith_loop', exit: 'vehicle_wraith_exit' },
  wasp: { enter: 'vehicle_wasp_enter', loop: 'vehicle_wasp_loop', exit: 'vehicle_wasp_exit' },
  ghost: { enter: 'vehicle_ghost_enter', loop: 'vehicle_ghost_loop', exit: 'vehicle_ghost_exit' },
}

/** All the engine stems, for the preloading and the assets guardrail. */
export function allEngineStems(): string[] {
  return Object.values(VEHICLE_ENGINE_STEMS).flatMap((s) => [s.enter, s.loop, s.exit])
}

/** A closed period on the axis of the replay, in milliseconds. */
export interface EngineSpan {
  t0Ms: number
  t1Ms: number
}

/**
 * An engine episode: from the first movement (`t0Ms`, `enter`) to the last (`t1Ms`, `exit`),
 * silent during its `arrets`.
 */
export interface EngineEpisode extends EngineSpan {
  /** The long stops, strictly interior to the episode, sorted: the loop is silent there. */
  arrets: EngineSpan[]
}

/** The engine plan of ONE vehicle: its family (key of `VEHICLE_ENGINE_STEMS`) and its episodes. */
export interface EnginePlan {
  family: string
  episodes: EngineEpisode[]
}

/**
 * mergeRideSpans — THE UNION of the occupation episodes (framing decision n° 1): the rides
 * can OVERLAP (several passengers) and follow closely (change of driver);
 * the engine, it, sounds as one piece. A hole < `gapMergeMs` does not cut it.
 */
export function mergeRideSpans(
  rides: readonly { t0: number; t1: number }[],
  frameMs: number,
  gapMergeMs = ENGINE_RIDE_GAP_MERGE_MS,
): EngineSpan[] {
  const sorted = rides
    .filter((r) => r.t1 > r.t0)
    .map((r) => ({ t0Ms: r.t0 * frameMs, t1Ms: r.t1 * frameMs }))
    .sort((a, b) => a.t0Ms - b.t0Ms)
  const out: EngineSpan[] = []
  for (const s of sorted) {
    const last = out[out.length - 1]
    if (last && s.t0Ms - last.t1Ms < gapMergeMs) {
      last.t1Ms = Math.max(last.t1Ms, s.t1Ms)
    } else {
      out.push({ ...s })
    }
  }
  return out
}

/**
 * movingSpansOf — the periods where the vehicle REALLY MOVES, bounded to `span`, sorted.
 *
 * The speed is derived from the trajectory samples (horizontal distance / dt — the only
 * kinematics that the film publishes): an interval between two samples counts if it exceeds
 * `VEHICLE_MOVE_SPEED`. The intervals separated by less than `ENGINE_STOP_MERGE_MS` are merged
 * (a short stop cuts nothing); a merged movement shorter than `ENGINE_MOVE_MIN_MS` is
 * set aside. Without a sample that moves, the list is empty: a stationary vehicle stays silent.
 */
export function movingSpansOf(
  samples: readonly { t: number; x: number; y: number }[],
  span: EngineSpan,
  frameMs: number,
): EngineSpan[] {
  const merged: EngineSpan[] = []
  for (let i = 1; i < samples.length; i++) {
    const t0Ms = Math.max(samples[i - 1].t * frameMs, span.t0Ms)
    const t1Ms = Math.min(samples[i].t * frameMs, span.t1Ms)
    if (t1Ms <= t0Ms) continue
    const dtS = ((samples[i].t - samples[i - 1].t) * frameMs) / 1000
    const v = Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y) / dtS
    if (v <= VEHICLE_MOVE_SPEED) continue
    const last = merged[merged.length - 1]
    if (last && t0Ms - last.t1Ms < ENGINE_STOP_MERGE_MS) last.t1Ms = Math.max(last.t1Ms, t1Ms)
    else merged.push({ t0Ms, t1Ms })
  }
  return merged.filter((s) => s.t1Ms - s.t0Ms >= ENGINE_MOVE_MIN_MS)
}

/**
 * episodeOfMoves — the engine episode of an occupation: from the first movement to the last, the
 * holes between movements becoming stops. `null` if the vehicle did not move.
 */
export function episodeOfMoves(moves: readonly EngineSpan[]): EngineEpisode | null {
  if (moves.length === 0) return null
  const arrets: EngineSpan[] = []
  for (let i = 1; i < moves.length; i++) arrets.push({ t0Ms: moves[i - 1].t1Ms, t1Ms: moves[i].t0Ms })
  return { t0Ms: moves[0].t0Ms, t1Ms: moves[moves.length - 1].t1Ms, arrets }
}

/**
 * planVehicleEngines — THE COMPLETE PLAN of a document: a plan per vehicle that sounds.
 *
 * FOUR REFUSALS, in order: the DECOR (never a sound — framing decision n° 1, same
 * set as the layer), the family WITHOUT BANK (clean silence — n° 2), the vehicle
 * NEVER OCCUPIED (an engine only runs during the union of the rides), and the occupation WITHOUT
 * MOVEMENT (a stationary vehicle stays silent, user decision of 2026-11-02).
 */
export function planVehicleEngines(
  vehicles: readonly ReplayVehicleTrackReady[],
  frameMs: number,
): EnginePlan[] {
  const out: EnginePlan[] = []
  for (const v of vehicles) {
    if (!v.family || vehicleIsDecor(v.family)) continue
    if (!VEHICLE_ENGINE_STEMS[v.family]) continue
    const episodes: EngineEpisode[] = []
    for (const span of mergeRideSpans(v.rides, frameMs)) {
      const ep = episodeOfMoves(movingSpansOf(v.samples, span, frameMs))
      if (ep) episodes.push(ep)
    }
    if (episodes.length > 0) out.push({ family: v.family, episodes })
  }
  return out
}

/** What an engine MUST play at a given moment, outside transitions (the player places those). */
export type EnginePhase = 'loop' | 'arret' | null

/** enginePhaseAt — the nominal state of an episode at `ms`: running, stop (silence), or nothing. */
export function enginePhaseAt(episode: EngineEpisode, ms: number): EnginePhase {
  if (ms < episode.t0Ms || ms >= episode.t1Ms) return null
  for (const s of episode.arrets) {
    if (ms >= s.t0Ms && ms < s.t1Ms) return 'arret'
  }
  return 'loop'
}

/**
 * equalPowerCurves — the two ramps of a crossfade AT CONSTANT POWER (sin/cos).
 *
 * It is THE trap documented by the bank (§5 of the HANDOFF, two iterations lost): a fade
 * linear between two decorrelated signals digs the energy by 3 dB at the junction. sin²+cos² = 1 —
 * the total energy stays flat over the whole junction. The curves serve
 * `setValueCurveAtTime` on the real-time side as on the export side.
 */
export function equalPowerCurves(steps = 32): { fadeIn: Float32Array; fadeOut: Float32Array } {
  const fadeIn = new Float32Array(steps)
  const fadeOut = new Float32Array(steps)
  for (let i = 0; i < steps; i++) {
    const phi = (i / (steps - 1)) * (Math.PI / 2)
    fadeIn[i] = Math.sin(phi)
    fadeOut[i] = Math.cos(phi)
  }
  return { fadeIn, fadeOut }
}
