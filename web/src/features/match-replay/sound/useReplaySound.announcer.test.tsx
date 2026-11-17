// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useReplaySound.announcer.test.tsx — THE ANNOUNCER'S WIRING (2026-11-13). Its rules have their
 * tests (announcerSound.test.ts); here, what only the assembly can betray: the round-end call
 * goes through the track (cursor, seek, export), and the "Announcer" toggle cuts every voice
 * call, the end-of-match voice included, while the fanfare keeps playing.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NO_ALLEGIANCE } from '@/lib/replay/filmAllegiance'

import { type FakeContext, flushAudio, installFakeAudio } from '../test/fakeAudio'
import { testReplayDoc } from '../test/testDoc'
import { useReplaySound, type ReplaySoundContext } from './useReplaySound'

const EN: ReplaySoundContext = { allegiance: NO_ALLEGIANCE, endMatch: null, locale: 'en', followed: null, medals: [] }

let ctx: FakeContext

beforeEach(() => {
  ctx = installFakeAudio().ctx
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Two rounds at 10 Hz: the transition, and its "round over" call, fall at 1,000 ms. */
function twoRounds() {
  return testReplayDoc({
    frameIntervalMs: 100,
    scoreTimeline: {
      teams: [{ teamId: 0, rounds: [{ round: 0, points: [{ t: 2, v: 1 }, { t: 10, v: 2 }] }, { round: 1, points: [{ t: 40, v: 1 }] }], total: [] }],
    },
  })
}

describe('useReplaySound — the announcer', () => {
  it('the round-over call plays once at its moment, and a seek across it plays nothing', async () => {
    const doc = twoRounds()
    const { result } = renderHook(() => useReplaySound(doc, [], 1, EN))
    act(() => result.current.toggle())
    await act(async () => { await flushAudio() })
    act(() => result.current.tick(900))
    act(() => result.current.tick(1_100))
    expect(ctx.sources).toHaveLength(1)
    act(() => result.current.seek(500))
    act(() => result.current.seek(1_500)) // a jump over the call
    act(() => result.current.tick(1_600))
    expect(ctx.sources).toHaveLength(1)
    expect(result.current.exportTrack().timeline).toEqual([{ ms: 1_000, stem: 'round_over_en', announcer: true }])
    expect(result.current.exportTrack().families.voice).toContain('round_over_en')
  })

  it('cutting the announcer category removes the call from the played and exported track', async () => {
    const doc = twoRounds()
    const { result } = renderHook(() => useReplaySound(doc, [], 1, EN))
    act(() => result.current.toggleCategory('announcer'))
    act(() => result.current.toggle())
    await act(async () => { await flushAudio() })
    act(() => result.current.tick(900))
    act(() => result.current.tick(1_100))
    expect(ctx.sources).toHaveLength(0)
    expect(result.current.exportTrack().timeline).toEqual([])
  })

  it('announcer category cut: the end-of-match fanfare plays alone, at the page and in the export', async () => {
    const doc = testReplayDoc({ frameIntervalMs: 100 })
    const context: ReplaySoundContext = { ...EN, endMatch: { outcome: 'win', ffa: false, locale: 'en' } }
    const { result } = renderHook(() => useReplaySound(doc, [], 1, context))
    act(() => result.current.toggleCategory('announcer'))
    act(() => result.current.toggle())
    await act(async () => { await flushAudio() })
    act(() => result.current.endMatch())
    expect(ctx.sources).toHaveLength(1)
    expect(result.current.exportTrack().endMatchStems).toEqual(['end_victory_music_01'])
  })
})
