// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useReplaySound.lookahead.test.tsx — THE TRACK IS SCHEDULED AHEAD, ON THE AUDIO CLOCK.
 *
 * Reported in use (2026-11-16): "sounds get laggy, or jammed up in traffic with each other so
 * things start coming out late". The beat that reads the track runs in the animation loop, and a
 * sound used to start at the beat that crossed it: as late as the frame was long, and every sound
 * of a long frame on one instant (measured: median 25 ms late at 30-50 ms frames, 10% bunched).
 * What these cases hold: a sound is placed at ITS moment from the frame's timestamp, ahead of
 * time; a long frame no longer moves it; and the pause, the jump and the frame step keep their
 * rules (nothing plays twice, nothing crossed pours out, a stopped frame plays what it crosses).
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NO_ALLEGIANCE } from '@/lib/replay/filmAllegiance'

import type { ReplayKill } from '../model/killFeedLogic'
import { type FakeContext, flushAudio, installFakeAudio } from '../test/fakeAudio'
import { testReplayDoc } from '../test/testDoc'
import { SOUND_LOOKAHEAD_S } from './replayAudio'
import { useReplaySound, type ReplaySoundContext } from './useReplaySound'

const NO_CONTEXT: ReplaySoundContext = { allegiance: NO_ALLEGIANCE, endMatch: null, locale: undefined, followed: null, medals: [] }

let ctx: FakeContext
/** The page clock (`performance.now`), held still unless a case moves it. */
let pageNow = 0

beforeEach(() => {
  ctx = installFakeAudio().ctx
  pageNow = 1_000
  vi.spyOn(performance, 'now').mockImplementation(() => pageNow)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function kill(replayMs: number): ReplayKill {
  return {
    replayMs, medals: [],
    tMs: replayMs, xuid: 'K', teamID: 0,
    weaponKey: 'hinf_br75', weaponLabel: 'BR75', weaponImageUrl: '', weaponTinted: false,
    assistState: '', assistGamertag: '', assistTeamID: null,
    killerDamagePct: null, assistDamagePct: null,
    victimXuid: 'V', victimGamertag: 'Victim',
  }
}

function doc() {
  return testReplayDoc({
    frameIntervalMs: 100,
    tracks: [
      { slot: 1, team: -1, xuid: 'K', points: [{ t: 0, x: 0, y: 0 }, { t: 100, x: 10, y: 0 }], startFrame: 0, endFrame: 100 },
      { slot: 2, team: -1, xuid: 'V', points: [{ t: 0, x: 5, y: 5 }, { t: 40, x: 5, y: 4 }], startFrame: 0, endFrame: 40 },
    ],
  })
}

async function mountPlaying(kills: ReplayKill[], speed = 1) {
  const d = doc()
  const hook = renderHook(() => useReplaySound(d, kills, speed, NO_CONTEXT))
  act(() => hook.result.current.toggle())
  await act(async () => { await flushAudio() })
  act(() => hook.result.current.setTransportPlaying(true))
  return hook
}

describe('useReplaySound — scheduling ahead', () => {
  it('a sound inside the lookahead is placed AHEAD, at its own moment on the audio clock', async () => {
    const { result } = await mountPlaying([kill(2_000)])
    act(() => result.current.tick(1_900, 1_000)) // reseeding beat
    act(() => result.current.tick(1_950, 1_050)) // 2,000 is 50 ms ahead: inside the lookahead
    expect(ctx.sources).toHaveLength(1)
    // Page moment of 2,000 = 1,050 + 50 = 1,100; the page clock reads 1,000 → 0.1 s ahead.
    expect(ctx.sources[0].started).toBeCloseTo(ctx.currentTime + 0.1, 9)
  })

  it('the frame\'s timestamp places it, not the moment the beat runs (work before it in the frame)', async () => {
    const { result } = await mountPlaying([kill(2_000)])
    act(() => result.current.tick(1_900, 1_000))
    pageNow = 1_070 // the beat runs 20 ms into the frame stamped 1,050
    act(() => result.current.tick(1_950, 1_050))
    expect(ctx.sources[0].started).toBeCloseTo(ctx.currentTime + 0.03, 9)
  })

  it('a long frame after the scheduling does not delay it, and it never plays twice', async () => {
    const { result } = await mountPlaying([kill(2_000)])
    act(() => result.current.tick(1_900, 1_000))
    act(() => result.current.tick(1_950, 1_050))
    act(() => result.current.tick(2_150, 1_250)) // a 200 ms frame
    expect(ctx.sources).toHaveLength(1)
  })

  it('beyond the lookahead, nothing is scheduled yet', async () => {
    const ahead = SOUND_LOOKAHEAD_S * 1000
    const { result } = await mountPlaying([kill(2_000 + ahead)])
    act(() => result.current.tick(1_900, 1_000))
    act(() => result.current.tick(1_950, 1_050))
    expect(ctx.sources).toHaveLength(0)
  })

  it('the lookahead covers the same real time at 2x: twice the stretch of the track', async () => {
    const { result } = await mountPlaying([kill(2_150)], 2)
    act(() => result.current.tick(1_900, 1_000))
    act(() => result.current.tick(2_000, 1_050)) // 2,150 is 150 ms of match = 75 ms real ahead
    expect(ctx.sources).toHaveLength(1)
    expect(ctx.sources[0].started).toBeCloseTo(ctx.currentTime + 0.125, 9)
  })
})

describe('useReplaySound — the jump, the pause and the frame step with sounds scheduled ahead', () => {
  it('a jump (seek) drops what was scheduled ahead: it never sounds on the new moment', async () => {
    const { result } = await mountPlaying([kill(2_000)])
    act(() => result.current.tick(1_900, 1_000))
    act(() => result.current.tick(1_950, 1_050))
    expect(ctx.sources).toHaveLength(1)
    act(() => result.current.seek(10_000))
    expect(ctx.sources[0].stopped!).toBeLessThanOrEqual(ctx.sources[0].started!)
  })

  it('the pause drops what was scheduled ahead, and the resume schedules it again (not skipped)', async () => {
    const { result } = await mountPlaying([kill(2_000)])
    act(() => result.current.tick(1_900, 1_000))
    act(() => result.current.tick(1_950, 1_050))
    act(() => result.current.setTransportPlaying(false))
    expect(ctx.sources[0].stopped!).toBeLessThanOrEqual(ctx.sources[0].started!)
    act(() => result.current.setTransportPlaying(true))
    act(() => result.current.tick(1_960, 5_000))
    expect(ctx.sources).toHaveLength(2)
    expect(ctx.sources[1].started).toBeGreaterThan(ctx.currentTime)
  })

  it('at the stop, a frame step schedules nothing ahead, and plays what it crosses now', async () => {
    const { result } = await mountPlaying([kill(2_000)])
    act(() => result.current.setTransportPlaying(false))
    act(() => result.current.tick(1_900, 1_000))
    act(() => result.current.tick(1_950, 1_050))
    expect(ctx.sources).toHaveLength(0)
    act(() => result.current.tick(2_050, 1_150))
    expect(ctx.sources).toHaveLength(1)
    expect(ctx.sources[0].started).toBe(ctx.currentTime)
  })
})
