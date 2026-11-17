// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  COUNTDOWN_SKIP_GUARD_MS,
  sceneStepOf,
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
    expect(line).toEqual({ text: 'Checking build status…', action: null, actionLabel: null, fraction: null })
  })

  it('offers the build with a plain minutes warning when absent', () => {
    const line = buildLineOf({ phase: 'absent' }, false)
    expect(line.action).toBe('build')
    expect(line.actionLabel).toBe('Build map')
    expect(line.text).toBe('This map has not been built yet. A first build takes minutes.')
  })

  it('offers an update, not a first build, when the map is outdated', () => {
    const line = buildLineOf({ phase: 'outdated' }, false)
    expect(line.action).toBe('build')
    expect(line.actionLabel).toBe('Update map')
    expect(line.text).toBe('This map was built by an older version. Update it to get the new textures.')
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
    expect(line.fraction).toBeNull() // no fraction reported: the bar sweeps
  })

  it('names the stage with the percentage once the server reports a fraction', () => {
    const line = buildLineOf({ phase: 'building', elapsedMs: 60000, progress: 0.47, stage: 'textures' }, false)
    expect(line.text).toBe('Compressing textures… 47 % — about 1:07 left')
    expect(line.fraction).toBeCloseTo(0.47)
  })

  it('adds an estimated time left from elapsed time over progress once past 5%', () => {
    // 60 s elapsed at 25%: ~180 s left, formatted m:ss.
    const line = buildLineOf({ phase: 'building', elapsedMs: 60000, progress: 0.25, stage: 'textures' }, false)
    expect(line.text).toBe('Compressing textures… 25 % — about 3:00 left')
  })

  it('withholds the estimate below 5% (it would dance on the first reports)', () => {
    const line = buildLineOf({ phase: 'building', elapsedMs: 8000, progress: 0.04, stage: 'geometry' }, false)
    expect(line.text).toBe('Reading the map geometry… 4 %')
  })

  it('falls back to the elapsed count for a fraction of zero (an old server that sends the field)', () => {
    const line = buildLineOf({ phase: 'building', elapsedMs: 9500, progress: 0, stage: 'geometry' }, false)
    expect(line.text).toBe('Building… 10s elapsed')
    expect(line.fraction).toBeNull()
  })

  it('falls back to a plain building name for a stage the table does not know', () => {
    const line = buildLineOf({ phase: 'building', elapsedMs: 60000, progress: 0.5, stage: 'mystery' }, false)
    expect(line.text).toBe('Building… 50 % — about 1:00 left')
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

  it('ticks once per number as it appears (the countdown beep), never before it starts or after a skip', () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    const onTick = vi.fn()
    const { rerender } = renderHook(({ started }) => usePreGameCountdown(onDone, started, onTick), {
      initialProps: { started: false },
    })
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(onTick).not.toHaveBeenCalled()
    rerender({ started: true })
    expect(onTick.mock.calls).toEqual([[3]])
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(onTick.mock.calls).toEqual([[3], [2]])
    act(() => {
      vi.advanceTimersByTime(COUNTDOWN_SKIP_GUARD_MS)
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
      vi.advanceTimersByTime(2000)
    })
    expect(onTick.mock.calls).toEqual([[3], [2]])
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('ignores the key press that opened the match, and Escape', () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    renderHook(() => usePreGameCountdown(onDone))
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
      vi.advanceTimersByTime(COUNTDOWN_SKIP_GUARD_MS)
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(onDone).not.toHaveBeenCalled()
  })

  it('skips on a key press and fires onDone once, immediately', () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    renderHook(() => usePreGameCountdown(onDone))
    act(() => {
      vi.advanceTimersByTime(COUNTDOWN_SKIP_GUARD_MS)
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

describe('sceneStepOf', () => {
  const MB = 1024 * 1024
  it('names each phase of the scene load with its count and the overall fraction', () => {
    expect(sceneStepOf({ kind: 'loading', phase: 'download', fraction: 0.2, done: 42 * MB, total: 130 * MB }))
      .toEqual({ label: 'Downloading the map 42 / 130 MB', fraction: 0.2 })
    expect(sceneStepOf({ kind: 'loading', phase: 'download', fraction: 0, done: 3 * MB, total: 0 }).label).toBe('Downloading the map 3 MB')
    expect(sceneStepOf({ kind: 'loading', phase: 'decode', fraction: 0.3, done: 12, total: 40 }).label).toBe('Decoding textures 12 / 40')
    expect(sceneStepOf({ kind: 'loading', phase: 'index', fraction: 0.4, done: 0, total: 0 }).label).toBe('Preparing geometry')
    expect(sceneStepOf({ kind: 'loading', phase: 'variant-build', fraction: 0.4, done: 0, total: 0 }).label).toBe('Building the map objects')
    expect(sceneStepOf({ kind: 'loading', phase: 'assets', fraction: 0.6, done: 5, total: 9 }).label).toBe('Loading players and weapons 5 / 9')
    expect(sceneStepOf({ kind: 'loading', phase: 'warmup', fraction: 0.9, done: 0, total: 0 }).label).toBe('Compiling shaders')
    expect(sceneStepOf({ kind: 'ready' })).toEqual({ label: 'Ready', fraction: 1 })
  })
  it('claims no progress when the scene failed', () => {
    expect(sceneStepOf({ kind: 'error' }).fraction).toBeNull()
  })
})