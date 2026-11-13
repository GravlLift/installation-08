/**
 * useMatchFetchQueue — drives the "Fetch" button on each remote-match row: starts the server's
 * one-at-a-time fetch-and-build job, polls its state every `pollMs` while it is in flight, and
 * reports when a match becomes `ready` so the caller can refresh the local list.
 *
 * Single-flight, client side: `start` no-ops while any row is already active (`activeMatchId`
 * set), same contract as `useMeshBuild.ts`'s `build()`. A 409 from the server (someone else —
 * another tab, or a job this client lost track of — is already fetching) is not surfaced as an
 * error: the row becomes `blocked` and polls the SAME per-match state route, which reports real
 * progress if it turns out to be this match after all, or keeps reading `idle` if it is some
 * other match. Either way the row has something true to show instead of a raw 409.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  ApiError,
  FetchConflictError,
  fetchFetchState,
  startMatchFetch,
  type FetchStateBody,
} from '../lib/api/standalone'

export type FetchRowPhase =
  | { phase: 'idle' }
  | { phase: 'queued' }
  | { phase: 'downloading'; done: number; total: number }
  | { phase: 'building' }
  | { phase: 'ready' }
  | { phase: 'failed'; error: string }
  | { phase: 'blocked' }

/** Default polling interval while a fetch job is in flight. */
export const MATCH_FETCH_POLL_MS = 2000

const IDLE_PHASE: FetchRowPhase = { phase: 'idle' }

/** Turns one fetch-state body into the phase a row renders. Pure, so it is tested without
 *  touching the network or a timer. */
export function phaseOfFetchState(body: FetchStateBody): FetchRowPhase {
  switch (body.state) {
    case 'idle':
      return IDLE_PHASE
    case 'queued':
      return { phase: 'queued' }
    case 'downloading':
      return { phase: 'downloading', done: body.done, total: body.total }
    case 'building':
      return { phase: 'building' }
    case 'ready':
      return { phase: 'ready' }
    case 'failed':
      return { phase: 'failed', error: body.error ?? 'fetch failed' }
  }
}

/** Whether `phase` needs another poll (a job for this row is in flight, known or suspected).
 *  `idle` counts here too: the only way a row's phase is explicitly `idle` (as opposed to simply
 *  having no entry at all, which the polling effect treats as "never started") is a poll response
 *  after a 409 conflict — meaning some other match is still the one in flight, so this row keeps
 *  polling its own state on the chance it becomes the active job after all. */
export function isFetchRowInFlight(phase: FetchRowPhase): boolean {
  return (
    phase.phase === 'idle' ||
    phase.phase === 'queued' ||
    phase.phase === 'downloading' ||
    phase.phase === 'building' ||
    phase.phase === 'blocked'
  )
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : String(err)
}

export interface UseMatchFetchQueueResult {
  /** The match id currently being fetched (or suspected to be, after a conflict), if any. */
  activeMatchId: string | null
  /** This row's phase; `idle` for every match id with no job tracked. */
  phaseOf: (matchId: string) => FetchRowPhase
  /** Starts fetching `matchId`. No-op while another row is already active. */
  start: (matchId: string) => void
}

/** `onReady` fires once, the moment a tracked row's job reports `ready`, so the caller can
 *  refresh the local match list and flip that row to "Open". */
export function useMatchFetchQueue(
  onReady: (matchId: string) => void,
  pollMs: number = MATCH_FETCH_POLL_MS,
): UseMatchFetchQueueResult {
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null)
  const [rows, setRows] = useState<Record<string, FetchRowPhase>>({})
  const activeMatchIdRef = useRef(activeMatchId)
  activeMatchIdRef.current = activeMatchId
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  useEffect(() => {
    const id = activeMatchId
    if (id === null) return
    const current = rows[id]
    if (!current || !isFetchRowInFlight(current)) return
    const controller = new AbortController()
    // EXACTLY ONE pending poll at a time, same guard as `useMeshBuild.ts`.
    let polling = false
    const timer = setInterval(() => {
      if (polling) return
      polling = true
      void (async () => {
        try {
          const body = await fetchFetchState(id, controller.signal)
          if (controller.signal.aborted) return
          const nextPhase = phaseOfFetchState(body)
          setRows((prev) => ({ ...prev, [id]: nextPhase }))
          if (nextPhase.phase === 'ready' || nextPhase.phase === 'failed') {
            setActiveMatchId(null)
            if (nextPhase.phase === 'ready') onReadyRef.current(id)
          }
        } catch (err) {
          if (controller.signal.aborted) return
          setRows((prev) => ({ ...prev, [id]: { phase: 'failed', error: errorMessage(err) } }))
          setActiveMatchId(null)
        } finally {
          polling = false
        }
      })()
    }, pollMs)
    return () => {
      clearInterval(timer)
      controller.abort()
    }
    // Keyed on the row's phase TAG, not the row object or the whole `rows` map: a tick that only
    // updates `done`/`total` must not tear this interval down and restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMatchId, rows[activeMatchId ?? '']?.phase, pollMs])

  const start = useCallback((matchId: string) => {
    if (activeMatchIdRef.current !== null) return
    // Set the single-flight lock immediately (disables every other row's button right away);
    // `rows[matchId]` is set once the POST actually answers, below — not optimistically, so the
    // polling effect never races a guessed state against the real one.
    setActiveMatchId(matchId)
    void (async () => {
      try {
        const body = await startMatchFetch(matchId)
        setRows((prev) => ({ ...prev, [matchId]: phaseOfFetchState(body) }))
      } catch (err) {
        if (err instanceof FetchConflictError) {
          // Someone else is fetching — keep this row active so the polling effect above starts
          // reading the match's own state route instead of giving up with a raw 409.
          setRows((prev) => ({ ...prev, [matchId]: { phase: 'blocked' } }))
          return
        }
        setRows((prev) => ({ ...prev, [matchId]: { phase: 'failed', error: errorMessage(err) } }))
        setActiveMatchId(null)
      }
    })()
  }, [])

  const phaseOf = useCallback((matchId: string) => rows[matchId] ?? IDLE_PHASE, [rows])

  return { activeMatchId, phaseOf, start }
}
