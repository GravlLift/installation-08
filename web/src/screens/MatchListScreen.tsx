/**
 * MatchListScreen — the app's home screen: an account panel (sign in with Xbox, see
 * `AccountPanel`/`useAuthState`), "Your recent matches" from the signed-in account's Halo
 * history when signed in (`RemoteMatchesPanel`/`useRemoteMatches`/`useMatchFetchQueue`), and —
 * unchanged — every match the standalone server has already imported, from `GET /api/matches`.
 * Clicking a local row, or "Open" on an already-fetched remote row, opens `MatchViewScreen`
 * (see `App.tsx`'s router).
 */
import { useCallback, useEffect, useState } from 'react'

import { fetchMatches, type MatchSummary } from '../lib/api/standalone'
import { AccountPanel } from './AccountPanel'
import { RemoteMatchesPanel } from './RemoteMatchesPanel'
import { useAuthState } from './useAuthState'
import { useMatchFetchQueue } from './useMatchFetchQueue'
import { useRemoteMatches } from './useRemoteMatches'

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

function LocalMatchesSection({
  state,
  onOpenMatch,
}: {
  state: LoadState
  onOpenMatch: (matchId: string) => void
}) {
  if (state.phase === 'loading') {
    return <p className="text-sm text-muted-foreground">Loading matches…</p>
  }

  if (state.phase === 'error') {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-destructive">Could not reach the server: {state.message}</p>
        <p className="text-muted-foreground">Is `it3d.exe serve` running on 127.0.0.1:8177?</p>
      </div>
    )
  }

  if (state.matches.length === 0) {
    return <p className="text-sm text-muted-foreground">No matches imported yet.</p>
  }

  return (
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
              {m.players && m.players.length > 0 ? m.players.map((p) => p.name).join(', ') : '—'}
            </td>
            <td className="py-2 pr-4 text-muted-foreground">{formatImportedAt(m.importedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function MatchListScreen({ onOpenMatch }: { onOpenMatch: (matchId: string) => void }) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })

  const loadLocalMatches = useCallback((signal: AbortSignal) => {
    setState({ phase: 'loading' })
    void (async () => {
      try {
        const matches = await fetchMatches(signal)
        if (signal.aborted) return
        setState({ phase: 'ready', matches })
      } catch (err) {
        if (signal.aborted) return
        setState({
          phase: 'error',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    })()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    loadLocalMatches(controller.signal)
    return () => controller.abort()
  }, [loadLocalMatches])

  const auth = useAuthState()
  const signedIn = auth.phase.phase === 'signed_in'
  const remote = useRemoteMatches(signedIn)

  const onFetchReady = useCallback(
    (_matchId: string) => {
      remote.refresh()
      const controller = new AbortController()
      loadLocalMatches(controller.signal)
    },
    [remote, loadLocalMatches],
  )
  const fetchQueue = useMatchFetchQueue(onFetchReady)

  return (
    <div className="h-screen overflow-y-auto bg-background p-6 text-foreground">
      <h1 className="mb-4 text-lg font-semibold">LevelUp 3D Replay</h1>

      <div className="mb-6">
        <AccountPanel phase={auth.phase} onLogin={auth.login} onLogout={auth.logout} />
      </div>

      {signedIn && (
        <RemoteMatchesPanel
          state={remote.state}
          localIds={remote.localIds}
          activeMatchId={fetchQueue.activeMatchId}
          phaseOf={fetchQueue.phaseOf}
          onRefresh={remote.refresh}
          onFetch={fetchQueue.start}
          onOpen={onOpenMatch}
        />
      )}

      <h2 className="mb-4 text-sm font-semibold">Matches</h2>
      <LocalMatchesSection state={state} onOpenMatch={onOpenMatch} />
    </div>
  )
}
