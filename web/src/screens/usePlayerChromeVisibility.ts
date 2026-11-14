/**
 * usePlayerChromeVisibility — the auto-hide rule of the player's chrome (top strip and
 * transport, docs/UI-DESIGN.md 4.4).
 *
 * The chrome hides 3 s after the last activity while the replay PLAYS, and stays visible
 * whenever one of these holds:
 *   - the replay is paused,
 *   - a menu of the chrome's own is open (speed, export, settings, scoreboard),
 *   - the pointer is over the chrome,
 *   - any key press, mouse move, click or focus anywhere just happened (the 3 s window).
 * Every activity re-shows the chrome and re-arms the hide timer; leaving the chrome while it
 * is the only reason it is up starts the countdown at once.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

/** The idle window before the chrome hides, in ms. */
export const CHROME_HIDE_DELAY_MS = 3000

export interface UsePlayerChromeVisibilityParams {
  playing: boolean
  /** A menu of the chrome's own is open. */
  menuOpen: boolean
  /** The scrub bar is being dragged: the chrome must stay up. */
  scrubbing?: boolean
}

export function usePlayerChromeVisibility({ playing, menuOpen, scrubbing }: UsePlayerChromeVisibilityParams): {
  visible: boolean
  scopeRef: React.RefObject<HTMLElement | null>
  onScopeEnter: () => void
  onScopeLeave: () => void
} {
  const scopeRef = useRef<HTMLElement | null>(null)
  const [visible, setVisible] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverRef = useRef(false)

  // Whether the chrome must stay up regardless of the idle window.
  const alwaysOn = !playing || menuOpen || !!scrubbing

  // Refs read by the listeners: the hook must not re-subscribe on every frame tick.
  const alwaysRef = useRef(alwaysOn)
  alwaysRef.current = alwaysOn
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  const armHide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (!alwaysRef.current && !hoverRef.current) setVisible(false)
    }, CHROME_HIDE_DELAY_MS)
  }, [])

  const show = useCallback(() => {
    setVisible(true)
    if (alwaysRef.current) return
    armHide()
  }, [armHide])

  // Pausing, opening a menu or any activity keeps the chrome up; hiding it starts here.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (alwaysOn) {
      setVisible(true)
      return
    }
    if (visibleRef.current && !hoverRef.current) armHide()
  }, [alwaysOn, armHide])

  // Mouse moves, key presses, clicks and focus re-show the chrome and re-arm the timer.
  useEffect(() => {
    const onActivity = (event: Event) => {
      // A mouse move only counts inside the chrome's scope, otherwise a camera drag on the
      // 3D view would keep it up forever.
      if (event.type === 'mousemove') {
        const scope = scopeRef.current
        const target = event.target
        if (!scope || !target) return
        try {
          if (scope !== target && !scope.contains(target as Node)) return
        } catch {
          // jsdom can throw on cross-realm targets; treat as outside the scope.
          return
        }
      }
      show()
    }
    window.addEventListener('mousemove', onActivity)
    window.addEventListener('keydown', onActivity)
    window.addEventListener('focusin', onActivity)
    window.addEventListener('pointerdown', onActivity)
    return () => {
      window.removeEventListener('mousemove', onActivity)
      window.removeEventListener('keydown', onActivity)
      window.removeEventListener('focusin', onActivity)
      window.removeEventListener('pointerdown', onActivity)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [show])

  const onScopeEnter = useCallback(() => {
    hoverRef.current = true
    show()
  }, [show])

  const onScopeLeave = useCallback(() => {
    hoverRef.current = false
    if (!alwaysRef.current && visibleRef.current) armHide()
  }, [armHide])

  return { visible, scopeRef, onScopeEnter, onScopeLeave }
}
