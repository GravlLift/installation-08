// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * fxInk.ts — the SHOT EFFECT TINTS, read from the theme.
 *
 * WHAT THIS FILE SETTLES, AND WHY IT IS NOT A BREACH OF THE TOKEN RULE.
 * Lot 3.2 had settled "family = SHAPE, color = SHOTTER", and dropped the POC palette. The
 * user REOPENS this ruling on 2026-08-15, word for word: "le muzzle flash c'est bien pour
 * les armes CINÉTIQUES ; pour les autres faut des effets de type PLASMA BLEUTÉ OU ROUGEÂTRE
 * pour les armes Banished à énergie, voire d'ÉNERGIE VIOLETTE pour les armes Forerunner"
 * (the muzzle flash is right for KINETIC weapons; for the others we need effects in the BLUE
 * or REDDISH PLASMA style for the energy weapons of the Banished, or even VIOLET ENERGY for
 * the Forerunner weapons), then, as a correction: "the shot effect colors don't take the
 * shooter's color [...] they only take the WEAPON into account". So this is not a backslide
 * out of forgetting: the NATURE of the discharge is now stated by color, and the player's
 * identity stays carried by their marker and their aim cone.
 *
 * WHY NOT `--ac-*` TOKENS. Those state a DATA ROLE and are remapped by the accessibility
 * palettes: under Okabe-Ito, a blue plasma would become orange, which would destroy the very
 * information the tint carries. These colors are DIEGETIC — they name what the game shows.
 * They therefore live in the theme (`--replay-fx-*`, globals.css), with a value per light/dark
 * theme, and are read here the way `canvasInk.ts` reads the layout inks. The rule is extended,
 * not bypassed: no color value is written in `features/`.
 *
 * THE VOCABULARY IS THE SERVER'S: the title's `[shot_tints]` (the nature of the discharge),
 * published per weapon in `weaponLabels[id].tint`. The guardrail `fxInk.guard.test.ts` checks
 * that the two lists agree and that every tint has its variable in the theme — otherwise a
 * tint added on the server and not styled would fall back to neutral, silently.
 */
import { log } from '@/lib/accessibility/_logger'
import { readThemeVar } from './themeInk'

/** Natures of discharge. `neutral` is not a nature: it is the absence of a known nature. */
export type FxTint =
  | 'kinetic'
  | 'plasma_cool'
  | 'plasma_green'
  | 'plasma_hot'
  | 'forerunner'
  | 'electric'
  | 'needle'
  | 'blast'
  | 'neutral'

/** The natures the TITLE can publish (`neutral` is the client fallback, not a value). */
export const SERVED_FX_TINTS: readonly FxTint[] = [
  'kinetic',
  'plasma_cool',
  'plasma_green',
  'plasma_hot',
  'forerunner',
  'electric',
  'needle',
  'blast',
]

/** Theme variable of a tint. The dashes follow the CSS convention, not the TOML. */
export function fxTintVar(tint: FxTint): string {
  return `--replay-fx-${tint.replace('_', '-')}`
}

/**
 * fxTintOf validates the nature announced by the document.
 *
 * UNKNOWN OR ABSENT: `neutral`. We do not snap to a nearby tint — a borrowed color would
 * assert a nature we do not know, exactly as a borrowed shape would (same rule as
 * `familyOf`).
 */
export function fxTintOf(raw: string | undefined): FxTint {
  if (!raw) return 'neutral'
  return (SERVED_FX_TINTS as readonly string[]).includes(raw) ? (raw as FxTint) : 'neutral'
}

/** The inks of an effect: the tint of the discharge, and the shared white-hot core. */
export interface FxInk {
  tint: Record<FxTint, string>
  /** The white-hot core of the flash: the same incandescence whatever the nature. */
  core: string
}

/**
 * readFxInk reads the tints of the theme (DARK theme during an export, cf. `themeInk.ts`).
 * Call it ONCE per theme (not per frame): a `getComputedStyle` per effect and per frame
 * would cost far more than the drawing itself.
 *
 * A missing variable returns an empty string — an empty `fillStyle` leaves the context
 * unchanged rather than painting an invented color (same rule as `readInk`).
 */
export function readFxInk(): FxInk {
  const read = (name: string): string => {
    if (typeof document === 'undefined') return ''
    const value = readThemeVar(name)
    if (!value) {
      log.error(`replay-fx:${name}`, `Effect tint "${name}" missing from the theme.`)
      return ''
    }
    return value
  }
  const tint = {} as Record<FxTint, string>
  for (const t of [...SERVED_FX_TINTS, 'neutral' as FxTint]) {
    tint[t] = read(fxTintVar(t))
  }
  return { tint, core: read('--replay-fx-core') }
}
