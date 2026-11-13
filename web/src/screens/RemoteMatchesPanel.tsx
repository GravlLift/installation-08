/**
 * RemoteMatchesPanel — "Your recent matches": rows from `GET /api/remote/matches`, each either
 * "Open" (already in the local store) or "Fetch" (downloads and builds it). Shown only while
 * signed in (`MatchListScreen` gates on that). Logic lives in `useRemoteMatches` (the list,
 * local-id lookup) and `useMatchFetchQueue` (per-row fetch progress, single-flight); this stays
 * a thin render of both.
 */
import type { RemoteMatch } from '../lib/api/standalone'
import { formatRemoteMatchTime, isMatchLocal } from './homeScreenLogic'
import type { FetchRowPhase } from './useMatchFetchQueue'
import type { RemoteMatchesState } from './useRemoteMatches'

function fetchStatusText(phase: FetchRowPhase): string {
  switch (phase.phase) {
    case 'idle':
      return 'Waiting…'
    case 'queued':
      return 'Queued…'
    case 'downloading':
      return `Downloading… ${phase.done}/${phase.total}`
    case 'building':
      return 'Building…'
    case 'ready':
      return 'Ready'
    case 'blocked':
      return 'Another fetch is already in progress…'
    case 'failed':
      return phase.error === 'film not available'
        ? 'This film is no longer available on the Halo service.'
        : `Fetch failed: ${phase.error}`
  }
}

function RemoteMatchRow({
  match,
  isLocal,
  rowPhase,
  isActive,
  anyActive,
  onOpen,
  onFetch,
}: {
  match: RemoteMatch
  isLocal: boolean
  rowPhase: FetchRowPhase
  /** True while this row is the queue's current `activeMatchId` — covers `idle`/`blocked`
   *  (the 409-conflict fallback, see `useMatchFetchQueue`) as well as queued/downloading/
   *  building, so the row shows status text instead of a re-clickable Fetch button the whole
   *  time it is being polled, not just once a known progress state arrives. */
  isActive: boolean
  anyActive: boolean
  onOpen: () => void
  onFetch: () => void
}) {
  const inFlight = isActive && rowPhase.phase !== 'ready' && rowPhase.phase !== 'failed'
  const showOpen = isLocal || rowPhase.phase === 'ready'

  return (
    <tr className="border-b border-border">
      <td className="py-2 pr-4">{match.map || '—'}</td>
      <td className="py-2 pr-4">{match.mode || '—'}</td>
      <td className="py-2 pr-4 text-muted-foreground">{formatRemoteMatchTime(match.time)}</td>
      <td className="py-2 pr-4">
        {showOpen ? (
          <button
            type="button"
            className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground"
            onClick={onOpen}
          >
            Open
          </button>
        ) : inFlight ? (
          <span className="text-xs text-muted-foreground">{fetchStatusText(rowPhase)}</span>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-40"
              disabled={anyActive}
              onClick={onFetch}
            >
              Fetch
            </button>
            {rowPhase.phase === 'failed' && (
              <span className="text-xs text-destructive">{fetchStatusText(rowPhase)}</span>
            )}
          </div>
        )}
      </td>
    </tr>
  )
}

export function RemoteMatchesPanel({
  state,
  localIds,
  activeMatchId,
  phaseOf,
  onRefresh,
  onFetch,
  onOpen,
}: {
  state: RemoteMatchesState
  localIds: Set<string>
  activeMatchId: string | null
  phaseOf: (matchId: string) => FetchRowPhase
  onRefresh: () => void
  onFetch: (matchId: string) => void
  onOpen: (matchId: string) => void
}) {
  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Your recent matches</h2>
        <button
          type="button"
          className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
          onClick={onRefresh}
        >
          Refresh
        </button>
      </div>

      {state.phase === 'idle' && null}

      {state.phase === 'loading' && (
        <p className="text-sm text-muted-foreground">Loading recent matches…</p>
      )}

      {state.phase === 'error' && (
        <p className="text-sm text-destructive">Could not load recent matches: {state.message}</p>
      )}

      {state.phase === 'ready' && state.matches.length === 0 && (
        <p className="text-sm text-muted-foreground">No recent matches found.</p>
      )}

      {state.phase === 'ready' && state.matches.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="py-2 pr-4">Map</th>
              <th className="py-2 pr-4">Mode</th>
              <th className="py-2 pr-4">Played</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {state.matches.map((m) => (
              <RemoteMatchRow
                key={m.id}
                match={m}
                isLocal={isMatchLocal(m, localIds)}
                rowPhase={phaseOf(m.id)}
                isActive={activeMatchId === m.id}
                anyActive={activeMatchId !== null && activeMatchId !== m.id}
                onOpen={() => onOpen(m.id)}
                onFetch={() => onFetch(m.id)}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
