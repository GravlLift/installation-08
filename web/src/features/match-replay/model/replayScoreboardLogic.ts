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
 * THE MODE'S OWN COLUMN IS READ LIVE FROM THE FILM WHERE THE FILM HAS IT (`liveCapturesAt`,
 * `liveBallTimeAt`): CTF captures (the flag carries layer joined to the score timeline) and
 * Oddball ball time (the skull carries layer) are readings at the frame, the way the in-game
 * scoreboard would read them there. Hill time has no zone-occupancy layer in the film, so it
 * stays a MATCH TOTAL from the match stats (`modeStatOf`), and the overlay says so under the
 * table. A mode whose film layer is absent on an older artifact falls back to the match total,
 * the same as hill time.
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
   * for a time stat. For captures and ball time it is the LIVE value at the frame read (from the
   * film); for hill time it is the match total, and likewise a match total when the mode's film
   * layer is absent on an older artifact. `null` when no value applies: the mode has no stat
   * column, or the match-total fallback has no sheet value for this player.
   */
  modeValue: number | null
}

/**
 * The mode's own scoreboard column, as Halo Infinite's in-match scoreboard adds one: flag
 * captures in CTF, ball carry time in Oddball, zone time in Strongholds and King of the Hill
 * (both modes publish their zone time as `StrongholdOccupationTime`, served as
 * `time_in_zones_seconds`). `modeStatOf` picks the column and its MATCH-TOTAL values from
 * the match stats' objective block; captures and ball time are then read LIVE at the frame
 * from the film (`liveCapturesAt`, `liveBallTimeAt`) where the film carries its layer, and
 * the match total is the fallback (hill time always is: no zone-occupancy layer in the film).
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
  /** The mode's stat column, or `null` when the mode or the sheet has none. */
  modeStat: ScoreboardModeStat | null
  /**
   * `true` when `modeStat` is a LIVE reading at the frame (CTF captures, Oddball ball time):
   * the overlay drops its "match totals" note then. `false` for hill time and for a mode whose
   * film layer is absent on an older artifact (the value is then the match total).
   */
  modeStatLive: boolean
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
 * How many frames after a flag carry ends the film may publish the team's +1 before the two
 * still read as the same event (the Fortress CTF artifact dates the tick exactly 2 frames
 * after the carry ends; the window absorbs producer variation).
 */
const CAPTURE_SCORE_WINDOW_FRAMES = 6

/**
 * liveCapturesAt — the CTF captures each player has made at `frame`, read from the film:
 * a `carried` flag span ending in a capture is a dated event the span's own state does not
 * mark (a span that ends in a drop looks identical to one that ends in a capture), so a
 * capture is the team score rising within a few frames of a carry's end. Each +1 of a team's
 * total at or before `frame` is one capture, attributed to that team's latest carry within
 * the window of the tick. `null` when the film carries no flag-carries layer (older
 * artifact): the caller falls back to the match total, the note saying so.
 */
function liveCapturesAt(
  doc: Pick<ReplayDocumentReady, 'flagCarries'>,
  players: readonly ReplayPlayer[],
  timeline: ReplayScoreTimelineReady,
  frame: number,
): Map<string, number> | null {
  if (doc.flagCarries.length === 0) return null
  const teamOf = new Map<string, number | undefined>()
  for (const p of players) teamOf.set(p.xuid, p.team)
  // Each team's candidate carries: the carried spans that ended at or before `frame`.
  const carries = new Map<number, { t1: number; xuid: string }[]>()
  for (const flag of doc.flagCarries) {
    for (const span of flag.spans) {
      if (span.state !== 'carried' || span.xuid === null || span.t1 > frame) continue
      const team = teamOf.get(span.xuid)
      if (team == null) continue
      const list = carries.get(team) ?? []
      list.push({ t1: span.t1, xuid: span.xuid })
      carries.set(team, list)
    }
  }
  const captures = new Map<string, number>()
  for (const teamSeries of timeline.teams) {
    if (teamSeries.teamId == null) continue
    const teamCarries = carries.get(teamSeries.teamId)
    if (!teamCarries) continue
    teamCarries.sort((a, b) => b.t1 - a.t1)
    const consumed = new Set<number>()
    let previous = 0
    for (const tick of teamSeries.total) {
      if (tick.t > frame) break
      const delta = Math.max(0, tick.v - previous)
      previous = tick.v
      // Each +1 takes the latest unconsumed carry that ended within the window of the tick —
      // one that ended after it is the NEXT capture, not this one, and stays unconsumed.
      for (let i = 0; i < delta; i++) {
        const idx = teamCarries.findIndex(
          (c, k) => !consumed.has(k) && c.t1 <= tick.t && tick.t - c.t1 <= CAPTURE_SCORE_WINDOW_FRAMES,
        )
        if (idx < 0) break
        consumed.add(idx)
        const carry = teamCarries[idx]!
        captures.set(carry.xuid, (captures.get(carry.xuid) ?? 0) + 1)
      }
    }
  }
  return captures
}

/**
 * liveBallTimeAt — the seconds of skull carry time each player has accumulated at `frame`,
 * read from the film's flat skull-carries periods: the sum of `min(t1, frame) - t0` over the
 * periods opened at or before `frame`, frames to seconds through the film's time scale. An
 * open period (`closed: false`) runs to the end of the data, which `min(t1, frame)` already
 * bounds. `null` when the film carries no skull-carries layer (older artifact) or no usable
 * time scale: the caller falls back to the match total, the note saying so.
 */
function liveBallTimeAt(
  doc: Pick<ReplayDocumentReady, 'skullCarries' | 'frameIntervalMs'>,
  frame: number,
): Map<string, number> | null {
  if (doc.skullCarries.length === 0) return null
  const intervalMs = doc.frameIntervalMs
  if (!intervalMs || !Number.isFinite(intervalMs) || intervalMs <= 0) return null
  const time = new Map<string, number>()
  for (const carry of doc.skullCarries) {
    if (carry.t0 > frame) continue
    time.set(carry.xuid, (time.get(carry.xuid) ?? 0) + ((Math.min(carry.t1, frame) - carry.t0) * intervalMs) / 1000)
  }
  return time
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

  // THE MODE'S OWN COLUMN, LIVE WHERE THE FILM HAS ITS LAYER. Captures and ball time are
  // readings at the frame (the overlay drops its "match totals" note then); hill time has
  // no zone-occupancy layer in the film, and a mode whose layer is absent on an older
  // artifact falls back to the match total, the note saying so. In live mode a player with
  // no value is at zero (a measure), never a gap.
  let modeValueOf: ((xuid: string) => number | null) | null = mode?.valueOf ?? null
  let modeStatLive = false
  if (mode) {
    if (mode.stat.kind === 'captures') {
      const live = liveCapturesAt(doc, players, timeline, frame)
      if (live) {
        modeValueOf = (xuid) => live.get(xuid) ?? 0
        modeStatLive = true
      }
    } else if (mode.stat.kind === 'ballTime') {
      const live = liveBallTimeAt(doc, frame)
      if (live) {
        modeValueOf = (xuid) => live.get(xuid) ?? 0
        modeStatLive = true
      }
    }
  }

  const rows = new Map<string, ReplayScoreboardPlayer>()
  for (const p of players) rows.set(p.xuid, rowOf(timeline, p, frame, modeValueOf))

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

  const columns = { hasAssists: assistsRecorded(timeline), hasScore, modeStat: mode?.stat ?? null, modeStatLive }
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
