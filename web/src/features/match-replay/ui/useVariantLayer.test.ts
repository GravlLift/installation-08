/** Tests that the variant layer is prepared with the scene's KTX2 loader. */
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LoadProgress3d } from '../model/chargement3d_logic'
import type { ReplayScene3d } from '../scene3d/replayScene3d'
import { useVariantLayer } from './useVariantLayer'

const loadLayerModel = vi.hoisted(() => vi.fn(async () => ({ dispose: vi.fn() })))
vi.mock('../scene3d/mapModel', () => ({ loadLayerModel }))
vi.mock('../scene3d/variantLayer', () => ({ fetchVariantBuffer: async () => new ArrayBuffer(8) }))

describe('useVariantLayer', () => {
  it('hands the layer GLB to the scene\'s KTX2 loader', async () => {
    const textureLoader = { name: 'ktx2' }
    const scene = { mapLight: null, textureLoader, attachLayer: vi.fn(() => true), detachLayer: vi.fn() } as unknown as ReplayScene3d
    const progress = new LoadProgress3d()
    const { result } = renderHook(() => useVariantLayer(scene, '/api/variant.glb', false, progress))
    await waitFor(() => expect(result.current).toBe(true))
    expect(loadLayerModel).toHaveBeenCalledTimes(1)
    expect(loadLayerModel.mock.calls[0]).toContain(textureLoader)
  })
})
