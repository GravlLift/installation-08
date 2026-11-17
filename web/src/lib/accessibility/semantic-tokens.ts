// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * semantic-tokens.ts — standalone stand-in for LevelUp's accessibility token contract.
 *
 * LevelUp resolves a closed catalogue of roles (`outcome-win`, `team-ally`, ...) against
 * a user-selectable palette. This viewer has no palette picker: a token is just the name
 * of a CSS variable defined once in `index.css`. `SemanticToken` is loosened to `string`
 * so the lifted code (which never swaps palettes here) still type-checks without carrying
 * the full LevelUp catalogue.
 */

export type SemanticToken = string

/** `tokenCssVar('team-ally')` -> `var(--team-ally)`, read from `index.css`. */
export function tokenCssVar(token: SemanticToken): string {
  return `var(--${token})`
}

export function tokenVar(token: SemanticToken): string {
  return `--${token}`
}
