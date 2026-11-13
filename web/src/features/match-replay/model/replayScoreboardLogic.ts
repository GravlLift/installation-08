/**
 * replayScoreboardLogic.ts — the in-game scoreboard read AT THE CURRENT FRAME.
 *
 * What the overlay must say, and only that: each team's score at the frame read, and per
 * player the kills, deaths and assists the film has recorded up to that frame. Every
 * counter comes from the score timeline (`lib/replay/scoreTimeline`, schema 12) — the
 * film's own statborg records, the same source the 2D player cards read live. The team
 * score is the camp's `total` series; the per-player counters are the four player series.
 *
 * WHY NOT THE KILL EVENTS. `doc.killCauses` carries kills only (no death channel of its
 * own, no assists at all), and credits the killer the moment the film writes the cause.
 * The statborg counters ARE the game's scoreboard, dated per frame; counting from events
 * would invent a second, disagreeing one.
 *
 * WHAT THIS MODULE DELIBERATELY SAYS NOTHING ABOUT:
 *  - A player the film does not publish has no counters: `null`, never zeros. A "0" for
 *    someone the film never paired is a false statement (same doctrine as
 *    `scoreTimeline.playerCountersAt`);
 *  - An assists column only when the film records any assist at all (at least one
 *    published assists series with a step).
 *
 * TEAMS ARE THE FILM'S CAMPS (`ReplayPlayer.team`, the sole source of membership). A
 * player whose team the film withholds enters no team, exactly as everywhere else in the
 * replay. Free-for-all (no camp designated: `team` -1 or absent on every entry) is ONE
 * list, not teams.
 *
 * PURE module: no React, no DOM, no color.
 */
import type { MatchScoreboardRow } from '@/lib/api/types'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import { buildPlayers, groupByTeam, playerName, type ReplayPlayer } from '@/lib/replay/rosterLogic'
import {
  playerCountersAt,
  scoreTimelineOf,
  teamScoreAtFrame,
  type PlayerCounters,
  type ReplayScoreTimelineReady,
} from '@/lib/replay/scoreTimeline'

/** One player's row of the scoreboard, at the frame read. */
export interface ReplayScoreboardPlayer {
  /** Base xuid when the join to the match sheet landed, the film key otherwise (`bot:<name>`). */
  xuid: string
  /** Display name: the sheet's gamertag, the film's name when the sheet has none; empty for an unnamed entry. */
  name: string
  /**
   * The four counters the film gives at `frame`, or `null` when the film does not publish
   * this player (never zeros — see the module header).
   */
  counters: PlayerCounters | null
}

/** One team's panel: its members and the team score at the frame read. */
export interface ReplayScoreboardTeam {
  /** The film's camp designator — the render key, never a label. */
  teamId: number
  /** The camp's sheet side (`t{N}`) when its members carry one — names the team, nothing else. */
  side: string | null
  /** The team's TOTAL at the frame read; 0 for a camp that never scored (a measure, not a gap). */
  score: number
  players: ReplayScoreboardPlayer[]
}

/** The whole reading, or `null` when nothing may be shown (no score timeline, or an
 *  untrusted film clock). */
export interface ReplayScoreboardReading {
  /** `true` for free-for-all: one list, not team panels. */
  ffa: boolean
  /** The team panels (in camp-designator order); empty for free-for-all. */
  teams: ReplayScoreboardTeam[]
  /** One list for free-for-all; empty for team modes (the panels carry the rows). */
  players: ReplayScoreboardPlayer[]
  /** `true` when the film records assists at all — the column is drawn only then. */
  hasAssists: boolean
}


/**
 * assistsRecorded — does the film record assists at all? At least one published player
 * carries an assists series with a step. A series that never stepped records nothing:
 * the film is silent, which is not the same as "everyone is at zero".
 */
export function assistsRecorded(timeline: ReplayScoreTimelineReady | undefined): boolean {
  if (!timeline) return false
  for (const p of timeline.players) {
    if (p.assists.total.length > 0) return true
  }
  return false
}

/** rowOf — one player's row at `frame`: name and the film's counters. */
function rowOf(
  timeline: ReplayScoreTimelineReady,
  player: ReplayPlayer,
  frame: number,
): ReplayScoreboardPlayer {
  return {
    xuid: player.xuid,
    name: playerName(player) ?? '',
    counters: playerCountersAt(timeline, player.xuid, frame),
  }
}

/**
 * readReplayScoreboard — the scoreboard at `frame`.
 *
 * `null` when the score timeline must not be read (absent layer, or the film clock is not
 * trusted — `scoreTimelineOf` carries the guard): an uncalibrated score is worse than no
 * score, it reads as true.
 *
 * Rows are sorted the game's way: kills descending, then deaths ascending.
 */
export function readReplayScoreboard(
  doc: ReplayDocumentReady,
  scoreboard: ReadonlyArray<MatchScoreboardRow>,
  frame: number,
): ReplayScoreboardReading | null {
  const timeline = scoreTimelineOf(doc)
  if (!timeline) return null

  const players = buildPlayers(doc, [...scoreboard])
  const rows = new Map<string, ReplayScoreboardPlayer>()
  for (const p of players) rows.set(p.xuid, rowOf(timeline, p, frame))

  // THE CAMPS OF THE FILM. `groupByTeam` is the one grouping of the whole replay; a player
  // the film withholds an entry (or a team) for is in no camp.
  const teams = groupByTeam(players)
  const ffa = teams.length < 2

  const sortRows = (list: readonly ReplayScoreboardPlayer[]): ReplayScoreboardPlayer[] =>
    [...list].sort((a, b) => {
      const ka = a.counters?.kills ?? 0
      const kb = b.counters?.kills ?? 0
      if (kb !== ka) return kb - ka
      return (a.counters?.deaths ?? 0) - (b.counters?.deaths ?? 0)
    })

  if (ffa) {
    return {
      ffa: true,
      teams: [],
      players: sortRows(players.map((p) => rows.get(p.xuid)!)),
      hasAssists: assistsRecorded(timeline),
    }
  }

  const teamPanels = teams.map(({ team, side, players: members }) => ({
    teamId: team,
    side,
    score: teamScoreAtFrame(timeline, team, frame),
    players: sortRows(members.map((p) => rows.get(p.xuid)!)),
  }))
  return { ffa: false, teams: teamPanels, players: [], hasAssists: assistsRecorded(timeline) }
}
