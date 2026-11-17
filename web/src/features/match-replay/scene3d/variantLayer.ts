// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * variantLayer.ts — THE MATCH VARIANT'S OBJECT LAYER (crates, cover, `.mvar` decor),
 * downloaded then prepared like the map (`loadLayerModel`).
 *
 * Absent (404: a match with no variant, or a layer not built yet) is not a failure: `null`,
 * only logged at debug level. Any other error (network, unreadable GLB) bubbles up to the
 * caller, which keeps the map alone.
 */
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'

import { fetchBVHCache } from '@/lib/api/standalone'
import { isNotFound } from '@/lib/replay/queries'

import type { BakedLight } from './bakedLightShader'
import { loadLayerModel, type SurfaceModel } from './mapModel'
import { fetchMesh } from './meshFetch'

function noProgress(): void {}

/** fetchVariantBuffer downloads the layer's GLB (`onProgress`: bytes received, announced size); null when absent (404). */
export async function fetchVariantBuffer(
  path: string,
  signal: AbortSignal,
  onProgress: (loaded: number, total: number) => void = noProgress,
): Promise<ArrayBuffer | null> {
  try {
    return await fetchMesh(path, onProgress, signal)
  } catch (err) {
    if (!isNotFound(err)) throw err
    console.debug('3D replay: no variant object layer', path)
    return null
  }
}

/**
 * loadVariantLayer returns the layer ready to place, lit by the map's baked light (`light`);
 * `ktx2`: the scene's KTX2 loader, for a layer with compressed textures.
 */
export async function loadVariantLayer(path: string, signal: AbortSignal, light: BakedLight | null, ktx2: KTX2Loader | null = null): Promise<SurfaceModel | null> {
  const buffer = await fetchVariantBuffer(path, signal)
  if (!buffer) return null
  // Best-effort, like the map's: a failed or stale fetch (null) just means the layer builds its
  // own ray index, as if the sidecar were absent (`fetchBVHCache` never throws).
  const bvhCache = await fetchBVHCache(path, signal)
  return loadLayerModel(buffer, light, undefined, ktx2, bvhCache)
}