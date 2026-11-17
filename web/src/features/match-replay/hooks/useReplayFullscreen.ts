// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { useCallback, useEffect, useState, type RefObject } from 'react'

export const REPLAY_ESCAPE_LAYER_ATTR = 'data-replay-escape-layer'

export function useReplayFullscreen(viewerRef: RefObject<HTMLElement | null>) {
  const [active, setActive] = useState(false)

  useEffect(() => {
    const sync = () => setActive(document.fullscreenElement === viewerRef.current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [viewerRef])

  const toggle = useCallback(() => {
    if (document.fullscreenElement === viewerRef.current) {
      void document.exitFullscreen().catch((error: unknown) => console.warn('Fullscreen exit failed', error))
    } else if (viewerRef.current?.requestFullscreen) {
      void viewerRef.current.requestFullscreen().catch((error: unknown) => console.warn('Fullscreen request failed', error))
    }
  }, [viewerRef])

  return { active, toggle }
}
