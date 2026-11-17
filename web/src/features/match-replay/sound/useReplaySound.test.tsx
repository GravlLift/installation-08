// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useReplaySound.test.tsx — THE WIRING, where a sound actually triggers or stays silent for good.
 *
 * The pure rules have their tests (replaySound.test.ts) and the engine has its own
 * (replayAudio.test.ts). What remains is what only the assembly can betray: that nothing sounds
 * nor downloads until the user has clicked, that activating the sound mid-match does not
 * pour out all at once everything that precedes, that a fast forward stays silent without
 * losing the thread, and that the preference survives the page.
 */
import { act, renderHook } from '@testing-library/react'

// The instance settings (RANGED variation, distance) come from useSettings; here we
// neutralize them — their effects have their own tests (weaponSoundLogic, replayAudio).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NO_ALLEGIANCE } from '@/lib/replay/filmAllegiance'

import type { ReplayKill } from '../model/killFeedLogic'

import type { EndMatchSoundSpec } from './endMatchSound'
import { SOUND_MAX_VOICES } from './replayAudio'
import { SOUND_MAX_SPEED } from './replaySoundCursor'
import { type FakeContext, flushAudio, installFakeAudio, okAudioResponse } from '../test/fakeAudio'
import { testReplayDoc } from '../test/testDoc'
import { SOUND_VOLUME_DEFAULT, useReplaySound, type ReplaySoundContext } from './useReplaySound'

/** Default context of the tests of this file: no allegiance, no end of match, no
 * locale — only `endMatch` varies from one test to another (`{ ...NO_CONTEXT, endMatch }`). */
const NO_CONTEXT: ReplaySoundContext = { allegiance: NO_ALLEGIANCE, endMatch: null, locale: undefined, followed: null, medals: [] }

let ctx: FakeContext
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  const fake = installFakeAudio()
  ctx = fake.ctx
  fetchMock = fake.fetchMock
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** A kill OF THE FILM, already realigned: `replayMs` is the moment that the sound track reads. */
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

/** 10 Hz document with a killer/victim couple: the end of life falls at 2,000 ms. */
function docWithCouple() {
  return testReplayDoc({
    frameIntervalMs: 100,
    tracks: [
      { slot: 1, team: -1, xuid: 'K', points: [{ t: 0, x: 0, y: 0 }, { t: 100, x: 10, y: 0 }], startFrame: 0, endFrame: 100 },
      { slot: 2, team: -1, xuid: 'V', points: [{ t: 0, x: 5, y: 5 }, { t: 20, x: 5, y: 4 }], startFrame: 0, endFrame: 20 },
    ],
  })
}

/** The hook, mounted on a match with a single BR kill at 2,000 ms. */
function mount(speed = 1) {
  const doc = docWithCouple()
  const kills = [kill()]
  return renderHook(({ s }: { s: number }) => useReplaySound(doc, kills, s, NO_CONTEXT), {
    initialProps: { s: speed },
  })
}

describe('useReplaySound — off by default', () => {
  it('creates NO audio context and downloads nothing until we have clicked', () => {
    const { result } = mount()
    expect(result.current.on).toBe(false)
    expect(result.current.available).toBe(true)
    act(() => result.current.tick(2_500))
    expect(ctx.sources).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps controls available for an empty timeline', () => {
    const { result } = renderHook(() => useReplaySound(docWithCouple(), [], 1, NO_CONTEXT))
    expect(result.current.available).toBe(true)
    act(() => result.current.toggle())
    expect(result.current.on).toBe(true)
  })
})

