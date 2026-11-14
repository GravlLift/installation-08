/**
 * useFocusList — the game-menu focus model (docs/UI-DESIGN.md 6): a list with exactly one
 * focused row, driven by the keyboard and the mouse.
 *
 * The hook handles the keys on `window`: ArrowDown/ArrowUp move (clamped, no wrap),
 * Home/End jump to the first/last row, Enter calls `onSelect(index)`, Escape calls `onBack`
 * when given. While the user types in an input, textarea or select the keys are ignored so
 * a form keeps its own keyboard. Hovering a row focuses it and a click selects it.
 *
 * The focused index lives in the hook by default. A page that needs to know or set the
 * focused row (a preview that follows it, a row kept focused across a refresh) passes
 * `index` and `onIndexChange` and owns it instead.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseFocusListOptions {
  /** The number of rows; the focus stays inside it. */
  count: number
  /** Called with the focused index on Enter (or a row click). */
  onSelect?: (index: number) => void
  /** Called on Escape, when given. */
  onBack?: () => void
  /** The focused row, when the caller owns it (give `onIndexChange` with it). */
  index?: number
  /** Called when a key or a hover asks for another row. */
  onIndexChange?: (index: number) => void
}

/** Whether the key event comes from a control that owns its own keyboard. */
function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  )
}

/** The row a key moves the focus to, or null when the key does not move it. */
export function focusAfterKey(key: string, index: number, count: number): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowDown':
      return Math.min(count - 1, index + 1)
    case 'ArrowUp':
      return Math.max(0, index - 1)
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

export function useFocusList(options: UseFocusListOptions) {
  const { count, onSelect, onBack, onIndexChange } = options
  const [inner, setInner] = useState(0)
  const owned = options.index === undefined
  const index = Math.max(0, Math.min(count - 1, owned ? inner : (options.index ?? 0)))

  // The window listener reads the latest values through one ref, so it binds once.
  const latest = useRef({ index, count, onSelect, onBack, onIndexChange, owned })
  latest.current = { index, count, onSelect, onBack, onIndexChange, owned }

  const moveTo = useCallback((next: number) => {
    const now = latest.current
    if (next === now.index) return
    if (now.owned) setInner(next)
    now.onIndexChange?.(next)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      const now = latest.current
      const next = focusAfterKey(event.key, now.index, now.count)
      if (next !== null) {
        event.preventDefault()
        moveTo(next)
      } else if (event.key === 'Enter' && now.count > 0) {
        event.preventDefault()
        now.onSelect?.(now.index)
      } else if (event.key === 'Escape') {
        now.onBack?.()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [moveTo])

  const onClick = useCallback((i: number) => latest.current.onSelect?.(i), [])

  return { index, onHover: moveTo, onClick }
}
