/**
 * ReplayScoreboardOverlay.tsx — the in-game scoreboard, rendered on top of the 3D view.
 *
 * Two team panels side by side (one list for free-for-all), each team's score at the frame
 * read, and per player the kills, deaths and assists the film has recorded up to that
 * frame. The assists column is drawn only when the film records assists at all. A counter
 * the film does not publish is left out, never a zero. The followed player's row is
 * highlighted.
 *
 * No placeholder: the component renders nothing when the reading is `null` (no score
 * timeline, or an untrusted film clock) and nothing until the match sheet has loaded.
 */
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
    <tr className={followed ? 'bg-accent/60' : undefined}>
      <td className="max-w-40 truncate px-2 py-0.5 text-left text-foreground">
        {displayPlayerName(player.name || null, player.xuid)}
      </td>
      <td className="px-2 py-0.5 text-right tabular-nums text-foreground">{c ? c.kills : ''}</td>
      <td className="px-2 py-0.5 text-right tabular-nums text-foreground">{c ? c.deaths : ''}</td>
      {hasAssists && (
        <td className="px-2 py-0.5 text-right tabular-nums text-foreground">{c ? c.assists : ''}</td>
      )}
    </tr>
  )
}

/** The column heads; the assists head is out with the column. */
function ColumnHead({ hasAssists }: { hasAssists: boolean }) {
  return (
    <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
      <th className="px-2 py-0.5 text-left font-normal">Player</th>
      <th className="px-2 py-0.5 text-right font-normal">K</th>
      <th className="px-2 py-0.5 text-right font-normal">D</th>
      {hasAssists && <th className="px-2 py-0.5 text-right font-normal">A</th>}
    </tr>
  )
}

/** One team's panel: the camp's name, its score at the frame read, and its players. */
function TeamPanel({
  team,
  sheet,
  hasAssists,
  followedXuid,
}: {
  team: ReplayScoreboardTeam
  sheet: ReadonlyArray<MatchScoreboardRow>
  hasAssists: boolean
  followedXuid: string | null
}) {
  return (
    <table className="border-collapse text-xs">
      <thead>
        <tr>
          <th colSpan={hasAssists ? 4 : 3} className="border-b border-border px-2 py-1 text-left font-semibold text-foreground">
            {campLabel({ team: team.teamId, side: team.side }, sheet, TEAM_TEXT)}
            <span className="ml-2 tabular-nums">{team.score}</span>
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
}: {
  reading: ReplayScoreboardReading | null
  sheet: ReadonlyArray<MatchScoreboardRow>
  followedXuid: string | null
}) {
  if (!reading) return null
  if (reading.ffa) {
    return (
      <div data-testid="replay-scoreboard" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
        <div className="rounded border border-border bg-card/95 p-3 shadow-lg">
          <table className="border-collapse text-xs">
            <thead>
              <ColumnHead hasAssists={reading.hasAssists} />
            </thead>
            <tbody>
              {reading.players.map((p) => (
                <PlayerRow key={p.xuid} player={p} hasAssists={reading.hasAssists} followed={followedXuid === p.xuid} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }
  return (
    <div data-testid="replay-scoreboard" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-4">
      {reading.teams.map((team) => (
        <div key={team.teamId} className="rounded border border-border bg-card/95 p-3 shadow-lg">
          <TeamPanel team={team} sheet={sheet} hasAssists={reading.hasAssists} followedXuid={followedXuid} />
        </div>
      ))}
    </div>
  )
}
