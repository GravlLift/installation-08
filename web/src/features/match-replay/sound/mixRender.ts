// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
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
 *
 * # BROWSERS WITHOUT `suspend` (FIREFOX)
 *
 * `OfflineAudioContext.suspend` is not implemented in Firefox (browser-compat-data: `suspend`
 * `version_added: false`, bug 1265406; its `resume` exists but always rejects). There the track
 * renders in two stages instead (`renderGrouped`), chosen by feature detection on
 * `OfflineAudioContext.prototype.suspend`:
 *
 *  1. THE SOURCES, by groups. Every source is rendered WHOLE in exactly one short context: the
 *     sources that start within `GROUP_SPAN_S` of each other share one, a source longer than
 *     `GROUP_LONG_S` gets its own. A group's context starts at a whole second of the clip (a whole
 *     number of render quanta) and lasts until its last source has stopped, so no source, loop or
 *     envelope is ever cut at a context edge. The rendered groups are summed into the track.
 *     Everything up to the master is per source and linear (gain, pan, a fixed bus gain), so the
 *     sum of the groups is the master's input of the whole-track render.
 *  2. THE MASTER CHAIN (volume, distance attenuation and low-pass) runs over that sum in windows
 *     of `CHAIN_WINDOW_S`, each started `CHAIN_PREROLL_FRAMES` early on the samples before it. The
 *     low-pass is the only node with memory; its slowest decay (500 Hz cut) is under a
 *     millisecond, so after a 53 ms pre-roll its state matches the continuous filter to far below
 *     float precision, and the output is written back in place.
 *
 * Each source is rendered for its own length and each window once: the cost is linear in the
 * track, like the just-in-time render.
 *
 * The times of a source are moved into its group's context with `mixTime.shiftedTime`, so every
 * start and automation event lands on the frame it has in the whole-track render. Checked in
 * Firefox 142 (2026-11-16) against one context holding every source: equal to 2.4e-7 without
 * the distance chain, 1.5e-8 with it, once that reference's master is held in stereo. Left in
 * its default channel mode, the single context's master turns from mono to stereo when the first
 * panned sound plays, and Firefox starts the new channel's low-pass from rest: a 0.014 step there
 * that the grouped render, stereo from end to end, does not have.
 */
import { shiftedTime } from './mixTime'
import { soundEnvelopeOf } from './replayAudio'
import type { MixedSound } from './replayAudioMix'
import { engineSegmentPlacements, engineSegmentSources, type EngineSegment } from './vehicleEngineMix'
import { shieldSegmentPlacements, shieldSegmentSources, type ShieldSegment } from './shieldMix'
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

/** A fixed-gain bus some sources feed before the master (the engines, the shield). */
export interface MixBus {
  id: string
  gain: number
}

/**
 * A source of the mix, free of any context: where it sits on the clip axis (seconds) and how to
 * wire it into a given context. `wire` places it so that the clip moment `t` is heard at the
 * context's time `t - originS`, and returns the node connected to `destination`. `endS` may be
 * `Infinity` (a loop that plays to the end).
 */
