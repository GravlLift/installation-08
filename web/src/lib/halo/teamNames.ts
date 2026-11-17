// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * teamNames — team_id -> official Halo Infinite team name resolution.
 *
 * 1:1 port of `src/config.py::TEAM_MAP` (Python main branch). Halo Infinite
 * defines 9 named teams (Eagle / Cobra / ...) assigned to team_id 0..8
 * in a fixed way by 343 Industries — this mapping does not depend on the match.
 *
 * The backend exposes `team_side` in the "t{N}" format for MatchScoreboard
 * (see buildTeamTabFull, which does `fmt.Sprintf("t%d", *s.TeamID)`). Other
 * surfaces (media picker) expose the integer directly — use
 * `resolveTeamNameFromID` then.
 *
 * Module placed under `lib/halo/` (and not `features/match-view/`) so it can
 * be consumed by several features without cross-feature coupling.
 */
import { sansAccents } from '@/lib/text/sansAccents'

const TEAM_NAMES_HALO_INFINITE: Record<number, string> = {
  0: 'Eagle',
  1: 'Cobra',
  2: 'Hades',
  3: 'Valkyrie',
  4: 'Rampart',
  5: 'Cutlass',
  6: 'Valor',
  7: 'Hazard',
  8: 'Observer',
}

/**
 * Parses "t{N}" -> N. Returns null if the format is not recognized (an empty team
 * or an older convention). Idempotent against null/undefined.
 */
export function parseTeamSideID(teamSide: string | null | undefined): number | null {
  if (!teamSide) return null
  const m = /^t(\d+)$/.exec(teamSide)
  if (!m) return null
  return Number(m[1])
}

/**
 * Resolves team_side "t{N}" -> official Halo Infinite name. Returns null if
 * team_id is absent from the map (a non-standard team, or a new one not yet
 * referenced) or if the format is invalid.
 */
export function resolveTeamName(teamSide: string | null | undefined): string | null {
  const id = parseTeamSideID(teamSide)
  if (id == null) return null
  return TEAM_NAMES_HALO_INFINITE[id] ?? null
}

/**
 * Direct variant: team_id (integer) -> official name, without going through the
 * "t{N}" format. Useful for surfaces that already expose the integer.
 */
export function resolveTeamNameFromID(teamID: number | null | undefined): string | null {
  if (teamID == null) return null
  return TEAM_NAMES_HALO_INFINITE[teamID] ?? null
}

/**
 * Path of a team's logo asset: `/titles/{slug}/teams/{teamId}.png`.
 * Uniform, title-agnostic asset resolution (the slug parameterizes the path, it is
 * not a behavior branch). Returns null if either is absent ->
 * the caller does not display a logo. Some team_id values may have no asset:
 * the `<img>`'s onError handles the 404 on the rendering side.
 */
export function teamLogoPath(
  slug: string | null | undefined,
  teamID: number | null | undefined,
): string | null {
  if (!slug || teamID == null) return null
  return `/titles/${slug}/teams/${teamID}.png`
}

/**
 * Detects whether a team label ALREADY contains the word "équipe"/"team"
 * (accents and case ignored). Used to avoid a double prefix: the Halo 5 backend
 * supplies a label that is already complete and localized from team_colors ("Équipe Cobra"),
 * whereas the official names resolved on the frontend (Eagle / Cobra) are BARE and
 * expect the "Équipe"/"Team" prefix added by teamLabelFmt.
 *
 * Title-agnostic: only the DATA (the label) is tested, never the slug.
 * No official Halo team name (Eagle/Cobra/Hades/…) contains these words,
 * so the test produces no false positive on bare names.
 */
export function labelHasTeamWord(name: string): boolean {
  const normalized = sansAccents(name).toLowerCase()
  return /\b(equipe|team)\b/.test(normalized)
}
