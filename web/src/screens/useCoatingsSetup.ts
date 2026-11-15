/**
 * useCoatingsSetup — drives the match viewer's "Set up coatings" button: starts the server's
 * one coatings setup job (`POST /api/coatings/setup`), polls its state every `pollMs` while it
 * runs, and reduces each state to the phase the control renders: idle, running (with the
 * stage), ready, or failed (with the server's message).
 *
 * On mount it reads the state once, so a setup already running (started from another tab, or
 * before a reload) shows its progress instead of offering a second start. Single-flight like
 * `useMatchFetchQueue`: `start` no-ops while a run is tracked, and a 409 (someone else started
 * one) turns into polling the same state route rather than an error.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  ApiError,
  CoatingsSetupConflictError,
  fetchCoatingsSetupState,
  startCoatingsSetup,
  type CoatingsSetupJobState,
  type CoatingsSetupStateBody,
} from '../lib/api/standalone'

/** The stages a running setup reports, in order. */
export type CoatingsSetupStage = Exclude<CoatingsSetupJobState, 'idle' | 'ready' | 'failed'>

export type CoatingsSetupPhase =
  | { phase: 'idle' }
  | { phase: 'running'; stage: CoatingsSetupStage }
  | { phase: 'ready' }
  | { phase: 'failed'; error: string }

/** Default polling interval while the setup runs. */
export const COATINGS_SETUP_POLL_MS = 1500

/** What each stage tells the viewer. */
export const COATINGS_SETUP_STAGE_LABELS: Record<CoatingsSetupStage, string> = {
  downloading: 'downloading Ekur',
  verifying: 'verifying the download',
  // Measured on a Steam install: about 4 minutes and about 9 GB written before the trim.
  dumping: 'extracting coating data from the game (about 4 minutes, uses about 10 GB of disk while it runs)',
  validating: 'checking the export and trimming it to the coating tables',
  queuing: 'queuing the coating rebuilds',
}

/** Turns one state body into the phase the control renders. Pure, so it is tested without
 *  the network or a timer. */
export function setupPhaseOf(body: CoatingsSetupStateBody): CoatingsSetupPhase {
  switch (body.state) {
    case 'idle':
      return { phase: 'idle' }
    case 'ready':
      return { phase: 'ready' }
    case 'failed':
      return { phase: 'failed', error: body.error || 'the setup failed' }
    default:
      return { phase: 'running', stage: body.state }
  }
}

/** A readable reason for a request that failed before the job could report one: the server's
 *  typed refusals get words, anything else keeps its own message. */
export function setupRequestError(err: unknown): string {
  if (err instanceof ApiError) {
    const code = (err.body as { error?: string } | null)?.error
    if (code === 'read_only') return 'this server is read-only'
    if (code === 'origin_not_allowed') return 'the server only accepts this from the local viewer'
    if (code === 'builds_unavailable') return 'the server has no build queue'
    return err.message
  }
  return String(err)
}

export interface UseCoatingsSetupResult {
  phase: CoatingsSetupPhase
  /** Starts the setup. No-op while one is running. */
  start: () => void
}

export function useCoatingsSetup(pollMs: number = COATINGS_SETUP_POLL_MS): UseCoatingsSetupResult {
  const [phase, setPhase] = useState<CoatingsSetupPhase>({ phase: 'idle' })
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  // Set while a start is in flight, before its POST answers (blocks a double click).
  const startingRef = useRef(false)

  // One read on mount: a setup already running shows its progress.
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const body = await fetchCoatingsSetupState(controller.signal)
        if (controller.signal.aborted || startingRef.current) return
        const next = setupPhaseOf(body)
        // Only a running setup is adopted: an old ready or failed run from earlier in this
        // server's life is not news on a fresh page.
        if (next.phase === 'running') setPhase(next)
      } catch {
        // An older server without the route, or the server down: stay idle.
      }
    })()
    return () => controller.abort()
  }, [])

  const running = phase.phase === 'running'
  useEffect(() => {
    if (!running) return
    const controller = new AbortController()
    let polling = false
    const timer = setInterval(() => {
      if (polling) return
      polling = true
      void (async () => {
        try {
          const body = await fetchCoatingsSetupState(controller.signal)
          if (controller.signal.aborted) return
          const next = setupPhaseOf(body)
          // An idle answer while tracking a run means the server restarted: the run is gone.
          setPhase(next.phase === 'idle' ? { phase: 'failed', error: 'the server restarted during the setup' } : next)
        } catch (err) {
          if (controller.signal.aborted) return
          setPhase({ phase: 'failed', error: setupRequestError(err) })
        } finally {
          polling = false
        }
      })()
    }, pollMs)
    return () => {
      clearInterval(timer)
      controller.abort()
    }
  }, [running, pollMs])

  const start = useCallback(() => {
    if (startingRef.current || phaseRef.current.phase === 'running') return
    startingRef.current = true
    void (async () => {
      try {
        const body = await startCoatingsSetup()
        setPhase(setupPhaseOf(body))
      } catch (err) {
        if (err instanceof CoatingsSetupConflictError) {
          // Someone else is running one: follow it through the state route, from the stage
          // the 409 names.
          const stage = (err.body as { state?: string } | null)?.state
          const known = stage !== undefined && stage in COATINGS_SETUP_STAGE_LABELS
          setPhase({ phase: 'running', stage: known ? (stage as CoatingsSetupStage) : 'downloading' })
          return
        }
        setPhase({ phase: 'failed', error: setupRequestError(err) })
      } finally {
        startingRef.current = false
      }
    })()
  }, [])

  return { phase, start }
}
