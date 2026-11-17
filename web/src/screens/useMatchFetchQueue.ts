// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useMatchFetchQueue — drives the "Fetch" button on each remote-match row: queues the server's
 * fetch-and-build job and polls every in-flight row's state every `pollMs`, reporting when a
 * match becomes `ready` so the caller can refresh the local list.
 *
 * Several rows can be queued at once; the server downloads them one after another (FIFO) and
 * each queued row shows its position. One job per row: `start` on a row that is already
 * queued, downloading, or blocked no-ops. A 409 from an OLDER server (which refuses a second
 * fetch) is not surfaced as an error: the row becomes `blocked` and polls the SAME per-match
 * state route, which reports real progress if it turns out to be this match after all, or keeps
 * reading `idle` if it is some other match. Either way the row has something true to show
 * instead of a raw 409.
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
  | { phase: 'queued'; position: number }
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
      return { phase: 'queued', position: body.position ?? 1 }
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
  /** This row's phase; `idle` for every match id with no job tracked. */
  phaseOf: (matchId: string) => FetchRowPhase
  /** Queues `matchId` for fetching. No-op if that row already has a job in flight. */
  start: (matchId: string) => void
}

/** `onReady` fires once, the moment a tracked row's job reports `ready`, so the caller can
 *  refresh the local match list and flip that row to "Open". */
export function useMatchFetchQueue(
  onReady: (matchId: string) => void,
  pollMs: number = MATCH_FETCH_POLL_MS,
): UseMatchFetchQueueResult {
  const [rows, setRows] = useState<Record<string, FetchRowPhase>>({})
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  // The joined list of in-flight row ids. A tick that only updates `done`/`total`/`position`
  // leaves it unchanged, so the polling interval is not torn down and restarted; it restarts
  // exactly when a row joins or leaves the in-flight set.
  const inFlightKey = Object.keys(rows)
    .filter((id) => isFetchRowInFlight(rows[id]))
    .join(',')

  useEffect(() => {
    if (inFlightKey === '') return
    const ids = inFlightKey.split(',')
    const controller = new AbortController()
    // EXACTLY ONE pending poll round at a time, same guard as `useMeshBuild.ts`.
    let polling = false
    const timer = setInterval(() => {
      if (polling) return
      polling = true
      void (async () => {
        try {
          await Promise.all(
            ids.map(async (id) => {
              try {
                const body = await fetchFetchState(id, controller.signal)
                if (controller.signal.aborted) return
                const nextPhase = phaseOfFetchState(body)
                setRows((prev) => ({ ...prev, [id]: nextPhase }))
                if (nextPhase.phase === 'ready') onReadyRef.current(id)
              } catch (err) {
                if (controller.signal.aborted) return
                setRows((prev) => ({ ...prev, [id]: { phase: 'failed', error: errorMessage(err) } }))
              }
            }),
          )
        } finally {
          polling = false
        }
      })()
    }, pollMs)
    return () => {
      clearInterval(timer)
      controller.abort()
    }
  }, [inFlightKey, pollMs])

  const start = useCallback((matchId: string) => {
    // One job per row: a row that is already queued, downloading, or being chased after a 409
    // gets no duplicate POST. `rows[matchId]` is set once the POST actually answers, below —
    // not optimistically, so the polling effect never races a guessed state against the real
    // one.
    const current = rowsRef.current[matchId]
    if (current && isFetchRowInFlight(current)) return
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
      }
    })()
  }, [])

  const phaseOf = useCallback((matchId: string) => rows[matchId] ?? IDLE_PHASE, [rows])

  return { phaseOf, start }
}
