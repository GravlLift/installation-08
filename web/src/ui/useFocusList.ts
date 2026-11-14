/**
 * useFocusList — the game-menu focus model (docs/UI-DESIGN.md 6): a list with exactly one
 * focused row, driven by the keyboard and the mouse.
 *
 * The hook owns the index and the key handling on `window`: ArrowDown/ArrowUp move (clamped,
 * no wrap — the mockup's match list does not wrap, and the main menu follows it), Home/End
 * jump to the first/last row, Enter calls `onSelect(index)`, Escape calls `onBack` when
 * given. While the user types in an input, textarea or select the keys are ignored so a
 * form (the account panel) keeps its own keyboard.
 *
 * Rows report hover through `onHover(index)` (hover focuses) and a click selects
 * (`onClick(index)` → `onSelect`). The hook returns the focused index so the caller can
 * style the focused row and scroll it into view.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseFocusListOptions {
  /** The number of rows; the focus is clamped into it. */
  count: number
  /** Called with the focused index on Enter (or a row click). */
  onSelect?: (index: number) => void
  /** Called on Escape, when given. */
  onBack?: () => void
}

/** Whether the key event comes from a control that owns its own keyboard. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  )
}

export function useFocusList({ count, onSelect, onBack }: UseFocusListOptions) {
  const [index, setIndex] = useState(0)

  // Keep the focus inside the list when `count` shrinks (a row disappeared).
  useEffect(() => {
    setIndex((i) => (i >= count ? Math.max(0, count - 1) : i))
  }, [count])

  // The listener reads the latest callbacks and index through refs, so it binds once per
  // `count` change and never goes stale.
  const indexRef = useRef(index)
  indexRef.current = index
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect
  const backRef = useRef(onBack)
  backRef.current = onBack

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      const i = indexRef.current
      switch (event.key) {
        case 'ArrowDown':
          if (count > 1) { event.preventDefault(); setIndex(Math.min(count - 1, i + 1)) }
          return
        case 'ArrowUp':
          if (count > 1) { event.preventDefault(); setIndex(Math.max(0, i - 1)) }
          return
        case 'Home':
          if (count > 0) { event.preventDefault(); setIndex(0) }
          return
        case 'End':
          if (count > 0) { event.preventDefault(); setIndex(count - 1) }
          return
        case 'Enter':
          if (count > 0) { event.preventDefault(); selectRef.current?.(i) }
          return
        case 'Escape':
          backRef.current?.()
          return
        default:
          return
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [count])

  const onHover = useCallback((i: number) => setIndex(i), [])
  const onClick = useCallback((i: number) => selectRef.current?.(i), [])

  return { index, onHover, onClick }
}
