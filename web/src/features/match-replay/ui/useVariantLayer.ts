// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useVariantLayer — places the match variant's object layer on the loaded 3D map.
 *
 * The layer's GLB download starts as soon as its path is known, alongside the map's (its size
 * weighs in the loading bar from the start); its preparation waits for the posed map (`scene`),
 * whose baked light it reuses. Every step reports into `progress`. Absent (no variant, 404, or a
 * failed build), nothing; on failure, a warning and the map stays alone. Either way the hook
 * returns true once the layer is settled, so the load does not finish before it. The layer is
 * removed when the scene or the path changes, and with the scene; a layer arriving after that is
 * never attached. The layer itself is session-cached by its served path (`sessionAssetCache3d`): a
 * reopened match with the same variant finds it already decoded, and nothing here disposes it
 * directly — the cache does, only when evicted.
 */
import { useEffect, useRef, useState } from 'react'

import { fetchBVHCache, uploadBVHCache } from '@/lib/api/standalone'

import type { LoadProgress3d } from '../model/chargement3d_logic'
import type { ReplayScene3d } from '../scene3d/replayScene3d'
import { loadLayerModel } from '../scene3d/mapModel'
import { mark, runWhenIdle, timedSync } from '../scene3d/perf3d'
import { cachedLayerModel, layerModelKey, sessionAssetCache, storeLayerModel } from '../scene3d/sessionAssetCache3d'
import { fetchVariantBuffer } from '../scene3d/variantLayer'

type Prefetch = {
  path: string
  progress: LoadProgress3d
  buffer: Promise<ArrayBuffer | null>
  /** The layer's ray-index sidecar, fetched alongside the buffer so a cache hit costs no extra
   *  round trip; null (never rejects) when absent, stale, or the fetch failed. */
  bvhCache: Promise<ArrayBuffer | null>
}

/**
 * `variantPath`: the layer's URL once the server has it; `pending`: true while the server still
 * resolves or builds it (the load waits). Returns true once the layer is settled for `progress`.
 */
export function useVariantLayer(
  scene: ReplayScene3d | null,
  variantPath: string | null,
  pending: boolean,
  progress: LoadProgress3d,
): boolean {
  const [settledFor, setSettledFor] = useState<LoadProgress3d | null>(null)
  const prefetch = useRef<Prefetch | null>(null)

  // The download, before the map is posed. Skipped when the layer is already session-cached: a
  // reopened match on the same variant has nothing to prefetch.
  useEffect(() => {
    if (!variantPath || cachedLayerModel(variantPath)) return
    const abort = new AbortController()
    const buffer = fetchVariantBuffer(variantPath, abort.signal, (loaded, total) => progress.variantBytes(loaded, total))
    buffer.catch(() => {})
    const bvhCache = fetchBVHCache(variantPath, abort.signal)
    const entry = { path: variantPath, progress, buffer, bvhCache }
    prefetch.current = entry
    return () => {
      abort.abort()
      if (prefetch.current === entry) prefetch.current = null
    }
  }, [variantPath, progress])

  // The preparation and the pose, once the map is posed.
  useEffect(() => {
    if (!variantPath) {
      if (pending) progress.variantBuilding()
      else {
        progress.variantNone()
        setSettledFor(progress)
      }
      return
    }
    if (!scene) return
    const abort = new AbortController()
    let alive = true
    const key = layerModelKey(variantPath)
    void (async () => {
      try {
        let layer = cachedLayerModel(variantPath)
        // Packs the freshly built ray index to store server-side, once the layer is posed; stays
        // null on a cache hit and when a used sidecar already matched (see the map's own `attach` effect).
        let packBvhUpload: (() => ArrayBuffer) | null = null
        if (layer) {
          // Warm load: see the map's own cache hit above — nothing to fetch, decode or index.
          mark('cache-hit:layer')
          progress.variantBytes(1, 1)
          progress.step('variant-decode', 1, 1)
          progress.step('variant-index', 1, 1)
        } else {
          const entry = prefetch.current
          const samePrefetch = entry && entry.path === variantPath && entry.progress === progress
          const pre = samePrefetch ? entry.buffer : fetchVariantBuffer(variantPath, abort.signal, (loaded, total) => progress.variantBytes(loaded, total))
          const bvhPre = samePrefetch ? entry.bvhCache : fetchBVHCache(variantPath, abort.signal)
          const [buffer, bvhCache] = await Promise.all([pre, bvhPre])
          // The buffer is read once: the layer holds what it needs, the 100+ MB file is released.
          if (prefetch.current?.buffer === pre) prefetch.current = null
          if (!alive) return
          if (!buffer) progress.variantNone()
          else {
            layer = await loadLayerModel(buffer, scene.mapLight, (step, done = 0, total = 0) =>
              progress.step(step === 'materials' ? 'variant-decode' : 'variant-index', done, total), scene.textureLoader, bvhCache)
            storeLayerModel(variantPath, layer)
            packBvhUpload = layer.bvhUpload
          }
        }
        if (layer) {
          const resolvedLayer = layer
          // Not attached (unmounted meanwhile, or no map posed yet): the cache still holds the
          // layer unpinned, for a later try, instead of it being disposed here.
          if (!alive || !timedSync('variant:attach', () => scene.attachLayer(resolvedLayer))) {
            // no-op
          } else {
            sessionAssetCache.acquire(key)
            // Off the critical path, after an idle moment, same as the map's own upload: the pack
            // (`serializeBVHCache`) and the upload both run after the layer is posed, never
            // before. Never runs on a cache hit or when a used sidecar matched.
            if (packBvhUpload) {
              const pack = packBvhUpload
              runWhenIdle(() => {
                if (abort.signal.aborted) return
                void uploadBVHCache(variantPath, pack(), abort.signal)
              })
            }
          }
        }
      } catch (err) {
        if (!alive) return
        console.warn('3D replay: variant object layer not loaded, map stays alone', variantPath, err)
      }
      if (!alive) return
      progress.variantSettled()
      setSettledFor(progress)
    })()
    return () => {
      alive = false
      abort.abort()
      scene.detachLayer()
      sessionAssetCache.release(key)
    }
  }, [scene, variantPath, pending, progress])

  return settledFor === progress
}
