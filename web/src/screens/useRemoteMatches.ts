/**
 * useRemoteMatches — loads "Your recent matches" (`GET /api/remote/matches`) and the local
 * store's match ids (`GET /api/matches`, reusing `fetchMatches`) whenever `signedIn` is true, so
 * each remote row can tell "Open" (already local) from "Fetch" (not yet). Exposes `refresh` for
 * the panel's own "Refresh" button and for after a fetch job completes.
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

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : String(err)
}

// The server downloads a missing map picture in the background after the first list
// answer; this is how long the page waits before asking once more for the list.
const mapImageFollowUpDelayMs = 5000

export interface UseRemoteMatchesResult {
  state: RemoteMatchesState
  localIds: Set<string>
  refresh: () => void
}

export function useRemoteMatches(signedIn: boolean): UseRemoteMatchesResult {
  const [state, setState] = useState<RemoteMatchesState>({ phase: 'idle' })
  const [localIds, setLocalIds] = useState<Set<string>>(new Set())
  const controllerRef = useRef<AbortController | null>(null)

  // followUp marks the single scheduled follow-up itself, so it never schedules another:
  // a map whose image never downloads must not turn this into a 5 s polling loop.
  const load = useCallback((signal: AbortSignal, followUp = false) => {
    setState({ phase: 'loading' })
    void (async () => {
      try {
        const [remote, local] = await Promise.all([fetchRemoteMatches(signal), fetchMatches(signal)])
        if (signal.aborted) return
        setLocalIds(localMatchIdSet(local))
        setState({ phase: 'ready', matches: remote })
        // A single follow-up, not a polling loop: when an entry came back without its map
        // picture (the server is downloading it), re-request the list once about 5 s later.
        if (!followUp && remote.some((m) => m.mapAssetId && !m.mapImageUrl)) {
          setTimeout(() => {
            if (!signal.aborted) load(signal, true)
          }, mapImageFollowUpDelayMs)
        }
      } catch (err) {
        if (signal.aborted) return
        setState({ phase: 'error', message: errorMessage(err) })
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
    load(controller.signal)
    return () => controller.abort()
  }, [signedIn, load])

  const refresh = useCallback(() => {
    if (!signedIn) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    load(controller.signal)
  }, [signedIn, load])

  return { state, localIds, refresh }
}
