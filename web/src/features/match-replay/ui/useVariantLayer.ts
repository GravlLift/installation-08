/**
 * useVariantLayer — pose le calque des objets de la variante du match sur la carte 3D chargée.
 *
 * Il part une fois la carte posée (`scene` non nul), jamais avant : la carte ne l'attend pas. Absent,
 * rien ; en échec, un avertissement et la carte reste seule. Le calque est retiré et libéré quand la
 * scène ou le chemin change, et avec la scène ; un calque arrivé après la libération est libéré aussitôt.
 */
import { useEffect } from 'react'

import type { ReplayScene3d } from '../scene3d/replayScene3d'
import { loadVariantLayer } from '../scene3d/variantLayer'

export function useVariantLayer(scene: ReplayScene3d | null, variantPath: string | null): void {
  useEffect(() => {
    if (!scene || !variantPath) return
    const abort = new AbortController()
    let alive = true
    void (async () => {
      try {
        const layer = await loadVariantLayer(variantPath, abort.signal, scene.mapLight)
        if (!layer) return
        if (!alive || !scene.attachLayer(layer)) layer.dispose()
      } catch (err) {
        if (!alive) return
        console.warn('rejeu 3D : calque des objets de la variante non chargé, la carte reste seule', variantPath, err)
      }
    })()
    return () => {
      alive = false
      abort.abort()
      scene.detachLayer()
    }
  }, [scene, variantPath])
}
