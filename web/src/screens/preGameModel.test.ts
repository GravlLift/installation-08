import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildLineOf,
  COUNTDOWN_STEPS,
  preGameStepOfDocument,
  splitRosters,
  usePreGameCountdown,
} from './preGameModel'

afterEach(() => {
  vi.useRealTimers()
})

describe('preGameStepOfDocument', () => {
  it('names the document step', () => {
    expect(preGameStepOfDocument('document')).toBe('Loading the replay')
  })

  it('names the mesh step', () => {
    expect(preGameStepOfDocument('mesh')).toBe('Checking the map')
  })
})

describe('splitRosters', () => {
  const players = [
    { name: 'Jordan Plays', teamId: 0 },
    { name: 'Athena', teamId: 0 },
    { name: 'Rival One', teamId: 1 },
    { name: 'Rival Two', teamId: 1 },
  ]

  it('labels both teams by number when the player is not in the match', () => {
    const r = splitRosters(players, null)
    expect(r).toEqual({
      own: 'Team 1',
      other: 'Team 2',
      ally: ['Jordan Plays', 'Athena'],
      enemy: ['Rival One', 'Rival Two'],
    })
  })

  it('labels "Your team" and "Opponents" and moves the player side first', () => {
    const r = splitRosters(players, 'jordan  plays')
    expect(r).toEqual({
      own: 'Your team',
      other: 'Opponents',
      ally: ['Jordan Plays', 'Athena'],
      enemy: ['Rival One', 'Rival Two'],
    })
  })

  it('moves the player side first even when it is not the first team id', () => {
    const shuffled = [
      { name: 'Rival One', teamId: 0 },
      { name: 'Jordan Plays', teamId: 1 },
    ]
    const r = splitRosters(shuffled, 'jordanplays')
    expect(r?.own).toBe('Your team')
    expect(r?.ally).toEqual(['Jordan Plays'])
    expect(r?.enemy).toEqual(['Rival One'])
  })

  it('returns null when the match carries no players', () => {
    expect(splitRosters(null, 'Jordan Plays')).toBeNull()
    expect(splitRosters([], 'Jordan Plays')).toBeNull()
  })
})

describe('buildLineOf', () => {
  it('offers nothing while checking', () => {
    const line = buildLineOf({ phase: 'checking' }, false)
    expect(line).toEqual({ text: 'Checking build status…', action: null, actionLabel: null })
  })

  it('offers the build with a plain minutes warning when absent', () => {
    const line = buildLineOf({ phase: 'absent' }, false)
    expect(line.action).toBe('build')
    expect(line.actionLabel).toBe('Build map')
    expect(line.text).toBe('This map has not been built yet. A first build takes minutes.')
  })

  it('shows the queue position when the server carries it', () => {
    expect(buildLineOf({ phase: 'queued', queuePosition: 2 }, false).text).toBe('Queued (position 2)…')
    expect(buildLineOf({ phase: 'queued' }, false).text).toBe('Queued…')
  })

  it('shows the build elapsed time and offers cancel', () => {
    const line = buildLineOf({ phase: 'building', elapsedMs: 9500 }, false)
    expect(line.text).toBe('Building… 10s elapsed')
    expect(line.action).toBe('cancel')
    expect(line.actionLabel).toBe('Cancel')
  })

  it('shows the cancelling label while the cancel request is in flight', () => {
    expect(buildLineOf({ phase: 'building' }, true).actionLabel).toBe('Cancelling…')
  })

  it('offers a retry with the error on failure', () => {
    const line = buildLineOf({ phase: 'failed', error: 'disk full' }, false)
    expect(line.action).toBe('retry')
    expect(line.actionLabel).toBe('Retry')
    expect(line.text).toBe('Build failed: disk full')
  })

  it('offers the build again after a cancelled build', () => {
    const line = buildLineOf({ phase: 'cancelled' }, false)
    expect(line.action).toBe('build')
    expect(line.actionLabel).toBe('Build map')
  })

  it('reports the built map as loading', () => {
    expect(buildLineOf({ phase: 'ready' }, false).text).toBe('Map built, loading…')
  })
})

describe('usePreGameCountdown', () => {
  it('counts down one number per second, then fires onDone', async () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    const { result } = renderHook(() => usePreGameCountdown(onDone))
    expect(result.current.value).toBe(3)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.value).toBe(2)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.value).toBe(1)
    expect(onDone).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('skips on a key press and fires onDone once, immediately', () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    renderHook(() => usePreGameCountdown(onDone))
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    })
    expect(onDone).toHaveBeenCalledOnce()
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('skips on a click and re-renders on each step (the tick bump re-plays the animation)', async () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    const { result } = renderHook(() => usePreGameCountdown(onDone))
    const firstTick = result.current.tick
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.tick).toBe(firstTick + 1)
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerdown'))
    })
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('does not fire onDone when unmounted mid-count', () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    const { unmount } = renderHook(() => usePreGameCountdown(onDone))
    unmount()
    act(() => {
      vi.advanceTimersByTime(10000)
    })
    expect(onDone).not.toHaveBeenCalled()
  })

  it('exposes the 3, 2, 1 sequence', () => {
    expect(COUNTDOWN_STEPS).toEqual([3, 2, 1])
  })
})
