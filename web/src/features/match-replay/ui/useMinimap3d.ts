/**
 * useMinimap3d — the corner minimap over the 3D view (`topDownMinimap3d`): shown or hidden with the
 * `N` key, the choice remembered in the replay preferences (`usePersistedFlag`), on by default.
 *
 * `N`, not `M`: `M` is the player's sound key (`useReplayShortcuts`). The key is not taken from a
 * text field, nor with a modifier, as every player shortcut.
 */
import { useEffect, type RefObject } from 'react'

import { isTypingTarget } from '../hooks/useReplayShortcuts'
import type { ReplayScene3d } from '../scene3d/replayScene3d'
import { usePersistedFlag } from '../settings/useReplaySettings'

/** The preference "corner minimap shown" (this browser). */
export const MINIMAP_KEY = 'replay-3d-minimap'
/** The keys that show or hide it, Caps Lock included. */
const MINIMAP_KEYS = new Set(['n', 'N'])

export function useMinimap3d(sceneRef: RefObject<ReplayScene3d | null>, ready: boolean): void {
  const [on, toggle] = usePersistedFlag(MINIMAP_KEY, true)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!MINIMAP_KEYS.has(e.key) || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])
  useEffect(() => {
    if (ready) sceneRef.current?.setMinimap(on)
  }, [ready, on, sceneRef])
}
