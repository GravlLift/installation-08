/**
 * useRemoteMatches.test.ts — loads the remote match list and local match ids while `signedIn`,
 * clears them when signed out, and `refresh()` reloads both. Fetch is mocked per URL since this
 * hook calls two different routes.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useRemoteMatches } from './useRemoteMatches'

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response
}

function routedFetch(routes: Record<string, () => Response>): ReturnType<typeof vi.fn> {
  return vi.fn((url: string) => {
    for (const [prefix, respond] of Object.entries(routes)) {
      if (url.startsWith(prefix)) return Promise.resolve(respond())
    }
    throw new Error(`unmocked fetch: ${url}`)
  })
}

describe('useRemoteMatches', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('loads nothing while signed out', () => {
    vi.stubGlobal('fetch', vi.fn())
    const { result } = renderHook(() => useRemoteMatches(false))
    expect(result.current.state).toEqual({ phase: 'idle' })
    expect(result.current.localIds.size).toBe(0)
  })

  it('loads the remote list and the local id set once signed in', async () => {
    const remote = [{ id: 'r1', map: 'Recharge', mode: 'Slayer', time: '2026-11-13T12:00:00Z' }]
    const local = [{ matchId: 'r1', mapName: 'Recharge', mapModule: 'm', build: 'b', durationMs: 1, players: null, importedAt: 'x' }]
    vi.stubGlobal(
      'fetch',
      routedFetch({
        '/api/remote/matches': () => jsonResponse(remote),
        '/api/matches': () => jsonResponse(local),
      }),
    )

    const { result } = renderHook(() => useRemoteMatches(true))
    expect(result.current.state).toEqual({ phase: 'loading' })

    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.state).toEqual({ phase: 'ready', matches: remote })
    expect(result.current.localIds.has('r1')).toBe(true)
  })

  it('surfaces a 401 (not signed in) as a readable error', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch({
        '/api/remote/matches': () => jsonResponse({ error: 'sign in required' }, false, 401),
        '/api/matches': () => jsonResponse([]),
      }),
    )

    const { result } = renderHook(() => useRemoteMatches(true))
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.state.phase).toBe('error')
    if (result.current.state.phase === 'error') {
      expect(result.current.state.message).toContain('sign in required')
    }
  })

  it('clears the list when signed out again', async () => {
    const remote = [{ id: 'r1', map: 'Recharge', mode: 'Slayer', time: 'x' }]
    vi.stubGlobal(
      'fetch',
      routedFetch({
        '/api/remote/matches': () => jsonResponse(remote),
        '/api/matches': () => jsonResponse([]),
      }),
    )

    const { result, rerender } = renderHook(({ signedIn }) => useRemoteMatches(signedIn), {
      initialProps: { signedIn: true },
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.state.phase).toBe('ready')

    rerender({ signedIn: false })
    expect(result.current.state).toEqual({ phase: 'idle' })
    expect(result.current.localIds.size).toBe(0)
  })

  it('refresh() reloads both routes', async () => {
    const fetchMock = routedFetch({
      '/api/remote/matches': () => jsonResponse([]),
      '/api/matches': () => jsonResponse([]),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useRemoteMatches(true))
    await act(async () => {
      await Promise.resolve()
    })
    const callsAfterLoad = fetchMock.mock.calls.length

    act(() => result.current.refresh())
    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchMock.mock.calls.length).toBe(callsAfterLoad + 2)
  })
})
