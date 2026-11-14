/**
 * preGameModel — the pure logic of the pre-game screen (brief 125): the progress-line step
 * from the document and map-build states, the two rosters against each other, the build
 * line (what the map build says right now, and which action it offers), and the countdown
 * sequence (3, 2, 1 with skip). The screen renders it; nothing in here touches the network,
 * storage or the DOM, so it is tested with plain calls and fake timers only where a timer
 * is involved (the countdown hook).
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { fractionChargement3d, type LoadState } from '../features/match-replay/model/chargement3d_logic'
import { displayPlayerName } from '../lib/players/displayName'

/** A player as the summary carries it: a name and the team that owns the slot. */
export interface PreGamePlayer {
  name: string
  xuid?: string
  teamId: number
}

/** The step the pre-game progress line shows for the document state. */
export function preGameStepOfDocument(step: 'document' | 'mesh'): string {
  return step === 'document' ? 'Loading the replay' : 'Checking the map'
}

/**
 * The two rosters against each other. Teams are grouped in ascending `teamId` order (the
 * mockup's `teams`). When `gamertag` signs for one of the teams, that team goes first and
 * the sides read "Your team" / "Opponents"; otherwise "Team 1" / "Team 2". A match with no
 * players has no versus block at all (the screen leaves it out).
 */
export function splitRosters(
  players: PreGamePlayer[] | null,
  gamertag: string | null,
): { own: string; other: string; ally: string[]; enemy: string[] } | null {
  if (!players || players.length === 0) return null
  const teamIds = [...new Set(players.map((p) => p.teamId))].sort((a, b) => a - b)
  const sides = teamIds.map((id) =>
    players.filter((p) => p.teamId === id).map((p) => displayPlayerName(p.name, p.xuid)),
  )
  const me = (gamertag ?? '').replace(/\s+/g, '').toLowerCase()
  const ownIndex = me
    ? sides.findIndex((side) => side.some((n) => n.replace(/\s+/g, '').toLowerCase() === me))
    : -1
  const own = ownIndex >= 0 ? 'Your team' : 'Team 1'
  const other = ownIndex >= 0 ? 'Opponents' : 'Team 2'
  const ally = ownIndex >= 0 ? sides[ownIndex] : (sides[0] ?? [])
  const enemy = (ownIndex >= 0 ? sides.filter((_, i) => i !== ownIndex) : sides.slice(1)).flat()
  return { own, other, ally, enemy }
}

/** The one build line: the status text (the hook's own words, restyled) plus the action the
 *  state offers, if any. `checking` offers nothing yet (the state route still answers). */
export function buildLineOf(
  phase: { phase: string; queuePosition?: number; elapsedMs?: number; error?: string },
  cancelling: boolean,
): { text: string; action: 'build' | 'retry' | 'cancel' | null; actionLabel: string | null } {
  switch (phase.phase) {
    case 'checking':
      return { text: 'Checking build status…', action: null, actionLabel: null }
    case 'absent':
      return { text: 'This map has not been built yet. A first build takes minutes.', action: 'build', actionLabel: 'Build map' }
    case 'queued':
      return {
        text: typeof phase.queuePosition === 'number' ? `Queued (position ${phase.queuePosition})…` : 'Queued…',
        action: null,
        actionLabel: null,
      }
    case 'building':
      return {
        text: typeof phase.elapsedMs === 'number' ? `Building… ${Math.round(phase.elapsedMs / 1000)}s elapsed` : 'Building…',
        action: 'cancel',
        actionLabel: cancelling ? 'Cancelling…' : 'Cancel',
      }
    case 'ready':
      return { text: 'Map built, loading…', action: null, actionLabel: null }
    case 'failed':
      return { text: `Build failed: ${phase.error ?? 'unknown error'}`, action: 'retry', actionLabel: 'Retry' }
    case 'cancelled':
      return { text: 'Build cancelled.', action: 'build', actionLabel: 'Build map' }
    default:
      return { text: 'Checking build status…', action: null, actionLabel: null }
  }
}

/** The countdown steps, one per second (the mockup's 3, 2, 1). */
export const COUNTDOWN_STEPS = [3, 2, 1] as const

/**
 * usePreGameCountdown — the 3, 2, 1 before the replay starts, one number per second,
 * skipping straight to done on any key press or a click, and calling `onDone` exactly once
 * when the last number has been shown for a second. The effect binds once and reads the
 * latest `onDone` through a ref; the unmount and skip both clear the timer, so a page
 * change mid-count never fires the callback.
 */
/** How long after the countdown starts a key or click cannot skip it yet. */
export const COUNTDOWN_SKIP_GUARD_MS = 400

/** The progress line for the 3D scene's own load: the step name and the scene's real
 *  overall fraction (null when the scene failed, so no bar claims progress). */
export function sceneStepOf(load: LoadState): { label: string; fraction: number | null } {
  switch (load.kind) {
    case 'download':
      return { label: 'Loading the map', fraction: fractionChargement3d(load) }
    case 'materials':
    case 'index':
      return { label: 'Preparing the map', fraction: fractionChargement3d(load) }
    case 'assets':
    case 'warmup':
      return { label: 'Loading players and weapons', fraction: fractionChargement3d(load) }
    case 'ready':
      return { label: 'Ready', fraction: 1 }
    case 'error':
      return { label: 'The map could not be loaded', fraction: null }
  }
}

export function usePreGameCountdown(onDone: () => void, started: boolean = true) {
  const [value, setValue] = useState<number | null>(COUNTDOWN_STEPS[0] ?? null)
  const [tick, setTick] = useState(0)
  const doneRef = useRef(false)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    if (!started || doneRef.current) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
      doneRef.current = true
      onDoneRef.current()
    }
    // A key or a click skips, except Escape (it goes back) and anything in the first moments
    // (the key press or click that opened the match must not skip its countdown).
    const armedAt = Date.now() + COUNTDOWN_SKIP_GUARD_MS
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && Date.now() >= armedAt) finish()
    }
    const onPointer = () => {
      if (Date.now() >= armedAt) finish()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPointer, true)
    const step = (i: number) => {
      if (i >= COUNTDOWN_STEPS.length) return finish()
      setValue(COUNTDOWN_STEPS[i] ?? null)
      setTick((t) => t + 1)
      timer = setTimeout(() => step(i + 1), 1000)
    }
    step(0)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPointer, true)
      if (timer !== null) clearTimeout(timer)
    }
    // The countdown starts when `started` becomes true and runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started])

  const skip = useCallback(() => {
    if (!started || doneRef.current) return
    doneRef.current = true
    onDoneRef.current()
  }, [started])

  return { value, tick, skip }
}
