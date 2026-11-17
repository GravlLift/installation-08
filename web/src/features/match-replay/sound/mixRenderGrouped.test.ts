/**
 * mixRenderGrouped.test.ts — the render of the browsers without `OfflineAudioContext.suspend`
 * (Firefox): it must sound like the just-in-time render, stay linear in the track, and keep the
 * progress and the cancellation.
 *
 * Both renders run on a sample-level fake context (`src/test/fakeOfflineAudio.ts`) that does the
 * real signal processing of the nodes the mix uses, so "sounds the same" is checked sample by
 * sample: the same job, rendered both ways, must agree within 1e-6 everywhere, with sounds,
 * loops, fades and value curves that straddle the group edges (whole seconds) and the master
 * chain's windows (every 10 s), and with the distance low-pass on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  FakeAudioBuffer,
  FakeOfflineAudioContext,
  FakeOfflineAudioContextNoSuspend,
  fakeAudioStats,
  resetFakeAudioStats,
} from '@/test/fakeOfflineAudio'

import {
  CHAIN_WINDOW_S,
  GROUP_LONG_S,
  groupSources,
  mixSources,
  MIX_SAMPLE_RATE,
  offlineSuspendSupported,
  renderAudioMix,
  type MixJob,
  type MixRenderPath,
} from './mixRender'
import { shiftedTime } from './mixTime'
import type { MixedSound } from './replayAudioMix'

/** A deterministic mono buffer: a decaying tone over a little noise, so a misplaced sample shows. */
function tone(durationS: number, hz: number, seed: number): AudioBuffer {
  const n = Math.round(durationS * MIX_SAMPLE_RATE)
  const buf = new FakeAudioBuffer(1, n, MIX_SAMPLE_RATE)
  const d = buf.getChannelData(0)
  let a = seed >>> 0
  for (let i = 0; i < n; i++) {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0
    const noise = (a / 4294967296 - 0.5) * 0.2
    d[i] = (Math.sin((2 * Math.PI * hz * i) / MIX_SAMPLE_RATE) * 0.6 + noise) * Math.exp((-1.5 * i) / n)
  }
  return buf as unknown as AudioBuffer
}

const BUFFERS = new Map<string, AudioBuffer | null>([
  ['shot', tone(0.4, 440, 1)],
  ['long', tone(1.3, 220, 2)],
  ['loop', tone(0.7, 330, 3)],
  ['fanfare', tone(6, 523, 4)],
  ['engineEnter', tone(0.9, 110, 5)],
  ['engineLoop', tone(1.1, 90, 6)],
  ['engineExit', tone(1.6, 70, 7)],
  ['shieldLoop', tone(0.6, 660, 8)],
  ['shieldShot', tone(0.5, 880, 9)],
  ['absent', null],
])

const draw = (gainDb = 0, playbackRate = 1) => ({ gainDb, playbackRate })
const sound = (atMs: number, stem: string, extra: Partial<MixedSound> = {}): MixedSound => ({
  atMs,
  stem,
  draw: draw(-2),
  family: 'sfx',
  ...extra,
})

/** A 25 s track that puts something across every edge the grouped render has. */
const JOB: MixJob = {
  sounds: [
    sound(0, 'shot'),
    sound(950, 'long'),
    // Across the first group's span (2 s) and the second second.
    sound(1990, 'long', { place: { gain: 0.7, pan: -0.6 } }),
    sound(2003, 'shot'),
    sound(4321.37, 'shot', { draw: draw(-6, 1.17) }),
    sound(5000, 'absent'),
    // Across the first master-chain window (10 s), a held loop, and a panned one.
    sound(9980, 'long', { place: { gain: 0.9, pan: 0.8 } }),
    sound(9999.7, 'loop', { shape: { holdS: 1.5 } }),
    sound(11_500, 'long', { draw: draw(-1, 0.83) }),
    sound(15_200, 'loop', { shape: { holdS: 2.2 } }),
    sound(17_000, 'long', { shape: { cutS: 0.2 } }),
    // A long one (alone in its context) across the second window (20 s), and a stolen one.
    sound(19_000, 'fanfare', { family: 'music', conclusion: true }),
    sound(19_990, 'long', { shape: { stealS: 0.1 } }),
    // Runs past the end of the track: cut by the track's length, as in the whole-track render.
    sound(24_800, 'long'),
  ],
  engines: [
    { stem: 'engineEnter', atS: 3.05, loop: false, stopS: 3.35, fadeOutS: 0.15 },
    { stem: 'engineLoop', atS: 3.2, loop: true, stopS: 14.7, fadeInS: 0.15, fadeOutS: 0.15 },
    { stem: 'engineExit', atS: 14.55, loop: false, fadeInS: 0.15 },
    // A loop with no forced end plays to the end of the track.
    { stem: 'engineLoop', atS: 21.3, loop: true, fadeInS: 0.15 },
  ],
  shields: [
    { stem: 'shieldLoop', atS: 5.5, loop: true, offsetS: 0.25, stopS: 12.25, fadeOutS: 0.1 },
    { stem: 'shieldShot', atS: 12.25, loop: false },
    { stem: 'shieldLoop', atS: 18.9, loop: true, offsetS: 0.4, stopS: 20.6, fadeOutS: 0.1 },
  ],
}

