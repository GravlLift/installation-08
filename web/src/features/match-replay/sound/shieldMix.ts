/**
 * shieldMix.ts — THE FOLLOWED SPARTAN'S SHIELD ALARMS in the out-of-real-time export: the SAME
 * pure logic as the page (`shieldSound.ts` says what and when, `shieldSoundPlayer.ts` plays it
 * on a bus), pre-computed in pure segments and placed in advance in the mix's
 * `OfflineAudioContext` — the doctrine of `vehicleEngineMix.ts` for the bar's sounds.
 *
 * WHAT CHANGES WITH RESPECT TO REAL TIME, AND WHY:
 *  - everything is PRE-COMPUTED per life span of the exported range: offline there is no cursor
 *    to follow — each source knows its moment, its loop offset and its cuts as of the planning;
 *  - a loop (the low or depleted beep) sounds over its whole state interval, entered at the beat
 *    the interval's start gives (`loopOffsetS`, the same rule as the page's seek), and stopped
 *    at the interval's end by the page's ramp (`VOLUME_RAMP_S`) — on a state change, on a death,
 *    on the bound;
 *  - the one-shots (break, recharge start + layer + rise, full + layer) are the cues of
 *    `shieldCuesBetween` over the span, the rise picked by `pickRechargeRise` with the same
 *    refill length, and a cut cue (rechargeEnd, full, a death) stops the in-flight rise with the
 *    page's own stop action (`SHIELD_RISE_CUT_S` linear fade).
 *
 * THE GAIN IS THE PAGE'S: each source at 1 under the shield bus (`SHIELD_BUS_GAIN`, the page's
 * own level). Like the engines, the shield is a SOUND EFFECT and counts in no voice ceiling.
 */
import { SHIELD_BUS_GAIN, SHIELD_RISE_CUT_S } from './shieldSoundPlayer'
import { VOLUME_RAMP_S } from './replayAudio'
import {
  loopOffsetS,
  pickRechargeRise,
  shieldCuesBetween,
  shieldLoopAt,
  SHIELD_SOUND,
  type ShieldCue,
  type ShieldSoundReading,
} from './shieldSound'
import type { ShieldHudTrack } from '../model/shieldHud'
import type { MixBus, MixSource, TimedPlacement } from './mixRender'
import { shiftedTime } from './mixTime'

/** A shield source placed on the axis of the CLIP (seconds). */
export interface ShieldSegment {
  stem: string
  /** Start on the axis of the clip. Can be negative by less than a frame: bounded at render. */
  atS: number
  loop: boolean
  /** Where in the file a loop starts: the beat the page's playback would stand at (`loopOffsetS`). */
  offsetS?: number
  /** Forced end; absent = the source plays its whole file (a one-shot). */
  stopS?: number
  /** Output fade to zero ending at `stopS`, LINEAR as in the page (its fades are linear ramps). */
  fadeOutS?: number
}

/** The followed player's shield at the export: the page's reader and the film's frame time. */
export interface ShieldMixSource {
  reader: (frame: number) => ShieldSoundReading | null
  frameMs: number
}

const LOOP_STEM: Record<'low' | 'broken', string> = {
  low: SHIELD_SOUND.lowLoop,
  broken: SHIELD_SOUND.brokenLoop,
}

/**
 * planShieldSegments — the segments of ONE followed player, bounded to the exported range.
 *
 * The reader's frames inside the range are grouped into SPANS of one life (a death or a life
 * change breaks a span, as the page's `stopAll` breaks the playback). `durOf` returns the
 * decoded duration of a stem, or `null` if the file is absent — the concerned segment skips,
 * clean silence like everywhere.
 */
export function planShieldSegments(
  source: ShieldMixSource,
  bounds: { startMs: number; endMs: number },
  durOf: (stem: string) => number | null,
): ShieldSegment[] {
  const { reader, frameMs } = source
  const rel = (ms: number) => (ms - bounds.startMs) / 1000
  const out: ShieldSegment[] = []
  const from = Math.floor(bounds.startMs / frameMs)
  const to = Math.ceil(bounds.endMs / frameMs)
  let i = from
  while (i < to) {
    const r = reader(i)
    if (!r) {
      i += 1
      continue
    }
    let j = i + 1
    while (j < to) {
      const next = reader(j)
      if (!next || next.life !== r.life) break
      j += 1
    }
    out.push(...spanSegments(r.track, i, j, rel, frameMs, durOf))
    i = j
  }
  return out.sort((a, b) => a.atS - b.atS)
}

