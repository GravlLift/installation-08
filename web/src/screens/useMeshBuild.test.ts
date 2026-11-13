/**
 * useMeshBuild.test.ts — the build panel's state machine: initial state check, starting a
 * build, polling while queued/building, stopping on ready/failed, and cleaning up its timer and
 * in-flight requests on unmount (no poll ever fires after that).
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MeshStateBody } from '../lib/api/standalone'
import { isMeshBuildInFlight, phaseOfMeshState, useMeshBuild } from './useMeshBuild'

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response
}

describe('phaseOfMeshState', () => {
  it('maps every server state to its phase', () => {
    const base: MeshStateBody = { state: 'absent', moduleKey: 'mod' }
    expect(phaseOfMeshState(base)).toEqual({ phase: 'absent', moduleKey: 'mod' })
    expect(phaseOfMeshState({ ...base, state: 'queued', queuePosition: 2 })).toEqual({
      phase: 'queued',
      moduleKey: 'mod',
      queuePosition: 2,
    })
    expect(phaseOfMeshState({ ...base, state: 'building', elapsedMs: 500 })).toEqual({
      phase: 'building',
      moduleKey: 'mod',
      elapsedMs: 500,
    })
    expect(phaseOfMeshState({ ...base, state: 'ready' })).toEqual({ phase: 'ready', moduleKey: 'mod' })
    expect(phaseOfMeshState({ ...base, state: 'failed', error: 'boom' })).toEqual({
      phase: 'failed',
      moduleKey: 'mod',
      error: 'boom',
    })
  })
})

describe('isMeshBuildInFlight', () => {
  it('is true only for queued/building', () => {
    expect(isMeshBuildInFlight({ phase: 'checking' })).toBe(false)
    expect(isMeshBuildInFlight({ phase: 'absent', moduleKey: '' })).toBe(false)
    expect(isMeshBuildInFlight({ phase: 'queued', moduleKey: '' })).toBe(true)
    expect(isMeshBuildInFlight({ phase: 'building', moduleKey: '' })).toBe(true)
    expect(isMeshBuildInFlight({ phase: 'ready', moduleKey: '' })).toBe(false)
    expect(isMeshBuildInFlight({ phase: 'failed', moduleKey: '', error: 'x' })).toBe(false)
  })
})

describe('useMeshBuild', () => {
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

  it('checks state once on mount and lands on absent with no polling', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ state: 'absent', moduleKey: 'mod-a' }))

    const { result } = renderHook(() => useMeshBuild('match-1', 2000))
    expect(result.current.phase).toEqual({ phase: 'checking' })

    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.phase).toEqual({ phase: 'absent', moduleKey: 'mod-a' })

    // No build in flight: advancing time must not issue a second fetch.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('polls while building and stops at ready', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ state: 'building', moduleKey: 'mod-b', elapsedMs: 0 }))
      .mockResolvedValueOnce(jsonResponse({ state: 'building', moduleKey: 'mod-b', elapsedMs: 2000 }))
      .mockResolvedValueOnce(jsonResponse({ state: 'ready', moduleKey: 'mod-b' }))

    const { result } = renderHook(() => useMeshBuild('match-2', 2000))
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.phase).toEqual({ phase: 'building', moduleKey: 'mod-b', elapsedMs: 0 })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(result.current.phase).toEqual({ phase: 'building', moduleKey: 'mod-b', elapsedMs: 2000 })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(result.current.phase).toEqual({ phase: 'ready', moduleKey: 'mod-b' })

    // Ready: no further polling, however long time passes.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('build() starts a build from absent and then polls until failed, with retry', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ state: 'absent', moduleKey: 'mod-c' })) // initial check
      .mockResolvedValueOnce(jsonResponse({ state: 'queued', moduleKey: 'mod-c', queuePosition: 1 })) // POST build
      .mockResolvedValueOnce(jsonResponse({ state: 'failed', moduleKey: 'mod-c', error: 'game not found' })) // poll
      .mockResolvedValueOnce(jsonResponse({ state: 'queued', moduleKey: 'mod-c' })) // retry POST build

    const { result } = renderHook(() => useMeshBuild('match-3', 1000))
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.phase).toEqual({ phase: 'absent', moduleKey: 'mod-c' })

    act(() => result.current.build())
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.phase).toEqual({ phase: 'queued', moduleKey: 'mod-c', queuePosition: 1 })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.phase).toEqual({
      phase: 'failed',
      moduleKey: 'mod-c',
      error: 'game not found',
    })

    // Failed stops polling on its own...
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)

    // ...and retry (another `build()` call) starts a fresh request.
    act(() => result.current.build())
    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(result.current.phase).toEqual({ phase: 'queued', moduleKey: 'mod-c' })
  })

  it('stops polling and issues no further fetch after unmount', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ state: 'building', moduleKey: 'mod-d' }))

    const { result, unmount } = renderHook(() => useMeshBuild('match-4', 1000))
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.phase).toEqual({ phase: 'building', moduleKey: 'mod-d' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    unmount()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('restarts its check when matchId changes', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ state: 'absent', moduleKey: 'mod-e' }))
      .mockResolvedValueOnce(jsonResponse({ state: 'ready', moduleKey: 'mod-f' }))

    const { result, rerender } = renderHook(({ id }) => useMeshBuild(id, 1000), {
      initialProps: { id: 'match-5' },
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.phase).toEqual({ phase: 'absent', moduleKey: 'mod-e' })

    rerender({ id: 'match-6' })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.phase).toEqual({ phase: 'ready', moduleKey: 'mod-f' })
  })
})
