/**
 * useRemoteMatches.test.ts — loads the remote match list and local match ids while `signedIn`,
 * clears them when signed out, and `refresh()` reloads both. Fetch is mocked per URL since this
 * hook calls two different routes.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GAMERTAG_NOT_FOUND, useRemoteMatches } from './useRemoteMatches'

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

  it('re-requests the list once after 5 s when an entry lacks its map picture', async () => {
    const missing = [{ id: 'r1', map: 'Recharge', mode: 'Slayer', time: 'x', mapAssetId: 'a1' }]
    const withImage = missing.map((m) => ({ ...m, mapImageUrl: '/static/maps/halo_infinite/a1.png' }))
    let answer: typeof missing = missing
    const remoteCalls: number[] = []
    const fetchMock = routedFetch({
      '/api/remote/matches': () => {
        remoteCalls.push(1)
        return jsonResponse(answer)
      },
      '/api/matches': () => jsonResponse([]),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useRemoteMatches(true))
    await act(async () => {
      await Promise.resolve()
    })
    expect(remoteCalls.length).toBe(1)
    expect(result.current.state).toEqual({ phase: 'ready', matches: missing })

    // Nothing happens before the follow-up delay.
    act(() => {
      vi.advanceTimersByTime(4999)
    })
    expect(remoteCalls.length).toBe(1)

    // The single follow-up re-requests the list; the server now answers with the image.
    answer = withImage
    act(() => {
      vi.advanceTimersByTime(1)
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(remoteCalls.length).toBe(2)
    expect(result.current.state).toEqual({ phase: 'ready', matches: withImage })

    // It is a single follow-up: with every entry now carrying its picture, time passes
    // and no third request is made.
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(remoteCalls.length).toBe(2)
  })

  it('does not follow up again when the follow-up response still lacks the map picture', async () => {
    // The image never arrives (a failed download, a small-image asset): the list must be
    // re-requested exactly once, not every 5 s forever.
    const missing = [{ id: 'r1', map: 'Recharge', mode: 'Slayer', time: 'x', mapAssetId: 'a1' }]
    const remoteCalls: number[] = []
    const fetchMock = routedFetch({
      '/api/remote/matches': () => {
        remoteCalls.push(1)
        return jsonResponse(missing)
      },
      '/api/matches': () => jsonResponse([]),
    })
    vi.stubGlobal('fetch', fetchMock)

    renderHook(() => useRemoteMatches(true))
    await act(async () => {
      await Promise.resolve()
    })
    expect(remoteCalls.length).toBe(1)

    // 20 s of fake time: four follow-up delays past. Exactly one follow-up may fire.
    act(() => {
      vi.advanceTimersByTime(20_000)
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(remoteCalls.length).toBe(2)
  })

  it('does not follow up when every entry already carries its map picture', async () => {
    const withImage = [{ id: 'r1', map: 'Recharge', mode: 'Slayer', time: 'x', mapAssetId: 'a1', mapImageUrl: '/static/maps/halo_infinite/a1.png' }]
    const remoteCalls: number[] = []
    const fetchMock = routedFetch({
      '/api/remote/matches': () => {
        remoteCalls.push(1)
        return jsonResponse(withImage)
      },
      '/api/matches': () => jsonResponse([]),
    })
    vi.stubGlobal('fetch', fetchMock)

    renderHook(() => useRemoteMatches(true))
    await act(async () => {
      await Promise.resolve()
    })
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(remoteCalls.length).toBe(1)
  })

  it("loads a searched player's matches through ?gamertag= and reloads when it changes", async () => {
    const urls: string[] = []
    const fetchMock = vi.fn((url: string) => {
      urls.push(url)
      if (url.startsWith('/api/remote/matches')) {
        const id = url.includes('gamertag=') ? decodeURIComponent(url.split('gamertag=')[1]) : 'own'
        return Promise.resolve(jsonResponse([{ id, map: 'Streets', mode: 'Slayer', time: 'x' }]))
      }
      return Promise.resolve(jsonResponse([]))
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result, rerender } = renderHook(({ gt }) => useRemoteMatches(true, gt), {
      initialProps: { gt: null as string | null },
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.loadedFor).toBeNull()
    expect(result.current.state).toEqual({ phase: 'ready', matches: [{ id: 'own', map: 'Streets', mode: 'Slayer', time: 'x' }] })

    rerender({ gt: 'Other Player' })
    expect(result.current.state).toEqual({ phase: 'loading' })
    await act(async () => {
      await Promise.resolve()
    })
    expect(urls).toContain('/api/remote/matches?gamertag=Other%20Player')
    expect(result.current.loadedFor).toBe('Other Player')
    expect(result.current.state).toEqual({
      phase: 'ready',
      matches: [{ id: 'Other Player', map: 'Streets', mode: 'Slayer', time: 'x' }],
    })

    // Clearing the search goes back to the account's own list.
    rerender({ gt: null })
    await act(async () => {
      await Promise.resolve()
    })
    expect(urls[urls.length - 2]).toBe('/api/remote/matches')
    expect(result.current.loadedFor).toBeNull()
  })

  it('words a 404 for a searched gamertag as "Gamertag not found"', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch({
        '/api/remote/matches': () => jsonResponse({ error: 'gamertag not found' }, false, 404),
        '/api/matches': () => jsonResponse([]),
      }),
    )
    const { result } = renderHook(() => useRemoteMatches(true, 'Nobody'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.state).toEqual({ phase: 'error', message: GAMERTAG_NOT_FOUND })
    expect(result.current.loadedFor).toBe('Nobody')
  })

  it('keeps the ready list on screen while refresh() reloads it', async () => {
    const remote = [{ id: 'r1', map: 'Recharge', mode: 'Slayer', time: 'x' }]
    let release: () => void = () => {}
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.startsWith('/api/remote/matches')) {
          calls++
          if (calls === 1) return Promise.resolve(jsonResponse(remote))
          return new Promise<Response>((resolve) => {
            release = () => resolve(jsonResponse(remote))
          })
        }
        return Promise.resolve(jsonResponse([]))
      }),
    )
    const { result } = renderHook(() => useRemoteMatches(true, 'Other'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.state.phase).toBe('ready')
    act(() => result.current.refresh())
    expect(result.current.state).toEqual({ phase: 'ready', matches: remote })
    await act(async () => {
      release()
      await Promise.resolve()
    })
    expect(calls).toBe(2)
    expect(result.current.state).toEqual({ phase: 'ready', matches: remote })
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