describe('useReplaySound — activation', () => {
  it('stays silent and keeps controls available when sound files return 404', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = mount()
    act(() => result.current.toggle())
    await act(async () => { await flushAudio() })
    act(() => { result.current.tick(1_900); result.current.tick(2_050) })
    expect(result.current.available).toBe(true)
    expect(result.current.on).toBe(true)
    expect(ctx.sources).toHaveLength(0)
  })
  it('the click opens the context and preloads the sounds OF THIS MATCH, not the whole pack', async () => {
    const { result } = mount()
    act(() => result.current.toggle())
    await act(async () => { await flushAudio() })
    expect(result.current.on).toBe(true)
    expect(ctx.resumed).toBe(1)
    // The kill of the match, the intro excerpt that any match can play at the start (item 7),
    // and the pre-game countdown tick (`countdownSound.ts`).
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      '/static/sounds/halo_infinite/hinf_br75.ogg',
      '/static/sounds/halo_infinite/intro_music_01.ogg',
      '/static/sounds/halo_infinite/ui_countdown_tick.ogg',
    ])
  })

  it('activating mid-match does not pour out what precedes: the first beat reseeds', async () => {
    const { result } = mount()
    act(() => result.current.toggle())
    await act(async () => { await flushAudio() })
    // The kill (2,000 ms) is ALREADY passed when the sound activates at 2,100 ms.
    act(() => result.current.tick(2_100))
    expect(ctx.sources).toHaveLength(0)
  })

  it('then the next sound goes out, only once, at its passage', async () => {
    const { result } = mount()
    act(() => result.current.toggle())
    await act(async () => { await flushAudio() })
    act(() => result.current.tick(1_900)) // silent reseeding before the kill
    act(() => result.current.tick(2_050)) // the kill passes here
    expect(ctx.sources).toHaveLength(1)
    act(() => result.current.tick(2_150)) // nothing new: nothing replays
    expect(ctx.sources).toHaveLength(1)
  })

  /**
   * LOT 5.8.7 — A JUMP DOES NOT POUR OUT WHAT IT CROSSES, WHATEVER ITS AMPLITUDE.
   *
   * `tick` only reseeds in silence beyond `SOUND_RESYNC_JUMP_MS` (1 s): served after a
   * timeline drag, a jump UNDER the second would play the whole interval in a burst. `seek` is the
   * path of the jumps, and it places the cursor without playing anything.
   */
  it('a JUMP (seek) plays nothing, even under the reseeding second', async () => {
    const { result } = mount()
    act(() => result.current.toggle())
    await act(async () => { await flushAudio() })
    act(() => result.current.tick(1_900)) // cursor placed just before the kill
    // 150 ms jump: well UNDER the reseeding threshold, so `tick` would have played the kill here.
    act(() => result.current.seek(2_050))
    expect(ctx.sources).toHaveLength(0)
    // AND IT DOES NOT COME BACK LATER: the cursor is placed AFTER it, not before.
    act(() => result.current.tick(2_150))
    expect(ctx.sources).toHaveLength(0)
  })

  it('the WITNESS: the same jump by `tick` does play the kill (that is the playback)', async () => {
    const { result } = mount()
    act(() => result.current.toggle())
    await act(async () => { await flushAudio() })
    act(() => result.current.tick(1_900))
    act(() => result.current.tick(2_050))
    expect(ctx.sources).toHaveLength(1)
  })
})

describe('useReplaySound — intended silences', () => {
  it('fast forward: the sound stays silent, and returning to 1x does not trigger a salvo', async () => {
    const { result, rerender } = mount(SOUND_MAX_SPEED * 2)
    act(() => result.current.toggle())
    await act(async () => { await flushAudio() })
    expect(result.current.mutedBySpeed).toBe(true)
    act(() => result.current.tick(1_900))
    act(() => result.current.tick(2_050)) // the kill passes during the fast forward
    expect(ctx.sources).toHaveLength(0)
    rerender({ s: 1 })
    expect(result.current.mutedBySpeed).toBe(false)
    act(() => result.current.tick(2_150)) // the cursor has followed: nothing to catch up
    expect(ctx.sources).toHaveLength(0)
  })

  it('the cut is immediate: the master falls to zero, we do not wait for the end of the sounds', async () => {
    const { result } = mount()
    act(() => result.current.toggle())
    await act(async () => { await flushAudio() })
    act(() => result.current.toggle())
    const master = ctx.gains[0]
    expect(master.gain.calls.filter((c) => c[0] === 'ramp').pop()?.[1]).toBe(0)
    act(() => result.current.tick(1_900))
    act(() => result.current.tick(2_050))
    expect(ctx.sources).toHaveLength(0)
  })
})

