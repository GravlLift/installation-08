// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * usePlayerChromeInsets — the player's safe insets: how far the top strip reaches down into the
 * 16:9 box and the transport reaches up into it, published on the box as the CSS variables
 * `--bc-chrome-top` and `--bc-chrome-bottom` (px, never negative).
 *
 * Windowed, the strip sits above the box and the transport below it, so both are 0. In
 * fullscreen the chrome is laid over the scene and they measure the overlap. The chrome's
 * auto-hide is an opacity fade, so the sizes hold whether it shows or not: a reader never jumps
 * when it fades.
 *
 * Read by the panels opened from the bar (`.bc-panel`: settings, export), which sit between
 * the two and so never cover either, and by the HUD's shield, which never goes above the top one.
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
      const overlap = (px: number) => `${Math.max(0, Math.round(px))}px`
      box.style.setProperty('--bc-chrome-top', overlap(top.getBoundingClientRect().bottom - frame.top))
      box.style.setProperty('--bc-chrome-bottom', overlap(frame.bottom - bar.getBoundingClientRect().top))
    }
    update()
    const observer = new ResizeObserver(update)
    for (const el of [box, top, bar]) observer.observe(el)
    return () => observer.disconnect()
  }, [boxRef, topRef, barRef])
}
