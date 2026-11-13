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

import { testReplayDoc } from '../features/match-replay/test/testDoc'
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
    vi.restoreAllMocks()
  })

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
    act(() => flushOneTick(250))
    expect(tick).toHaveBeenLastCalledWith(500)
    act(() => flushOneTick(250))
    expect(tick).toHaveBeenLastCalledWith(1000)
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
})
