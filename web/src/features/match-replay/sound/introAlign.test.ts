// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * introAlign.test.ts — THE INTRO ALIGNED TO THE KICKOFF even when its buffer arrives late
 * (item 7, A4.9, DA-9 of the 2026-09-26 backlog plan).
 *
 * THE CASE THAT MATTERS: first "Play" after a reload. The audio player is born in that
 * click, the excerpt is not yet decoded. The ordinary path was skipping it. Now we wait for
 * the decoding, then the source goes out with an OFFSET equal to the time elapsed since the gesture: the
 * resolution of the rise stays on the kickoff. If the wait exceeds the preamble
 * at the current speed (1 s at 1x, 0.5 s at 2x), the kickoff is past: silence, never a
 * sound offset from its image.
 *
 * The decoding is ASYNCHRONOUS and manually driven (held `fetch` response), the wall clock is
 * injected: no real delay, no randomness.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type FakeContext, flushAudio, installFakeAudio, okAudioResponse } from '../test/fakeAudio'
import { INTRO_THEME_START_S, introLateBoundS, playIntroAligned, playIntroFrom } from './introSound'
import { ReplayAudioPlayer } from './replayAudio'

const URL = '/static/sounds/halo_infinite/intro_music_01.ogg'

let ctx: FakeContext
let fetchMock: ReturnType<typeof vi.fn>
/** The held `fetch` response: it is released when the "decoding" must finish. */
let release: () => void
/** The injected wall clock, in ms. */
let now = 0
const clock = () => now

beforeEach(() => {
  const fake = installFakeAudio()
  ctx = fake.ctx
  fetchMock = fake.fetchMock
  fetchMock.mockImplementation(
    () => new Promise((resolve) => { release = () => resolve(okAudioResponse(3)) }),
  )
  now = 1_000
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Makes the decoding "finish" at the `ms` moment of the wall clock. */
async function decodeA(ms: number) {
  now = ms
  release()
  await flushAudio()
}

describe('introLateBoundS — the admitted delay is the preamble at the current speed', () => {
  it('1 s at 1x, 0.5 s at 2x', () => {
    expect(introLateBoundS(1)).toBeCloseTo(1, 9)
    expect(introLateBoundS(2)).toBeCloseTo(0.5, 9)
  })
})

describe('playIntroAligned — aligned start despite a late decoding', () => {
  it('decoded in 200 ms: the source goes out with an offset of 0.2 s', async () => {
    const p = new ReplayAudioPlayer(1)
    void playIntroAligned(p, URL, 1, clock)
    expect(ctx.sources).toHaveLength(0) // nothing until the buffer is there
    await decodeA(1_200)
    expect(ctx.sources).toHaveLength(1)
    expect(ctx.sources[0].offset).toBeCloseTo(0.2, 9)
    // The rest of the envelope is offset by that much: the source stops 0.2 s earlier.
    expect(ctx.sources[0].stopped! - ctx.sources[0].started!).toBeCloseTo(3 - 0.2, 9)
  })

  it('decoded beyond the preamble: no source (the kickoff is past)', async () => {
    const p = new ReplayAudioPlayer(1)
    void playIntroAligned(p, URL, 1, clock)
    await decodeA(2_050)
    expect(ctx.sources).toHaveLength(0)
  })

  it('at 2x, the bound is 0.5 s: 0.6 s of delay is already too late', async () => {
    const p = new ReplayAudioPlayer(1)
    void playIntroAligned(p, URL, 2, clock)
    await decodeA(1_600)
    expect(ctx.sources).toHaveLength(0)
  })

  it('already decoded: immediate start, in the gesture, without offset', async () => {
    const p = new ReplayAudioPlayer(1)
    p.preload([URL])
    await decodeA(1_000)
    now = 5_000
    void playIntroAligned(p, URL, 1, clock)
    expect(ctx.sources).toHaveLength(1)
    expect(ctx.sources[0].offset).toBe(0)
  })
})

describe('playIntroFrom — the whole theme first, the excerpt when it is missing', () => {
  /** A player whose loads all finish at once: `ok` lists the URLs that decode. */
  const stub = (ok: string[], loaded: string[] = []) => {
    const played: [string, number][] = []
    const done = new Set(loaded)
    return {
      played,
      isLoaded: (u: string) => done.has(u),
      whenLoaded: async (u: string) => { if (ok.includes(u)) done.add(u) },
      playFrom: (u: string, s: number) => { played.push([u, s]) },
    }
  }
  const THEME = '/static/sounds/halo_infinite/foot_17f8c16b.ogg'
  const sources = [{ url: THEME, startS: INTRO_THEME_START_S }, { url: URL, startS: 0 }]

  it('enters the decoded theme one second before its resolution', async () => {
    const p = stub([], [THEME])
    await playIntroFrom(p, sources, 1, clock)
    expect(p.played).toEqual([[THEME, INTRO_THEME_START_S]])
    expect(INTRO_THEME_START_S).toBeCloseTo(2.19, 9)
  })

  it('falls back to the excerpt when the theme does not load', async () => {
    const p = stub([URL])
    await playIntroFrom(p, sources, 1, clock)
    expect(p.played).toEqual([[URL, 0]])
  })
})