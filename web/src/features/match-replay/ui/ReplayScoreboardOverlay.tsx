/**
 * ReplayScoreboardOverlay.tsx — the in-game scoreboard, rendered on top of the 3D view.
 *
 * One connected panel in the light-blue HUD style (`.bc-sb` in `broadcast.css`): the teams side
 * by side in columns of the same panel (one list for free-for-all), each team's score at the
 * frame read, and per player the kills, deaths and assists the film has recorded up to that
 * frame. Each team header carries its team color as a stripe (`teamColorOfXuid`, the in-game
 * team color), so the light blue is the chrome and the team color is the identity. The assists
 * column is drawn only when the film records assists at all. A counter the film does not
 * publish is left out, never a zero. The followed player's row is highlighted.
 *
 * No placeholder: the component renders nothing when the reading is `null` (no score
 * timeline, or an untrusted film clock) and nothing until the match sheet has loaded.
 */
import type { CSSProperties } from 'react'
import type { MatchScoreboardRow } from '@/lib/api/types'
import { campLabel } from '@/lib/replay/replayCamps'
import type { TeamNamingText } from '@/lib/halo/teamLabel'
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

/** One player's row. Counters the film withholds stay out (empty cells, never zeros). */
function PlayerRow({
  player,
  hasAssists,
  followed,
}: {
  player: ReplayScoreboardPlayer
  hasAssists: boolean
  followed: boolean
}) {
  const c = player.counters
  return (
    <tr className={followed ? 'bc-sb-followed' : undefined}>
      <td className="bc-sb-name">{displayPlayerName(player.name || null, player.xuid)}</td>
      <td>{c ? c.kills : ''}</td>
      <td>{c ? c.deaths : ''}</td>
      {hasAssists && <td>{c ? c.assists : ''}</td>}
    </tr>
  )
}

/** The column heads; the assists head is out with the column. */
function ColumnHead({ hasAssists }: { hasAssists: boolean }) {
  return (
    <tr className="bc-sb-cols">
      <th className="bc-sb-name">Player</th>
      <th>K</th>
      <th>D</th>
      {hasAssists && <th>A</th>}
    </tr>
  )
}

/** One team's column: the camp's name, its score at the frame read, and its players. */
function TeamTable({
  team,
  sheet,
  hasAssists,
  followedXuid,
  teamColorOfXuid,
}: {
  team: ReplayScoreboardTeam
  sheet: ReadonlyArray<MatchScoreboardRow>
  hasAssists: boolean
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
          <th colSpan={hasAssists ? 4 : 3}>
            <span className="bc-sb-teamline">
              <span className="bc-sb-teamname">{campLabel({ team: team.teamId, side: team.side }, sheet, TEAM_TEXT)}</span>
              <span className="bc-sb-score">{team.score}</span>
            </span>
          </th>
        </tr>
        <ColumnHead hasAssists={hasAssists} />
      </thead>
      <tbody>
        {team.players.map((p) => (
          <PlayerRow key={p.xuid} player={p} hasAssists={hasAssists} followed={followedXuid === p.xuid} />
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
  return (
    <div data-testid="replay-scoreboard" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <div className="bc-sb">
        {reading.ffa ? (
          <table className="bc-sb-team">
            <thead>
              <ColumnHead hasAssists={reading.hasAssists} />
            </thead>
            <tbody>
              {reading.players.map((p) => (
                <PlayerRow key={p.xuid} player={p} hasAssists={reading.hasAssists} followed={followedXuid === p.xuid} />
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
                hasAssists={reading.hasAssists}
                followedXuid={followedXuid}
                teamColorOfXuid={teamColorOfXuid}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
