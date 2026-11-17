// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useSurfaceProbe — the 3D view's surface inspector, on the dev machine only: Alt+click on the
 * map names the game material under the pointer (and the variant object carrying it), copies
 * the line (`formatProbe`) to the clipboard (useCopyToClipboard) and logs it.
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
      console.info('3D replay: surface inspected', next)
      setLine(next)
      void copy(next)
    },
    [sceneRef, copy],
  )
  const probe: SurfaceProbeState | null = line === null ? null : { line, copied }
  return { probe, onClick, clear: () => setLine(null) }
}
