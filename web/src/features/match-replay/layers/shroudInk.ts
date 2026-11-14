/**
 * shroudInk.ts — THE SHROUD SCREEN'S INKS, read from the theme.
 *
 * DIEGETIC, LIKE THE SHOT TINTS (`fxInk.ts`): these are the colors the game paints the bubble
 * with, read in its material (the values and their tags are written next to the variables in
 * `index.css`). They are not data roles, so they are not `--ac-*` tokens an accessibility palette
 * would remap; they live in the theme and no color value is written in `features/`.
 */
import { log } from '@/lib/accessibility/_logger'

import type { ShroudInk } from './placementShroud'
import { readThemeVar } from './themeInk'

/** Theme variable of each ink of the bubble. */
export const SHROUD_INK_VARS: Readonly<Record<keyof ShroudInk, string>> = {
  core: '--replay-shroud-body',
  glow: '--replay-shroud-rim',
  cell: '--replay-shroud-cell',
}

/**
 * readShroudInk reads the bubble's three inks (DARK theme during an export, cf. `themeInk.ts`).
 * A missing variable returns an empty string and is logged, never replaced by an invented color.
 */
export function readShroudInk(): ShroudInk {
  const read = (name: string): string => {
    if (typeof document === 'undefined') return ''
    const value = readThemeVar(name)
    if (!value) log.error(`replay-shroud:${name}`, `Shroud ink "${name}" missing from the theme.`)
    return value
  }
  return { core: read(SHROUD_INK_VARS.core), glow: read(SHROUD_INK_VARS.glow), cell: read(SHROUD_INK_VARS.cell) }
}
