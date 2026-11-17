// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * vehicleEngineMix.ts — THE ENGINES IN THE OUT-OF-REAL-TIME EXPORT: the SAME logic as the
 * page (same bounds of merged episodes, same 150 ms crossfades at constant power, same bus at
 * 0.85), placed in advance in the `OfflineAudioContext` of the mixing.
 *
 * THE PLAN IS THAT OF THE PAGE (`vehicleEngineSound.planVehicleEngines`, transmitted by
 * `useReplaySound.exportTrack`): the clip cannot invent an engine or miss one —
 * exactly the doctrine of `replayAudioMix.ts` for the event track.
 *
 * WHAT CHANGES WITH RESPECT TO REAL TIME, AND WHY:
 *  - everything is PRE-COMPUTED in PURE SEGMENTS (`planEngineSegments`, tested): offline, there
 *    is no cursor to follow — each source knows its moment, its loop and its
 *    fades as of the planning;
 *  - an episode CUT by the start bound resumes directly on `loop` (same rule as
 *    the seek: never a re-enter for a start that the clip does not show);
 *  - an episode CUT by the end bound is turned off by the junction fade (150 ms) that
 *    ends EXACTLY on the bound — no added envelope on an `exit`, which only plays here if
 *    the exit is IN the clip (its ends are engraved, it then overflows in the tail);
 *  - a LONG STOP places no source: the loop that precedes it ends with the
 *    fade-out (`ENGINE_STOP_FADE_S`), the one that follows it begins with the resume fade
 *    (`ENGINE_RESTART_FADE_S`) — the same as the page.
 */
import {
  ENGINE_CROSSFADE_S,
  ENGINE_RESTART_FADE_S,
  ENGINE_STOP_FADE_S,
  equalPowerCurves,
  VEHICLE_ENGINE_BUS_GAIN,
  VEHICLE_ENGINE_STEMS,
  type EngineEpisode,
  type EnginePlan,
  type EngineSpan,
} from './vehicleEngineSound'
import type { MixBus, MixSource, TimedPlacement } from './mixRender'
import { shiftedTime } from './mixTime'

/** An engine source placed on the axis of the CLIP (seconds). */
export interface EngineSegment {
  stem: string
  /** Start on the axis of the clip. Can be negative by less than a fade: bounded at render. */
  atS: number
  loop: boolean
  /** Forced end (loops and enter); absent = the source plays its whole file (exit). */
  stopS?: number
  /** Input fade at constant power, from `atS`. */
  fadeInS?: number
  /** Output fade at constant power, ending at `stopS`. */
  fadeOutS?: number
}

/** The RUNNING periods of an episode bounded to [a, b], in order (the stops removed). */
function courseSpans(ep: EngineEpisode, a: number, b: number): EngineSpan[] {
  const out: EngineSpan[] = []
  let cursor = a
  for (const s of ep.arrets) {
    const i0 = Math.max(s.t0Ms, a)
    const i1 = Math.min(s.t1Ms, b)
    if (i1 <= i0) continue
    if (i0 > cursor) out.push({ t0Ms: cursor, t1Ms: i0 })
    cursor = i1
  }
  if (cursor < b) out.push({ t0Ms: cursor, t1Ms: b })
  return out
}

/**
 * planEngineSegments — the segments of ONE vehicle plan, bounded to the exported range.
 *
 * `durOf` returns the decoded duration of a stem (the enter needs it to place its junction), or
 * `null` if the file is absent — the concerned segment skips, clean silence like everywhere.
 */
export function planEngineSegments(
  plan: EnginePlan,
  bounds: { startMs: number; endMs: number },
  durOf: (stem: string) => number | null,
): EngineSegment[] {
  const stems = VEHICLE_ENGINE_STEMS[plan.family]
  if (!stems) return []
  const out: EngineSegment[] = []
  const rel = (ms: number) => (ms - bounds.startMs) / 1000
  for (const ep of plan.episodes) {
    const a = Math.max(ep.t0Ms, bounds.startMs)
    const b = Math.min(ep.t1Ms, bounds.endMs)
    if (b <= a) continue
    const entered = ep.t0Ms >= bounds.startMs
    const enterDur = entered ? durOf(stems.enter) : null
    // The held voice starts at the junction of the enter when it plays, at the edge of the clip otherwise.
    let heldStart = rel(a)
    let heldFadeIn = 0
    if (enterDur !== null && enterDur > 0) {
      const fadeAt = rel(a) + Math.max(enterDur - ENGINE_CROSSFADE_S, 0)
      out.push({
        stem: stems.enter,
        atS: rel(a),
        loop: false,
        stopS: fadeAt + ENGINE_CROSSFADE_S,
        fadeOutS: ENGINE_CROSSFADE_S,
      })
      heldStart = fadeAt
      heldFadeIn = ENGINE_CROSSFADE_S
    }
    const exits = ep.t1Ms <= bounds.endMs
    const courses = durOf(stems.loop) === null ? [] : courseSpans(ep, a, b)
    for (let i = 0; i < courses.length; i++) {
      const c = courses[i]
      // The course that opens the episode takes the junction of the enter (or the edge of the clip); the
      // following ones RESTART from a stop.
      const opens = c.t0Ms === a
      const atS = opens ? heldStart : rel(c.t0Ms)
      const fadeInS = opens ? heldFadeIn : ENGINE_RESTART_FADE_S
      // The end of a course: toward `exit` (crossfade), toward a stop (fade-out),
      // or cut off by the edge of the clip.
      const closes = c.t1Ms === b
      const fadeOutS = closes ? ENGINE_CROSSFADE_S : ENGINE_STOP_FADE_S
      out.push({
        stem: stems.loop,
        atS,
        loop: true,
        stopS: closes && !exits ? rel(b) : rel(c.t1Ms) + fadeOutS,
        fadeInS,
        fadeOutS,
      })
    }
    if (exits && durOf(stems.exit) !== null) {
      out.push({ stem: stems.exit, atS: rel(ep.t1Ms), loop: false, fadeInS: ENGINE_CROSSFADE_S })
    }
  }
  return out
}

