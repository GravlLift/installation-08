/**
 * variantLayer.ts — LE CALQUE DES OBJETS DE LA VARIANTE du match (caisses, abris, décor du `.mvar`),
 * téléchargé puis préparé comme la carte (`loadLayerModel`).
 *
 * Absent (404 : match sans variante, ou calque pas encore construit) n'est pas une panne : `null`,
 * noté en débogage seulement. Toute autre erreur (réseau, GLB illisible) remonte à l'appelant, qui
 * garde la carte seule.
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
    console.debug('rejeu 3D : pas de calque des objets de la variante', path)
    return null
  }
}

/**
 * loadVariantLayer rend le calque prêt à poser, éclairé par la lumière cuite de la carte (`light`) ;
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