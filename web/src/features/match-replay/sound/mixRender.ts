/**
 * mixRender.ts — THE OFFLINE RENDER of the export's sound track, with the sources placed JUST IN
 * TIME: a step ahead of the render, and released once they have stopped.
 *
 * # WHY NOT EVERY SOURCE AT ONCE
 *
 * An `OfflineAudioContext` pulls every node connected to its graph at every render quantum (128
 * frames), whether its source has started yet or not. Placing a whole match up front therefore
 * costs (number of sounds) x (length of the track): the render of a long range grows with the
 * square of its length, and a full ranked match (about 1,300 sounds over 7 minutes) did not
 * finish one render in four minutes, while the export said "Preparing" and nothing else. Placed
 * just in time, the graph only ever holds the sounds that overlap the current step: the cost is
 * linear in the track, about one second for that same match.
 *
 * # HOW
 *
 * The context SUSPENDS every `MIX_RENDER_STEP_S`. At each stop the sources that start before the
 * next stop are placed, the ones that have stopped are disconnected, the progress is published
 * and the cancellation is read. What is heard does not change: a source is always placed before
 * its start, with the same envelope, and only disconnected after its stop.
 */
import { soundEnvelopeOf } from './replayAudio'
import type { MixedSound } from './replayAudioMix'
import { engineSegmentPlacements, type EngineSegment } from './vehicleEngineMix'
import { shieldSegmentPlacements, type ShieldSegment } from './shieldMix'
import { distanceChain, gainFromDb } from './weaponSoundLogic'

/** Sampling frequency of the mixing. 48 kHz: the native rate of the delivered assets. */
export const MIX_SAMPLE_RATE = 48_000
/** Two channels: the sources are mono, the container and the players expect stereo. */
export const MIX_CHANNELS = 2

/**
 * The step between two suspensions, in seconds. 2 s at 48 kHz is 96,000 frames, a whole number
 * of 128-frame render quanta: each suspension lands exactly on its time, never before a source
 * that was meant to be placed at it.
 */
export const MIX_RENDER_STEP_S = 2

/** What the offline render consumes: the buffers already decoded, by stem. */
export type MixBuffers = ReadonlyMap<string, AudioBuffer | null>

/**
 * A source to place in the render: when it starts and stops on the clip axis (seconds), and the
 * gesture that wires it. `place` returns the node that feeds the shared bus — the one to
 * disconnect once the source has stopped. `endS` may be `Infinity` (a loop that plays to the end).
 */
export interface TimedPlacement {
  startS: number
  endS: number
  place: () => AudioNode
}

/** What a render reports while it runs, and how it learns that it must stop. */
export interface RenderHooks {
  /** The rendered share of the track, 0..1, published at each step. */
  progress?: (fraction: number) => void
  /** Read at each step: `true` stops the render, which then resolves `null`. */
  cancelled?: () => boolean
}

/**
 * placeMixSound wires one kept sound with its envelope: the EXACT transposition of
 * `ReplayAudioPlayer.play()` (hold gain, plateau, linear fade to zero, `playbackRate` when the
 * variation asks for one), at an absolute moment. THE PLACE multiplies the hold gain, and the
 * stereo panner only exists when the placement puts the sound at a side, as in the player.
 *
 * Returns the node connected to `destination` (the panner, or the gain without one).
 */
export function placeMixSound(
  ctx: BaseAudioContext,
  destination: AudioNode,
  s: MixedSound,
  buf: AudioBuffer,
): AudioNode {
  const t0 = s.atMs / 1000
  const { fadeStartS, stopS, loop } = soundEnvelopeOf(buf.duration, s.shape)
  const hold = gainFromDb(s.draw.gainDb) * (s.place?.gain ?? 1)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(hold, t0)
  gain.gain.setValueAtTime(hold, t0 + fadeStartS)
  gain.gain.linearRampToValueAtTime(0, t0 + stopS)
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.loop = loop
  if (s.draw.playbackRate !== 1) src.playbackRate.value = s.draw.playbackRate
  src.connect(gain)
  src.start(t0)
  src.stop(t0 + stopS)
  if (s.place && s.place.pan !== 0) {
    const panner = ctx.createStereoPanner()
    panner.pan.value = s.place.pan
    gain.connect(panner)
    panner.connect(destination)
    return panner
  }
  gain.connect(destination)
  return gain
}

