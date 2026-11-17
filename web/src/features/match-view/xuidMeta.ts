// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * xuidMeta.ts — WHO IS WHO IN A MATCH: display name and team, by xuid.
 *
 * WHY THIS FILE EXISTS. The same cascade was written twice, identically
 * (`MatchTugOfWarChart`, `MatchKDCumulChart`), and the 2D replay was about to claim
 * a third copy. Repo rule: the third copy gets centralized AND gets a guardrail —
 * here, `xuidMeta.guard.test.ts`, which forbids rewriting the cascade elsewhere.
 *
 * THE TEAM ISN'T IN THE DATA, it's inferred. "Ally" means "on the side of the player
 * whose page we're viewing": we read the `team_side` of their row, and everyone who
 * shares that side is an ally. With no row for them, nobody is an ally — better no
 * team at all than an invented one, since the kills' color depends on it.
 *
 * THE REPLAY PAGE ONLY READS THE NAMES FROM IT (2026-10-06). Its allegiance comes
 * from the FILM's team (`lib/replay/filmAllegiance.ts`): the identity table only
 * serves it the feed's gamertags and filters the database's kills, never says who's
 * an ally. The three-argument scheme it used to use ("ally" relative to its own
 * point of view, 2026-09-06) was removed along with that last reader; the Match
 * page's five charts still call with two arguments, unchanged.
 */
import { displayPlayerName } from '@/lib/players/displayName'
import type { MatchScoreboardRow } from '@/lib/api/types'
import { parseTeamSideID } from '@/lib/halo/teamNames'

/** Display name (bots included) and membership, by xuid. */
export type XuidMeta = ReadonlyMap<string, { gamertag: string; ally: boolean }>

/**
 * resolveXuidMeta indexes the scoreboard by xuid.
 *
 * `meXUID` names the page's player; their row can also be recognized by `is_me`,
 * which still takes priority (a row marked "me" is an ally by definition — even in
 * free-for-all, where nobody has a `team_side`: everyone ELSE's team stays
 * undecidable, but the page's own player's isn't inferred, it's given).
 */
export function resolveXuidMeta(
  scoreboard: MatchScoreboardRow[] | null | undefined,
  meXUID: string | null,
): XuidMeta {
  const sb = scoreboard ?? []
  const meRow = meXUID ? sb.find((r) => r.xuid === meXUID) : undefined
  const allyTeam = meRow?.team_side ?? null
  const meta = new Map<string, { gamertag: string; ally: boolean }>()
  for (const r of sb) {
    const ally = !!r.is_me || (allyTeam != null && r.team_side === allyTeam)
    meta.set(r.xuid, { gamertag: displayPlayerName(r.gamertag, r.xuid), ally })
  }
  return meta
}

/**
 * allyOfTeamId says whether a team (`teamId`, the number of a sheet side `t{N}`, the
 * one the score layer's series use) is on the page's player's side, FOR THE MATCH PAGE.
 *
 * The page reasons in "ally / opponent", a notion RELATIVE to the player being
 * viewed; the bridge goes through the sheet, the only place where the side and the
 * xuid coexist, and through the cascade above (`allies`). `null` = side not found or
 * no player recognized: the mark takes a neutral color, never one of the two
 * default colors.
 *
 * THE REPLAY PAGE DOESN'T USE IT: its allegiance comes from the FILM's team
 * (`lib/replay/filmAllegiance.ts`, 2026-10-06). This sheet reader used to live in
 * `lib/replay/scoreTimeline.ts`; it joined the cascade it depends on once the replay
 * stopped being one of its readers.
 */
export function allyOfTeamId(
  scoreboard: ReadonlyArray<Pick<MatchScoreboardRow, 'xuid' | 'team_side'>>,
  allies: ReadonlyMap<string, { ally: boolean }> | undefined,
  teamId: number,
): boolean | null {
  if (!allies) return null
  for (const row of scoreboard) {
    if (parseTeamSideID(row.team_side) !== teamId) continue
    const meta = allies.get(row.xuid)
    if (meta) return meta.ally
  }
  return null
}

/**
 * meXUIDOf finds the page's player in the scoreboard, when the caller doesn't have
 * it from elsewhere. `is_me` is set by the backend on the viewed player's row.
 *
 * THE INPUT IS DELIBERATELY WIDE (2026-09-06): `resolveViewpoint`, the replay's
 * point-of-view resolver, uses it for its fallback and only touches `xuid` + `is_me`.
 * Narrowing it to these two fields avoids re-copying the "me" row lookup here — a
 * sixth copy of the exact read that batch L2b just removed.
 */
export function meXUIDOf(
  scoreboard: readonly Pick<MatchScoreboardRow, 'xuid' | 'is_me'>[] | null | undefined,
): string | null {
  return (scoreboard ?? []).find((r) => r.is_me)?.xuid ?? null
}
