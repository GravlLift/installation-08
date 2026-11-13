/**
 * MatchListScreen — the app's home screen: every match the standalone server has imported,
 * from `GET /api/matches`. Clicking a row opens `MatchViewScreen` (see `App.tsx`'s router).
 */
import { useEffect, useState } from 'react'

import { fetchMatches, type MatchSummary } from '../lib/api/standalone'

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
}

function formatImportedAt(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; matches: MatchSummary[] }

export function MatchListScreen({ onOpenMatch }: { onOpenMatch: (matchId: string) => void }) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    setState({ phase: 'loading' })
    void (async () => {
      try {
        const matches = await fetchMatches(controller.signal)
        setState({ phase: 'ready', matches })
      } catch (err) {
        if (controller.signal.aborted) return
        setState({
          phase: 'error',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    })()
    return () => controller.abort()
  }, [])

  if (state.phase === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Loading matches…
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 text-sm">
        <p className="text-destructive">Could not reach the server: {state.message}</p>
        <p className="text-muted-foreground">
          Is `it3d.exe serve` running on 127.0.0.1:8177?
        </p>
      </div>
    )
  }

  if (state.matches.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        No matches imported yet.
      </div>
    )
  }

  return (
    <div className="h-screen overflow-y-auto bg-background p-6 text-foreground">
      <h1 className="mb-4 text-lg font-semibold">Matches</h1>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2 pr-4">Map</th>
            <th className="py-2 pr-4">Duration</th>
            <th className="py-2 pr-4">Players</th>
            <th className="py-2 pr-4">Imported</th>
          </tr>
        </thead>
        <tbody>
          {state.matches.map((m) => (
            <tr
              key={m.matchId}
              className="cursor-pointer border-b border-border hover:bg-card"
              onClick={() => onOpenMatch(m.matchId)}
            >
              <td className="py-2 pr-4">{m.mapName || m.mapModule || m.matchId}</td>
              <td className="py-2 pr-4 font-mono">{formatDuration(m.durationMs)}</td>
              <td className="py-2 pr-4">
                {m.players && m.players.length > 0
                  ? m.players.map((p) => p.name).join(', ')
                  : '—'}
              </td>
              <td className="py-2 pr-4 text-muted-foreground">{formatImportedAt(m.importedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
