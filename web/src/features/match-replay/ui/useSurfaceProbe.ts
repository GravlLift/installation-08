// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useSurfaceProbe — l'inspecteur de surfaces de la vue 3D, sur le poste de développement
 * seulement : Alt+clic sur la carte nomme le matériau du jeu sous le pointeur (et l'objet de la
 * variante qui le porte), copie la ligne (`formatProbe`) dans le presse-papiers
 * (useCopyToClipboard) et la journalise.
 */
import { useCallback, useState, type MouseEvent, type RefObject } from 'react'

import { useCopyToClipboard } from '@/lib/clipboard/useCopyToClipboard'

import type { ReplayScene3d } from '../scene3d/replayScene3d'
import { formatProbe } from '../scene3d/surfaceProbe3d'

export interface SurfaceProbeState {
  line: string
  copied: boolean
}

export function useSurfaceProbe(sceneRef: RefObject<ReplayScene3d | null>) {
  const [line, setLine] = useState<string | null>(null)
  const { copy, copied } = useCopyToClipboard()
  const onClick = useCallback(
    (e: MouseEvent) => {
      if (!import.meta.env.DEV || !e.altKey) return
      const hit = sceneRef.current?.probe(e.clientX, e.clientY)
      if (!hit) {
        setLine(null)
        return
      }
      const next = formatProbe(hit)
      console.info('rejeu 3D : surface inspectée', next)
      setLine(next)
      void copy(next)
    },
    [sceneRef, copy],
  )
  const probe: SurfaceProbeState | null = line === null ? null : { line, copied }
  return { probe, onClick, clear: () => setLine(null) }
}
