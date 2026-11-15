/**
 * useAudioUnlock.test.tsx — THE SOUND ALREADY ENABLED REVIVES ON THE FIRST GESTURE ON THE PAGE
 * (item 12 of the backlog plan of 2026-09-26, decision D-10), judged through `useReplaySound`:
 * that is where the user hears it, or not.
 *
 * THE MEASURED DEFECT (A2.0, Chromium and Firefox, default autoplay policy): with automatic
 * playback, the playback starts without "Play" nor "Restart"; no player is born, and a click
 * elsewhere on the page changes nothing. The replay stays silent until the sound button is
 * touched. Going from one replay to another with automatic playback, same silence, even though
 * the document has already received a gesture.
 *
 * We simulate a RELOAD: the preference is "enabled" in local storage, and nothing has been born.
 */
import { act, fireEvent, renderHook } from '@testing-library/react'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NO_ALLEGIANCE } from '@/lib/replay/filmAllegiance'

import type { ReplayKill } from '../model/killFeedLogic'
import { type FakeContext, flushAudio, installFakeAudio } from '../test/fakeAudio'
import { testReplayDoc } from '../test/testDoc'
import { useReplaySound, type ReplaySoundContext } from './useReplaySound'

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
  // `userActivation` is set on the instance by some tests: we remove it.
  Reflect.deleteProperty(navigator, 'userActivation')
})

/** A BR kill at 2,000 ms: enough to hear (or not) a sound. */
function kill(): ReplayKill {
  return {
    replayMs: 2_000, medals: [],
    tMs: 2_000, xuid: 'K', teamID: 0,
    weaponKey: 'hinf_br75', weaponLabel: 'BR75', weaponImageUrl: '', weaponTinted: false,
    assistState: '', assistGamertag: '', assistTeamID: null,
    killerDamagePct: null, assistDamagePct: null,
    victimXuid: 'V', victimGamertag: 'Victim',
  }
}

function mount() {
  const doc = testReplayDoc({
    frameIntervalMs: 100,
    tracks: [
      { slot: 1, team: -1, xuid: 'K', points: [{ t: 0, x: 0, y: 0 }, { t: 100, x: 10, y: 0 }], startFrame: 0, endFrame: 100 },
      { slot: 2, team: -1, xuid: 'V', points: [{ t: 0, x: 5, y: 5 }, { t: 20, x: 5, y: 4 }], startFrame: 0, endFrame: 20 },
    ],
  })
  const kills = [kill()]
  return renderHook(() => useReplaySound(doc, kills, 1, NO_CONTEXT))
}

/** Has the document already received a gesture? (API `navigator.userActivation`, absent from jsdom.) */
function documentAlreadyActive(active: boolean) {
  Object.defineProperty(navigator, 'userActivation', { value: { hasBeenActive: active }, configurable: true })
}

/** The kill passes: a sound goes out if, and only if, a player is alive. */
function playKill(result: { current: ReturnType<typeof useReplaySound> }) {
  act(() => result.current.tick(1_900))
  act(() => result.current.tick(2_050))
}

describe('useAudioUnlock — preference "enabled", no player (reload)', () => {
  beforeEach(() => localStorage.setItem('replay-sound-on', 'true'))

  it('the first CLICK anywhere on the page opens the player, only once', async () => {
    const { result } = mount()
    fireEvent.click(document.body)
    await act(async () => { await flushAudio() })
    expect(ctx.resumed).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(3) // the kill + the intro excerpt (item 7) + the countdown tick
    playKill(result)
    expect(ctx.sources).toHaveLength(1)
    fireEvent.click(document.body)
    fireEvent.keyUp(document.body, { key: 'x' })
    expect(ctx.resumed).toBe(1)
  })

  it('a KEY too (on release) opens the player', async () => {
    const { result } = mount()
    fireEvent.keyUp(document.body, { key: 'x' })
    await act(async () => { await flushAudio() })
    expect(ctx.resumed).toBe(1)
    playKill(result)
    expect(ctx.sources).toHaveLength(1)
  })

  it('the listener is REMOVED after the first gesture', async () => {
    const removed = vi.spyOn(document, 'removeEventListener')
    mount()
    fireEvent.click(document.body)
    await act(async () => { await flushAudio() })
    const types = removed.mock.calls.map(([type]) => type)
    expect(types).toEqual(expect.arrayContaining(['click', 'keyup']))
  })

  it('document ALREADY active at display (another replay without reload): the player opens without gesture', async () => {
    documentAlreadyActive(true)
    const { result } = mount()
    await act(async () => { await flushAudio() })
    expect(ctx.resumed).toBe(1)
    playKill(result)
    expect(ctx.sources).toHaveLength(1)
  })

  it('document never activated: NOTHING before the gesture (autoplay policy)', () => {
    documentAlreadyActive(false)
    const { result } = mount()
    playKill(result)
    expect(ctx.gains).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /**
   * NON-REGRESSION OF 2026-08-27: the first click on the SOUND BUTTON activates, it does not cut.
   * A real click emits `pointerdown` then `click`; the button (React, under the root) sees its
   * `click` BEFORE the document's listener. A listener on `pointerdown` would open the player
   * BEFORE the toggle, which would find it alive and CUT: two clicks to hear, the 08/27 defect
   * back through another door.
   */
  it('the first click on the SOUND BUTTON activates and does not cut', async () => {
    const { result } = mount()
    fireEvent.pointerDown(document.body)
    act(() => result.current.toggle()) // the button's `click`, under the React root
    fireEvent.click(document.body) // then the same `click`, arriving at the document
    await act(async () => { await flushAudio() })
    expect(result.current.on).toBe(true)
    expect(localStorage.getItem('replay-sound-on')).toBe('true')
    expect(ctx.resumed).toBe(1)
    playKill(result)
    expect(ctx.sources).toHaveLength(1)
  })

  it('the M key (sound shortcut, on `keydown`) activates and does not cut', async () => {
    const { result } = mount()
    fireEvent.keyDown(document.body, { key: 'm' })
    act(() => result.current.toggle()) // the shortcut, listened by the window on `keydown`
    fireEvent.keyUp(document.body, { key: 'm' })
    await act(async () => { await flushAudio() })
    expect(result.current.on).toBe(true)
    expect(ctx.resumed).toBe(1)
  })

  it('unmounted before any gesture: a click afterwards opens nothing', () => {
    const { unmount } = mount()
    unmount()
    fireEvent.click(document.body)
    expect(ctx.gains).toHaveLength(0)
  })
})

describe('useAudioUnlock — preference "off"', () => {
  it('neither gesture nor already-active document open anything, nothing is downloaded', async () => {
    documentAlreadyActive(true)
    const { result } = mount()
    fireEvent.click(document.body)
    fireEvent.keyUp(document.body, { key: 'x' })
    await act(async () => { await flushAudio() })
    playKill(result)
    expect(result.current.on).toBe(false)
    expect(ctx.gains).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