/**
 * The segments of one life's span of frames [i, j): the loops of its state intervals, the
 * one-shots of its cues in order, and the in-flight rise cut at the span's end — the page's
 * `stopAll` of a death or of the bound, with its ramp.
 */
function spanSegments(
  track: ShieldHudTrack,
  i: number,
  j: number,
  rel: (ms: number) => number,
  frameMs: number,
  durOf: (stem: string) => number | null,
): ShieldSegment[] {
  const out: ShieldSegment[] = []
  // THE LOOPS: state intervals inside [i, j), delimited by the bar's transitions.
  const tr = track.transitions
  let prev = i
  for (const t of tr) {
    if (t.frame <= i) continue
    if (t.frame >= j) break
    out.push(...loopInterval(track, prev, t.frame, rel, frameMs, durOf))
    prev = t.frame
  }
  out.push(...loopInterval(track, prev, j, rel, frameMs, durOf))
  // THE ONE-SHOTS: the cues the span crosses, in order. `rise` is what a cut cue must stop
  // (the page's stop action touches only the rise); `shots` end on their own (their voices
  // free themselves in live) and are cut only by a death, as the page's stopAll does.
  let rise: ShieldSegment[] = []
  const shots: ShieldSegment[] = []
  const cutRise = (stopS: number, fadeS: number) => {
    for (const s of rise) {
      s.stopS = stopS
      s.fadeOutS = fadeS
    }
    rise = []
  }
  for (const cue of shieldCuesBetween(track, i, j - 1)) {
    const atS = rel(cue.frame * frameMs)
    if (cue.kind !== 'break') cutRise(atS + SHIELD_RISE_CUT_S, SHIELD_RISE_CUT_S)
    const { shots: cueShots, rise: cueRise } = cueSources(cue, atS, durOf)
    for (const s of cueShots) {
      out.push(s)
      shots.push(s)
    }
    if (cueRise) {
      out.push(cueRise)
      rise = [cueRise]
    }
  }
  // THE SPAN'S END cuts what is still in flight with the page's stopAll ramp: a death, the
  // bound — a loop of the same span ends on the same ramp at its own interval's end.
  for (const s of [...rise, ...shots]) {
    s.stopS = rel(j * frameMs)
    s.fadeOutS = VOLUME_RAMP_S
  }
  return out
}

/** The one-shots of a cue at clip time `atS` and, for a recharge, its picked rise: fresh and unplaced. */
function cueSources(
  cue: ShieldCue,
  atS: number,
  durOf: (stem: string) => number | null,
): { shots: ShieldSegment[]; rise?: ShieldSegment } {
  const oneShot = (stem: string): ShieldSegment => ({ stem, atS, loop: false })
  switch (cue.kind) {
    case 'break':
      return { shots: [oneShot(SHIELD_SOUND.break)] }
    case 'recharge': {
      // THE RISE PICK, the page's rule: the rise whose sounding length matches the refill.
      const durationsMs = SHIELD_SOUND.rises.map((s) => {
        const d = durOf(s)
        return d === null ? undefined : d * 1000
      })
      const pick = pickRechargeRise(cue.fillMs, durationsMs)
      return {
        shots: [oneShot(SHIELD_SOUND.rechargeStart), oneShot(SHIELD_SOUND.rechargeLayer)],
        ...(pick >= 0 ? { rise: oneShot(SHIELD_SOUND.rises[pick]) } : {}),
      }
    }
    case 'rechargeEnd':
      return { shots: [] }
    case 'full':
      return { shots: [oneShot(SHIELD_SOUND.full), oneShot(SHIELD_SOUND.fullLayer)] }
  }
}

