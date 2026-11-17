// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * canvasInk.ts — the STRUCTURAL INKS of the replay canvas.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS NOT A BREACH OF THE TOKEN RULE.
 * The semantic tokens (`--ac-*`) state a BUSINESS ROLE: a victory, a tier of
 * performance, a team. The strokes this canvas needs here carry none of them — the edge of a
 * step and the text of a label are layout, exactly like the track background and the border of
 * an SVG, which the project rule explicitly tolerates.
 *
 * What is refused instead is the literal: a hard-coded `#8b97a3` would follow neither the light
 * theme, nor the dark theme, nor a change of chart. So we read the variables of the design
 * system itself, the way `resolveToken` does for tokens.
 *
 * Any color that SAYS something (a team, a shot, a death) goes through a token — this file
 * must never be used to fabricate one.
 */
import { log } from '@/lib/accessibility/_logger'

import { readThemeVar } from './themeInk'

/** Layout variables of the design system used by the canvas. */
export type InkVar =
  | '--muted-foreground'
  | '--border'
  | '--foreground'
  /** BACKGROUND ink: it serves as the OUTLINE of anything filled with `--foreground` (pedestals). */
  | '--background'
  | '--card'
  /** Stroke of the names under the markers (dark in both themes, cf. globals.css). */
  | '--replay-label-stroke'
  /** BACKDROP of the exported video: pure black, identical in both themes (decision D8). */
  | '--replay-export-backdrop'

/**
 * readInk reads a layout variable of the theme — the DARK theme's during an export
 * (cf. `themeInk.ts`, decision D9), the active theme's otherwise. Returns an empty string on
 * the server side or when the variable is missing — an empty `fillStyle` leaves the context
 * unchanged rather than painting an invented color.
 */
export function readInk(name: InkVar): string {
  if (typeof document === 'undefined') return ''
  const value = readThemeVar(name)
  if (!value) {
    log.error(`replay-ink:${name}`, `Layout variable "${name}" missing from the theme.`)
    return ''
  }
  return value
}
