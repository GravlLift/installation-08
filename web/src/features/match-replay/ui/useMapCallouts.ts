// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useMapCallouts — the named areas of the match's map (`GET /api/matches/{id}/callouts`),
 * prepared for the HUD's place label (`mapCallouts`). Null while loading, and for good when
 * the server cannot read them (no game installed, a map without areas): the label is then
 * simply not drawn.
 */
import { useEffect, useState } from 'react'

import { calloutsUrl } from '@/lib/api/standalone'
import { prepareCallouts, type MapCallouts, type PreparedCallouts } from '../model/mapCallouts'

export function useMapCallouts(matchId: string | null | undefined): PreparedCallouts | null {
  const [state, setState] = useState<{ id: string; callouts: PreparedCallouts | null } | null>(null)
  useEffect(() => {
    if (!matchId) return
    const ctrl = new AbortController()
    void (async () => {
      let callouts: PreparedCallouts | null = null
      try {
        const res = await fetch(calloutsUrl(matchId), { signal: ctrl.signal })
        if (res.ok) callouts = prepareCallouts((await res.json()) as MapCallouts)
      } catch {
        // Offline, aborted or not JSON: no label.
      }
      if (!ctrl.signal.aborted) setState({ id: matchId, callouts })
    })()
    return () => ctrl.abort()
  }, [matchId])
  return state && state.id === matchId ? state.callouts : null
}
