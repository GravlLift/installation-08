/**
 * PreGameScreen — the pre-game page (docs/UI-DESIGN.md 4.3, brief 125): the match's map image
 * sharp as the backdrop, the playlist and mode as the eyebrow, the map name large, the two
 * rosters against each other with "VS" between, and one progress line carrying the real step
 * name (the scene's load phase and count under the bar). It replaces the three pre-viewer
 * states of `MatchViewScreen`: the document fetch, the mesh check and the map build (same
 * `useMeshBuild`, same messages, restyled). When the document and the map are ready (every load phase over, the first frame drawn) the bar
 * completes, holds a moment, and it counts down 3, 2, 1 and then the viewer plays: any key
 * or a click skips the countdown, Escape at any time goes back to match select. Each number
 * plays the game's countdown beep (`countdownSound.ts`) through the viewer's sound player.
 *
 * The viewer mounts as soon as the document is ready (the scene loads while the rosters are
 * on screen); the countdown ends on the viewer, which starts playing from frame 0. The pure
 * part (step labels, roster split, build line, countdown sequence) is `preGameModel.ts`,
 * tested there.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ReplayDocumentReady } from '../lib/replay/replayNormalize'
import { checkMesh, fetchReplayDocument, MatchNotFoundError, MeshNotBuiltError } from '../lib/api/standalone'
import { normalizeReplayDocument } from '../lib/replay/replayNormalize'
import { useMatchSummary } from './useMatchSummary'
import { MESH_BUILD_POLL_MS, useMeshBuild } from './useMeshBuild'
import { useTextureQuality, type TextureQuality } from '../features/match-replay/settings/useTextureQuality'
import { useAuthState } from './useAuthState'
import { cleanMapName } from './matchSelectModel'
import type { LoadState } from '../features/match-replay/model/chargement3d_logic'
import {
  READY_HOLD_MS,
  buildLineOf,
  preGameStepOfDocument,
  sceneStepOf,
  splitRosters,
  usePreGameCountdown,
} from './preGameModel'
import { ReplayViewer } from './MatchViewScreen'
import { MatchNotFetched } from './MatchNotFetched'
import { ProgressLine } from './ProgressLine'
import { Screen } from '../ui/Screen'
import { TickerDot } from '../ui/Ticker'

type PreGameState =
  | { phase: 'document' }
  | { phase: 'mesh' }
  | { phase: 'build'; doc: ReplayDocumentReady }
  | { phase: 'ready'; doc: ReplayDocumentReady }
  | { phase: 'missing' }
  | { phase: 'error'; message: string }

/** Fetches the match's replay document, checks the map mesh, and lands on one of the states
 *  above. `MeshNotBuiltError` keeps the already-fetched document so the build can run here
 *  and the viewer mounts the moment the map is built (no re-fetch, no reload). A 404 on the
 *  document is `missing`: the match is not stored on this install (a shared link), and the page
 *  offers to fetch it. `attempt` re-runs the load once that fetch is done. */
