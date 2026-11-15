/**
 * replayScoreboardLogic.ts — the in-game scoreboard read AT THE CURRENT FRAME.
 *
 * What the overlay must say, and only that: each team's score at the frame read, and per
 * player the kills, deaths and assists the film has recorded up to that frame. Every
 * counter comes from the score timeline (`lib/replay/scoreTimeline`, schema 12) — the
 * film's own statborg records, the same source the 2D player cards read live. The team
 * score is the camp's `total` series; the per-player counters are the four player series
 * (personal score, kills, deaths, assists).
 *
 * THE MODE'S OWN COLUMN IS THE ONE EXCEPTION (`modeStatOf`): captures, ball time and zone time
 * exist only as match totals in the match stats (the film has no per-player series for them),
 * so that column reads the same at every frame and the overlay says so.
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
  /**
   * The mode's own stat for this player (`ReplayScoreboardReading.modeStat`): a count, or seconds
   * for a time stat. A MATCH TOTAL from the match stats, not a value at the frame read; `null`
   * when the sheet has no value for this player or the mode has no stat column.
   */
  modeValue: number | null
}

/**
 * The mode's own scoreboard column, as Halo Infinite's in-match scoreboard adds one: flag
 * captures in CTF, ball carry time in Oddball, zone time in Strongholds and King of the Hill
 * (both modes publish their zone time as `StrongholdOccupationTime`, served as
 * `time_in_zones_seconds`). Read from the match stats' objective block, so it is the match
 * total: the film gives no per-player series for it.
 */
export type ScoreboardModeStatKind = 'captures' | 'ballTime' | 'zoneTime'

export interface ScoreboardModeStat {
  kind: ScoreboardModeStatKind
  /** The column head. */
  label: string
  /** `true` for a time in seconds (shown m:ss), `false` for a count. */
  seconds: boolean
}

const MODE_STATS: ReadonlyArray<ScoreboardModeStat & { field: 'flag_captures' | 'time_as_skull_carrier_seconds' | 'time_in_zones_seconds' }> = [
  { kind: 'captures', label: 'Caps', seconds: false, field: 'flag_captures' },
  { kind: 'ballTime', label: 'Ball time', seconds: true, field: 'time_as_skull_carrier_seconds' },
  { kind: 'zoneTime', label: 'Hill time', seconds: true, field: 'time_in_zones_seconds' },
]

/**
 * modeStatOf — the mode's stat column, from the first objective field any sheet row carries
 * (the server fills only the played mode's block). `null` for a mode without one (Slayer) or a
 * sheet without objective stats: the column is left out then, never filled with zeros.
 */
export function modeStatOf(
  scoreboard: ReadonlyArray<MatchScoreboardRow>,
): { stat: ScoreboardModeStat; valueOf: (xuid: string) => number | null } | null {
  for (const { field, ...stat } of MODE_STATS) {
    const values = new Map<string, number>()
    for (const row of scoreboard) {
      const v = row.objective?.[field]
      if (typeof v === 'number' && Number.isFinite(v)) values.set(row.xuid, v)
    }
    if (values.size > 0) return { stat, valueOf: (xuid) => values.get(xuid) ?? null }
  }
  return null
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
  /** `true` when the film records personal score at all (the game's Score column, read at the
   *  frame like the other counters) — the column is drawn only then. */
  hasScore: boolean
  /** The mode's stat column (match totals), or `null` when the mode or the sheet has none. */
  modeStat: ScoreboardModeStat | null
}

/** scoreRecorded — does the film record personal score at all? Same rule as assists. */
export function scoreRecorded(timeline: ReplayScoreTimelineReady | undefined): boolean {
  return !!timeline?.players.some((p) => p.score.total.length > 0)
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

/** rowOf — one player's row at `frame`: name, the film's counters and the mode's stat. */
function rowOf(
  timeline: ReplayScoreTimelineReady,
  player: ReplayPlayer,
  frame: number,
  modeValueOf: ((xuid: string) => number | null) | null,
): ReplayScoreboardPlayer {
  return {
    xuid: player.xuid,
    name: playerName(player) ?? '',
    counters: playerCountersAt(timeline, player.xuid, frame),
    modeValue: modeValueOf ? modeValueOf(player.xuid) : null,
  }
}

/**
 * readReplayScoreboard — the scoreboard at `frame`.
 *
 * `null` when the score timeline must not be read (absent layer, or the film clock is not
 * trusted — `scoreTimelineOf` carries the guard): an uncalibrated score is worse than no
 * score, it reads as true.
 *
 * Rows are sorted the game's way: score descending when the film records score, then kills
 * descending, then deaths ascending.
 */
export function readReplayScoreboard(
  doc: ReplayDocumentReady,
  scoreboard: ReadonlyArray<MatchScoreboardRow>,
  frame: number,
): ReplayScoreboardReading | null {
  const timeline = scoreTimelineOf(doc)
  if (!timeline) return null

  const mode = modeStatOf(scoreboard)
  const hasScore = scoreRecorded(timeline)
  const players = buildPlayers(doc, [...scoreboard])
  const rows = new Map<string, ReplayScoreboardPlayer>()
  for (const p of players) rows.set(p.xuid, rowOf(timeline, p, frame, mode?.valueOf ?? null))

  // THE CAMPS OF THE FILM. `groupByTeam` is the one grouping of the whole replay; a player
  // the film withholds an entry (or a team) for is in no camp.
  const teams = groupByTeam(players)
  const ffa = teams.length < 2

  const sortRows = (list: readonly ReplayScoreboardPlayer[]): ReplayScoreboardPlayer[] =>
    [...list].sort((a, b) => {
      if (hasScore) {
        const sa = a.counters?.score ?? 0
        const sb = b.counters?.score ?? 0
        if (sb !== sa) return sb - sa
      }
      const ka = a.counters?.kills ?? 0
      const kb = b.counters?.kills ?? 0
      if (kb !== ka) return kb - ka
      return (a.counters?.deaths ?? 0) - (b.counters?.deaths ?? 0)
    })

  const columns = { hasAssists: assistsRecorded(timeline), hasScore, modeStat: mode?.stat ?? null }
  if (ffa) {
    return {
      ffa: true,
      teams: [],
      players: sortRows(players.map((p) => rows.get(p.xuid)!)),
      ...columns,
    }
  }

  const teamPanels = teams.map(({ team, side, players: members }) => ({
    teamId: team,
    side,
    score: teamScoreAtFrame(timeline, team, frame),
    players: sortRows(members.map((p) => rows.get(p.xuid)!)),
  }))
  return { ffa: false, teams: teamPanels, players: [], ...columns }
}
