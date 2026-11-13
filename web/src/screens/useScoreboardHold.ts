/**
 * useScoreboardHold — the Tab hold of the in-game scoreboard: while Tab is held down the
 * overlay is open, releasing it closes it.
 *
 * What this listener owns, and only that:
 *  - Tab itself: the default focus move is prevented ONLY while the overlay is open (the
 *    hold or the toggle) and never while a text field, a `contenteditable` or the timeline
 *    scrubber is focused — the same guard the replay shortcuts use (`isTypingTarget`);
 *  - the hold: a repeat of the key is ignored (Tab auto-repeats while held; the overlay
 *    must not toggle on every repeat), and a release outside the window (the keyup lost
 *    because focus moved) cannot leave the overlay stuck open — `blur` closes it too.
 *
 * No other key is read: this listener must not steal a single keystroke that is not Tab.
 */
import { useEffect, useState } from 'react'
import { isTypingTarget } from '../features/match-replay/hooks/useReplayShortcuts'

/** While held, or toggled by the button: `true` shows the scoreboard overlay. */
export function useScoreboardHold(): [boolean, (next: boolean) => void] {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab' || e.repeat) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isTypingTarget(e.target)) return
      e.preventDefault()
      setOpen(true)
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      setOpen(false)
    }
    function onBlur() {
      setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])
  return [open, setOpen]
}
