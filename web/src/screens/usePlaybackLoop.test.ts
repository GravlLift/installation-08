// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * usePlaybackLoop.test.ts — regression for the duplicate-`requestAnimationFrame` bug: the hook
 * must schedule at most one tick per tick while playing, never two. Two schedules per tick double
 * the number of pending callbacks every animation frame, which looks like smooth playback for a
 * few seconds (the queue is still small) and then locks the main thread solid once a single
 * tick's queue outgrows the frame budget — this is what froze a real playback session after
 * ~12s, long after any particular frame's content (a death, a mode switch) had passed.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { scriptPlayback, startScript, stopScript } from '../features/match-replay/scene3d/cameraScriptStore'
import type { CameraScript } from '../features/match-replay/scene3d/cameraScript3d'
import { testReplayDoc } from '../features/match-replay/test/testDoc'
import { msToFrames } from '../lib/replay/replayLogic'
import { usePlaybackLoop } from './usePlaybackLoop'

describe('usePlaybackLoop', () => {
  let pending: FrameRequestCallback[] = []
  let now = 0

  beforeEach(() => {
    pending = []
    now = 0
    vi.spyOn(global, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      pending.push(cb)
      return pending.length
    })
    vi.spyOn(global, 'cancelAnimationFrame').mockImplementation(() => {})
    vi.spyOn(performance, 'now').mockImplementation(() => now)
  })

  afterEach(() => {
    stopScript()
    vi.restoreAllMocks()
  })

  /** A two-key world script; `lengthMs` is 2000 (its last key), or the clock's last rate's s, whichever is later. */
  function twoKeyWorldScript(clock?: CameraScript['clock']): CameraScript {
    return {
      version: 1,
      matchId: 'm',
      name: 'two-key',
      keys: [
        { t: 0, pos: { at: 'world', point: [0, 0, 0] }, look: { at: 'world', point: [1, 0, 0] } },
        { t: 2000, pos: { at: 'world', point: [2, 0, 0] }, look: { at: 'world', point: [3, 0, 0] } },
      ],
      ...(clock ? { clock } : {}),
    }
  }

  /** Runs every callback queued for "this" animation frame exactly once, as a real browser would. */
  function flushOneTick(advanceMs: number) {
    now += advanceMs
    const batch = pending
    pending = []
    for (const cb of batch) cb(now)
  }

  it('advances the sound clock at playback speed and signals the end once', () => {
    const doc = testReplayDoc({ frameCount: 31 })
    const tick = vi.fn()
    const onEnded = vi.fn()
    renderHook(() => usePlaybackLoop({ doc, playing: true, speed: 2, fps: 30, frameRef: { current: 0 }, setFrame: vi.fn(), setPlaying: vi.fn(), tick, onEnded }))
    // The moment, and the frame's timestamp the sound schedules ahead from.
    act(() => flushOneTick(250))
    expect(tick).toHaveBeenLastCalledWith(500, 250)
    act(() => flushOneTick(250))
    expect(tick).toHaveBeenLastCalledWith(1000, 500)
    expect(onEnded).toHaveBeenCalledOnce()
    expect(pending).toHaveLength(0)
  })

  it('schedules exactly one callback per tick while playing (never doubles the queue)', () => {
    const doc = testReplayDoc({ frameCount: 100_000 })
    const frameRef = { current: 0 }
    const setFrame = vi.fn()
    const setPlaying = vi.fn()

    renderHook(() =>
      usePlaybackLoop({ doc, playing: true, speed: 1, fps: 30, frameRef, setFrame, setPlaying }),
    )

    expect(pending.length).toBe(1)
    for (let tick = 0; tick < 10; tick++) {
      act(() => flushOneTick(16))
      // If the hook ever schedules more than one callback per tick, this grows geometrically
      // (2, 4, 8, ...) instead of staying at 1 — that growth is exactly what froze the real page.
      expect(pending.length).toBe(1)
    }
  })

  it('stops scheduling once the document ends, without scheduling a trailing extra tick', () => {
    const doc = testReplayDoc({ frameCount: 5 })
    const frameRef = { current: 0 }
    const setFrame = vi.fn()
    const setPlaying = vi.fn()

    renderHook(() =>
      usePlaybackLoop({ doc, playing: true, speed: 1000, fps: 30, frameRef, setFrame, setPlaying }),
    )

    // A huge speed jumps straight to the last frame in one tick.
    act(() => flushOneTick(1000))

    expect(setPlaying).toHaveBeenCalledWith(false)
    expect(pending.length).toBe(0)
  })

  it('advances the script clock and follows the film frame from its document time', () => {
    const doc = testReplayDoc({ frameCount: 1000, frameIntervalMs: 100 })
    const frameRef = { current: 0 }
    const setFrame = vi.fn()
    const tick = vi.fn()
    startScript(twoKeyWorldScript({ startMs: 3000, rates: [{ s: 0, rate: 0.5, ease: 'linear' }] }))
    renderHook(() => usePlaybackLoop({ doc, playing: true, speed: 1, fps: 10, frameRef, setFrame, setPlaying: vi.fn(), tick }))

    act(() => flushOneTick(1000))

    expect(scriptPlayback()?.sMs).toBe(1000)
    expect(frameRef.current).toBe(msToFrames(3500, doc))
    expect(setFrame).toHaveBeenLastCalledWith(Math.round(msToFrames(3500, doc)))
    // rate 0.5: the sound stays silent
    expect(tick).not.toHaveBeenCalled()
  })

  it('a frozen (rate-0) clock keeps the film frame fixed while the script time advances', () => {
    const doc = testReplayDoc({ frameCount: 1000, frameIntervalMs: 100 })
    const frameRef = { current: 0 }
    startScript(twoKeyWorldScript({ startMs: 5000, rates: [{ s: 0, rate: 0, ease: 'linear' }] }))
    renderHook(() => usePlaybackLoop({ doc, playing: true, speed: 1, fps: 10, frameRef, setFrame: vi.fn(), setPlaying: vi.fn() }))

    act(() => flushOneTick(1000))
    const fixed = frameRef.current
    expect(fixed).toBe(msToFrames(5000, doc))
    act(() => flushOneTick(1000))

    expect(frameRef.current).toBe(fixed)
    expect(scriptPlayback()?.sMs).toBe(2000)
  })

  it('re-places the sound cursor on the first full-rate frame after a silent stretch, then ticks', () => {
    const doc = testReplayDoc({ frameCount: 1000, frameIntervalMs: 100 })
    const tick = vi.fn()
    const seek = vi.fn()
    startScript(twoKeyWorldScript({ startMs: 0, rates: [{ s: 0, rate: 0.5, ease: 'linear' }, { s: 1000, rate: 1, ease: 'linear' }] }))
    renderHook(() => usePlaybackLoop({ doc, playing: true, speed: 1, fps: 10, frameRef: { current: 0 }, setFrame: vi.fn(), setPlaying: vi.fn(), tick, seek }))

    act(() => flushOneTick(500)) // sMs=500: below full rate, silent
    expect(tick).not.toHaveBeenCalled()
    expect(seek).not.toHaveBeenCalled()
    act(() => flushOneTick(500)) // sMs=1000: first full-rate frame re-places the cursor (a jump, not a burst)
    expect(seek).toHaveBeenCalledTimes(1)
    expect(seek).toHaveBeenLastCalledWith(750)
    expect(tick).not.toHaveBeenCalled()
    act(() => flushOneTick(500)) // sMs=1500: in sync, ticks from here
    expect(tick).toHaveBeenCalledTimes(1)
    expect(tick).toHaveBeenLastCalledWith(1250, 1500)
  })

  it('re-places the cursor (seek, not tick) on a script\'s first full-rate frame', () => {
    const doc = testReplayDoc({ frameCount: 1000, frameIntervalMs: 100 })
    const tick = vi.fn()
    const seek = vi.fn()
    startScript(twoKeyWorldScript({ startMs: 3000, rates: [{ s: 0, rate: 1, ease: 'linear' }] }))
    renderHook(() => usePlaybackLoop({ doc, playing: true, speed: 1, fps: 10, frameRef: { current: 0 }, setFrame: vi.fn(), setPlaying: vi.fn(), tick, seek }))

    act(() => flushOneTick(1000)) // sMs=1000, docMsAt = 3000 + 1000 = 4000

    expect(seek).toHaveBeenCalledTimes(1)
    expect(seek).toHaveBeenLastCalledWith(4000)
    expect(tick).not.toHaveBeenCalled()
  })

  it('ends playback at the script length without the match-end sound', () => {
    const doc = testReplayDoc({ frameCount: 1000, frameIntervalMs: 100 })
    const setPlaying = vi.fn()
    const onEnded = vi.fn()
    startScript(twoKeyWorldScript())
    renderHook(() => usePlaybackLoop({ doc, playing: true, speed: 1, fps: 10, frameRef: { current: 0 }, setFrame: vi.fn(), setPlaying, onEnded }))

    act(() => flushOneTick(2000))

    expect(setPlaying).toHaveBeenCalledWith(false)
    expect(onEnded).not.toHaveBeenCalled()
    expect(pending).toHaveLength(0)
    // the script stays loaded, holding its last pose
    expect(scriptPlayback()).not.toBeNull()
  })
})
