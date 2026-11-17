// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * teamSeriesColor.ts — THE COLOR OF A TEAM SERIES IN A CHART, and there is only one.
 *
 * A SINGLE TEAM-COLOR FAMILY: the `team-ally` / `team-enemy` TOKENS, i.e. the
 * accessibility palette the user has set (decision D1 of the styling plan) — in
 * charts (`teamSeriesColor`, via `resolveToken`) as in the DOM (`teamTokenCssVar`):
 * score table, team headers, kill feed, banner, timeline and replay map. The game's
 * OFFICIAL color by `team_id` (Eagle blue, Cobra red) paints no team: on Halo
 * Infinite `team_id` is ALWAYS present, and a cascade that placed it before the
 * token never reached the user's own setting — a player who set their teams to
 * green and orange would see blue and red.
 *
 * WHY THIS FILE RATHER THAN A PRIVATE FUNCTION. It was one — in
 * `MatchScoreCurveChart.tsx` — until the marked-points chart needed the SAME color
 * (2026-09-03). Two teams painted by two functions is two colors for the same team
 * across two blocks of the same tab (CLAUDE.md rule #6, ≤ 2 copies).
 *
 * NO HARDCODED VALUE: `resolveToken` reads the current palette, and the call must
 * happen FROM `buildOption` — it's the rebuild on palette change that refreshes the tint.
 */
import type { EChartsThemeColors } from '@/components/charts/_utils'
import { resolveToken, tokenCssVar } from '@/lib/accessibility'

/**
 * teamSeriesColor renders a team series's color.
 *
 * `ally === null` = team UNKNOWN: the caller can't place it against the viewed
 * player (via the sheet on the Match page's charts, via the film's team on the
 * replay and the Arsenal tab). Neutral theme color, never one of the two default
 * colors — asserting a team we haven't measured would be worse than saying nothing.
 */
export function teamSeriesColor(ally: boolean | null, tc: EChartsThemeColors): string {
  if (ally === null) return tc.axisLabel
  return resolveToken(ally ? 'team-ally' : 'team-enemy')
}

/**
 * THE NEUTRAL COLOR OF AN UNKNOWN TEAM IN THE DOM. A theme variable, never a team
 * token: asserting a team we haven't measured would be worse than saying nothing
 * (same rule as `teamSeriesColor`'s `tc.axisLabel` fallback).
 */
const NEUTRAL_TEAM_COLOR = 'var(--muted-foreground)'

/**
 * teamTokenCssVar — the DOM COUNTERPART of `teamSeriesColor`, and it obeys the SAME boundary.
 *
 * DOM/CSS charts (usage grid bars, pedestal-control sticks, objective face-off)
 * don't go through `resolveToken`: they write the token's CSS VARIABLE, which
 * follows the palette with no re-render. The choice rule itself is the same — the
 * `team-ally` / `team-enemy` tokens, i.e. the user's own accessibility palette,
 * never the game's official color by `team_id` (see the header).
 *
 * `ally === null` = team UNKNOWN, same as for `teamSeriesColor`: neutral theme color.
 */
export function teamTokenCssVar(ally: boolean | null): string {
  if (ally === null) return NEUTRAL_TEAM_COLOR
  return tokenCssVar(ally ? 'team-ally' : 'team-enemy')
}
