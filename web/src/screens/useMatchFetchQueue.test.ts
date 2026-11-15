/**
 * useMatchFetchQueue.test.ts — per-row remote-match fetch progress: starting a job, queueing
 * several rows at once (the server downloads them one after another, positions included),
 * polling while a job is in flight, stopping on ready/failed (and calling `onReady`), the
 * 409-conflict fallback to polling the row's own state, and cleanup on unmount.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FetchStateBody } from '../lib/api/standalone'
import { isFetchRowInFlight, phaseOfFetchState, useMatchFetchQueue } from './useMatchFetchQueue'

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response
}

function queued(matchId: string, position = 1): FetchStateBody {
  return { state: 'queued', matchId, done: 0, total: 0, position }
}

describe('phaseOfFetchState', () => {
  it('maps every server state to its phase', () => {
    const base: FetchStateBody = { state: 'idle', matchId: 'm', done: 0, total: 0 }
    expect(phaseOfFetchState(base)).toEqual({ phase: 'idle' })
    expect(phaseOfFetchState({ ...base, state: 'queued', position: 2 })).toEqual({
      phase: 'queued',
      position: 2,
    })
    expect(phaseOfFetchState({ ...base, state: 'queued' })).toEqual({
      phase: 'queued',
      position: 1,
    })
    expect(phaseOfFetchState({ ...base, state: 'downloading', done: 3, total: 10 })).toEqual({
      phase: 'downloading',
      done: 3,
      total: 10,
    })
    expect(phaseOfFetchState({ ...base, state: 'building' })).toEqual({ phase: 'building' })
    expect(phaseOfFetchState({ ...base, state: 'ready' })).toEqual({ phase: 'ready' })
    expect(phaseOfFetchState({ ...base, state: 'failed', error: 'film not available' })).toEqual({
      phase: 'failed',
      error: 'film not available',
    })
  })
})

describe('isFetchRowInFlight', () => {
  it('is true for idle/queued/downloading/building/blocked', () => {
    // `idle` here means "polled this id after a conflict and it is still not ours" — the
    // polling effect keeps going; a row with no entry at all (never started) is a separate
    // case the effect checks for itself (`!current`), not something this function sees.
    expect(isFetchRowInFlight({ phase: 'idle' })).toBe(true)
    expect(isFetchRowInFlight({ phase: 'queued', position: 1 })).toBe(true)
    expect(isFetchRowInFlight({ phase: 'downloading', done: 0, total: 0 })).toBe(true)
    expect(isFetchRowInFlight({ phase: 'building' })).toBe(true)
    expect(isFetchRowInFlight({ phase: 'blocked' })).toBe(true)
    expect(isFetchRowInFlight({ phase: 'ready' })).toBe(false)
    expect(isFetchRowInFlight({ phase: 'failed', error: 'x' })).toBe(false)
  })
})

describe('useMatchFetchQueue', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('starts a fetch, polls until ready, and calls onReady exactly once', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(queued('a'))) // POST
      .mockResolvedValueOnce(jsonResponse({ state: 'downloading', matchId: 'a', done: 1, total: 4 })) // poll 1
      .mockResolvedValueOnce(jsonResponse({ state: 'building', matchId: 'a', done: 4, total: 4 })) // poll 2
      .mockResolvedValueOnce(jsonResponse({ state: 'ready', matchId: 'a', done: 4, total: 4 })) // poll 3

    const onReady = vi.fn()
    const { result } = renderHook(() => useMatchFetchQueue(onReady, 1000))

    act(() => result.current.start('a'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.phaseOf('a')).toEqual({ phase: 'queued', position: 1 })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.phaseOf('a')).toEqual({ phase: 'downloading', done: 1, total: 4 })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.phaseOf('a')).toEqual({ phase: 'building' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.phaseOf('a')).toEqual({ phase: 'ready' })
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(onReady).toHaveBeenCalledWith('a')

    // Ready: no further polling.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('queues several rows at once: each shows its position, then moves to progress', async () => {
    // POST a (position 1), POST b (position 2), then poll rounds: a downloading, b queued (2);
    // then a ready, b downloading; then b ready.
    fetchMock
      .mockResolvedValueOnce(jsonResponse(queued('a', 1))) // POST a
      .mockResolvedValueOnce(jsonResponse(queued('b', 2))) // POST b
      .mockResolvedValueOnce(jsonResponse({ state: 'downloading', matchId: 'a', done: 1, total: 4 })) // poll a
      .mockResolvedValueOnce(jsonResponse(queued('b', 2))) // poll b
      .mockResolvedValueOnce(jsonResponse({ state: 'ready', matchId: 'a', done: 4, total: 4 })) // poll a
      .mockResolvedValueOnce(jsonResponse({ state: 'downloading', matchId: 'b', done: 1, total: 2 })) // poll b
      .mockResolvedValueOnce(jsonResponse({ state: 'ready', matchId: 'b', done: 2, total: 2 })) // poll b

    const onReady = vi.fn()
    const { result } = renderHook(() => useMatchFetchQueue(onReady, 1000))

    act(() => {
      result.current.start('a')
      result.current.start('b')
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.phaseOf('a')).toEqual({ phase: 'queued', position: 1 })
    expect(result.current.phaseOf('b')).toEqual({ phase: 'queued', position: 2 })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.phaseOf('a')).toEqual({ phase: 'downloading', done: 1, total: 4 })
    expect(result.current.phaseOf('b')).toEqual({ phase: 'queued', position: 2 })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.phaseOf('a')).toEqual({ phase: 'ready' })
    expect(result.current.phaseOf('b')).toEqual({ phase: 'downloading', done: 1, total: 2 })
    expect(onReady).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.phaseOf('b')).toEqual({ phase: 'ready' })
    expect(onReady).toHaveBeenCalledTimes(2)
    expect(onReady).toHaveBeenLastCalledWith('b')
  })

  it('start() on a row that already has a job in flight no-ops (no duplicate POST)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(queued('a', 1)))

    const { result } = renderHook(() => useMatchFetchQueue(vi.fn(), 1000))
    act(() => result.current.start('a'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.phaseOf('a')).toEqual({ phase: 'queued', position: 1 })

    act(() => result.current.start('a'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.phaseOf('a')).toEqual({ phase: 'queued', position: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a 409 conflict falls back to polling the row state instead of erroring', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'fetch already in progress' }, false, 409)) // POST conflict
      .mockResolvedValueOnce(jsonResponse({ state: 'idle', matchId: 'a', done: 0, total: 0 })) // poll: still someone else's job
      .mockResolvedValueOnce(jsonResponse({ state: 'ready', matchId: 'a', done: 4, total: 4 })) // poll: it was ours after all

    const onReady = vi.fn()
    const { result } = renderHook(() => useMatchFetchQueue(onReady, 1000))

    act(() => result.current.start('a'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.phaseOf('a')).toEqual({ phase: 'blocked' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.phaseOf('a')).toEqual({ phase: 'idle' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.phaseOf('a')).toEqual({ phase: 'ready' })
    expect(onReady).toHaveBeenCalledWith('a')
  })

  it('a failed job leaves the queue so another row can start', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(queued('a', 1)))
      .mockResolvedValueOnce(
        jsonResponse({ state: 'failed', matchId: 'a', done: 0, total: 0, error: 'film not available' }),
      )
      .mockResolvedValueOnce(jsonResponse(queued('b', 1)))

    const { result } = renderHook(() => useMatchFetchQueue(vi.fn(), 1000))
    act(() => result.current.start('a'))
    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.phaseOf('a')).toEqual({ phase: 'failed', error: 'film not available' })

    act(() => result.current.start('b'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.phaseOf('b')).toEqual({ phase: 'queued', position: 1 })
  })

  it('stops polling and issues no further fetch after unmount', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(queued('a', 1)))

    const { result, unmount } = renderHook(() => useMatchFetchQueue(vi.fn(), 1000))
    act(() => result.current.start('a'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    unmount()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
