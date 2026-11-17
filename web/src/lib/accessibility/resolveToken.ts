// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * resolveToken.ts — standalone stand-in for LevelUp's synchronous token resolver.
 *
 * LevelUp reads the hex value of a token from the active palette (for Canvas/Plotly code
 * that cannot use a CSS variable). This viewer has one fixed palette: resolve the same
 * CSS variable `tokenCssVar` points at, from the live document, falling back to a visible
 * neutral if the variable is not set (e.g. in a non-DOM test environment).
 */
import type { SemanticToken } from './semantic-tokens'

const FALLBACK = '#9ca3af'

export function resolveToken(token: SemanticToken): string {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return FALLBACK
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--${token}`).trim()
  return value || FALLBACK
}
