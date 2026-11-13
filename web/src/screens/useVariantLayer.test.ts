import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useVariantLayer } from './useVariantLayer'

afterEach(() => vi.unstubAllGlobals())

it('builds an absent variant and exposes its URL when ready', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ state: 'absent' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ state: 'ready' }) })
  vi.stubGlobal('fetch', fetchMock)
  const { result } = renderHook(() => useVariantLayer('abc'))
  await waitFor(() => expect(result.current).toBe('/api/matches/abc/variant.glb'))
  expect(fetchMock.mock.calls[1][1].method).toBe('POST')
})

it('keeps the layer absent when there is no mvar', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 })
  vi.stubGlobal('fetch', fetchMock)
  const { result } = renderHook(() => useVariantLayer('abc'))
  await act(async () => { await Promise.resolve() })
  expect(result.current).toBeNull()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})
