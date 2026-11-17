// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * teamLabel.ts — A TEAM'S LABEL, and there is only one of it.
 *
 * The cascade lived in two copies (`MatchScoreboard.tsx`, `MatchObjectivesSection.tsx`);
 * the 2D replay cards would have been the third (2026-08-16) — CLAUDE.md rule #6:
 * centralize AND add a guard rail (`teamLabel.guard.test.ts`: `labelHasTeamWord(` may no longer
 * be called outside `lib/halo/`).
 *
 * THE CASCADE'S ORDER, unchanged:
 *   1. the label supplied by the backend (`team_name` — Halo 5: "Red/Blue" already localized
 *      server-side from team_colors);
 *   2. otherwise the official name resolved on the frontend from `team_side` (Halo Infinite: Eagle / Cobra…);
 *   3. a label that ALREADY contains the word "équipe/team" is NOT re-prefixed (otherwise
 *      "Équipe Équipe Cobra"); a bare name receives the localized prefix;
 *   4. otherwise "Équipe N" if the team id is known but outside the reference list;
 *   5. otherwise the caller's LAST RESORT: "Unknown team" for `resolveTeamLabel`
 *      (Match View), "Équipe N" of the identifier the caller KNOWS for
 *      `resolveKnownTeamLabel` (replay: the team there comes from the film, it always has a number).
 * A decision based on the DATA, never on the title slug.
 */
import type { MatchScoreboardRow } from '@/lib/api/types'

import { labelHasTeamWord, parseTeamSideID, resolveTeamName } from './teamNames'

/**
 * The two localized texts that NAME a team. The replay dictionary carries them and nothing
 * more: on its page, a team comes from the film and is never "unknown" (ADR 0034 D-9).
 */
export interface TeamNamingText {
  teamLabelFmt: (name: string) => string
  teamNumberedFmt: (n: number) => string
}

/**
 * The Match View cascade's three texts: the two that name, plus its last
 * resort. `MatchViewText` carries them; this structural type avoids coupling between features.
 */
export interface TeamLabelText extends TeamNamingText {
  teamUnknown: string
}

/** Scoreboard rows to consider for the backend label: those of the targeted team. */
type RowsLike = ReadonlyArray<Pick<MatchScoreboardRow, 'team_name'>>

/**
 * nameFromSheet — steps 1 through 4 of the cascade, `null` when none of them names the team. The
 * two exported variants only differ in their last resort.
 */
function nameFromSheet(
  rows: RowsLike,
  teamSide: string | null | undefined,
  text: TeamNamingText,
): string | null {
  const backendName = rows.find((r) => r.team_name)?.team_name ?? null
  const officialName = backendName ?? resolveTeamName(teamSide)
  if (officialName) {
    return labelHasTeamWord(officialName) ? officialName : text.teamLabelFmt(officialName)
  }
  const teamID = parseTeamSideID(teamSide)
  return teamID != null ? text.teamNumberedFmt(teamID) : null
}

/**
 * resolveTeamLabel returns a team's display label.
 *
 * `rows` = the scoreboard rows FOR THIS TEAM (the first non-empty `team_name` wins);
 * `teamSide` = the backend's `t{N}`-format side, `null` if unknown.
 */
export function resolveTeamLabel(
  rows: RowsLike,
  teamSide: string | null | undefined,
  text: TeamLabelText,
): string {
  return nameFromSheet(rows, teamSide, text) ?? text.teamUnknown
}

/**
 * resolveKnownTeamLabel — the label of a team whose IDENTIFIER the caller knows:
 * the same cascade, and as a last resort "Équipe N" of that identifier instead
 * of "Unknown team". The replay uses it everywhere: the team there is the film's designator, and
 * a side without a scoreboard row keeps a name ("Équipe 1") rather than an admission of ignorance.
 */
export function resolveKnownTeamLabel(
  rows: RowsLike,
  teamSide: string | null | undefined,
  teamId: number,
  text: TeamNamingText,
): string {
  return nameFromSheet(rows, teamSide, text) ?? text.teamNumberedFmt(teamId)
}
