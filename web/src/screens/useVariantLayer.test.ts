// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
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
  await waitFor(() => expect(result.current.path).toBe('/api/matches/abc/variant.glb?quality=high'))
  expect(fetchMock.mock.calls[0][0]).toBe('/api/matches/abc/variant/state?quality=high')
})

it('builds an absent High layer on the High build route', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ state: 'absent' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ state: 'ready' }) })
  vi.stubGlobal('fetch', fetchMock)
  const { result } = renderHook(() => useVariantSource('abc', 'high'))
  await waitFor(() => expect(result.current.path).toBe('/api/matches/abc/variant.glb?quality=high'))
  expect(fetchMock.mock.calls[1][0]).toBe('/api/matches/abc/variant/build?quality=high')
  expect(fetchMock.mock.calls[1][1].method).toBe('POST')
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
  await waitFor(() => expect(result.current.path).toBe('/api/matches/abc/variant.glb?quality=high'))
  expect(fetchMock.mock.calls[1][0]).toBe('/api/matches/abc/variant/state?quality=high')
})

it('keeps the layer absent when there is no mvar', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 })
  vi.stubGlobal('fetch', fetchMock)
  const { result } = renderHook(() => useVariantLayer('abc'))
  await act(async () => { await Promise.resolve() })
  expect(result.current).toBeNull()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('exposes server build progress while the variant is building', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ state: 'building', progress: 0.55, stage: 'textures' }) }))
  const { result } = renderHook(() => useVariantSource('abc'))
  await waitFor(() => expect(result.current).toMatchObject({ pending: true, progress: 0.55, stage: 'textures' }))
})

it('shows an already built Standard layer while High is building', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('quality=high') ? { state: 'building', progress: 0.2 } : { state: 'ready' } })))
  const { result } = renderHook(() => useVariantSource('abc', 'high'))
  await waitFor(() => expect(result.current.path).toBe('/api/matches/abc/variant.glb'))
  expect(result.current.pending).toBe(false)
})

it('upgrades the Standard fallback when High is ready', async () => {
  let highChecks = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('quality=high') ? { state: ++highChecks === 1 ? 'building' : 'ready' } : { state: 'ready' } })))
  const { result } = renderHook(() => useVariantSource('abc', 'high'))
  await waitFor(() => expect(result.current.path).toBe('/api/matches/abc/variant.glb'))
  await waitFor(() => expect(result.current.path).toBe('/api/matches/abc/variant.glb?quality=high'), { timeout: 4000 })
})
