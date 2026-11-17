// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * filmAllegiance.ts — ALLEY OR ENEMY, READ FROM THE FILM: the only allegiance computation of the replay.
 *
 * # THE RULE (decision of 2026-10-06, agreed by the user)
 *
 * ally(p) = (p's film team) === (the REFERENCE player's film team). A player's team is the
 * designator the film writes in their roster entry (`ReplayPlayer.team`, ADR 0034 D-9); the
 * match sheet NAMES the camps (`replayCamps.ts`) and does not decide the ink.
 *
 * Until now, the ink came from the sheet, through the identity table `xuidMeta` — whose keys
 * are the BASE xuids. A bot, which the film designates by its `bot:<name>` key, was never
 * found there: it took enemy ink right into the watched player's own camp. Every replay surface
 * (pawns, columns, feed, timeline, scoreboard banner, end screen, objectives, sounds, the Arsenal
 * tab's tables) now reads this module, and `xuidMeta` serves only identity (the names) anymore.
 *
 * # THE REFERENCE IS GIVEN, NEVER DISCOVERED HERE
 *
 * `buildFilmAllegiance` receives the BASE xuid of the reference player: on the Replay page, the
 * point of view (`model.viewpoint`, the page's player by default); for the Arsenal tab's tables,
 * the page's player. It finds them in the film via their sheet row (`board.xuid`, the join of
 * `buildPlayers`) or via their key. The end-of-match sound receives the Replay page's allegiance
 * but reads only its camps and a player's team from it (`VictoryFilm`): its player, the page's,
 * it finds itself in the sheet (`endMatchSoundSpec`).
 *
 * # THREE ANSWERS: ally (`true`), enemy (`false`), NO CAMP INK (`null`)
 *
 *  - A PLAYER WHOSE TEAM THE FILM HIDES has no camp ink: `null`, each surface serves its neutral
 *    ink. That is a SOURCE defect, counted by the bake (`coverage.seats.sansEquipe`) and fixed on
 *    the Go side; the sheet does not fill it in.
 *  - A REFERENCE WITHOUT A FILM TEAM (or absent from the film) locates no one: `null` for ALL,
 *    itself included — it is a teamless player like any other. The surfaces whose structure is the
 *    camp (score banner, end screen, two-variant sounds) stay silent, as they did without a "me"
 *    row. Never a guessed ink.
 *  - CAMPLESS MODE (designator `-1` for the reference, "no team"): the reference is an ally of
 *    itself and every other player is an enemy — the free-for-all, as the page already painted
 *    it. A CAMP `-1` is not one: `ofTeam(-1)` returns `null`, as does a `-1` player in a camped
 *    mode.
 *
 * Everything is PURE: no React, no DOM, no color.
 */
import type { MatchScoreboardRow } from '@/lib/api/types'

import type { ReplayCamp } from './replayCamps'
import type { ReplayDocumentReady } from './replayNormalize'
import { buildPlayers, groupByTeam, type ReplayPlayer } from './rosterLogic'

/** Ally (`true`), enemy (`false`), or no camp ink (`null`) — see the header. */
export type Allegiance = boolean | null

/** Each one's allegiance, seen from the reference player. */
export interface FilmAllegiance {
  /**
   * THE ALLIED CAMP AS A NUMBER: the reference's film team when it is a camp (>= 0);
   * `null` when the reference is absent from the film, the film hides its team, or it gives
   * none (`-1`, campless mode). For reads that compare a designator (holder of a zone, a mark's
   * camp): `null` = stay silent.
   */
  readonly allyTeam: number | null
  /**
   * The match's camps (designators >= 0, ascending), named by the sheet from their members
   * (`ReplayCamp.side`). The score banner and the end screen require exactly two.
   */
  readonly camps: readonly ReplayCamp[]
  /** The allegiance of a CAMP of the film (a column, a table camp, a zone holder, a flag). */
  ofTeam: (team: number | null | undefined) => Allegiance
  /** The allegiance of a PLAYER of the film (the owner of a life). */
  ofPlayer: (player: ReplayPlayer | null | undefined) => Allegiance
  /**
   * The allegiance of a player designated by an identifier: their film key (`ReplayPlayer.xuid`,
   * `bot:<name>` for a bot) OR a BASE xuid (feed, sheet) — a bot links there through its sheet
   * row (`board.xuid`, `bid(N.0)`), the join of `buildPlayers`. Unknown → `null`.
   */
  ofXuid: (xuid: string | null | undefined) => Allegiance
  /** The film team of a player designated as for `ofXuid` (`-1` included); `null` if the film hides it. */
  teamOfXuid: (xuid: string | null | undefined) => number | null
  /**
   * The FILM keys (`ReplayPlayer.xuid`) of a camp's players: a human's xuid, which is also the
   * key of the position re-reads (`buildLivesByXuid`), and `bot:<name>` for a bot, which those
   * re-reads do not index (its lives have no xuid). Empty for a negative designator: "no team"
   * has no members.
   */
  membersOf: (team: number) => readonly string[]
}

const AUCUN_MEMBRE: readonly string[] = Object.freeze([])

/**
 * buildFilmAllegiance — each film player's allegiance seen from `reference` (BASE xuid, or film
 * key). `players`: the join of `buildPlayers`, of which only the team, the key and the sheet
 * row are read.
 */
export function buildFilmAllegiance(
  players: readonly ReplayPlayer[],
  reference: string | null | undefined,
): FilmAllegiance {
  const parCle = new Map<string, ReplayPlayer>()
  for (const p of players) {
    parCle.set(p.xuid, p)
    if (p.board?.xuid && !parCle.has(p.board.xuid)) parCle.set(p.board.xuid, p)
  }
  const ref = reference ? parCle.get(reference) : undefined
  const refKey = ref?.xuid ?? null
  const refTeam = ref?.team ?? null
  const allyTeam = refTeam !== null && refTeam >= 0 ? refTeam : null
  const ofTeam = (team: number | null | undefined): Allegiance =>
    allyTeam === null || team == null || team < 0 ? null : team === allyTeam
  const ofPlayer = (p: ReplayPlayer | null | undefined): Allegiance => {
    if (!p || p.team === undefined || refTeam === null) return null
    // CAMPLESS MODE: no one shares the reference's camp, which stays an ally of itself.
    if (refTeam < 0) return p.xuid === refKey
    return ofTeam(p.team)
  }
  const membres = new Map<number, string[]>()
  for (const p of players) {
    if (p.team === undefined || p.team < 0) continue
    const liste = membres.get(p.team)
    if (liste) liste.push(p.xuid)
    else membres.set(p.team, [p.xuid])
  }
  return {
    allyTeam,
    camps: groupByTeam(players)
      .filter((camp) => camp.team >= 0)
      .map(({ team, side }) => ({ team, side })),
    ofTeam,
    ofPlayer,
    ofXuid: (xuid) => (xuid ? ofPlayer(parCle.get(xuid)) : null),
    teamOfXuid: (xuid) => (xuid ? parCle.get(xuid)?.team ?? null : null),
    membersOf: (team) => membres.get(team) ?? AUCUN_MEMBRE,
  }
}

/** The allegiance of a page with no film (or no reference): no one has camp ink. */
export const NO_ALLEGIANCE: FilmAllegiance = buildFilmAllegiance([], null)

/**
 * filmAllegianceOf — the same allegiance, built from the document and the sheet: for the
 * surfaces that do not receive the join ready-made (the Arsenal tab's tables, mounted on the
 * Match page). Without a document (not yet loaded, or absent), no one has camp ink.
 */
export function filmAllegianceOf(
  doc: ReplayDocumentReady | null | undefined,
  scoreboard: MatchScoreboardRow[],
  reference: string | null | undefined,
): FilmAllegiance {
  return doc ? buildFilmAllegiance(buildPlayers(doc, scoreboard), reference) : NO_ALLEGIANCE
}