describe('useReplaySound — categories (settings drawer, phase 2)', () => {
  it('the six categories are active by default', () => {
    const { result } = mount()
    expect(result.current.categories).toEqual({
      weapon: true, grenade: true, melee: true, equipment: true, objective: true, announcer: true,
    })
  })

  it('cutting WEAPONS removes the weapon kill from the played track without making the panel disappear', async () => {
    const { result } = mount()
    act(() => result.current.toggleCategory('weapon'))
    expect(result.current.categories.weapon).toBe(false)
    expect(result.current.available).toBe(true) // the match HAS sound, even with all categories cut
    act(() => result.current.toggle())
    await act(async () => { await flushAudio() })
    act(() => result.current.tick(1_900))
    act(() => result.current.tick(2_050)) // the kill (weapon) would pass here
    expect(ctx.sources).toHaveLength(0)
  })

  it('cutting a category removes ITS sounds, the others stay unchanged', async () => {
    const doc = testReplayDoc({
      frameIntervalMs: 100,
      tracks: [
        { slot: 1, team: -1, xuid: 'K', points: [{ t: 0, x: 0, y: 0 }, { t: 100, x: 10, y: 0 }], startFrame: 0, endFrame: 100 },
        { slot: 2, team: -1, xuid: 'V', points: [{ t: 0, x: 5, y: 5 }, { t: 20, x: 5, y: 4 }], startFrame: 0, endFrame: 20 },
      ],
      grenades: [{ i: 0, rank: 0, s: '', slot: 1, t: 5, x: 0, y: 0 }], // throw_frag at 500 ms
    })
    const { result } = renderHook(() => useReplaySound(doc, [kill()], 1, NO_CONTEXT))
    act(() => result.current.toggleCategory('weapon'))
    act(() => result.current.toggle())
    await act(async () => { await flushAudio() })
    act(() => result.current.tick(100)) // silent reseeding, BEFORE the throw
    act(() => result.current.tick(600)) // the throw (grenade, active category) has passed
    expect(ctx.sources).toHaveLength(1)
    act(() => result.current.tick(2_100)) // the kill (weapon, cut category) has passed
    expect(ctx.sources).toHaveLength(1) // still only one sound: the weapon stays muted
  })

  it('the category preference survives the remount (localStorage, like the sound)', () => {
    const first = mount()
    act(() => first.result.current.toggleCategory('equipment'))
    first.unmount()

    const { result } = mount()
    expect(result.current.categories.equipment).toBe(false)
    expect(result.current.categories.weapon).toBe(true)
  })
})

describe('useReplaySound — preferences', () => {
  it('the sound state and the volume survive the remount (localStorage)', async () => {
    const first = mount()
    act(() => first.result.current.toggle())
    act(() => first.result.current.setVolume(0.3))
    await act(async () => { await flushAudio() })
    first.unmount()
    expect(ctx.closed).toBe(1) // the context dies with the component

    const { result } = mount()
    expect(result.current.on).toBe(true)
    expect(result.current.volume).toBe(0.3)
  })

  it('default volume at first passage, and bounds respected', () => {
    const { result } = mount()
    expect(result.current.volume).toBe(SOUND_VOLUME_DEFAULT)
    act(() => result.current.setVolume(5))
    expect(result.current.volume).toBe(1)
    act(() => result.current.setVolume(-2))
    expect(result.current.volume).toBe(0)
  })
})

/**
 * THE RETURN ON A PAGE WHERE THE SOUND WAS ALREADY ACTIVATED (fix of 2026-08-27).
 *
 * THE DEFECT THAT THESE CASES FIX, reported in use: the preference comes back from local storage,
 * the player does not (an AudioContext is only born in a gesture). The panel therefore announced "sound
 * enabled" on a silent replay, and the next click — the only gesture that could fix everything —
 * toggled the preference to "off". It took TWO clicks to hear anything.
 *
 * `localStorage` is set BY HAND rather than by a first mount: what we want
 * to reproduce is a PAGE RELOAD, that is, a preference without a player — a first
 * mount would leave behind an already-open audio context and test something else.
 */
