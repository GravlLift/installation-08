/**
 * ReplayScoreboardOverlay.tsx — the in-game scoreboard, rendered on top of the 3D view.
 *
 * One connected panel in the light-blue HUD style (`.bc-sb` in `broadcast.css`): the teams side
 * by side in columns of the same panel (one list for free-for-all), each team's score at the
 * frame read, and per player the columns of Halo Infinite's in-match scoreboard: Score, K, D, A,
 * then the mode's own stat (captures in CTF, ball time in Oddball, hill time in Strongholds and
 * King of the Hill). Score, kills, deaths and assists are the film's counters at the frame read;
 * the mode stat is the match total from the match stats (the film has no series for it), and
 * the panel says so under the table. Each team header carries its team color as a stripe
 * (`teamColorOfXuid`, the in-game team color), so the light blue is the chrome and the team
 * color is the identity. A column is drawn only when the data has it (score and assists when
 * the film records any, the mode stat when the sheet has one). A counter the film does not
 * publish is left out, never a zero. The followed player's row is highlighted.
 *
 * No placeholder: the component renders nothing when the reading is `null` (no score
 * timeline, or an untrusted film clock) and nothing until the match sheet has loaded.
 */
import type { CSSProperties } from 'react'
import type { MatchScoreboardRow } from '@/lib/api/types'
import { campLabel } from '@/lib/replay/replayCamps'
import type { TeamNamingText } from '@/lib/halo/teamLabel'
import { formatClock } from '@/lib/replay/replayLogic'
import { displayPlayerName } from '@/lib/players/displayName'
import type {
  ReplayScoreboardPlayer,
  ReplayScoreboardReading,
  ReplayScoreboardTeam,
} from '../model/replayScoreboardLogic'

/** The English team-naming texts of the replay dictionary. */
const TEAM_TEXT: TeamNamingText = {
  teamLabelFmt: (name) => `Team ${name}`,
  teamNumberedFmt: (n) => `Team ${n}`,
}

/** Which columns the reading carries. */
type Columns = Pick<ReplayScoreboardReading, 'hasScore' | 'hasAssists' | 'modeStat'>

function columnCount(columns: Columns): number {
  return 3 + (columns.hasScore ? 1 : 0) + (columns.hasAssists ? 1 : 0) + (columns.modeStat ? 1 : 0)
}

/** The mode stat's cell: a count, or a time as m:ss. */
function modeCell(value: number | null, columns: Columns): string {
  if (value === null || !columns.modeStat) return ''
  return columns.modeStat.seconds ? formatClock(value * 1000) : String(value)
}

/** One player's row. Counters the film withholds stay out (empty cells, never zeros). */
function PlayerRow({
  player,
  columns,
  followed,
}: {
  player: ReplayScoreboardPlayer
  columns: Columns
  followed: boolean
}) {
  const c = player.counters
  return (
    <tr className={followed ? 'bc-sb-followed' : undefined}>
      <td className="bc-sb-name">{displayPlayerName(player.name || null, player.xuid)}</td>
      {columns.hasScore && <td className="bc-sb-points">{c ? c.score : ''}</td>}
      <td>{c ? c.kills : ''}</td>
      <td>{c ? c.deaths : ''}</td>
      {columns.hasAssists && <td>{c ? c.assists : ''}</td>}
      {columns.modeStat && <td className="bc-sb-mode">{modeCell(player.modeValue, columns)}</td>}
    </tr>
  )
}

/** The column heads; a column the data lacks is out with its head. */
function ColumnHead({ columns }: { columns: Columns }) {
  return (
    <tr className="bc-sb-cols">
      <th className="bc-sb-name">Player</th>
      {columns.hasScore && <th>Score</th>}
      <th>K</th>
      <th>D</th>
      {columns.hasAssists && <th>A</th>}
      {columns.modeStat && <th className="bc-sb-mode">{columns.modeStat.label}</th>}
    </tr>
  )
}

/** One team's column: the camp's name, its score at the frame read, and its players. */
function TeamTable({
  team,
  sheet,
  columns,
  followedXuid,
  teamColorOfXuid,
}: {
  team: ReplayScoreboardTeam
  sheet: ReadonlyArray<MatchScoreboardRow>
  columns: Columns
  followedXuid: string | null
  teamColorOfXuid?: (xuid: string) => string | null
}) {
  const first = team.players[0]
  const color = first ? teamColorOfXuid?.(first.xuid) : null
  const style = color ? ({ '--bc-sb-team': color } as CSSProperties) : undefined
  return (
    <table className="bc-sb-team" style={style}>
      <thead>
        <tr className="bc-sb-teamhead">
          <th colSpan={columnCount(columns)}>
            <span className="bc-sb-teamline">
              <span className="bc-sb-teamname">{campLabel({ team: team.teamId, side: team.side }, sheet, TEAM_TEXT)}</span>
              <span className="bc-sb-score">{team.score}</span>
            </span>
          </th>
        </tr>
        <ColumnHead columns={columns} />
      </thead>
      <tbody>
        {team.players.map((p) => (
          <PlayerRow key={p.xuid} player={p} columns={columns} followed={followedXuid === p.xuid} />
        ))}
      </tbody>
    </table>
  )
}

/**
 * The overlay. `reading` is `null` while the score timeline is absent or untrusted — nothing
 * is rendered then (no placeholder, no final-only value). The followed player's row carries
 * the highlight.
 */
export function ReplayScoreboardOverlay({
  reading,
  sheet,
  followedXuid,
  teamColorOfXuid,
}: {
  reading: ReplayScoreboardReading | null
  sheet: ReadonlyArray<MatchScoreboardRow>
  followedXuid: string | null
  /** The in-game team color of a player, for each team header's stripe. */
  teamColorOfXuid?: (xuid: string) => string | null
}) {
  if (!reading) return null
  const columns: Columns = { hasScore: reading.hasScore, hasAssists: reading.hasAssists, modeStat: reading.modeStat }
  return (
    <div data-testid="replay-scoreboard" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <div className="bc-sb">
        {reading.ffa ? (
          <table className="bc-sb-team">
            <thead>
              <ColumnHead columns={columns} />
            </thead>
            <tbody>
              {reading.players.map((p) => (
                <PlayerRow key={p.xuid} player={p} columns={columns} followed={followedXuid === p.xuid} />
              ))}
            </tbody>
          </table>
        ) : (
          <div className="bc-sb-teams">
            {reading.teams.map((team) => (
              <TeamTable
                key={team.teamId}
                team={team}
                sheet={sheet}
                columns={columns}
                followedXuid={followedXuid}
                teamColorOfXuid={teamColorOfXuid}
              />
            ))}
          </div>
        )}
        {reading.modeStat && !reading.modeStatLive && (
          <p className="bc-sb-note">{reading.modeStat.label}: match totals</p>
        )}
      </div>
    </div>
  )
}
