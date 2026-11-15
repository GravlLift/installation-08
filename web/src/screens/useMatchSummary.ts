/**
 * useMatchSummary — the one `MatchSummary` row for `matchId`, read from `GET /api/matches` (no
 * single-match route exists yet, see `cmd/infinite-theater-3d/remote_routes.go`), and
 * useRemoteMatch — the same match's row in "Your recent matches" (`GET /api/remote/matches`),
 * which carries the mode and when it was played. Used by the top strip of the player chrome.
 * Each is `null` while loading, on a fetch error (signed out, service down), or when the id is
 * not in its list; the header just shows less.
 */
import { useEffect, useState } from 'react'

import { fetchMatches, fetchRemoteMatches, type MatchSummary, type RemoteMatch } from '../lib/api/standalone'

/** useRowOf loads a list once per `matchId` (and again when `refreshKey` changes) and keeps
 *  the row whose id matches. */
function useRowOf<T>(
  matchId: string,
  load: (signal: AbortSignal) => Promise<T[]>,
  idOf: (row: T) => string,
  label: string,
  refreshKey: number,
): T | null {
  const [row, setRow] = useState<T | null>(null)

  useEffect(() => {
    setRow(null)
    const controller = new AbortController()
    void (async () => {
      try {
        const rows = await load(controller.signal)
        if (controller.signal.aborted) return
        setRow(rows.find((r) => idOf(r) === matchId) ?? null)
      } catch (err) {
        if (controller.signal.aborted) return
        console.warn(`${label}: failed to load`, err)
        setRow(null)
      }
    })()
    return () => controller.abort()
    // load, idOf and label are module-level constants at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, refreshKey])

  return row
}

const summaryId = (m: MatchSummary) => m.matchId
const remoteId = (m: RemoteMatch) => m.id

/** `refreshKey` re-reads the list when it changes: the pre-game page bumps it once a shared
 *  match link's fetch has stored the match, so its header picks up the new row. */
export function useMatchSummary(matchId: string, refreshKey = 0): MatchSummary | null {
  return useRowOf(matchId, fetchMatches, summaryId, 'useMatchSummary', refreshKey)
}

export function useRemoteMatch(matchId: string): RemoteMatch | null {
  return useRowOf(matchId, fetchRemoteMatches, remoteId, 'useRemoteMatch', 0)
}
