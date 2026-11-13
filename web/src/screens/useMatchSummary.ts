/**
 * useMatchSummary — the one `MatchSummary` row for `matchId`, read from `GET /api/matches` (no
 * single-match route exists yet, see `cmd/infinite-theater-3d/remote_routes.go`). Used by
 * `MatchHeaderBar` to show the map name and import time above the 3D viewer. `null` while
 * loading, on a fetch error, or if the id is not in the list — the header just shows less.
 */
import { useEffect, useState } from 'react'

import { fetchMatches, type MatchSummary } from '../lib/api/standalone'

export function useMatchSummary(matchId: string): MatchSummary | null {
  const [summary, setSummary] = useState<MatchSummary | null>(null)

  useEffect(() => {
    setSummary(null)
    const controller = new AbortController()
    void (async () => {
      try {
        const matches = await fetchMatches(controller.signal)
        if (controller.signal.aborted) return
        setSummary(matches.find((m) => m.matchId === matchId) ?? null)
      } catch (err) {
        if (controller.signal.aborted) return
        console.warn('useMatchSummary: failed to load match list', err)
        setSummary(null)
      }
    })()
    return () => controller.abort()
  }, [matchId])

  return summary
}
