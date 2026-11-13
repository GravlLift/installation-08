/**
 * introSound.test.tsx — THE INTRO MUSIC (item 7 of the backlog, decision D-8), sound side.
 *
 * The TRIGGER (when playback leaves the preamble) is tested on the playback side
 * (`hooks/useReplayPlayback.intro.test.tsx`). Here, what the sound does with it: the excerpt goes through
 * the ordinary path of the player, so through its silences — sound off, speed beyond
 * SOUND_MAX_SPEED — and it is pre-loaded with the track, without ever entering the export.
 */
import { act, renderHook } from '@testing-library/react'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NO_ALLEGIANCE } from '@/lib/replay/filmAllegiance'

import type { ReplayKill } from '../model/killFeedLogic'
import { type FakeContext, flushAudio, installFakeAudio, okAudioResponse } from '../test/fakeAudio'
import { testReplayDoc } from '../test/testDoc'
import { INTRO_MUSIC_STEM } from './introSound'
import { SOUND_MAX_SPEED } from './replaySoundCursor'
import { useReplaySound, type ReplaySoundContext } from './useReplaySound'

const NO_CONTEXT: ReplaySoundContext = { allegiance: NO_ALLEGIANCE, endMatch: null, locale: undefined }
const INTRO_URL = `/static/sounds/halo_infinite/${INTRO_MUSIC_STEM}.ogg`
/** The fake duration of the excerpt (1 byte = 0.1 s in the fake decoder): that is what is read. */
const INTRO_S = 3.3

let ctx: FakeContext
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  const fake = installFakeAudio()
  ctx = fake.ctx
  fetchMock = fake.fetchMock
  fetchMock.mockImplementation((url: string) => Promise.resolve(okAudioResponse(url === INTRO_URL ? INTRO_S : 1.2)))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function kill(): ReplayKill {
  return {
    replayMs: 2_000, medals: [], tMs: 2_000, xuid: 'K', teamID: 0,
    weaponKey: 'hinf_br75', weaponLabel: 'BR75', weaponImageUrl: '', weaponTinted: false,
    assistState: '', assistGamertag: '', assistTeamID: null, killerDamagePct: null, assistDamagePct: null,
    victimXuid: 'V', victimGamertag: 'Victime',
  }
}

function mount(speed = 1) {
  const doc = testReplayDoc({
    frameIntervalMs: 100,
    tracks: [
      { slot: 1, team: -1, xuid: 'K', points: [{ t: 0, x: 0, y: 0 }, { t: 100, x: 10, y: 0 }], startFrame: 0, endFrame: 100 },
      { slot: 2, team: -1, xuid: 'V', points: [{ t: 0, x: 5, y: 5 }, { t: 20, x: 5, y: 4 }], startFrame: 0, endFrame: 20 },
    ],
  })
  const kills = [kill()]
  return renderHook(({ s }: { s: number }) => useReplaySound(doc, kills, s, NO_CONTEXT), { initialProps: { s: speed } })
}

const introSources = () => ctx.sources.filter((s) => s.buffer?.duration === INTRO_S)

describe('useReplaySound — the intro music', () => {
  it('keeps the tick and the conclusion stable between renders', () => {
    const view = mount()
    const { tick, endMatch } = view.result.current
    view.rerender({ s: 1 })
    expect(view.result.current.tick).toBe(tick)
    expect(view.result.current.endMatch).toBe(endMatch)
    view.rerender({ s: 2 })
    expect(view.result.current.tick).toBe(tick)
  })

  it('sound on, at 1x: the excerpt is pre-loaded with the track and goes out once', async () => {
    const { result } = mount()
    act(() => result.current.toggle())
    await act(async () => { await flushAudio() })
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain(INTRO_URL)
    act(() => result.current.intro())
    expect(introSources()).toHaveLength(1)
  })

  // DA-9 / A4.9: first "Play" after a reload. The player is born IN that gesture
  // (`wake`), the excerpt is not yet decoded when `intro` is called just after.
  it('first "Play" after a reload: the excerpt goes out all the same, once decoded', async () => {
    localStorage.setItem('replay-sound-on', 'true')
    const { result } = mount()
    act(() => {
      result.current.wake()
      result.current.intro()
    })
    expect(introSources()).toHaveLength(0)
    await act(async () => { await flushAudio() })
    expect(introSources()).toHaveLength(1)
    localStorage.clear()
  })

  it('at SOUND_MAX_SPEED exactly, it still goes out', async () => {
    const { result } = mount(SOUND_MAX_SPEED)
    act(() => result.current.toggle())
    await act(async () => { await flushAudio() })
    act(() => result.current.intro())
    expect(introSources()).toHaveLength(1)
  })

  it('sound off: silence, and no context nor download in the passing', () => {
    const { result } = mount()
    act(() => result.current.intro())
    expect(ctx.sources).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('beyond SOUND_MAX_SPEED: silence, like the rest of the sound', async () => {
    const { result } = mount(SOUND_MAX_SPEED * 2)
    act(() => result.current.toggle())
    await act(async () => { await flushAudio() })
    act(() => result.current.intro())
    expect(ctx.sources).toHaveLength(0)
  })

  it('absent from the export: not in the track nor in the conclusion, shelved as music', async () => {
    const { result } = mount()
    act(() => result.current.toggle())
    await act(async () => { await flushAudio() })
    const track = result.current.exportTrack()
    expect(track.timeline.map((e) => e.stem)).not.toContain(INTRO_MUSIC_STEM)
    expect(track.endMatchStems).not.toContain(INTRO_MUSIC_STEM)
    expect(track.families.music).toContain(INTRO_MUSIC_STEM)
  })
})
