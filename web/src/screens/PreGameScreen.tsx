/**
 * PreGameScreen — the pre-game page (docs/UI-DESIGN.md 4.3, brief 125): the match's map image
 * sharp as the backdrop, the playlist and mode as the eyebrow, the map name large, the two
 * rosters against each other with "VS" between, and one progress line carrying the real step
 * name. It replaces the three pre-viewer states of `MatchViewScreen`: the document fetch,
 * the mesh check and the map build (same `useMeshBuild`, same messages, restyled). When the
 * document and the map are ready it counts down 3, 2, 1 and then the viewer plays: any key
 * or a click skips the countdown, Escape at any time goes back to match select.
 *
 * The viewer mounts as soon as the document is ready (the scene loads while the rosters are
 * on screen); the countdown ends on the viewer, which starts playing from frame 0. The pure
 * part (step labels, roster split, build line, countdown sequence) is `preGameModel.ts`,
 * tested there.
 */
import { useCallback, useEffect, useState } from 'react'

import type { ReplayDocumentReady } from '../lib/replay/replayNormalize'
import { checkMesh, fetchReplayDocument, MeshNotBuiltError } from '../lib/api/standalone'
import { normalizeReplayDocument } from '../lib/replay/replayNormalize'
import { useMatchSummary } from './useMatchSummary'
import { useMeshBuild } from './useMeshBuild'
import { useAuthState } from './useAuthState'
import { cleanMapName } from './matchSelectModel'
import type { LoadState } from '../features/match-replay/model/chargement3d_logic'
import {
  buildLineOf,
  preGameStepOfDocument,
  sceneStepOf,
  splitRosters,
  usePreGameCountdown,
} from './preGameModel'
import { ReplayViewer } from './MatchViewScreen'
import { Screen } from '../ui/Screen'
import { TickerDot } from '../ui/Ticker'

type PreGameState =
  | { phase: 'document' }
  | { phase: 'mesh' }
  | { phase: 'build'; doc: ReplayDocumentReady }
  | { phase: 'ready'; doc: ReplayDocumentReady }
  | { phase: 'error'; message: string }

/** Fetches the match's replay document, checks the map mesh, and lands on one of the states
 *  above. `MeshNotBuiltError` keeps the already-fetched document so the build can run here
 *  and the viewer mounts the moment the map is built (no re-fetch, no reload). */
function useMatchDocument(matchId: string): PreGameState {
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
        await checkMesh(matchId, controller.signal)
        if (controller.signal.aborted) return
        setState({ phase: 'ready', doc })
      } catch (err) {
        if (controller.signal.aborted) return
        if (err instanceof MeshNotBuiltError && doc) {
          setState({ phase: 'build', doc })
          return
        }
        setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    })()
    return () => controller.abort()
  }, [matchId])
  return state
}

/** The one progress line: the real step name and, when the state carries a fraction, the
 *  determinate bar; otherwise the bar indeterminate. Nothing invents a percentage. */
function ProgressLine({ label, fraction }: { label: string; fraction: number | null }) {
  return (
    <div className="bc-progress">
      <div className="bc-bar">
        <i
          className={fraction === null ? 'indeterminate' : ''}
          style={fraction === null ? undefined : { width: `${Math.round(fraction * 100)}%` }}
        />
      </div>
      <div className="bc-step">{label}</div>
    </div>
  )
}

export function PreGameScreen({ matchId, onBack }: { matchId: string; onBack: () => void }) {
  const state = useMatchDocument(matchId)
  const summary = useMatchSummary(matchId)
  const auth = useAuthState()
  const gamertag = auth.phase.phase === 'signed_in' ? auth.phase.gamertag : null

  // The map build: `useMeshBuild` untouched, this screen renders its phase and keeps its
  // build/cancel behavior exactly.
  const { phase: buildPhase, build, cancel, cancelling } = useMeshBuild(
    state.phase === 'build' ? matchId : '',
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
  const onCountdownDone = useCallback(() => setViewerLive(true), [])
  const countdown = usePreGameCountdown(onCountdownDone, sceneReady)

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
  const counting = sceneReady && countdown.value !== null

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
          {state.phase === 'error' ? 'Failed to load the match' : 'Match loading'}
        </span>,
      ]}
      keys={counting ? [['Any key', 'Skip'], ['Esc', 'Back']] : [['Esc', 'Back']]}
    >
      <div className="bc-pregame">
        <div className="bc-pregame-panel">
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
        </div>
      </div>
    </Screen>
    </div>
    </>
  )
}