describe('useReplaySound — the sound already activated revives at the first gesture', () => {
  /** The exact state of a reload: the preference says "enabled", nothing has been born yet. */
  function reloadWithSoundOn() {
    localStorage.setItem('replay-sound-on', 'true')
    return mount()
  }

  it('at load, the preference is there but NOTHING sounds — that is the desync to repair', () => {
    const { result } = reloadWithSoundOn()
    expect(result.current.on).toBe(true)
    act(() => result.current.tick(1_900))
    act(() => result.current.tick(2_050)) // the kill passes here
    expect(ctx.gains).toHaveLength(0) // no player: not even a master gain
    expect(ctx.sources).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('THE FIRST CLICK ACTIVES: the sound goes out, and the preference STAYS at "enabled"', async () => {
    const { result } = reloadWithSoundOn()
    act(() => result.current.toggle())
    await act(async () => { await flushAudio() })
    expect(result.current.on).toBe(true)
    expect(localStorage.getItem('replay-sound-on')).toBe('true')
    expect(ctx.resumed).toBe(1)
    act(() => result.current.tick(1_900))
    act(() => result.current.tick(2_050))
    expect(ctx.sources).toHaveLength(1)
  })

  it('the NEXT click cuts, as usual: the toggle is not broken', async () => {
    const { result } = reloadWithSoundOn()
    act(() => result.current.toggle()) // this one activates
    await act(async () => { await flushAudio() })
    act(() => result.current.toggle()) // this one cuts
    expect(result.current.on).toBe(false)
    expect(localStorage.getItem('replay-sound-on')).toBe('false')
    act(() => result.current.tick(1_900))
    act(() => result.current.tick(2_050))
    expect(ctx.sources).toHaveLength(0)
  })

  it('a transport gesture is enough: the sound comes back without going through the button', async () => {
    const { result } = reloadWithSoundOn()
    act(() => result.current.wake())
    await act(async () => { await flushAudio() })
    expect(result.current.on).toBe(true)
    act(() => result.current.tick(1_900))
    act(() => result.current.tick(2_050))
    expect(ctx.sources).toHaveLength(1)
  })

  it('sound OFF: a transport gesture opens no context (the doctrine holds)', () => {
    const { result } = mount() // default preference: off
    act(() => result.current.wake())
    expect(ctx.gains).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('one more transport gesture recreates nothing: the born player remains the only one', async () => {
    const { result } = reloadWithSoundOn()
    act(() => result.current.wake())
    await act(async () => { await flushAudio() })
    const gains = ctx.gains.length
    act(() => result.current.wake())
    act(() => result.current.wake())
    expect(ctx.gains).toHaveLength(gains)
    expect(ctx.resumed).toBe(1)
  })

  it('the sound CONCLUSION benefits from it: a woken replay that reaches the end sounds', async () => {
    localStorage.setItem('replay-sound-on', 'true')
    const doc = docWithCouple()
    const { result } = renderHook(() =>
      useReplaySound(doc, [kill()], 1, { ...NO_CONTEXT, endMatch: { outcome: 'win', ffa: false, locale: 'en' } }),
    )
    act(() => result.current.wake())
    await act(async () => { await flushAudio() })
    act(() => result.current.endMatch())
    expect(ctx.sources).toHaveLength(2) // the voice and the fanfare
  })
})

/**
 * THE END OF MATCH (lot C, 2026-08-27). The SELECTION rules have their tests
 * (endMatchSound.test.ts); here we only judge the wiring — that the conclusion obeys the same
 * silences as the rest (sound off, fast forward), that its takes are ALREADY loaded when
 * it goes out (a file requested at the arrival would sound after the silence), and that the voice and the
 * fanfare do go out TOGETHER, two voices of the player and not a pre-mixed file.
 */
describe('useReplaySound — the end of match', () => {
  const VICTORY_SPEC: EndMatchSoundSpec = { outcome: 'win', ffa: false, locale: 'en' }

  /** The hook, mounted on the same single-kill match, with an end of match to announce. */
  function mountWithEnd(spec: EndMatchSoundSpec | null = VICTORY_SPEC) {
    const doc = docWithCouple()
    const kills = [kill()]
    return renderHook(() => useReplaySound(doc, kills, 1, { ...NO_CONTEXT, endMatch: spec }))
  }

  it('sound off: the conclusion does not sound, and opens no context on the way', () => {
    const { result } = mountWithEnd()
    act(() => result.current.endMatch())
    expect(ctx.sources).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the takes are preloaded WITH the track, drawing included', async () => {
    const { result } = mountWithEnd()
    act(() => result.current.toggle())
    await act(async () => { await flushAudio() })
    const charges = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(charges).toContain('/static/sounds/halo_infinite/end_victory_voice_en_01.ogg')
    expect(charges).toContain('/static/sounds/halo_infinite/end_victory_music_01.ogg')
    expect(charges).toContain('/static/sounds/halo_infinite/hinf_br75.ogg')
  })

  it('at the arrival, the voice and the fanfare go out together — two voices, not one', async () => {
    const { result } = mountWithEnd()
    act(() => result.current.toggle())
    await act(async () => { await flushAudio() })
    act(() => result.current.endMatch())
    expect(ctx.sources).toHaveLength(2)
  })

  // ITEM 11 (2026-09-26): on a dense end, the shots held the ceiling and the fanfare, played
  // after the voice, was silently refused. The fanfare alone lasts 9.9 s here: that is what we read.
  it('eight sounds in course at the arrival: the voice AND the fanfare go out anyway', async () => {
    fetchMock.mockImplementation((url: string) => Promise.resolve(okAudioResponse(url.includes('_music_') ? 9.9 : 1.2)))
    const eight = Array.from({ length: SOUND_MAX_VOICES }, () => kill())
    const { result } = renderHook(() => useReplaySound(docWithCouple(), eight, 1, { ...NO_CONTEXT, endMatch: VICTORY_SPEC }))
    act(() => result.current.toggle())
    await act(async () => { await flushAudio() })
    act(() => result.current.tick(1_900))
    act(() => result.current.tick(2_050)) // the eight kills go out together: ceiling full
    expect(ctx.sources).toHaveLength(SOUND_MAX_VOICES)
    act(() => result.current.endMatch())
    expect(ctx.sources).toHaveLength(SOUND_MAX_VOICES + 2)
    expect(ctx.sources.slice(SOUND_MAX_VOICES).map((s) => s.buffer?.duration)).toContain(9.9)
  })

  it('fast forward: the conclusion stays silent too, as the panel announces', async () => {
    const doc = docWithCouple()
    const { result } = renderHook(() =>
      useReplaySound(doc, [kill()], SOUND_MAX_SPEED * 2, { ...NO_CONTEXT, endMatch: VICTORY_SPEC }),
    )
    act(() => result.current.toggle())
    await act(async () => { await flushAudio() })
    expect(result.current.mutedBySpeed).toBe(true)
    act(() => result.current.endMatch())
    expect(ctx.sources).toHaveLength(0)
  })

  it('unreadable end: nothing to load, nothing to play — the rest of the sound is intact', async () => {
    const { result } = mountWithEnd(null)
    act(() => result.current.toggle())
    await act(async () => { await flushAudio() })
    expect(fetchMock).toHaveBeenCalledTimes(3) // the only sound of the match (the BR kill) + the intro + the countdown tick
    act(() => result.current.endMatch())
    expect(ctx.sources).toHaveLength(0)
  })
})

/**
 * THE TRACK FOR THE VIDEO (decision 6 of the capture plan). What these cases hold: a
 * silent replay makes NO audio node — the sound is off by default, and filming a match must
 * not open a context that no one asked for.
 */
describe('useReplaySound — the recording track', () => {
  it('sound off: no track, and above all no context opened on the way', () => {
    const { result } = mount()
    expect(result.current.recordingTrack()).toBeNull()
    expect(ctx.streamDests).toHaveLength(0)
  })

  it('sound enabled: the track exists and comes from the current player', async () => {
    const { result } = mount()
    act(() => result.current.toggle())
    await act(async () => { await flushAudio() })
    expect(result.current.recordingTrack()).toBe(ctx.streamDests[0].track)
  })

  it('cutting the sound afterwards returns `null` again', async () => {
    // The IN-PROGRESS clip keeps its track (it is wired at the start): what this case says,
    // is that a recording launched AFTER the cut restarts silent.
    const { result } = mount()
    act(() => result.current.toggle())
    await act(async () => { await flushAudio() })
    act(() => result.current.toggle())
    expect(result.current.recordingTrack()).toBeNull()
  })
})