/** The loop of a state interval [s, e) of frames, entered at the page's beat and stopped on the ramp. */
function loopInterval(
  track: ShieldHudTrack,
  s: number,
  e: number,
  rel: (ms: number) => number,
  frameMs: number,
  durOf: (stem: string) => number | null,
): ShieldSegment[] {
  const want = shieldLoopAt(track, s)
  if (!want) return []
  const stem = LOOP_STEM[want.loop]
  const durS = durOf(stem)
  if (durS === null) return []
  return [
    {
      stem,
      atS: rel(s * frameMs),
      loop: true,
      offsetS: loopOffsetS((s - want.since) * frameMs, durS),
      stopS: rel(e * frameMs),
      fadeOutS: VOLUME_RAMP_S,
    },
  ]
}

/**
 * shieldTailSeconds — what the shield OVERFLOWS after the bound of the clip: a one-shot that
 * goes out near the end (a break at the last frame overflows its whole file). Same role as
 * `engineTailSeconds`.
 */
export function shieldTailSeconds(
  segments: readonly ShieldSegment[],
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

/** The shield bus (`SHIELD_BUS_GAIN`, the page's level). */
const SHIELD_BUS: MixBus = { id: 'shield', gain: SHIELD_BUS_GAIN }

/**
 * shieldSegmentSources — the segments as context-free sources of the mix, behind the shield bus.
 * Both renders consume them: the just-in-time one (`shieldSegmentPlacements`) and the grouped one
 * of the browsers without `suspend` (`mixRender.renderGrouped`).
 */
export function shieldSegmentSources(
  segments: readonly ShieldSegment[],
  buffers: ReadonlyMap<string, AudioBuffer | null>,
): MixSource[] {
  const out: MixSource[] = []
  for (const s of segments) {
    const buf = buffers.get(s.stem)
    if (!buf) continue
    const at = Math.max(s.atS, 0)
    // A loop is always bounded by the plan (its interval's end); a one-shot plays its whole file.
    const endS = s.stopS !== undefined ? Math.max(s.stopS, at) : at + buf.duration
    out.push({
      startS: at,
      endS,
      bus: SHIELD_BUS,
      wire: (ctx, destination, originS) => placeShieldSegment(ctx, destination, s, buf, originS),
    })
  }
  return out
}

/**
 * shieldSegmentPlacements — the segments as placements for the just-in-time render
 * (`mixRender.renderScheduled`), behind the shield bus. The bus is the only node placed up front.
 */
export function shieldSegmentPlacements(
  ctx: BaseAudioContext,
  destination: AudioNode,
  segments: readonly ShieldSegment[],
  buffers: ReadonlyMap<string, AudioBuffer | null>,
): TimedPlacement[] {
  if (segments.length === 0) return []
  const bus = ctx.createGain()
  bus.gain.value = SHIELD_BUS.gain
  bus.connect(destination)
  return shieldSegmentSources(segments, buffers).map((s) => ({
    startS: s.startS,
    endS: s.endS,
    place: () => s.wire(ctx, bus, 0),
  }))
}

/**
 * Wires one segment with its linear fade; returns its gain, the node on the bus. `originS` is the
 * clip moment the context's time 0 stands for (0 for the whole-track render); every time is
 * computed on the clip axis, then moved into the context (`mixTime.shiftedTime`).
 */
function placeShieldSegment(
  ctx: BaseAudioContext,
  bus: AudioNode,
  s: ShieldSegment,
  buf: AudioBuffer,
  originS: number,
): AudioNode {
  const shift = (t: number) => shiftedTime(t, originS, ctx.sampleRate)
  const at = Math.max(s.atS, 0)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(1, shift(at))
  if (s.stopS !== undefined && s.fadeOutS) {
    gain.gain.setValueAtTime(1, shift(Math.max(s.stopS - s.fadeOutS, at)))
    gain.gain.linearRampToValueAtTime(0, shift(Math.max(s.stopS, at)))
  }
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.loop = s.loop
  src.connect(gain)
  gain.connect(bus)
  if (s.offsetS !== undefined && s.offsetS > 0 && buf.duration > 0) src.start(shift(at), s.offsetS % buf.duration)
  else src.start(shift(at))
  if (s.stopS !== undefined) src.stop(shift(Math.max(s.stopS, at)))
  return gain
}