export interface MixSource {
  startS: number
  endS: number
  /** The bus it feeds; absent, it feeds the master directly. */
  bus?: MixBus
  wire: (ctx: BaseAudioContext, destination: AudioNode, originS: number) => AudioNode
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
 * Returns the node connected to `destination` (the panner, or the gain without one). `originS` is
 * the clip moment the context's time 0 stands for: 0 for the whole-track render.
 */
export function placeMixSound(
  ctx: BaseAudioContext,
  destination: AudioNode,
  s: MixedSound,
  buf: AudioBuffer,
  originS = 0,
): AudioNode {
  const t0 = s.atMs / 1000
  // Every time is computed on the clip axis, then moved into the context (`mixTime.ts`).
  const at = (t: number) => shiftedTime(t, originS, ctx.sampleRate)
  const { fadeStartS, stopS, loop } = soundEnvelopeOf(buf.duration, s.shape)
  const hold = gainFromDb(s.draw.gainDb) * (s.place?.gain ?? 1)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(hold, at(t0))
  gain.gain.setValueAtTime(hold, at(t0 + fadeStartS))
  gain.gain.linearRampToValueAtTime(0, at(t0 + stopS))
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.loop = loop
  if (s.draw.playbackRate !== 1) src.playbackRate.value = s.draw.playbackRate
  src.connect(gain)
  src.start(at(t0))
  src.stop(at(t0 + stopS))
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

/** The kept sounds as context-free sources (`MixSource`), straight into the master. */
export function soundSources(sounds: readonly MixedSound[], buffers: MixBuffers): MixSource[] {
  const out: MixSource[] = []
  for (const s of sounds) {
    const buf = buffers.get(s.stem)
    if (!buf) continue
    const startS = s.atMs / 1000
    const endS = startS + soundEnvelopeOf(buf.duration, s.shape).stopS
    out.push({ startS, endS, wire: (ctx, destination, originS) => placeMixSound(ctx, destination, s, buf, originS) })
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
 *
 * THE PATH is chosen by feature detection (`offlineSuspendSupported`): just in time where the
 * context can suspend, grouped (`renderGrouped`, see the header) where it cannot. `path` is only
 * passed by the tests, which render the same job both ways.
 */
export function renderAudioMix(
  job: MixJob,
  buffers: MixBuffers,
  durationMs: number,
  level: MixLevel,
  hooks: RenderHooks = {},
  path: MixRenderPath = offlineSuspendSupported() ? 'just-in-time' : 'grouped',
): Promise<AudioBuffer | null> {
  const frames = Math.max(1, Math.ceil((durationMs / 1000) * MIX_SAMPLE_RATE))
  if (path === 'grouped') return renderGrouped(mixSources(job, buffers), frames, level, hooks)
  const ctx = new OfflineAudioContext(MIX_CHANNELS, frames, MIX_SAMPLE_RATE)
  const master = masterChain(ctx, level)
  const items = [
    ...soundPlacements(ctx, master, job.sounds, buffers),
    ...engineSegmentPlacements(ctx, master, job.engines, buffers),
    ...shieldSegmentPlacements(ctx, master, job.shields, buffers),
  ]
  return renderScheduled(ctx, items, hooks)
}

/** The level of a render: the master volume (0..1) and the distance setting (0..100). */
export interface MixLevel {
  volume: number
  distancePercent: number
}

/** The two renders of a track: see the header. */
export type MixRenderPath = 'just-in-time' | 'grouped'

/**
 * offlineSuspendSupported says whether this browser's `OfflineAudioContext` can suspend at a
 * time, which the just-in-time render needs. Detected on the prototype, never from the user
 * agent: Firefox lacks it (its `resume` exists but rejects, so only `suspend` is a valid probe).
 */
export function offlineSuspendSupported(): boolean {
  return typeof OfflineAudioContext === 'function' && typeof OfflineAudioContext.prototype.suspend === 'function'
}

/**
 * masterChain wires the master of a track into `ctx`: master gain, then the distance chain when
 * the setting asks for one, then the output. Returns the master, where the sources go.
 */
function masterChain(ctx: BaseAudioContext, level: MixLevel): AudioNode {
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
  return master
}

/** Every source of a job, context-free: the sounds, the engines and the shield. */
export function mixSources(job: MixJob, buffers: MixBuffers): MixSource[] {
  return [
    ...soundSources(job.sounds, buffers),
    ...engineSegmentSources(job.engines, buffers),
    ...shieldSegmentSources(job.shields, buffers),
  ]
}

/** One render quantum, in frames: the granularity of every offline context. */
const RENDER_QUANTUM = 128
/** Sources starting within this span of a group's first one share its context (seconds). */
export const GROUP_SPAN_S = 2
/** A source that plays longer than this is rendered in a context of its own (seconds). */
export const GROUP_LONG_S = 4
/** At most this many group contexts render at once... */
const GROUP_CONCURRENCY = 4
/** ...and together they hold at most this many frames (60 s), unless one alone is longer. */
const GROUP_FRAME_BUDGET = 60 * MIX_SAMPLE_RATE
/** The master chain renders the track in windows of this length (seconds). */
export const CHAIN_WINDOW_S = 10
/**
 * Each window after the first starts this early, on the samples before it, so the low-pass
 * enters the window with the state the continuous filter has there: 2,560 frames (20 quanta,
 * 53 ms) against a decay under 1 ms at the lowest cut (500 Hz).
 */
export const CHAIN_PREROLL_FRAMES = 20 * RENDER_QUANTUM
/** The share of the progress bar given to the sources; the master chain takes the rest. */
const SOURCES_SHARE = 0.85

/** A group of sources rendered in one context that starts at the clip's second `originS`. */
interface SourceGroup {
  originS: number
  sources: MixSource[]
  endS: number
  frames: number
}

/**
 * groupSources splits the sources into render groups (see the header). Every group starts on a
 * whole second, which is a whole number of render quanta at 48 kHz, and lasts until its last
 * source stops (bounded by the track), plus one quantum for the rounding of the times to frames.
 */
export function groupSources(sources: readonly MixSource[], totalFrames: number): SourceGroup[] {
  const durationS = totalFrames / MIX_SAMPLE_RATE
  const audible = sources.filter((s) => s.startS < durationS && s.endS > s.startS).sort((a, b) => a.startS - b.startS)
  const groups: SourceGroup[] = []
  let open: SourceGroup | null = null
  for (const s of audible) {
    const endS = Math.min(s.endS, durationS)
    const originS = Math.floor(s.startS)
    if (endS - s.startS > GROUP_LONG_S) {
      groups.push({ originS, sources: [s], endS, frames: 0 })
      continue
    }
    if (!open || s.startS >= open.originS + GROUP_SPAN_S) {
      open = { originS, sources: [], endS, frames: 0 }
      groups.push(open)
    }
    open.sources.push(s)
    open.endS = Math.max(open.endS, endS)
  }
  for (const g of groups) {
    const originFrame = g.originS * MIX_SAMPLE_RATE
    g.frames = Math.min(totalFrames - originFrame, Math.ceil((g.endS - g.originS) * MIX_SAMPLE_RATE) + RENDER_QUANTUM)
  }
  return groups
}

/** Renders one group in its own context; the buses are created there, once each. */
function renderGroup(g: SourceGroup): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(MIX_CHANNELS, g.frames, MIX_SAMPLE_RATE)
  const buses = new Map<string, AudioNode>()
  for (const s of g.sources) {
    let destination: AudioNode = ctx.destination
    if (s.bus) {
      let bus = buses.get(s.bus.id)
      if (!bus) {
        const gain = ctx.createGain()
        gain.gain.value = s.bus.gain
        gain.connect(ctx.destination)
        buses.set(s.bus.id, gain)
        bus = gain
      }
      destination = bus
    }
    s.wire(ctx, destination, g.originS)
  }
  return ctx.startRendering()
}

/** Adds a rendered group into the track at its origin. */
function addInto(track: AudioBuffer, part: AudioBuffer, atFrame: number): void {
  for (let c = 0; c < MIX_CHANNELS; c++) {
    const dst = track.getChannelData(c)
    const src = part.getChannelData(c)
    const n = Math.min(src.length, dst.length - atFrame)
    for (let i = 0; i < n; i++) dst[atFrame + i] += src[i]
  }
}

/** The next batch of groups to render together: by count, and by frames held at once. */
function nextBatch(groups: readonly SourceGroup[], from: number): SourceGroup[] {
  const batch: SourceGroup[] = []
  let frames = 0
  for (let i = from; i < groups.length && batch.length < GROUP_CONCURRENCY; i++) {
    if (batch.length > 0 && frames + groups[i].frames > GROUP_FRAME_BUDGET) break
    batch.push(groups[i])
    frames += groups[i].frames
  }
  return batch
}

/**
 * renderGrouped renders a track without `suspend` (see the header): the sources by groups summed
 * into the track, then the master chain over it in windows, in place. Resolves the track, or
 * `null` when `hooks.cancelled` answered `true` between two contexts.
 */
export async function renderGrouped(
  sources: readonly MixSource[],
  totalFrames: number,
  level: MixLevel,
  hooks: RenderHooks = {},
): Promise<AudioBuffer | null> {
  const track = new OfflineAudioContext(MIX_CHANNELS, 1, MIX_SAMPLE_RATE).createBuffer(MIX_CHANNELS, totalFrames, MIX_SAMPLE_RATE)
  const groups = groupSources(sources, totalFrames)
  const groupFrames = groups.reduce((n, g) => n + g.frames, 0)
  let doneFrames = 0
  for (let i = 0; i < groups.length; ) {
    if (hooks.cancelled?.()) return null
    const batch = nextBatch(groups, i)
    const parts = await Promise.all(batch.map(renderGroup))
    // Summed in the groups' order, whatever order they finished in: the same job sums the same way.
    batch.forEach((g, j) => addInto(track, parts[j], g.originS * MIX_SAMPLE_RATE))
    i += batch.length
    doneFrames += batch.reduce((n, g) => n + g.frames, 0)
    hooks.progress?.(SOURCES_SHARE * (doneFrames / groupFrames))
  }
  const ok = await applyMasterChain(track, level, hooks, (f) => hooks.progress?.(SOURCES_SHARE + (1 - SOURCES_SHARE) * f))
  if (!ok) return null
  hooks.progress?.(1)
  return track
}

/**
 * applyMasterChain runs the master chain over `track` in place, window by window, each window
 * after the first preceded by `CHAIN_PREROLL_FRAMES` of the samples before it (see the header).
 * `false` when cancelled.
 */
async function applyMasterChain(
  track: AudioBuffer,
  level: MixLevel,
  hooks: RenderHooks,
  progress: (fraction: number) => void,
): Promise<boolean> {
  const total = track.length
  const windowFrames = CHAIN_WINDOW_S * MIX_SAMPLE_RATE
  // The master's input just before the current window: the track there is already output.
  let before: Float32Array[] = []
  for (let start = 0; start < total; start += windowFrames) {
    if (hooks.cancelled?.()) return false
    const end = Math.min(total, start + windowFrames)
    const pre = start === 0 ? 0 : CHAIN_PREROLL_FRAMES
    const ctx = new OfflineAudioContext(MIX_CHANNELS, pre + end - start, MIX_SAMPLE_RATE)
    const input = ctx.createBuffer(MIX_CHANNELS, pre + end - start, MIX_SAMPLE_RATE)
    for (let c = 0; c < MIX_CHANNELS; c++) {
      const data = input.getChannelData(c)
      if (pre > 0) data.set(before[c], 0)
      data.set(track.getChannelData(c).subarray(start, end), pre)
    }
    before = Array.from({ length: MIX_CHANNELS }, (_, c) => track.getChannelData(c).slice(Math.max(0, end - CHAIN_PREROLL_FRAMES), end))
    const src = ctx.createBufferSource()
    src.buffer = input
    src.connect(masterChain(ctx, level))
    src.start(0)
    const out = await ctx.startRendering()
    for (let c = 0; c < MIX_CHANNELS; c++) track.getChannelData(c).set(out.getChannelData(c).subarray(pre), start)
    progress(end / total)
  }
  return true
}
