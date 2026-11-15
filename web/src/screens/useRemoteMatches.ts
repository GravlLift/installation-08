/**
 * useRemoteMatches — loads "Your recent matches" (`GET /api/remote/matches`) and the local
 * store's match ids (`GET /api/matches`, reusing `fetchMatches`) whenever `signedIn` is true, so
 * each remote row can tell "Open" (already local) from "Fetch" (not yet). Exposes `refresh` for
 * the panel's own "Refresh" button and for after a fetch job completes.
 *
 * With a `gamertag`, the list is that player's recent matches instead of the account's own
 * (`?gamertag=`); changing it reloads, and a gamertag the service does not know ends in the
 * error "Gamertag not found".
 *
 * Loading is gated on `signedIn`: going from signed-in to signed-out clears the list rather than
 * leaving a stale one on screen (there is no account to have fetched it from any more).
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError, fetchMatches, fetchRemoteMatches, type RemoteMatch } from '../lib/api/standalone'
import { localMatchIdSet } from './matchSelectModel'

export type RemoteMatchesState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; matches: RemoteMatch[] }

/** The message shown when a searched gamertag names no player. */
export const GAMERTAG_NOT_FOUND = 'Gamertag not found'

function errorMessage(err: unknown, gamertag: string | null): string {
  if (gamertag && err instanceof ApiError && err.status === 404) return GAMERTAG_NOT_FOUND
  return err instanceof ApiError ? err.message : String(err)
}

// The server downloads a missing map picture in the background after the first list
// answer; this is how long the page waits before asking once more for the list.
const mapImageFollowUpDelayMs = 5000

export interface UseRemoteMatchesResult {
  state: RemoteMatchesState
  localIds: Set<string>
  /** The gamertag the settled state (ready or error) answers for, null for the account's own
   *  list. A caller compares it with the gamertag it asked for, so a list still holding the
   *  previous player's answer for a render is never shown under the new name. */
  loadedFor: string | null
  refresh: () => void
}

export function useRemoteMatches(signedIn: boolean, gamertag: string | null = null): UseRemoteMatchesResult {
  const [state, setState] = useState<RemoteMatchesState>({ phase: 'idle' })
  const [localIds, setLocalIds] = useState<Set<string>>(new Set())
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  // followUp marks the single scheduled follow-up itself, so it never schedules another:
  // a map whose image never downloads must not turn this into a 5 s polling loop.
  // keep (the follow-up and refresh, same list) leaves a ready list on screen while the new
  // answer loads, so the rows and the focused one do not blink away; a new gamertag does not.
  const load = useCallback((signal: AbortSignal, gt: string | null, followUp = false, keep = false) => {
    setState((s) => (keep && s.phase === 'ready' ? s : { phase: 'loading' }))
    void (async () => {
      try {
        const [remote, local] = await Promise.all([fetchRemoteMatches(signal, gt), fetchMatches(signal)])
        if (signal.aborted) return
        setLocalIds(localMatchIdSet(local))
        setLoadedFor(gt)
        setState({ phase: 'ready', matches: remote })
        // A single follow-up, not a polling loop: when an entry came back without its map
        // picture (the server is downloading it), re-request the list once about 5 s later.
        if (!followUp && remote.some((m) => m.mapAssetId && !m.mapImageUrl)) {
          setTimeout(() => {
            if (!signal.aborted) load(signal, gt, true, true)
          }, mapImageFollowUpDelayMs)
        }
      } catch (err) {
        if (signal.aborted) return
        setLoadedFor(gt)
        setState({ phase: 'error', message: errorMessage(err, gt) })
      }
    })()
  }, [])

  useEffect(() => {
    if (!signedIn) {
      setState({ phase: 'idle' })
      setLocalIds(new Set())
      return
    }
    const controller = new AbortController()
    controllerRef.current = controller
    load(controller.signal, gamertag)
    return () => controller.abort()
  }, [signedIn, gamertag, load])

  const refresh = useCallback(() => {
    if (!signedIn) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    load(controller.signal, gamertag, false, true)
  }, [signedIn, gamertag, load])

  return { state, localIds, loadedFor, refresh }
}
