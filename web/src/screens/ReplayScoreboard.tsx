import { useState } from 'react'
import type { MatchScoreboardRow } from '../lib/api/types'

export function ReplayScoreboard({ rows }: { rows: MatchScoreboardRow[] }) {
  const [open, setOpen] = useState(false)
  if (!rows.length) return null
  return <div className="absolute left-3 top-3 z-10 text-sm text-foreground">
    <button type="button" className="rounded bg-card/90 px-2 py-1" onClick={() => setOpen(!open)} aria-expanded={open}>Scoreboard</button>
    {open && <div className="mt-1 max-h-80 overflow-auto rounded bg-card/95 p-3"><table>
      <thead><tr><th>Player</th><th>Team</th><th>K</th><th>D</th><th>A</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.xuid}><td>{row.gamertag || row.xuid}</td><td>{row.team_side ?? '—'}</td><td>{row.kills ?? '—'}</td><td>{row.deaths ?? '—'}</td><td>{row.assists ?? '—'}</td></tr>)}</tbody>
    </table></div>}
  </div>
}
