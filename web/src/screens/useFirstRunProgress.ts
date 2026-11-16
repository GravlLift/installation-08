/**
 * useFirstRunProgress — the home screen's "Getting ready" panel: the first start of the server
 * reads the coatings from the game, then builds the announcer sounds, the weapon library, the
 * Spartan armor pieces and the first-person rigs (several minutes in all). Each has a state
 * route; this hook reads them, reduces them to five steps (`firstRunStepsOf`, pure) and polls
 * every `pollMs` only while a step is unfinished.
 *
 * A step is finished when it is ready, failed, or has nothing to do (`absent`: never queued,
 * its library is current; `idle` for the coatings setup), and also when its route cannot answer
 * (an older server, no build queue): an unknown state never holds the panel open.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export type FirstRunStepKey = 'coatings' | 'announcer' | 'weapons' | 'armor' | 'firstPerson'

export interface FirstRunStep {
  key: FirstRunStepKey
  /** What the step does, in plain words ("Building weapons"). */
  label: string
  status: 'pending' | 'running' | 'done' | 'failed'
  /** The server's message for a failed step. */
  error?: string
}

/** The steps in the order the server runs them, with their state routes. */
export const FIRST_RUN_STEPS: readonly { key: FirstRunStepKey; label: string; route: string }[] = [
  { key: 'coatings', label: 'Reading coatings from the game', route: '/api/coatings/setup/state' },
  { key: 'announcer', label: 'Building announcer sounds', route: '/api/announcer/state' },
  { key: 'weapons', label: 'Building weapons', route: '/api/weapons/state' },
  { key: 'armor', label: 'Building armor', route: '/api/spartan-pieces/state' },
  { key: 'firstPerson', label: 'Building first-person arms', route: '/api/first-person/state' },
]

export const FIRST_RUN_POLL_MS = 2000
/** How long the panel says "Ready" after the last step finishes. */
export const FIRST_RUN_READY_MS = 3000

/** One route's answer: its JSON body, or null when it could not answer. */
export type FirstRunBody = { state?: string; error?: string } | null

/** stepStatusOf reduces one state body to a step status. */
export function stepStatusOf(body: FirstRunBody): Pick<FirstRunStep, 'status' | 'error'> {
  const state = body?.state
  switch (state) {
    case undefined:
    case 'idle':
    case 'absent':
    case 'ready':
    case 'cancelled':
    case 'outdated':
      return { status: 'done' }
    case 'failed':
      return { status: 'failed', error: body?.error || 'it failed' }
    case 'queued':
      return { status: 'pending' }
    default:
      return { status: 'running' }
  }
}

/** firstRunStepsOf: the five steps from their route bodies, in `FIRST_RUN_STEPS` order. */
export function firstRunStepsOf(bodies: Partial<Record<FirstRunStepKey, FirstRunBody>>): FirstRunStep[] {
  const steps = FIRST_RUN_STEPS.map(({ key, label }) => ({ key, label, ...stepStatusOf(bodies[key] ?? null) }))
  // The coatings setup queues the three coating libraries when it ends, so while it runs they
  // are still ahead even though their routes read "absent" (not queued yet) or "ready" (an
  // old build the setup will redo): they count as pending, never as done.
  const coatings = steps.find((s) => s.key === 'coatings')
  if (coatings && !isFinished(coatings)) {
    for (const s of steps) {
      if (COATING_LIBRARY_STEPS.has(s.key) && s.status === 'done') s.status = 'pending'
    }
  }
  return steps
}

/** The steps the coatings setup queues when it ends. */
const COATING_LIBRARY_STEPS: ReadonlySet<FirstRunStepKey> = new Set(['weapons', 'armor', 'firstPerson'])

/** isFinished: a step that holds nothing open (done or failed). */
export function isFinished(step: FirstRunStep): boolean {
  return step.status === 'done' || step.status === 'failed'
}

/** The step the panel names as current: the first running one, else the first pending one. */
export function currentStep(steps: readonly FirstRunStep[]): FirstRunStep | null {
  return steps.find((s) => s.status === 'running') ?? steps.find((s) => s.status === 'pending') ?? null
}

async function readState(route: string, signal: AbortSignal): Promise<FirstRunBody> {
  try {
    const res = await fetch(route, { signal })
    if (!res.ok) return null
    return (await res.json()) as FirstRunBody
  } catch {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    return null
  }
}

export type FirstRunView =
  /** Nothing to show: every step was finished at the first read, or the panel has closed. */
  | { phase: 'hidden' }
  | { phase: 'working'; steps: FirstRunStep[] }
  /** Every step finished after work was seen: "Ready" for `FIRST_RUN_READY_MS`, then hidden. */
  | { phase: 'ready'; steps: FirstRunStep[] }
  /** Every step finished and one failed: the panel stays with the message. */
  | { phase: 'failed'; steps: FirstRunStep[] }

export interface UseFirstRunProgressResult {
  view: FirstRunView
  /** Reads the routes again and polls while something runs (a setup was just started). */
  refresh: () => void
}

export function useFirstRunProgress(pollMs: number = FIRST_RUN_POLL_MS, readyMs: number = FIRST_RUN_READY_MS): UseFirstRunProgressResult {
  const [view, setView] = useState<FirstRunView>({ phase: 'hidden' })
  const [round, setRound] = useState(0)
  const sawWork = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        const bodies = await Promise.all(FIRST_RUN_STEPS.map((s) => readState(s.route, controller.signal)))
        if (controller.signal.aborted) return
        const steps = firstRunStepsOf(Object.fromEntries(FIRST_RUN_STEPS.map((s, i) => [s.key, bodies[i]])))
        if (!steps.every(isFinished)) {
          sawWork.current = true
          setView({ phase: 'working', steps })
          timer = setTimeout(() => void tick(), pollMs)
          return
        }
        if (steps.some((s) => s.status === 'failed')) setView({ phase: 'failed', steps })
        else if (sawWork.current) {
          sawWork.current = false
          setView({ phase: 'ready', steps })
          timer = setTimeout(() => setView({ phase: 'hidden' }), readyMs)
        } else setView({ phase: 'hidden' })
      } catch {
        // Aborted: the page left.
      }
    }
    void tick()
    return () => {
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [round, pollMs, readyMs])

  const refresh = useCallback(() => setRound((r) => r + 1), [])
  return { view, refresh }
}
