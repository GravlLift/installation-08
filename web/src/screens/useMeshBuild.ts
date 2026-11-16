/**
 * useMeshBuild — drives the "map not built yet" panel: checks the module's build state once on
 * mount, lets the caller start a build, and polls the state route every `pollMs` while a build
 * is queued or running, stopping on `ready` or `failed` (and always on unmount).
 *
 * All the state logic lives here so `MatchViewScreen`'s build panel stays a thin render of
 * `phase`. Network calls go through `lib/api/standalone.ts`; this hook only sequences them.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  ApiError,
  fetchMeshState,
  requestMeshBuild,
  cancelMeshBuild,
  type MeshStateBody,
  type MeshQuality,
} from '../lib/api/standalone'

export type MeshBuildPhase =
  | { phase: 'checking' }
  | { phase: 'absent'; moduleKey: string }
  | { phase: 'queued'; moduleKey: string; queuePosition?: number }
  | { phase: 'building'; moduleKey: string; elapsedMs?: number }
  | { phase: 'ready'; moduleKey: string }
  | { phase: 'failed'; moduleKey: string; error: string }
  | { phase: 'cancelled'; moduleKey: string }
  | { phase: 'outdated'; moduleKey: string }

/** Default polling interval while a build is queued or running. */
export const MESH_BUILD_POLL_MS = 2000

/** Turns one state-route body into the phase the panel renders. Pure, so it is tested without
 *  touching the network or a timer. */
export function phaseOfMeshState(body: MeshStateBody): MeshBuildPhase {
  switch (body.state) {
    case 'absent':
      return { phase: 'absent', moduleKey: body.moduleKey }
    case 'queued':
      return { phase: 'queued', moduleKey: body.moduleKey, queuePosition: body.queuePosition }
    case 'building':
      return { phase: 'building', moduleKey: body.moduleKey, elapsedMs: body.elapsedMs }
    case 'ready':
      return { phase: 'ready', moduleKey: body.moduleKey }
    case 'cancelled':
      return { phase: 'cancelled', moduleKey: body.moduleKey }
    case 'outdated':
      return { phase: 'outdated', moduleKey: body.moduleKey }
    case 'failed':
      return { phase: 'failed', moduleKey: body.moduleKey, error: body.error ?? 'unknown error' }
  }
}

/** Whether `phase` needs another poll (a build is in flight server-side). */
export function isMeshBuildInFlight(phase: MeshBuildPhase): boolean {
  return phase.phase === 'queued' || phase.phase === 'building'
}

/** The module key carried by any phase but `checking`, which has none yet. */
function moduleKeyOf(phase: MeshBuildPhase): string {
  return phase.phase === 'checking' ? '' : phase.moduleKey
}

export interface UseMeshBuildResult {
  phase: MeshBuildPhase
  /** Starts (or joins) the build. No-op while a build is already in flight. */
  build: () => void
  cancel: () => void
  cancelling: boolean
}

export function useMeshBuild(
  matchId: string,
  pollMs: number = MESH_BUILD_POLL_MS,
  quality?: MeshQuality,
): UseMeshBuildResult {
  const [phase, setPhase] = useState<MeshBuildPhase>({ phase: 'checking' })
  const [cancelling, setCancelling] = useState(false)
  // Read inside the interval callback without making it a dependency that would restart polling.
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  useEffect(() => {
    const controller = new AbortController()
    setPhase({ phase: 'checking' })
    void (async () => {
      try {
        const body = await fetchMeshState(matchId, controller.signal, quality)
        if (controller.signal.aborted) return
        setPhase(phaseOfMeshState(body))
      } catch (err) {
        if (controller.signal.aborted) return
        setPhase({
          phase: 'failed',
          moduleKey: '',
          error: err instanceof ApiError ? err.message : String(err),
        })
      }
    })()
    return () => controller.abort()
  }, [matchId, quality])

  useEffect(() => {
    if (!isMeshBuildInFlight(phase)) return
    const controller = new AbortController()
    // EXACTLY ONE pending poll at a time: `setInterval` on its own could overlap a slow request
    // with the next tick, so each tick awaits its own fetch before the interval is allowed to
    // fire again is not how `setInterval` works — instead we guard with a `polling` flag so a
    // slow response never queues two requests in flight.
    let polling = false
    const id = setInterval(() => {
      if (polling) return
      polling = true
      void (async () => {
        try {
          const body = await fetchMeshState(matchId, controller.signal, quality)
          if (controller.signal.aborted) return
          setPhase(phaseOfMeshState(body))
        } catch (err) {
          if (controller.signal.aborted) return
          setPhase({
            phase: 'failed',
            moduleKey: moduleKeyOf(phaseRef.current),
            error: err instanceof ApiError ? err.message : String(err),
          })
        } finally {
          polling = false
        }
      })()
    }, pollMs)
    return () => {
      clearInterval(id)
      controller.abort()
    }
    // `phase.phase` (not the whole object) is the dependency: queuePosition/elapsedMs tick on
    // every poll response and must not tear down and restart this interval each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, phase.phase, pollMs, quality])

  const build = useCallback(() => {
    if (isMeshBuildInFlight(phaseRef.current)) return
    const controller = new AbortController()
    setPhase((prev) => ({ phase: 'queued', moduleKey: moduleKeyOf(prev) }))
    void (async () => {
      try {
        const body = await requestMeshBuild(matchId, controller.signal, quality)
        setPhase(phaseOfMeshState(body))
      } catch (err) {
        setPhase({
          phase: 'failed',
          moduleKey: moduleKeyOf(phaseRef.current),
          error: err instanceof ApiError ? err.message : String(err),
        })
      }
    })()
  }, [matchId, quality])

  const cancel = useCallback(() => {
    if (phaseRef.current.phase !== 'building' || cancelling) return
    setCancelling(true)
    void cancelMeshBuild(matchId, undefined, quality).then((body) => {
      setPhase(phaseOfMeshState(body))
    }).catch((err: unknown) => {
      setPhase({ phase: 'failed', moduleKey: moduleKeyOf(phaseRef.current), error: err instanceof Error ? err.message : String(err) })
      setCancelling(false)
    })
  }, [matchId, cancelling, quality])

  useEffect(() => {
    if (phase.phase !== 'building') setCancelling(false)
  }, [phase.phase])

  return { phase, build, cancel, cancelling }
}
