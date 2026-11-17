// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** Tests that the variant layer is prepared with the scene's KTX2 loader. */
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LoadProgress3d } from '../model/loading3d_logic'
import type { ReplayScene3d } from '../scene3d/replayScene3d'
import { sessionAssetCache } from '../scene3d/sessionAssetCache3d'
import { useVariantLayer } from './useVariantLayer'

const loadLayerModel = vi.hoisted(() => vi.fn(async () => ({ root: { traverse: vi.fn() }, dispose: vi.fn() })))
vi.mock('../scene3d/mapModel', () => ({ loadLayerModel }))
vi.mock('../scene3d/variantLayer', () => ({ fetchVariantBuffer: async () => new ArrayBuffer(8) }))

describe('useVariantLayer', () => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined)

  afterEach(() => {
    sessionAssetCache.clear()
  })

  it('hands the layer GLB to the scene\'s KTX2 loader', async () => {
    const textureLoader = { name: 'ktx2' }
    const scene = { mapLight: null, textureLoader, attachLayer: vi.fn(() => true), detachLayer: vi.fn() } as unknown as ReplayScene3d
    const progress = new LoadProgress3d()
    const { result } = renderHook(() => useVariantLayer(scene, '/api/variant.glb', false, progress))
    await waitFor(() => expect(result.current).toBe(true))
    expect(loadLayerModel).toHaveBeenCalledTimes(1)
    expect(loadLayerModel.mock.calls[0]).toContain(textureLoader)
  })

  it('reuses the session-cached layer on a second mount, without reloading its GLB', async () => {
    const textureLoader = { name: 'ktx2' }
    const scene = { mapLight: null, textureLoader, attachLayer: vi.fn(() => true), detachLayer: vi.fn() } as unknown as ReplayScene3d
    const firstProgress = new LoadProgress3d()
    const first = renderHook(() => useVariantLayer(scene, '/api/variant.glb', false, firstProgress))
    await waitFor(() => expect(first.result.current).toBe(true))
    first.unmount()

    loadLayerModel.mockClear()
    const secondProgress = new LoadProgress3d()
    const second = renderHook(() => useVariantLayer(scene, '/api/variant.glb', false, secondProgress))
    await waitFor(() => expect(second.result.current).toBe(true))
    expect(loadLayerModel).not.toHaveBeenCalled()
    expect(scene.attachLayer).toHaveBeenCalledTimes(2)
  })
})
