/**
 * preGameModel — the pure logic of the pre-game screen (brief 125): the progress-line step
 * from the document and map-build states, the two rosters against each other, the build
 * line (what the map build says right now, and which action it offers), and the countdown
 * sequence (3, 2, 1 with skip). The screen renders it; nothing in here touches the network,
 * storage or the DOM, so it is tested with plain calls and fake timers only where a timer
 * is involved (the countdown hook).
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { REPLAY_TEXT, type ReplayLocale } from '../features/match-replay/i18n/i18n'
import type { LoadState } from '../features/match-replay/model/chargement3d_logic'
import type { TextureQuality } from '../features/match-replay/settings/useTextureQuality'
import { formatClock } from '../lib/replay/replayLogic'
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

/** The one build line: the status text (the hook's own words, restyled), the real fraction
 *  the bar fills with (null while the server has not reported any, so the bar sweeps), and
 *  the action the state offers, if any. `checking` offers nothing yet (the state route
 *  still answers). While a build reports progress, the text names its stage with the
 *  percentage and an estimated time left once the progress is past 5% (from the elapsed
 *  time over the progress). */
export function buildLineOf(
  phase: { phase: string; queuePosition?: number; elapsedMs?: number; error?: string; progress?: number; stage?: string },
  cancelling: boolean,
  locale: ReplayLocale = 'en',
): { text: string; action: 'build' | 'retry' | 'cancel' | null; actionLabel: string | null; fraction: number | null } {
  switch (phase.phase) {
    case 'checking':
      return { text: 'Checking build status…', action: null, actionLabel: null, fraction: null }
    case 'absent':
      return { text: 'This map has not been built yet. A first build takes minutes.', action: 'build', actionLabel: 'Build map', fraction: null }
    case 'outdated':
      return { text: 'This map was built by an older version. Update it to get the new textures.', action: 'build', actionLabel: 'Update map', fraction: null }
    case 'queued':
      return {
        text: typeof phase.queuePosition === 'number' ? `Queued (position ${phase.queuePosition})…` : 'Queued…',
        action: null,
        actionLabel: null,
        fraction: null,
      }
    case 'building':
      return buildLineBuilding(phase, cancelling, locale)
    case 'ready':
      return { text: 'Map built, loading…', action: null, actionLabel: null, fraction: null }
    case 'failed':
      return { text: `Build failed: ${phase.error ?? 'unknown error'}`, action: 'retry', actionLabel: 'Retry', fraction: null }
    case 'cancelled':
      return { text: 'Build cancelled.', action: 'build', actionLabel: 'Build map', fraction: null }
    default:
      return { text: 'Checking build status…', action: null, actionLabel: null, fraction: null }
  }
}

// buildLineBuilding is the `building` arm of buildLineOf: the elapsed count while the server
// has not reported a fraction yet (the bar sweeps), the stage with its percentage once it has
// (the bar fills), and the estimated time left once the progress is past 5%.
function buildLineBuilding(
  phase: { phase: string; elapsedMs?: number; progress?: number; stage?: string },
  cancelling: boolean,
  locale: ReplayLocale,
): { text: string; action: 'build' | 'retry' | 'cancel' | null; actionLabel: string | null; fraction: number | null } {
  const fraction = typeof phase.progress === 'number' && phase.progress > 0 ? phase.progress : null
  if (fraction === null) {
    return {
      text: typeof phase.elapsedMs === 'number' ? `Building… ${Math.round(phase.elapsedMs / 1000)}s elapsed` : 'Building…',
      action: 'cancel',
      actionLabel: cancelling ? 'Cancelling…' : 'Cancel',
      fraction: null,
    }
  }
  const t = REPLAY_TEXT[locale]
  const stage = phase.stage && phase.stage in t.buildStage ? t.buildStage[phase.stage as keyof typeof t.buildStage] : 'Building'
  let text = t.buildProgressFmt(stage, Math.round(fraction * 100))
  if (fraction > 0.05 && typeof phase.elapsedMs === 'number') {
    const remainingMs = (phase.elapsedMs * (1 - fraction)) / fraction
    text += ` — ${t.buildEtaFmt(formatClock(remainingMs))}`
  }
  return { text, action: 'cancel', actionLabel: cancelling ? 'Cancelling…' : 'Cancel', fraction }
}