/** All the stems that the segments of a set of plans may need (decoding). */
export function engineStemsOf(plans: readonly EnginePlan[]): string[] {
  const out = new Set<string>()
  for (const p of plans) {
    const stems = VEHICLE_ENGINE_STEMS[p.family]
    if (!stems) continue
    for (const s of [stems.enter, stems.loop, stems.exit]) out.add(s)
  }
  return [...out]
}

/**
 * engineTailSeconds — what the engines OVERFLOW after the bound of the clip: the tail of an
 * engraved `exit` that begins near the end. Same role as `tailSeconds` for the events.
 */
export function engineTailSeconds(
  segments: readonly EngineSegment[],
  durOf: (stem: string) => number | null,
  clipDurS: number,
): number {
  let tail = 0
  for (const s of segments) {
    const end = s.stopS ?? s.atS + (durOf(s.stem) ?? 0)
    tail = Math.max(tail, end - clipDurS)
  }
  return Math.max(0, tail)
}

/** The engine bus: 0.85, the same restraint as the page (user decision of 2026-09-04). */
const ENGINE_BUS: MixBus = { id: 'engine', gain: VEHICLE_ENGINE_BUS_GAIN }

/**
 * engineSegmentSources — the segments as context-free sources of the mix, behind the engine bus.
 * Both renders consume them: the just-in-time one (`engineSegmentPlacements`) and the grouped one
 * of the browsers without `suspend` (`mixRender.renderGrouped`).
 */
export function engineSegmentSources(
  segments: readonly EngineSegment[],
  buffers: ReadonlyMap<string, AudioBuffer | null>,
): MixSource[] {
  const curves = equalPowerCurves()
  const out: MixSource[] = []
  for (const s of segments) {
    const buf = buffers.get(s.stem)
    if (!buf) continue
    const at = Math.max(s.atS, 0)
    // A loop without a forced end plays to the end of the track; an exit plays its whole file.
    const endS = s.stopS !== undefined ? Math.max(s.stopS, at) : s.loop ? Infinity : at + buf.duration
    out.push({
      startS: at,
      endS,
      bus: ENGINE_BUS,
      wire: (ctx, destination, originS) => placeEngineSegment(ctx, destination, s, { buf, curves }, originS),
    })
  }
  return out
}

/**
 * engineSegmentPlacements — the segments as placements for the just-in-time render
 * (`mixRender.renderScheduled`), behind the engine bus. The bus is the only node placed up front.
 */
export function engineSegmentPlacements(
  ctx: BaseAudioContext,
  destination: AudioNode,
  segments: readonly EngineSegment[],
  buffers: ReadonlyMap<string, AudioBuffer | null>,
): TimedPlacement[] {
  if (segments.length === 0) return []
  const bus = ctx.createGain()
  bus.gain.value = ENGINE_BUS.gain
  bus.connect(destination)
  return engineSegmentSources(segments, buffers).map((s) => ({
    startS: s.startS,
    endS: s.endS,
    place: () => s.wire(ctx, bus, 0),
  }))
}

/**
 * Wires one segment with its constant-power fades; returns its gain, the node on the bus.
 * `originS` is the clip moment the context's time 0 stands for (0 for the whole-track render):
 * every absolute time is computed on the clip axis first, then moved into the context
 * (`mixTime.shiftedTime`), so the shape lands on the same frames.
 */
function placeEngineSegment(
  ctx: BaseAudioContext,
  bus: AudioNode,
  s: EngineSegment,
  audio: { buf: AudioBuffer; curves: ReturnType<typeof equalPowerCurves> },
  originS: number,
): AudioNode {
  const shift = (t: number) => shiftedTime(t, originS, ctx.sampleRate)
  const at = Math.max(s.atS, 0)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(s.fadeInS ? 0 : 1, shift(at))
  if (s.fadeInS) gain.gain.setValueCurveAtTime(audio.curves.fadeIn, shift(at), s.fadeInS)
  if (s.stopS !== undefined && s.fadeOutS) {
    gain.gain.setValueCurveAtTime(audio.curves.fadeOut, shift(Math.max(s.stopS - s.fadeOutS, at)), s.fadeOutS)
  }
  const src = ctx.createBufferSource()
  src.buffer = audio.buf
  src.loop = s.loop
  src.connect(gain)
  gain.connect(bus)
  src.start(shift(at))
  if (s.stopS !== undefined) src.stop(shift(Math.max(s.stopS, at)))
  return gain
}
