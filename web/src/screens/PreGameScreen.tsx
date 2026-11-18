// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
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
import { MatchId } from './MatchId'

import type { ReplayDocumentReady } from '../lib/replay/replayNormalize'
import {
  checkMesh,
  fetchMeshState,
  fetchReplayDocument,
  MatchNotFoundError,
  MeshNotBuiltError,
  type MeshQuality,
} from '../lib/api/standalone'
import { normalizeReplayDocument } from '../lib/replay/replayNormalize'
import { useMatchSummary } from './useMatchSummary'
import { MESH_BUILD_POLL_MS, useMeshBuild } from './useMeshBuild'
import {
  TEXTURE_QUALITIES,
  useTextureQuality,
  type TextureQuality,
} from '../features/match-replay/settings/useTextureQuality'
import { useAuthState } from './useAuthState'
import { cleanMapName } from './matchSelectModel'
import type { LoadState } from '../features/match-replay/model/loading3d_logic'
import {
  QUALITY_BUILD_COST,
  READY_HOLD_MS,
  buildLineOf,
  offersQualityChoice,
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

type DocumentLoad =
  | { phase: 'document' }
  | { phase: 'loaded'; doc: ReplayDocumentReady }
  | { phase: 'missing' }
  | { phase: 'error'; message: string }

type MeshCheck = {
  doc: ReplayDocumentReady
  quality: TextureQuality
  result: { phase: 'ready' } | { phase: 'build' } | { phase: 'error'; message: string }
}

/**
 * Whether the map file that is on disk is also `ready` to the build runner. The viewer's own
 * build gate loads the scene only on `ready`: a file in an older build format (`outdated`) or
 * one whose build or in-place update is queued or running would mount the viewer, which then
 * drops its scene and shows its gate underneath this screen, where nothing can be clicked and
 * the progress line stays on the aborted download. Such a file goes to this screen's own
 * build step instead. A state route that cannot answer (no build runner) keeps the old
 * behavior: the file is there, so it loads.
 */
async function meshStateReady(matchId: string, signal: AbortSignal, quality: MeshQuality): Promise<boolean> {
  try {
    return (await fetchMeshState(matchId, signal, quality)).state === 'ready'
  } catch {
    return true
  }
}

/** Fetches the match's replay document, checks the map mesh, and lands on one of the states
 *  above. `MeshNotBuiltError` keeps the already-fetched document so the build can run here
 *  and the viewer mounts the moment the map is built (no re-fetch, no reload). A 404 on the
 *  document is `missing`: the match is not stored on this install (a shared link), and the page
 *  offers to fetch it. `attempt` re-runs the load once that fetch is done.
 *
 *  The document and the mesh check are two steps: a new `quality` (a pick on the pre-game's
 *  quality choice) re-checks the mesh for the same document without fetching it again. A check
 *  answers only for the document and quality it ran with, so a stale answer never shows. */
function useMatchDocument(matchId: string, attempt: number, quality: TextureQuality): PreGameState {
  const [load, setLoad] = useState<DocumentLoad>({ phase: 'document' })
  useEffect(() => {
    const controller = new AbortController()
    setLoad({ phase: 'document' })
    void (async () => {
      try {
        const raw = await fetchReplayDocument(matchId, controller.signal)
        if (controller.signal.aborted) return
        setLoad({ phase: 'loaded', doc: normalizeReplayDocument(raw) })
      } catch (err) {
        if (controller.signal.aborted) return
        if (err instanceof MatchNotFoundError) {
          setLoad({ phase: 'missing' })
          return
        }
        setLoad({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    })()
    return () => controller.abort()
  }, [matchId, attempt])

  const doc = load.phase === 'loaded' ? load.doc : null
  const [check, setCheck] = useState<MeshCheck | null>(null)
  useEffect(() => {
    if (!doc) return
    const controller = new AbortController()
    void (async () => {
      try {
        await checkMesh(matchId, controller.signal, quality)
        if (controller.signal.aborted) return
        const ready = await meshStateReady(matchId, controller.signal, quality)
        if (controller.signal.aborted) return
        setCheck({ doc, quality, result: { phase: ready ? 'ready' : 'build' } })
      } catch (err) {
        if (controller.signal.aborted) return
        if (err instanceof MeshNotBuiltError) {
          setCheck({ doc, quality, result: { phase: 'build' } })
          return
        }
        setCheck({ doc, quality, result: { phase: 'error', message: err instanceof Error ? err.message : String(err) } })
      }
    })()
    return () => controller.abort()
  }, [matchId, doc, quality])

  if (load.phase !== 'loaded') return load
  if (!check || check.doc !== load.doc || check.quality !== quality) return { phase: 'mesh' }
  if (check.result.phase === 'error') return check.result
  return { phase: check.result.phase, doc: load.doc }
}

/** The quality choice before a first build: one button per texture quality, each with its
 *  rough build time and size (`QUALITY_BUILD_COST`), the stored preference marked. A click
 *  builds that quality and makes it the preference. */
function QualityChoice({
  cancelled,
  preferred,
  built,
  onPick,
}: {
  cancelled: boolean
  preferred: TextureQuality
  /** Which qualities the match list reports built: those load at once instead of building. */
  built: Partial<Record<TextureQuality, boolean>>
  onPick: (quality: TextureQuality) => void
}) {
  const anyBuilt = TEXTURE_QUALITIES.some((q) => built[q])
  const intro = cancelled
    ? 'Build cancelled. Pick a texture quality.'
    : anyBuilt
      ? `This map is not built at ${QUALITY_BUILD_COST[preferred].name} yet. Load the quality already built, or build this one.`
      : 'This map has not been built yet. Pick a texture quality to build it.'
  return (
    <div className="bc-quality-choice" data-testid="quality-choice">
      <div className="bc-step">{intro}</div>
      <div className="bc-quality-options" role="group" aria-label="Texture quality">
        {TEXTURE_QUALITIES.map((q) => {
          const cost = QUALITY_BUILD_COST[q]
          return (
            <button
              key={q}
              type="button"
              className={'bc-quality-option' + (q === preferred ? ' on' : '')}
              data-testid={`build-quality-${q}`}
              onClick={() => onPick(q)}
            >
              <b>
                {built[q] ? 'Load' : 'Build'} {cost.name}
              </b>
              <small>{built[q] ? 'already built, loads at once' : `${cost.time}, ${cost.size}`}</small>
            </button>
          )
        })}
      </div>
      <p className="bc-quality-note">
        Approximate, measured on the largest map. You can change the quality later on the matches page or in the
        player settings.
      </p>
    </div>
  )
}

export function PreGameScreen({ matchId, onBack }: { matchId: string; onBack: () => void }) {
  // Bumped when a shared match link's fetch completes: the document loads again, in place.
  const [attempt, setAttempt] = useState(0)
  const onFetched = useCallback(() => setAttempt((n) => n + 1), [])
  // The texture-quality preference: the pre-game checks and builds the map at this quality, so
  // the viewer the screen hands off to loads the same files it was told were ready.
  // Only the quality AT MOUNT: a switch made later in the viewer's settings is the viewer's own
  // to handle (its in-viewer build gate). Following it here re-ran the document load, dropped the
  // live viewer while the document reloaded, and a live pre-game renders nothing but that viewer:
  // the whole page went blank and never came back.
  // The one exception is the quality choice this screen offers before a first build (no viewer
  // is mounted then): a pick sets the stored preference AND this screen's quality, so the map is
  // checked and built at the picked quality and the viewer later mounts on the same files.
  const { quality: liveQuality, setQuality: setStoredQuality } = useTextureQuality()
  const [quality, setQuality] = useState(liveQuality)
  // The quality picked on the choice when it differs from the one checked: its first state
  // check starts the build at once (the pick already said "build this one").
  const [pickedQuality, setPickedQuality] = useState<TextureQuality | null>(null)
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
    pickedQuality === quality,
  )
  // A pick on the quality choice: the same quality builds now; another one becomes this
  // screen's quality (the mesh is checked again at it, and built there if it is not built).
  const onPickQuality = useCallback(
    (picked: TextureQuality) => {
      setStoredQuality(picked)
      if (picked === quality) {
        build()
        return
      }
      setPickedQuality(picked)
      setQuality(picked)
    },
    [quality, build, setStoredQuality],
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
      buildLine = buildLineOf(buildPhase, cancelling, 'en')
      stepLabel = buildLine.text
      fraction = buildLine.fraction
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
  // The map is not built at this quality and nothing is building: the user picks the quality
  // here, before any build starts, and the pick builds only that quality.
  const choosing = !viewer && state.phase === 'build' && offersQualityChoice(buildPhase)

  return (
    <>
    {viewer}
    <div className="bc-over">
    <div className="bc-pregame-id"><MatchId matchId={matchId} /></div>
    <Screen
      id="pregame"
      gamertag={gamertag}
      crumb="Pre-game"
      backdropUrl={backdropUrl}
      sharp
      items={[
        <span key="server">
          <TickerDot bad={state.phase === 'error'} />
          {state.phase === 'error'
            ? 'Failed to load the match'
            : state.phase === 'missing'
              ? stepLabel
              : choosing
                ? 'Waiting for a texture quality pick'
                : 'Match loading'}
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
              {choosing ? (
                <QualityChoice
                  cancelled={buildPhase.phase === 'cancelled'}
                  preferred={quality}
                  built={{ standard: summary?.readyStandard, high: summary?.readyHigh }}
                  onPick={onPickQuality}
                />
              ) : counting ? null : (
                <ProgressLine label={stepLabel} fraction={fraction} />
              )}
              {!choosing && !viewer && state.phase === 'build' && buildLine?.action ? (
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