const DURATION_MS = 25_000

async function render(job: MixJob, level: { volume: number; distancePercent: number }, path: MixRenderPath) {
  const out = await renderAudioMix(job, BUFFERS, DURATION_MS, level, {}, path)
  if (!out) throw new Error('no render')
  return out
}

/** The largest gap between two renders, where it is (seconds), and the reference's peak. */
function maxDiff(a: AudioBuffer, b: AudioBuffer): { diff: number; atS: number; peak: number } {
  expect(a.length).toBe(b.length)
  let diff = 0
  let at = 0
  let peak = 0
  for (let c = 0; c < 2; c++) {
    const x = a.getChannelData(c)
    const y = b.getChannelData(c)
    for (let i = 0; i < x.length; i++) {
      const d = Math.abs(x[i] - y[i])
      if (d > diff) {
        diff = d
        at = i
      }
      peak = Math.max(peak, Math.abs(x[i]))
    }
  }
  return { diff, atS: at / MIX_SAMPLE_RATE, peak }
}

beforeEach(() => {
  resetFakeAudioStats()
  vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('shiftedTime — a time moved into a later context lands on the same frame', () => {
  /** Checks every time of a range: same first frame as the reference, a hair early at most. */
  const check = (stepMs: number) => {
    let gaps = 0
    for (let ms = 0; ms < 720_000; ms += stepMs) {
      const t = ms / 1000
      const origin = Math.floor(t)
      const target = t * MIX_SAMPLE_RATE - origin * MIX_SAMPLE_RATE
      const got = shiftedTime(t, origin, MIX_SAMPLE_RATE) * MIX_SAMPLE_RATE
      // The first frame at or after the position, the rule of starts and automation events.
      if (Math.ceil(got) !== Math.ceil(target) || got > target || target - got > 1e-10) gaps++
    }
    return gaps
  }

  it('on whole milliseconds over a 12-minute match: always the reference frame', () => {
    expect(check(1)).toBe(0)
  })

  it('between frames as well (times off the millisecond grid)', () => {
    expect(check(7.3)).toBe(0)
    expect(check(33.3333)).toBe(0)
  })

  it('and the plain subtraction does miss: the case the helper exists for', () => {
    // 3.2 s is exactly frame 153600; (3.2 - 3) s is past frame 9600, so a whole frame late.
    expect(3.2 * MIX_SAMPLE_RATE).toBe(153_600)
    expect(Math.ceil((3.2 - 3) * MIX_SAMPLE_RATE)).toBe(9601)
    expect(Math.ceil(shiftedTime(3.2, 3, MIX_SAMPLE_RATE) * MIX_SAMPLE_RATE)).toBe(9600)
  })

  it('leaves the whole-track render untouched (origin 0)', () => {
    for (const t of [0, 0.1, 3.2, 123.456, Infinity]) expect(shiftedTime(t, 0, MIX_SAMPLE_RATE)).toBe(t)
  })
})

describe('renderGrouped — the same sound as the just-in-time render', () => {
  it('the test job really crosses the edges: long sources alone, short ones grouped', () => {
    const groups = groupSources(mixSources(JOB, BUFFERS), (DURATION_MS / 1000) * MIX_SAMPLE_RATE)
    expect(groups.some((g) => g.sources.length > 1)).toBe(true)
    expect(groups.some((g) => g.sources.length === 1 && g.endS - g.sources[0].startS > GROUP_LONG_S)).toBe(true)
    // Every group starts on a whole second, so on a render quantum.
    for (const g of groups) expect(Number.isInteger(g.originS)).toBe(true)
    // The absent file is a silence, not a source.
    expect(groups.flatMap((g) => g.sources)).toHaveLength(mixSources(JOB, BUFFERS).length)
  })

  it('with the distance low-pass on: equal to 1e-6 over the whole track, window edges included', async () => {
    const level = { volume: 0.8, distancePercent: 60 }
    const reference = await render(JOB, level, 'just-in-time')
    const grouped = await render(JOB, level, 'grouped')
    const { diff, atS, peak } = maxDiff(reference, grouped)
    expect(peak).toBeGreaterThan(0.1)
    expect(diff, `largest gap at ${atS} s`).toBeLessThan(1e-6)
    // And right at the window edges, where a reset filter would click.
    for (const edge of [CHAIN_WINDOW_S, 2 * CHAIN_WINDOW_S]) {
      const at = edge * MIX_SAMPLE_RATE
      const r = reference.getChannelData(0).subarray(at - 64, at + 64)
      const g = grouped.getChannelData(0).subarray(at - 64, at + 64)
      expect(r.some((v) => Math.abs(v) > 1e-3)).toBe(true)
      for (let i = 0; i < r.length; i++) expect(Math.abs(r[i] - g[i])).toBeLessThan(1e-6)
    }
  })

  it('without the distance chain: equal to 1e-6 as well', async () => {
    const level = { volume: 1, distancePercent: 0 }
    const { diff, atS, peak } = maxDiff(await render(JOB, level, 'just-in-time'), await render(JOB, level, 'grouped'))
    expect(peak).toBeGreaterThan(0.1)
    expect(diff, `largest gap at ${atS} s`).toBeLessThan(1e-6)
  })
})

describe('renderGrouped — cost, progress, cancellation, detection', () => {
  /** One half-second shot every 0.3 s: a dense match. */
  const dense = (seconds: number): MixJob => ({
    sounds: Array.from({ length: Math.floor(seconds / 0.3) }, (_, i) => sound(i * 300, i % 2 ? 'shot' : 'long')),
    engines: [],
    shields: [],
  })
  const costOf = async (seconds: number, path: MixRenderPath) => {
    resetFakeAudioStats(true)
    await renderAudioMix(dense(seconds), BUFFERS, seconds * 1000, { volume: 1, distancePercent: 40 }, {}, path)
    return fakeAudioStats.renderCost
  }

  it('stays linear in the track: twice the match costs about twice, like the just-in-time render', async () => {
    const short = await costOf(60, 'grouped')
    const long = await costOf(120, 'grouped')
    expect(long / short).toBeLessThan(2.2)
    // And in the same order as the just-in-time render, not a multiple of it.
    expect(long).toBeLessThan(2 * (await costOf(120, 'just-in-time')))
  }, 60_000)

  it('publishes a rising progress that ends at 1', async () => {
    const seen: number[] = []
    await renderAudioMix(dense(30), BUFFERS, 30_000, { volume: 1, distancePercent: 0 }, { progress: (f) => seen.push(f) }, 'grouped')
    expect(seen.length).toBeGreaterThan(5)
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
    expect(seen.at(-1)).toBe(1)
  })

  it('a cancellation resolves null and renders nothing more', async () => {
    let calls = 0
    const out = await renderAudioMix(dense(60), BUFFERS, 60_000, { volume: 1, distancePercent: 0 }, {
      cancelled: () => ++calls > 2,
    }, 'grouped')
    expect(out).toBeNull()
    // The track's buffer context and two batches of at most four groups, then nothing.
    expect(fakeAudioStats.contexts).toBeLessThanOrEqual(1 + 2 * 4)
  })

  it('a context without suspend (Firefox) takes the grouped render by default, instead of failing', async () => {
    expect(offlineSuspendSupported()).toBe(true)
    vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContextNoSuspend)
    expect(offlineSuspendSupported()).toBe(false)
    const out = await renderAudioMix(JOB, BUFFERS, DURATION_MS, { volume: 1, distancePercent: 0 })
    expect(out?.length).toBe(DURATION_MS * 48)
  })
})
