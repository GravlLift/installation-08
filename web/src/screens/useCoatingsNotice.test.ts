// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useCoatingsNotice.test.ts — the three notice texts and the "render nothing" cases (a pure
 * reducer), plus the hook: it fetches once, stays hidden while loading, and aborts its request
 * on unmount. Mirrors `useAuthState.test.ts`'s fetch-mocking structure.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CoatingsStatusBody } from '../lib/api/standalone'
import { coatingNoticeOf, coatingsSetupOffered, useCoatingsNotice } from './useCoatingsNotice'

/** Builds a coating status body with sensible defaults, so a test names only what it changes. */
function status(overrides: Partial<CoatingsStatusBody> = {}): CoatingsStatusBody {
  return {
    export: 'ok',
    override: false,
    libraries: {
      spartan_pieces: { built: true, stale: false, materialsMissing: 0 },
      weapons: { built: true, stale: false, materialsMissing: 0 },
      first_person: { built: true, stale: false, materialsMissing: 0 },
    },
    ...overrides,
  }
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response
}

describe('coatingNoticeOf', () => {
  it('renders nothing when the export is ok and no materials are missing', () => {
    expect(coatingNoticeOf(status())).toBeNull()
  })

  it('says the export is missing when it is not set', () => {
    expect(coatingNoticeOf(status({ export: 'not_set' }))).toBe('Coatings off: no Ekur export found')
  })

  it('says the export is invalid when a candidate is not a full reference', () => {
    expect(coatingNoticeOf(status({ export: 'invalid' }))).toBe('Coatings off: the Ekur export is invalid')
  })

  it('counts the missing materials across the three libraries', () => {
    const body = status({
      libraries: {
        spartan_pieces: { built: true, stale: false, materialsMissing: 3 },
        weapons: { built: true, stale: false, materialsMissing: 2 },
        first_person: { built: true, stale: false, materialsMissing: 0 },
      },
    })
    expect(coatingNoticeOf(body)).toBe('Coatings incomplete: 5 pieces are missing from the Ekur export')
  })

  it('prefers the missing-export text over a partial one', () => {
    const body = status({
      export: 'not_set',
      libraries: {
        spartan_pieces: { built: true, stale: false, materialsMissing: 4 },
        weapons: { built: true, stale: false, materialsMissing: 0 },
        first_person: { built: true, stale: false, materialsMissing: 0 },
      },
    })
    expect(coatingNoticeOf(body)).toBe('Coatings off: no Ekur export found')
  })
})

describe('coatingsSetupOffered', () => {
  it('offers the setup when coatings are off and the export is the app own', () => {
    expect(coatingsSetupOffered(status({ export: 'not_set' }))).toBe(true)
    expect(coatingsSetupOffered(status({ export: 'invalid' }))).toBe(true)
  })

  it('does not offer it when the export is ok, even with missing materials', () => {
    expect(coatingsSetupOffered(status())).toBe(false)
  })

  it('does not offer it when IT3D_EKUR_DIR overrides the export', () => {
    expect(coatingsSetupOffered(status({ export: 'invalid', override: true }))).toBe(false)
  })
})

describe('useCoatingsNotice', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches once, stays hidden while loading, then shows the text', async () => {
    let resolveBody: (body: unknown) => void = () => {}
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveBody = (body) => resolve(jsonResponse(body))
      }),
    )

    const { result } = renderHook(() => useCoatingsNotice())
    // Hidden while loading.
    expect(result.current.notice).toBeNull()
    expect(result.current.ready).toBe(false)

    await act(async () => {
      resolveBody(status({ export: 'invalid' }))
      await Promise.resolve()
    })
    expect(result.current.notice).toBe('Coatings off: the Ekur export is invalid')
    expect(result.current.ready).toBe(true)
    expect(result.current.canSetUp).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/coatings/status')
  })

  it('renders nothing when the export is ok', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(status()))
    const { result } = renderHook(() => useCoatingsNotice())
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.notice).toBeNull()
    expect(result.current.ready).toBe(true)
  })

  it('renders nothing when the fetch fails (older server without the route)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'not found' }, false, 404))
    const { result } = renderHook(() => useCoatingsNotice())
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.notice).toBeNull()
    expect(result.current.ready).toBe(true)
  })

  it('aborts its in-flight request on unmount', async () => {
    fetchMock.mockReturnValue(
      new Promise<Response>(() => {
        // Never settles; the unmount must abort it.
      }),
    )

    const { unmount } = renderHook(() => useCoatingsNotice())
    // `fetchCoatingsStatus` passes the signal in the options object, `{ signal }`.
    const signal = (fetchMock.mock.calls[0][1] as { signal: AbortSignal }).signal
    expect(signal.aborted).toBe(false)

    unmount()
    expect(signal.aborted).toBe(true)
  })
})
