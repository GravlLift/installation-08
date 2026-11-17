// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useAuthState.test.ts — the account panel's state machine: initial check, polling while
 * pending, stopping on signed_in/signed_out/failed, login/logout transitions, and cleanup of its
 * timer and in-flight requests on unmount (no poll ever fires after that). Mirrors
 * `useMeshBuild.test.ts`'s structure.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthStateBody } from '../lib/api/standalone'
import { isAuthPending, phaseOfAuthState, useAuthState } from './useAuthState'

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response
}

describe('phaseOfAuthState', () => {
  it('maps every server state to its phase', () => {
    expect(phaseOfAuthState({ state: 'signed_out' })).toEqual({ phase: 'signed_out' })
    expect(
      phaseOfAuthState({
        state: 'pending',
        verificationUri: 'https://microsoft.com/link',
        userCode: 'ABCD1234',
        expiresAt: '2026-11-13T12:00:00Z',
      }),
    ).toEqual({
      phase: 'pending',
      verificationUri: 'https://microsoft.com/link',
      userCode: 'ABCD1234',
      expiresAt: '2026-11-13T12:00:00Z',
    })
    expect(phaseOfAuthState({ state: 'signed_in', gamertag: 'Foo Bar' })).toEqual({
      phase: 'signed_in',
      gamertag: 'Foo Bar',
    })
    expect(phaseOfAuthState({ state: 'failed', error: 'boom' })).toEqual({
      phase: 'failed',
      error: 'boom',
    })
  })
})

describe('isAuthPending', () => {
  it('is true only for pending', () => {
    expect(isAuthPending({ phase: 'loading' })).toBe(false)
    expect(isAuthPending({ phase: 'signed_out' })).toBe(false)
    expect(
      isAuthPending({ phase: 'pending', verificationUri: '', userCode: '', expiresAt: '' }),
    ).toBe(true)
    expect(isAuthPending({ phase: 'signed_in', gamertag: '' })).toBe(false)
    expect(isAuthPending({ phase: 'failed', error: '' })).toBe(false)
  })
})

describe('useAuthState', () => {
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

  it('checks state once on mount and lands on signed_out with no polling', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ state: 'signed_out' } satisfies AuthStateBody))

    const { result } = renderHook(() => useAuthState(2000))
    expect(result.current.phase).toEqual({ phase: 'loading' })

    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.phase).toEqual({ phase: 'signed_out' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('tolerates the older {signedIn} shape', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ signedIn: true, gamertag: 'Legacy Player' }))

    const { result } = renderHook(() => useAuthState(2000))
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.phase).toEqual({ phase: 'signed_in', gamertag: 'Legacy Player' })
  })

  it('login() moves to pending and polls until signed_in', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ state: 'signed_out' })) // initial check
      .mockResolvedValueOnce(
        jsonResponse({
          state: 'pending',
          verificationUri: 'https://microsoft.com/link',
          userCode: 'WXYZ',
          expiresAt: '2026-11-13T12:00:00Z',
        }),
      ) // POST login
      .mockResolvedValueOnce(jsonResponse({ state: 'pending', verificationUri: 'u', userCode: 'WXYZ', expiresAt: 'x' })) // poll, still pending
      .mockResolvedValueOnce(jsonResponse({ state: 'signed_in', gamertag: 'Real Gamer' })) // poll, now signed in

    const { result } = renderHook(() => useAuthState(1000))
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.phase).toEqual({ phase: 'signed_out' })

    act(() => result.current.login())
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.phase.phase).toBe('pending')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.phase.phase).toBe('pending')
    expect(fetchMock).toHaveBeenCalledTimes(3)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.phase).toEqual({ phase: 'signed_in', gamertag: 'Real Gamer' })

    // signed_in: no further polling, however long time passes.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('logout() cancels a pending sign-in', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ state: 'pending', verificationUri: 'u', userCode: 'C', expiresAt: 'x' }),
      ) // initial check
      .mockResolvedValueOnce(jsonResponse({ state: 'signed_out' })) // POST logout

    const { result } = renderHook(() => useAuthState(1000))
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.phase.phase).toBe('pending')

    act(() => result.current.logout())
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.phase).toEqual({ phase: 'signed_out' })

    // Cancelled: no further polling.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('stops polling and issues no further fetch after unmount', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ state: 'pending', verificationUri: 'u', userCode: 'C', expiresAt: 'x' }),
    )

    const { result, unmount } = renderHook(() => useAuthState(1000))
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.phase.phase).toBe('pending')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    unmount()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a failed state shows the server error and login() retries', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ state: 'failed', error: 'device code expired' }))
      .mockResolvedValueOnce(
        jsonResponse({ state: 'pending', verificationUri: 'u', userCode: 'C', expiresAt: 'x' }),
      )

    const { result } = renderHook(() => useAuthState(1000))
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.phase).toEqual({ phase: 'failed', error: 'device code expired' })

    act(() => result.current.login())
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.phase.phase).toBe('pending')
  })
})
