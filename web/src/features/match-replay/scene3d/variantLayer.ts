/**
 * variantLayer.ts — LE CALQUE DES OBJETS DE LA VARIANTE du match (caisses, abris, décor du `.mvar`),
 * téléchargé puis préparé comme la carte (`loadLayerModel`).
 *
 * Absent (404 : match sans variante, ou calque pas encore construit) n'est pas une panne : `null`,
 * noté en débogage seulement. Toute autre erreur (réseau, GLB illisible) remonte à l'appelant, qui
 * garde la carte seule.
 */
import { isNotFound } from '@/lib/replay/queries'

import type { BakedLight } from './bakedLightShader'
import { loadLayerModel, type SurfaceModel } from './mapModel'
import { fetchMesh } from './meshFetch'

function noProgress(): void {}

/** loadVariantLayer rend le calque prêt à poser, éclairé par la lumière cuite de la carte (`light`). */
export async function loadVariantLayer(path: string, signal: AbortSignal, light: BakedLight | null): Promise<SurfaceModel | null> {
  let buffer: ArrayBuffer
  try {
    buffer = await fetchMesh(path, noProgress, signal)
  } catch (err) {
    if (!isNotFound(err)) throw err
    console.debug('rejeu 3D : pas de calque des objets de la variante', path)
    return null
  }
  return loadLayerModel(buffer, light)
}
