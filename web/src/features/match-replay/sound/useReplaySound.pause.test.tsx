// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useReplaySound.pause.test.tsx — THE PAUSE TURNS OFF EVERYTHING, AND A JUMP AT THE STOP DOES NOT REKINDLE.
 *
 * Observed in the field (v8 controls, 2026-10-21): the vehicle sounds continued once
 * the replay was put in pause. Two causes, two tests:
 *  1. a jump at the stop (timeline drag, frame step, jump to a landmark) beat the sound AND
 *     reconciled the ENGINES in it, which would restart their loop without anything turning it off;
 *  2. the pause only turned off the engines and the held bursts, not the other sounds in flight.
 *
 * The engines are doubled (their player has its own tests): what is verified here is the
 * WIRING — when the hook asks the engines to follow, and when it asks them to stay silent.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'


const engine = vi.hoisted(() => ({
  stems: [] as string[],
  attach: vi.fn(),
  sync: vi.fn(),
  stop: vi.fn(),
  plansForExport: vi.fn(() => []),
}))
vi.mock('./useReplayEngineSound', () => ({ useReplayEngineSound: () => engine }))

import { NO_ALLEGIANCE } from '@/lib/replay/filmAllegiance'

import type { ReplayKill } from '../model/killFeedLogic'
import { type FakeContext, flushAudio, installFakeAudio } from '../test/fakeAudio'
import { testReplayDoc } from '../test/testDoc'
import { VOLUME_RAMP_S } from './replayAudio'
import { useReplaySound, type ReplaySoundContext } from './useReplaySound'

const NO_CONTEXT: ReplaySoundContext = { allegiance: NO_ALLEGIANCE, endMatch: null, locale: undefined, followed: null, medals: [] }

let ctx: FakeContext

beforeEach(() => {
  ctx = installFakeAudio().ctx
  engine.attach.mockClear()
  engine.sync.mockClear()
  engine.stop.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function kill(over: Partial<ReplayKill> = {}): ReplayKill {
  return {
    replayMs: 2_000, medals: [],
    tMs: 2_000, xuid: 'K', teamID: 0,
    weaponKey: 'hinf_br75', weaponLabel: 'BR75', weaponImageUrl: '', weaponTinted: false,
    assistState: '', assistGamertag: '', assistTeamID: null,
    killerDamagePct: null, assistDamagePct: null,
    victimXuid: 'V', victimGamertag: 'Victim',
    ...over,
  }
}

function docWithCouple() {
  return testReplayDoc({
    frameIntervalMs: 100,
    tracks: [
      { slot: 1, team: -1, xuid: 'K', points: [{ t: 0, x: 0, y: 0 }, { t: 100, x: 10, y: 0 }], startFrame: 0, endFrame: 100 },
      { slot: 2, team: -1, xuid: 'V', points: [{ t: 0, x: 5, y: 5 }, { t: 20, x: 5, y: 4 }], startFrame: 0, endFrame: 20 },
    ],
  })
}

async function mountOn() {
  const doc = docWithCouple()
  const kills = [kill()]
  const hook = renderHook(() => useReplaySound(doc, kills, 1, NO_CONTEXT))
  act(() => hook.result.current.toggle())
  await act(async () => { await flushAudio() })
  return hook
}

describe('useReplaySound — the engines only follow the playback', () => {
  it('in playback, a beat makes the engines follow', async () => {
    const { result } = await mountOn()
    act(() => result.current.setTransportPlaying(true))
    engine.sync.mockClear()
    act(() => result.current.tick(1_900))
    expect(engine.sync).toHaveBeenCalledWith(1_900)
  })

  it('AT THE STOP, a jump (seek) wakes NO engine', async () => {
    const { result } = await mountOn()
    act(() => result.current.setTransportPlaying(false))
    engine.sync.mockClear()
    act(() => result.current.seek(5_000))
    expect(engine.sync).not.toHaveBeenCalled()
    expect(engine.stop).toHaveBeenCalled()
  })

  it('AT THE STOP, a frame step (tick) wakes no engine either', async () => {
    const { result } = await mountOn()
    act(() => result.current.setTransportPlaying(false))
    engine.sync.mockClear()
    act(() => result.current.tick(5_000))
    expect(engine.sync).not.toHaveBeenCalled()
  })

  it('resuming the playback gives back their following to the engines', async () => {
    const { result } = await mountOn()
    act(() => result.current.setTransportPlaying(false))
    act(() => result.current.setTransportPlaying(true))
    engine.sync.mockClear()
    act(() => result.current.tick(5_100))
    expect(engine.sync).toHaveBeenCalledWith(5_100)
  })
})

describe('useReplaySound — the pause turns off everything that is in flight', () => {
  it('an event sound in course is stopped by the short ramp, not at the end of its file', async () => {
    const { result } = await mountOn()
    act(() => result.current.setTransportPlaying(true))
    act(() => result.current.tick(1_900))
    act(() => result.current.tick(2_050)) // the kill goes out
    expect(ctx.sources).toHaveLength(1)
    act(() => result.current.setTransportPlaying(false))
    expect(ctx.sources[0].stopped).toBeCloseTo(ctx.currentTime + VOLUME_RAMP_S)
  })

  it('at the stop, a frame step still plays the short sound that lands with the frame', async () => {
    const { result } = await mountOn()
    act(() => result.current.setTransportPlaying(false))
    act(() => result.current.tick(1_900))
    act(() => result.current.tick(2_050))
    expect(ctx.sources).toHaveLength(1)
  })
})