/** The placements of the kept sounds; a sound whose file is absent is a silence, as in live. */
export function soundPlacements(
  ctx: BaseAudioContext,
  destination: AudioNode,
  sounds: readonly MixedSound[],
  buffers: MixBuffers,
): TimedPlacement[] {
  const out: TimedPlacement[] = []
  for (const s of sounds) {
    const buf = buffers.get(s.stem)
    if (!buf) continue
    const startS = s.atMs / 1000
    const endS = startS + soundEnvelopeOf(buf.duration, s.shape).stopS
    out.push({ startS, endS, place: () => placeMixSound(ctx, destination, s, buf) })
  }
  return out
}

/**
 * renderScheduled renders the context with its sources placed just in time (see the header).
 * Resolves the rendered buffer, or `null` when `hooks.cancelled` answered `true` at a step: the
 * suspended context is then left to the garbage collector, never resumed.
 */
export function renderScheduled(
  ctx: OfflineAudioContext,
  items: readonly TimedPlacement[],
  hooks: RenderHooks = {},
): Promise<AudioBuffer | null> {
  const durationS = ctx.length / ctx.sampleRate
  const pending = [...items].sort((a, b) => a.startS - b.startS)
  let next = 0
  let live: { node: AudioNode; endS: number }[] = []
  const placeBefore = (untilS: number) => {
    for (; next < pending.length && pending[next].startS < untilS; next++) {
      live.push({ node: pending[next].place(), endS: pending[next].endS })
    }
  }
  const release = (nowS: number) => {
    live = live.filter((l) => {
      if (l.endS > nowS) return true
      l.node.disconnect()
      return false
    })
  }
  return new Promise((resolve, reject) => {
    const arm = (atS: number) => {
      if (atS >= durationS) return
      ctx.suspend(atS).then(() => {
        if (hooks.cancelled?.()) return resolve(null)
        release(atS)
        placeBefore(atS + MIX_RENDER_STEP_S)
        hooks.progress?.(atS / durationS)
        arm(atS + MIX_RENDER_STEP_S)
        return ctx.resume()
      }).catch(reject)
    }
    placeBefore(MIX_RENDER_STEP_S)
    arm(MIX_RENDER_STEP_S)
    ctx.startRendering().then((buf) => {
      hooks.progress?.(1)
      resolve(buf)
    }, reject)
  })
}

/** What one render mixes: the kept sounds, the engine segments and the shield segments. */
export interface MixJob {
  sounds: readonly MixedSound[]
  engines: readonly EngineSegment[]
  shields: readonly ShieldSegment[]
}

/**
 * renderAudioMix renders one track of the clip in a buffer.
 *
 * THE DURATION IS THAT OF THE CLIP plus the tail, computed once by the caller for all the tracks:
 * a hard cut at the bound would slice an end-of-match fanfare that begins at the last frame.
 *
 * THE DISTANCE CHAIN is the player's recipe (`ReplayAudioPlayer.setDistance`): master ->
 * attenuation -> low-pass -> output. At 0 % `distanceChain` returns `null` and no node is placed.
 */
export function renderAudioMix(
  job: MixJob,
  buffers: MixBuffers,
  durationMs: number,
  level: { volume: number; distancePercent: number },
  hooks: RenderHooks = {},
): Promise<AudioBuffer | null> {
  const frames = Math.max(1, Math.ceil((durationMs / 1000) * MIX_SAMPLE_RATE))
  const ctx = new OfflineAudioContext(MIX_CHANNELS, frames, MIX_SAMPLE_RATE)
  const master = ctx.createGain()
  master.gain.value = Math.min(Math.max(level.volume, 0), 1)
  const chain = distanceChain(level.distancePercent)
  if (chain) {
    const dist = ctx.createGain()
    dist.gain.value = gainFromDb(chain.gainDb)
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = chain.cutoffHz
    master.connect(dist)
    dist.connect(filter)
    filter.connect(ctx.destination)
  } else {
    master.connect(ctx.destination)
  }
  const items = [
    ...soundPlacements(ctx, master, job.sounds, buffers),
    ...engineSegmentPlacements(ctx, master, job.engines, buffers),
    ...shieldSegmentPlacements(ctx, master, job.shields, buffers),
  ]
  return renderScheduled(ctx, items, hooks)
}