/**
 * The rough cost of building a map at each texture quality, shown on the pre-game's quality
 * choice so the pick is informed. The server exposes no size for a map before it is built (the
 * state route's `bytes` exists only once a file does), so these are measured constants, stated
 * as approximate: Streets, the largest map, built on 2026-11-15 took about 2 minutes and up to
 * about 850 MB at Standard, and about 8 minutes and up to about 1.4 GB at High. Smaller maps
 * cost less, which is why the text says "up to".
 */
export const QUALITY_BUILD_COST: Record<TextureQuality, { name: string; time: string; size: string }> = {
  standard: { name: 'Standard', time: 'about 2 min', size: 'up to about 850 MB' },
  high: { name: 'High', time: 'about 8 min', size: 'up to about 1.4 GB' },
}

/** Whether the pre-game offers the texture-quality choice before a build: only when the map
 *  is not built at the current quality and nothing is building (a first build, or a build the
 *  user cancelled). An outdated map is an update of a file already built at this quality, a
 *  failed build offers its retry, and an in-flight build shows its progress. */
export function offersQualityChoice(phase: { phase: string }): boolean {
  return phase.phase === 'absent' || phase.phase === 'cancelled'
}

/** The countdown steps, one per second (the mockup's 3, 2, 1). */
export const COUNTDOWN_STEPS = [3, 2, 1] as const

/**
 * usePreGameCountdown — the 3, 2, 1 before the replay starts, one number per second,
 * skipping straight to done on any key press or a click, and calling `onDone` exactly once
 * when the last number has been shown for a second, and `onTick(n)` as each number appears
 * (the countdown beep). The effect binds once and reads the latest `onDone` and `onTick`
 * through refs; the unmount and skip both clear the timer, so a page
 * change mid-count never fires the callback.
 */
/** How long after the countdown starts a key or click cannot skip it yet. */
export const COUNTDOWN_SKIP_GUARD_MS = 400

/** How long the full bar stays on screen before the countdown replaces it. */
export const READY_HOLD_MS = 600

const MB = 1024 * 1024

function megabytes(bytes: number): string {
  return String(Math.round(bytes / MB))
}

function counted(label: string, done: number, total: number): string {
  return total > 0 ? `${label} ${Math.min(done, total)} / ${total}` : label
}

/** The progress line for the 3D scene's own load: the phase in plain words (with its count when
 *  the phase has one) and the scene's real overall fraction (null when the scene failed, so no
 *  bar claims progress). */
export function sceneStepOf(load: LoadState): { label: string; fraction: number | null } {
  if (load.kind === 'ready') return { label: 'Ready', fraction: 1 }
  if (load.kind === 'error') return { label: 'The map could not be loaded', fraction: null }
  const { fraction, done, total } = load
  switch (load.phase) {
    case 'download':
      return {
        label: total > 0 ? `Downloading the map ${megabytes(done)} / ${megabytes(total)} MB` : `Downloading the map ${megabytes(done)} MB`,
        fraction,
      }
    case 'decode': return { label: counted('Decoding textures', done, total), fraction }
    case 'index': return { label: counted('Preparing geometry', done, total), fraction }
    case 'variant-build': return { label: 'Building the map objects', fraction }
    case 'variant-prepare': return { label: counted('Preparing the map objects', done, total), fraction }
    case 'assets': return { label: counted('Loading players and weapons', done, total), fraction }
    case 'warmup': return { label: 'Compiling shaders', fraction }
    case 'first-frame': return { label: 'Drawing the first frame', fraction }
  }
}
export function usePreGameCountdown(onDone: () => void, started: boolean = true, onTick?: (n: number) => void) {
  const [value, setValue] = useState<number | null>(COUNTDOWN_STEPS[0] ?? null)
  const [tick, setTick] = useState(0)
  const doneRef = useRef(false)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const onTickRef = useRef(onTick)
  onTickRef.current = onTick

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
      const n = COUNTDOWN_STEPS[i]
      setValue(n ?? null)
      // The game's countdown beep, on each number as it appears (a skip cuts the rest).
      if (n !== undefined) onTickRef.current?.(n)
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