function useMatchDocument(matchId: string, attempt: number, quality: TextureQuality): PreGameState {
  const [state, setState] = useState<PreGameState>({ phase: 'document' })
  useEffect(() => {
    const controller = new AbortController()
    setState({ phase: 'document' })
    void (async () => {
      let doc: ReplayDocumentReady | null = null
      try {
        const raw = await fetchReplayDocument(matchId, controller.signal)
        if (controller.signal.aborted) return
        doc = normalizeReplayDocument(raw)
        setState({ phase: 'mesh' })
        await checkMesh(matchId, controller.signal, quality)
        if (controller.signal.aborted) return
        setState({ phase: 'ready', doc })
      } catch (err) {
        if (controller.signal.aborted) return
        if (err instanceof MeshNotBuiltError && doc) {
          setState({ phase: 'build', doc })
          return
        }
        if (err instanceof MatchNotFoundError && !doc) {
          setState({ phase: 'missing' })
          return
        }
        setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    })()
    return () => controller.abort()
  }, [matchId, attempt, quality])
  return state
}

export function PreGameScreen({ matchId, onBack }: { matchId: string; onBack: () => void }) {
  // Bumped when a shared match link's fetch completes: the document loads again, in place.
  const [attempt, setAttempt] = useState(0)
  const onFetched = useCallback(() => setAttempt((n) => n + 1), [])
  // The texture-quality preference: the pre-game checks and builds the map at this quality, so
  // the viewer the screen hands off to loads the same files it was told were ready.
  const { quality } = useTextureQuality()
  const state = useMatchDocument(matchId, attempt, quality)
  const summary = useMatchSummary(matchId, attempt)
  const auth = useAuthState()
  const gamertag = auth.phase.phase === 'signed_in' ? auth.phase.gamertag : null

  // The map build: `useMeshBuild` untouched, this screen renders its phase and keeps its
  // build/cancel behavior exactly — now for the chosen quality.
  const { phase: buildPhase, build, cancel, cancelling } = useMeshBuild(
    state.phase === 'build' ? matchId : '',
    MESH_BUILD_POLL_MS,
    quality,
  )

  // The map is ready when the document state says `ready` (mesh check passed) OR when the
  // build phase says `ready` (the build just finished and `state` still holds the doc).
  const mapReady = state.phase === 'ready' || buildPhase.phase === 'ready'
  const doc =
    state.phase === 'ready' || state.phase === 'build' ? state.doc : null

  // Once the document and the map file are there, the viewer mounts UNDER this screen and
  // loads its 3D scene; this screen stays on top and shows the scene's own progress. The
  // countdown starts only when the scene reports ready, and ends by releasing the viewer.
  const [sceneLoad, setSceneLoad] = useState<LoadState | null>(null)
  const [viewerLive, setViewerLive] = useState(false)
  const sceneReady = sceneLoad?.kind === 'ready'
  // The full bar stays on screen a moment (its fill animates to 100%) before the countdown
  // replaces it: the countdown never appears over a bar that has not finished.
  const [barDone, setBarDone] = useState(false)
  useEffect(() => {
    if (!sceneReady) return
    const timer = setTimeout(() => setBarDone(true), READY_HOLD_MS)
    return () => clearTimeout(timer)
  }, [sceneReady])
  const onCountdownDone = useCallback(() => setViewerLive(true), [])
  // The game's countdown beep on each number, through the mounted viewer's sound player.
  const countdownTickRef = useRef<((n: number) => void) | null>(null)
  const onCountdownTick = useCallback((n: number) => countdownTickRef.current?.(n), [])
  const countdown = usePreGameCountdown(onCountdownDone, barDone, onCountdownTick)

  // Escape goes back at any time before the replay starts.
  useEffect(() => {
    if (viewerLive) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onBack()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [viewerLive, onBack])

  const viewer =
    mapReady && doc ? (
      <ReplayViewer
        key={matchId}
        matchId={matchId}
        doc={doc}
        onBack={onBack}
        held={!viewerLive}
        onLoadState={setSceneLoad}
        countdownTickRef={countdownTickRef}
      />
    ) : null
  if (viewerLive) return viewer

  const roster = summary ? splitRosters(summary.players, gamertag) : null
  const eyebrow = [summary?.playlistName, summary?.modeName].filter(Boolean).join('  /  ')
  const mapName = summary ? cleanMapName(summary.mapName || summary.mapModule || matchId) : matchId
  const backdropUrl = summary?.mapImageUrl || null

  let stepLabel: string
  let fraction: number | null = null
  let buildLine: ReturnType<typeof buildLineOf> | null = null
  switch (state.phase) {
    case 'document':
      stepLabel = preGameStepOfDocument('document')
      break
    case 'mesh':
      stepLabel = preGameStepOfDocument('mesh')
      break
    case 'build': {
      buildLine = buildLineOf(buildPhase, cancelling)
      stepLabel = buildLine.text
      break
    }
    case 'ready':
      stepLabel = 'Loading the map'
      break
    case 'missing':
      stepLabel = 'Match not stored here'
      break
    case 'error':
      stepLabel = 'Failed to load the match'
      break
  }
  // The scene's own load, once the viewer is mounted under this screen.
  if (viewer && sceneLoad) {
    const scene = sceneStepOf(sceneLoad)
    stepLabel = scene.label
    fraction = scene.fraction
  }
  const counting = barDone && countdown.value !== null

  return (
    <>
    {viewer}
    <div className="bc-over">
    <Screen
      id="pregame"
      gamertag={gamertag}
      crumb="Pre-game"
      backdropUrl={backdropUrl}
      sharp
      items={[
        <span key="server">
          <TickerDot bad={state.phase === 'error'} />
          {state.phase === 'error' ? 'Failed to load the match' : state.phase === 'missing' ? stepLabel : 'Match loading'}
        </span>,
      ]}
      keys={counting ? [['Any key', 'Skip'], ['Esc', 'Back']] : [['Esc', 'Back']]}
    >
      <div className="bc-pregame">
        <div className="bc-pregame-panel">
          {state.phase === 'missing' ? (
            <MatchNotFetched matchId={matchId} auth={auth} onFetched={onFetched} onBack={onBack} />
          ) : (
          <>
          {eyebrow ? <div className="bc-eyebrow">{eyebrow}</div> : null}
          <h1 className="bc-title">{mapName}</h1>
          {roster ? (
            <div className="bc-versus">
              <div className="bc-side bc-ally">
                <h4>{roster.own}</h4>
                {roster.ally.map((name, i) => (
                  <div key={`${name}-${i}`}>{name}</div>
                ))}
              </div>
              <div className="bc-vs">VS</div>
              <div className="bc-side bc-enemy">
                <h4>{roster.other}</h4>
                {roster.enemy.map((name, i) => (
                  <div key={`${name}-${i}`}>{name}</div>
                ))}
              </div>
            </div>
          ) : null}
          {state.phase === 'error' ? (
            <>
              <p className="bc-pregame-error">{state.message}</p>
              <div className="bc-pregame-actions">
                <button type="button" className="bc-signout" onClick={onBack}>
                  Back to matches
                </button>
              </div>
            </>
          ) : (
            <>
              {counting ? null : <ProgressLine label={stepLabel} fraction={fraction} />}
              {!viewer && state.phase === 'build' && buildLine?.action ? (
                <div className="bc-pregame-actions">
                  {buildLine.action === 'cancel' ? (
                    <button type="button" className="bc-signout" onClick={cancel} disabled={cancelling}>
                      {buildLine.actionLabel}
                    </button>
                  ) : (
                    <button type="button" className="bc-cta" onClick={build}>
                      {buildLine.actionLabel}
                    </button>
                  )}
                </div>
              ) : null}
              {counting ? (
                <div key={countdown.tick} className="bc-count">
                  {countdown.value}
                </div>
              ) : null}
            </>
          )}
          </>
          )}
        </div>
      </div>
    </Screen>
    </div>
    </>
  )
}
