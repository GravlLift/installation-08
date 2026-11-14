/**
 * usePlayerChromeInsets — the player's safe insets: how far the top strip reaches down and the
 * transport reaches up inside the 16:9 box, published on the box as the CSS variables
 * `--bc-chrome-top` and `--bc-chrome-bottom` (px). The chrome's auto-hide is an opacity fade,
 * so the sizes hold whether it shows or not: a reader never jumps when it fades.
 *
 * Read by the panels opened from the bar (`.bc-panel`: settings, export), which sit between
 * the two and so never cover either.
 */
import { useEffect, type RefObject } from 'react'

export function usePlayerChromeInsets(
  boxRef: RefObject<HTMLElement | null>,
  topRef: RefObject<HTMLElement | null>,
  barRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const box = boxRef.current
    const top = topRef.current
    const bar = barRef.current
    if (!box || !top || !bar) return
    const update = () => {
      const frame = box.getBoundingClientRect()
      box.style.setProperty('--bc-chrome-top', `${Math.round(top.getBoundingClientRect().bottom - frame.top)}px`)
      box.style.setProperty('--bc-chrome-bottom', `${Math.round(frame.bottom - bar.getBoundingClientRect().top)}px`)
    }
    update()
    const observer = new ResizeObserver(update)
    for (const el of [box, top, bar]) observer.observe(el)
    return () => observer.disconnect()
  }, [boxRef, topRef, barRef])
}
