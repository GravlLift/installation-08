import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useVariantLayer, useVariantSource } from './useVariantLayer'
import type { MeshQuality } from '../lib/api/standalone'

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

it('serves the High layer from the quality URL', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ state: 'ready' }) })
  vi.stubGlobal('fetch', fetchMock)
  const { result } = renderHook(() => useVariantSource('abc', 'high'))
  await waitFor(() => expect(result.current.path).toBe('/api/matches/abc/variant?quality=high.glb'))
  expect(fetchMock.mock.calls[0][0]).toBe('/api/matches/abc/variant?quality=high/state')
})

it('re-requests the layer at the new quality when the quality switches', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ state: 'ready' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ state: 'ready' }) })
  vi.stubGlobal('fetch', fetchMock)
  const { result, rerender } = renderHook(({ quality }) => useVariantSource('abc', quality), {
    initialProps: { quality: undefined as MeshQuality | undefined },
  })
  await waitFor(() => expect(result.current.path).toBe('/api/matches/abc/variant.glb'))

  // The switch reads as a fresh request (pending) until the high check settles.
  rerender({ quality: 'high' })
  expect(result.current).toEqual({ path: null, pending: true })
  await waitFor(() => expect(result.current.path).toBe('/api/matches/abc/variant?quality=high.glb'))
  expect(fetchMock.mock.calls[1][0]).toBe('/api/matches/abc/variant?quality=high/state')
})

it('keeps the layer absent when there is no mvar', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 })
  vi.stubGlobal('fetch', fetchMock)
  const { result } = renderHook(() => useVariantLayer('abc'))
  await act(async () => { await Promise.resolve() })
  expect(result.current).toBeNull()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})
