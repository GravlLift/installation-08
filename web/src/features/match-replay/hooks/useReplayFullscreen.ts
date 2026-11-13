/**
 * useReplayFullscreen — lifted byte-identical from LevelUp (`hooks/useReplayFullscreen.ts`),
 * the fullscreen mode for the replay: an overlay frame plus a request for the browser's native
 * fullscreen on `document.documentElement` (so the settings drawer, portaled to `document.body`,
 * stays inside it). Native fullscreen failing or being unavailable leaves the overlay alone as
 * the mode — it still works everywhere.
 *
 * Exit paths: the F key or button (closes the mode AND native fullscreen); the browser's own
 * Escape while native is active (`fullscreenchange` is the source of truth, since the browser
 * does not always deliver that keystroke to the page); Escape while only the overlay is active,
 * which first closes whatever is "more inside" (an element carrying `REPLAY_ESCAPE_LAYER_ATTR` —
 * here, the settings drawer) before the mode itself — the escape listener is attached in capture
 * phase so it runs before a bubble-phase listener on that inner layer would have removed it.
 *
 * Standalone port note: `useExportActive` is lifted (`export/exportLayoutStore.ts`); this app
 * has no export dialog, so `disabled` is always `false` here, which is correct (nothing holds
 * the canvas for an export).
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { useExportActive } from '../export/exportLayoutStore'

/** The attribute a layer Escape must close before the fullscreen mode. Set in plain HTML
 *  (`data-replay-escape-layer=""`) on the settings drawer's root. */
export const REPLAY_ESCAPE_LAYER_ATTR = 'data-replay-escape-layer'

/** The mode's frame, applied to the page's main container. It scrolls itself. */
export const REPLAY_FULLSCREEN_FRAME =
  'fixed inset-0 z-40 overflow-y-auto overscroll-contain bg-background p-3 [align-content:safe_center]'

export interface ReplayFullscreen {
  /** The mode is open: the page applies `REPLAY_FULLSCREEN_FRAME` to its container. */
  active: boolean
  /** A video export holds the canvas: the mode cannot open or close via the button or F. */
  disabled: boolean
  /** Opens or closes the mode. Must be called INSIDE the gesture (click, keypress): native
   *  fullscreen requires it. */
  toggle: () => void
}

/** Is the page in native fullscreen, and is it ours (the only requester of the root)? */
function nativeIsOurs(): boolean {
  return document.fullscreenElement === document.documentElement
}

/** Gives native fullscreen back to the browser, if it is ours. */
function leaveNative(): void {
  if (!nativeIsOurs()) return
  document.exitFullscreen().catch((err: unknown) => {
    console.warn('[replay-fullscreen] native fullscreen exit refused', err)
  })
}

/** Requests native fullscreen for the page; without the API, the overlay alone is the mode. */
function requestNative(): void {
  const root = document.documentElement
  if (!document.fullscreenEnabled || typeof root.requestFullscreen !== 'function') return
  root.requestFullscreen().catch((err: unknown) => {
    console.warn('[replay-fullscreen] native fullscreen refused: overlay only', err)
  })
}

export function useReplayFullscreen(): ReplayFullscreen {
  const disabled = useExportActive()
  const [active, setActive] = useState(false)
  const activeRef = useRef(false)
  const reachedRef = useRef(false)

  const close = useCallback(() => {
    activeRef.current = false
    reachedRef.current = false
    setActive(false)
    leaveNative()
  }, [])

  const toggle = useCallback(() => {
    if (disabled) return
    if (activeRef.current) {
      close()
      return
    }
    activeRef.current = true
    setActive(true)
    requestNative()
  }, [disabled, close])

  useEffect(() => {
    function onChange() {
      if (nativeIsOurs()) {
        reachedRef.current = true
        if (!activeRef.current) leaveNative()
        return
      }
      if (document.fullscreenElement === null && reachedRef.current) close()
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [close])

  useEffect(() => {
    if (!active) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (document.querySelector(`[${REPLAY_ESCAPE_LAYER_ATTR}]`)) return
      close()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [active, close])

  const announcedRef = useRef(active)
  useEffect(() => {
    if (announcedRef.current === active) return
    announcedRef.current = active
    window.dispatchEvent(new Event('resize'))
  }, [active])

  useEffect(() => () => leaveNative(), [])

  return { active, disabled, toggle }
}
