/**
 * replayCamps.ts — THE REPLAY'S CAMPS: who gets in (the FILM), and what they are called (the
 * match SHEET).
 *
 * # THE TEAM IS THE FILM'S, AND NO OTHER SOURCE'S
 *
 * Decision of 2026-10-06 ("a section without a team does not exist; a player cannot fail to
 * have a team in a match"), in line with ADR 0034 D-9 ("team = the film alone") and the rule
 * "anonymous lives do not exist". The designator the roster publishes (`roster[].team`, schema
 * 57) is set ONCE on each player by `buildPlayers` (`ReplayPlayer.team`); `groupByCamp` draws
 * from it the camps of ALL the replay's groupings: card columns (`groupSeatsByTeam`), the
 * timeline's viewpoint menu, and the Arsenal tab's tables (`groupByTeam`).
 *
 * A PLAYER WHOSE TEAM THE FILM HIDES GETS INTO NO CAMP. That is neither an extra camp nor a
 * "set-apart" group: it is a SOURCE defect, counted by the bake (`coverage.seats.sansEquipe`)
 * and fixed there. No fallback files them by the sheet.
 *
 * # THE SHEET ONLY NAMES
 *
 * The sheet side (`team_side`, `t{N}`) that a camp's members carry gives it its NAME
 * (`campLabel`: Eagle, Cobra, or the `team_name` of a title that publishes one), and nothing
 * else: it decides neither the membership nor the ally/enemy ink, which also comes from the
 * film (`filmAllegiance.ts`, 2026-10-06). This module is the replay's only one to read it —
 * guardrail `replayCamps.guard.test.ts`.
 */
import type { MatchScoreboardRow } from '@/lib/api/types'
import { resolveKnownTeamLabel, type TeamNamingText } from '@/lib/halo/teamLabel'

/** A camp: the film's designator that DECIDES it, the sheet side that NAMES it. */
export interface ReplayCamp {
  /** The team designator the film writes (`roster[].team`): the camp's key, the only one. */
  team: number
  /**
   * The sheet side (`t{N}`) of its members that have a row — the majority's side among them
   * (`campSideOf`). It NAMES the camp, nothing else; `null` when no member has a row. It
   * decides neither who is in the camp nor its ink (`filmAllegiance.ts`).
   */
  side: string | null
}

/** What this module reads from a sheet row: its side, and the name it gives the team. */
export type CampSheetRow = Pick<MatchScoreboardRow, 'team_side' | 'team_name'>

/**
 * groupByCamp — files elements by CAMP of the FILM.
 *
 * THE ORDER OF CAMPS IS THAT OF THE DESIGNATORS (0, 1, …), stable from one frame and one bake
 * to the next; within a camp, entry order is kept. An element without a designator gets into
 * NO CAMP, and no camp is created for it (see the header). `rowsOf` returns an element's
 * sheet rows — a player has one or none, a seat those of its occupants — and serves only to
 * NAME the camp (`side`).
 */
export function groupByCamp<T>(
  items: readonly T[],
  teamOf: (item: T) => number | undefined,
  rowsOf: (item: T) => ReadonlyArray<CampSheetRow | undefined>,
): Array<ReplayCamp & { members: T[] }> {
  const parCamp = new Map<number, T[]>()
  for (const item of items) {
    const team = teamOf(item)
    if (team === undefined) continue
    const membres = parCamp.get(team)
    if (membres) membres.push(item)
    else parCamp.set(team, [item])
  }
  return [...parCamp.entries()]
    .sort(([a], [b]) => a - b)
    .map(([team, members]) => ({ team, side: campSideOf(members.flatMap(rowsOf)), members }))
}

/**
 * campSideOf — a camp's sheet side: the one carried by the MAJORITY of the given rows; on a
 * tie, the one that reached that count first. `null` when no row has a side (an empty string
 * is an absence: the DTO writes it for an unresolved camp).
 *
 * A MAJORITY, NOT THE FIRST COMER: the sheet can contradict the film on a player (the bake
 * counts it, `coverage.teams.contradiction`), and that player must not rename their camp.
 */
export function campSideOf(rows: ReadonlyArray<CampSheetRow | undefined>): string | null {
  const comptes = new Map<string, number>()
  let meilleur: string | null = null
  let max = 0
  for (const row of rows) {
    const side = row?.team_side
    if (!side) continue
    const n = (comptes.get(side) ?? 0) + 1
    comptes.set(side, n)
    if (n > max) {
      max = n
      meilleur = side
    }
  }
  return meilleur
}

/**
 * campLabel — the NAME of a camp, as every replay surface writes it.
 *
 * The repo's cascade (`resolveKnownTeamLabel`) on the sheet rows OF ITS SIDE — the published
 * `team_name`, else the side's official name (Eagle, Cobra…), else the side's "Team N" —, with
 * the FLOOR the DESIGNATOR's "Team N": a film camp always has a number, it is never "without a
 * team". `rows` can be the whole sheet or only the members' rows: only those of the camp's
 * side are read.
 */
export function campLabel(
  camp: ReplayCamp,
  rows: ReadonlyArray<CampSheetRow | undefined>,
  text: TeamNamingText,
): string {
  const side = camp.side
  const lignes = side
    ? rows.filter((row): row is CampSheetRow => row !== undefined && row.team_side === side)
    : []
  return resolveKnownTeamLabel(lignes, side, camp.team, text)
}
