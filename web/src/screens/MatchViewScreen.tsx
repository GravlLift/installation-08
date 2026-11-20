// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * MatchViewScreen — fetches one match's replay document from the standalone server, checks
 * its map mesh is built, and mounts the lifted 3D view with its match context.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'

import { Replay3DView } from '../features/match-replay/ui/Replay3DView'
import type { LoadState } from '../features/match-replay/model/loading3d_logic'
import type { PageAction3dInputs } from '../features/match-replay/scene3d/action3dInputs'
import { useReplayInks } from '../features/match-replay/layers/useReplayInks'
import { normalizeMapObjectives } from '../features/match-replay/layers/objectivesLayer'
import { buildShotFx } from '../features/match-replay/model/shotFx'
import { atPlaybackStart, firstSpawnFrame } from '../features/match-replay/model/playbackStart'
import { displayPlayerName } from '../lib/players/displayName'
import { useMatchReplayContext } from './useMatchReplayContext'
import { buildDocumentTeamIdentity } from '../lib/replay/teamIdentityFromDocument'
import { framesPerSecond } from '../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../lib/replay/replayNormalize'
import { ambienceFileUrl, ambienceLayoutUrl, meshUrl } from '../lib/api/standalone'
import { useReplaySettings } from '../features/match-replay/settings/useReplaySettings'
import { useTextureQuality } from '../features/match-replay/settings/useTextureQuality'
import { useReplayFullscreen } from '../features/match-replay/hooks/useReplayFullscreen'
import { useReplayShortcuts } from '../features/match-replay/hooks/useReplayShortcuts'
import type { SceneView3d } from '../features/match-replay/scene3d/topDownLogic'
import { ReplaySettingsDrawer } from '../features/match-replay/settings/ReplaySettingsDrawer'
import { useCameraScriptEditor } from '../features/match-replay/camera-script/useCameraScriptEditor'
import { CameraScriptPanel } from '../features/match-replay/camera-script/CameraScriptPanel'
import type { Action3dShow } from '../features/match-replay/scene3d/action3dInputs'
import { usePlaybackLoop } from './usePlaybackLoop'
import { scriptPlayback, setScriptPlaybackTime, stopScript } from '../features/match-replay/scene3d/cameraScriptStore'
import { useScoreboardHold } from './useScoreboardHold'
import { readReplayScoreboard } from '../features/match-replay/model/replayScoreboardLogic'
import { ReplayScoreboardOverlay } from '../features/match-replay/ui/ReplayScoreboardOverlay'
import { useCameraChoice } from './useCameraChoice'
import { usePlayerChromeInsets } from './usePlayerChromeInsets'
import { usePlayerMarks } from './usePlayerMarks'
import { useVariantSource } from './useVariantLayer'
import { MatchId } from './MatchId'
import { MESH_BUILD_POLL_MS, useMeshBuild } from './useMeshBuild'
import { buildLineOf } from './preGameModel'
import { ProgressLine } from './ProgressLine'
import { PreGameScreen } from './PreGameScreen'
import { useMatchSummary, useRemoteMatch } from './useMatchSummary'
import { useCoatingsNotice, COATING_NOTICE_TOOLTIP } from './useCoatingsNotice'
import { CoatingsSetupControl } from './CoatingsSetupControl'
import { useReplaySound } from '../features/match-replay/sound/useReplaySound'
import { replaySpartanPiecesPath, type ReplayArmorSource } from '../lib/replay/spartanArmor'
import { endMatchSoundSpec } from '../features/match-replay/sound/endMatchSound'
import { useAutoExport } from '../features/match-replay/export/useAutoExport'
import { useReplayCapture } from '../features/match-replay/export/useReplayCapture'
import { isExportBusy, ReplayExportDialog } from '../features/match-replay/export/ReplayExportDialog'
import { exportLayoutRequested, useExportLayout } from '../features/match-replay/export/exportLayoutStore'
import { useReplay3DExport } from '../features/match-replay/export/replay3dExportStore'
import { PlayerTransport } from './PlayerTransport'
import { usePlayerChromeVisibility } from './usePlayerChromeVisibility'
import { cleanMapName, playerTopMeta } from './matchSelectModel'

/** The arrow/J/L seek step, in seconds. */
const SKIP_SECONDS = 10

function useAction3dShow(): { show: Action3dShow; toggle: { [K in keyof Action3dShow]: () => void } } {
  const settings = useReplaySettings()
  return {
    show: {
      shots: settings.showShotFx,
      kills: settings.showKillFx,
      weaponPads: settings.showWeaponPads,
      groundWeapons: settings.showGroundWeapons,
      groundWeaponsSpecialOnly: settings.showGroundWeaponsSpecialOnly,
      groundWeaponsStarting: settings.showGroundWeaponsStarting,
      placements: settings.showPlacements,
      vehicles: settings.showVehicles,
      objectives: settings.showModeObjectives,
      flags: settings.showFlagCarries,
      vipCrown: settings.showVipCrown,
      bombCarrier: settings.showBombCarrier,
    },
    toggle: {
      shots: settings.toggleShotFx,
      kills: settings.toggleKillFx,
      weaponPads: settings.toggleWeaponPads,
      groundWeapons: settings.toggleGroundWeapons,
      groundWeaponsSpecialOnly: settings.toggleGroundWeaponsSpecialOnly,
      groundWeaponsStarting: settings.toggleGroundWeaponsStarting,
      placements: settings.togglePlacements,
      vehicles: settings.toggleVehicles,
      objectives: settings.toggleModeObjectives,
      flags: settings.toggleFlagCarries,
      vipCrown: settings.toggleVipCrown,
      bombCarrier: settings.toggleBombCarrier,
    },
  }
}

function aimHoldFramesOf(doc: ReplayDocumentReady): number {
  return Math.round(0.6 * framesPerSecond(doc))
}

export interface ReplayViewerProps {
  matchId: string
  doc: ReplayDocumentReady
  onBack: () => void
  held?: boolean
  onLoadState?: (load: LoadState) => void
  /** Filled with the replay sound's countdown tick while mounted: the pre-game countdown calls it
   *  on each number, through this viewer's player (sound settings and volume included). */
  countdownTickRef?: MutableRefObject<((n: number) => void) | null>
}

export function ReplayViewer({ matchId, doc, onBack, held = false, onLoadState, countdownTickRef }: ReplayViewerProps) {
  // Playback begins at the first spawn, not at frame zero (`playbackStart.ts`): the film opens
  // before anyone is on the map. The timeline still reaches frame zero.
  const startFrame = useMemo(() => firstSpawnFrame(doc), [doc])
  const frameRef = useRef(startFrame)
  const [frame, setFrame] = useState(startFrame)
  const [playing, setPlaying] = useState(!held)
  const [speed, setSpeed] = useState(1)
  const camera = useCameraChoice(doc.roster)
  // The reference player: team colors, the HUD and the export read from his side (free view included).
  const viewpoint = camera.player
  const [view, setView] = useState<SceneView3d>('3d')
  const toggleView = useCallback(() => setView((v) => (v === '3d' ? 'top' : '3d')), [])
  const [size, setSize] = useState({ width: 960, height: 540 })
  const hostRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  usePlayerChromeInsets(boxRef, topRef, barRef)
  // One panel opens from the bar at a time, on the right inside the scene's box (in fullscreen,
  // between the strip and the bar laid over it).
  const [panel, setPanel] = useState<'settings' | 'export' | 'camera' | null>(null)
  const togglePanel = useCallback((which: 'settings' | 'export' | 'camera') => setPanel((open) => (open === which ? null : which)), [])
  const closePanel = useCallback((which: 'settings' | 'export' | 'camera') => setPanel((open) => (open === which ? null : open)), [])
  const settingsOpen = panel === 'settings'
  const exportOpen = panel === 'export'
  const cameraOpen = panel === 'camera'
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const [scoreboardHeld, setScoreboard] = useScoreboardHold()
  const [scrubbing, setScrubbing] = useState(false)
  const { show, toggle } = useAction3dShow()
  const fullscreen = useReplayFullscreen(viewerRef)
  const fps = framesPerSecond(doc)
  // The texture-quality preference: which map and variant files the server serves this viewer.
  const { quality } = useTextureQuality()
  // The mesh build gate for the chosen quality: on a first open it is already `ready` (Standard
  // was checked and built by the pre-game), so the scene mounts at once; when the quality is
  // switched to a not-yet-built file it re-checks and, if absent, runs the same build flow and
  // progress the pre-game used, so "done" means the chosen files are actually ready to load.
  const gate = useMeshBuild(matchId, MESH_BUILD_POLL_MS, quality)
  const qualityAtMount = useRef(quality)
  const qualitySwitched = quality !== qualityAtMount.current
  const meshReady =
    gate.phase.phase === 'ready' || (!qualitySwitched && gate.phase.phase === 'checking')
  const buildLine = buildLineOf(gate.phase, gate.cancelling, 'en')
  const variant = useVariantSource(matchId, quality)
  const replayContext = useMatchReplayContext(matchId, doc)
  const inks = useReplayInks(0)
  const identity = useMemo(
    () => buildDocumentTeamIdentity(doc, viewpoint, inks.teamColorOf, inks.neutral),
    [doc, viewpoint, inks],
  )
  const endMatch = useMemo(() => endMatchSoundSpec(identity.allegiance, replayContext.context?.scoreboard ?? [], replayContext.context?.header.outcome_code, 'en'), [identity.allegiance, replayContext.context])
  // Memoized on the match: the ambience seam compares its urls by reference, a fresh object per
  // render would dispose and rebuild the beds at every re-render of this screen.
  const ambience = useMemo(() => ({ layoutUrl: ambienceLayoutUrl(matchId), fileUrl: (file: string) => ambienceFileUrl(matchId, file) }), [matchId])
  const sound = useReplaySound(doc, replayContext.kills, speed, { allegiance: identity.allegiance, endMatch, locale: 'en', followed: camera.followed, medals: replayContext.medals, match: replayContext.announcerMatch, ambience })
  useEffect(() => sound.setTransportPlaying(playing), [playing, sound.setTransportPlaying])
  const exportCanvasRef = useRef<HTMLCanvasElement>(null)
  const exportLayout = useExportLayout()
  const exportScene = useReplay3DExport()
  const redrawExport = useCallback(() => {
    const canvas = exportCanvasRef.current
    const layout = exportLayoutRequested()
    if (canvas && layout) {
      canvas.width = Math.round(layout.width * layout.pixelRatio)
      canvas.height = Math.round(layout.height * layout.pixelRatio)
    }
  }, [])
  void exportLayout
  const capture = useReplayCapture({
    canvasRef: exportCanvasRef, doc, frameRef, playing, play: () => setPlaying((p) => !p),
    redraw: redrawExport, playWindow: replayContext.playWindow,
    scoreboard: replayContext.context?.scoreboard ?? [], allegiance: identity.allegiance,
    kills: replayContext.kills, timeLimitMs: replayContext.timeLimitMs,
    outcome: { code: replayContext.context?.header.outcome_code }, viewpoint, locale: 'en',
    soundTrack: sound.exportTrack, soundVolume: sound.volume,
  })
  // The driven run: a URL that asks the page to render a camera script and upload the clip,
  // with no clicks. It runs at most once per page load, only when the URL asks, and says each
  // step in its pill (bottom-left), the title, and the console.
  const autoExport = useAutoExport({ matchId, videoExport: capture.videoExport, exportScene })

  const stepFrames = useCallback(
    (delta: number) => {
      // The user's own seeks stop a playing camera script (seekBy and restart run through here).
      if (scriptPlayback() !== null) stopScript()
      const next = Math.min(doc.frameCount - 1, Math.max(0, frameRef.current + delta))
      frameRef.current = next
      sound.seek(next * 1000 / fps)
      setFrame(Math.round(next))
    },
    [doc.frameCount, fps, sound.seek],
  )
  // showFrame moves the film to a frame WITHOUT stopping a playing script: the camera script's
  // preview/playback drives the camera here, so a script must keep its own set time.
  const showFrame = useCallback((f: number) => {
    frameRef.current = f
    sound.seek(f * 1000 / fps)
    setFrame(Math.round(f))
  }, [fps, sound.seek])
  const seekBy = useCallback((seconds: number) => stepFrames(seconds * fps), [stepFrames, fps])
  const togglePlay = useCallback(() => {
    if (held) return
    // Pressing play again with a script at its end restarts the script from 0 before playing.
    if (!playing) {
      const script = scriptPlayback()
      if (script !== null && script.sMs >= script.clock.lengthMs) setScriptPlaybackTime(0)
    }
    sound.wake(); if (!playing && atPlaybackStart(frameRef.current, startFrame)) sound.intro(); setPlaying((p) => !p)
  }, [held, playing, startFrame, sound.wake, sound.intro])
  useEffect(() => {
    if (!countdownTickRef) return
    countdownTickRef.current = sound.countdownTick
    return () => { countdownTickRef.current = null }
  }, [countdownTickRef, sound.countdownTick])
  const wasHeld = useRef(held)
  useEffect(() => {
    if (wasHeld.current && !held) { sound.wake(); if (atPlaybackStart(frameRef.current, startFrame)) sound.intro(); setPlaying(true) }
    wasHeld.current = held
  }, [held, startFrame, sound.wake, sound.intro])
  // Restart returns to the start of playback (the first spawn); scrubbing still reaches frame zero.
  const restart = useCallback(() => { sound.wake(); stepFrames(startFrame - frameRef.current) }, [stepFrames, startFrame, sound.wake])

  // Leaving free view stops a playing camera script; the script only drives the free camera.
  useEffect(() => {
    if (camera.mode !== 'free' && scriptPlayback() !== null) stopScript()
  }, [camera.mode])
  // Leaving the match stops any playing script.
  useEffect(() => stopScript, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setSize({ width, height })
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  const summary = useMatchSummary(matchId)
  const remote = useRemoteMatch(matchId)
  const coatings = useCoatingsNotice()
  const armor = useMemo<ReplayArmorSource>(
    () => ({ matchId, piecesPath: replaySpartanPiecesPath() }),
    [matchId],
  )

  const mapObjectives = useMemo(() => normalizeMapObjectives(doc.mapObjectives), [doc])
  const kills = replayContext.kills
  const shotFx = useMemo(() => buildShotFx(doc, aimHoldFramesOf(doc)), [doc])
  const scoreboardSheet = replayContext.context?.scoreboard ?? []
  const scoreboardReading = useMemo(
    () => (replayContext.context ? readReplayScoreboard(doc, scoreboardSheet, frame) : null),
    [doc, scoreboardSheet, frame, replayContext.context],
  )

  const action = useMemo<PageAction3dInputs>(() => {
    const inputs: PageAction3dInputs = {
      shotFx,
      kills,
      mapObjectives,
      allegiance: identity.allegiance,
      pageAllegiance: identity.allegiance,
      inks,
      show,
      shotHoldFrames: Math.round(0.6 * framesPerSecond(doc)),
      framesPerSecond: framesPerSecond(doc),
      deathHoldFrames: Math.round(1.4 * framesPerSecond(doc)),
      colorOfSlot: identity.colorOfSlot,
      colorOfXuid: identity.colorOfXuid,
      nameOfSlot: identity.nameOfSlot,
      nameOfXuid: (xuid: string) => {
        const entry = doc.roster.find((r) => r.xuid === xuid)
        return entry ? displayPlayerName(entry.name, entry.xuid) : identity.nameOfXuid(xuid)
      },
      seatedOfXuid: () => true,
      locale: 'en',
    }
    return inputs
  }, [doc, shotFx, kills, mapObjectives, identity, inks, show])

  // The camera-script editor lives in the page, not the panel, so closing the panel keeps the
  // edits. It is always mounted; the panel is a view over it (rendered only in the 3D view).
  const editor = useCameraScriptEditor({
    matchId,
    doc,
    frameRef,
    playing,
    setPlaying,
    cameraMode: camera.mode,
    setCameraMode: camera.setMode,
    showFrame,
  })
  // The camera panel names players; `action.nameOfXuid` can be null for an absent xuid, so fall
  // back to the xuid itself (a display name is always a string).
  const cameraNameOfXuid = (xuid: string): string => action.nameOfXuid(xuid) ?? xuid

  // The playback loop lives here (it did in the old PlaybackBar).
  usePlaybackLoop({ doc, playing, speed, fps, frameRef, setFrame, setPlaying, tick: sound.tick, seek: sound.seek, onEnded: sound.endMatch })

  const onScrub = useCallback((next: number) => {
    // The user's own scrub stops a playing camera script.
    if (scriptPlayback() !== null) stopScript()
    frameRef.current = next
    sound.seek(next * 1000 / fps)
    setFrame(next)
  }, [frameRef, sound.seek, fps])
  // The scrub bar's marks: the reference player's kills, deaths and medals.
  const marks = usePlayerMarks({ doc, player: camera.player, kills, medals: replayContext.medals, nameOfXuid: action.nameOfXuid, frameRef, onSeek: onScrub })
  useReplayShortcuts({
    togglePlay,
    seekBy,
    stepFrames,
    restart,
    toggleSound: sound.toggle,
    toggleFullscreen: fullscreen.toggle,
    toggleView,
    setCameraMode: view === '3d' ? camera.setMode : undefined,
    stepEvent: marks.stepEvent,
    skipSeconds: SKIP_SECONDS,
    enabled: !held,
  })

  const menuOpen = settingsOpen || exportOpen || cameraOpen || scoreboardHeld
  // Windowed, the strip and the bar sit above and below the scene; in fullscreen they are laid
  // over it and auto-hide.
  const chrome = usePlayerChromeVisibility({ overlay: fullscreen.active, menuOpen, scrubbing })
  const chromeClass = `bc-chrome ${chrome.visible ? '' : 'bc-hidden'}`

  // The top strip content.
  const mapName = summary ? cleanMapName(summary.mapName || summary.mapModule || '') : remote?.map ? cleanMapName(remote.map) : null
  const meta = playerTopMeta(summary, remote)

  return (
    <div
      ref={(el) => { viewerRef.current = el; chrome.scopeRef.current = el }}
      data-testid="replay-viewer"
      className={`bc-player ${fullscreen.active ? 'bc-player-full' : ''}`}
    >
      <div
        ref={topRef}
        className={`bc-player-top ${chromeClass}`}
        onPointerEnter={chrome.onScopeEnter}
        onPointerLeave={chrome.onScopeLeave}
      >
        <button type="button" className="bc-player-back" onClick={onBack}>← Matches</button>
        {mapName && <span className="bc-player-map">{mapName}</span>}
        {meta && <span className="bc-player-meta">{meta}</span>}
        <span className="bc-spacer" />
        <MatchId matchId={matchId} />
        {coatings.notice && coatings.canSetUp && <CoatingsSetupControl notice={coatings.notice} />}
        {coatings.notice && !coatings.canSetUp && (
          <span data-testid="coatings-notice" title={COATING_NOTICE_TOOLTIP} className="bc-player-notice">
            {coatings.notice}
          </span>
        )}
      </div>

      <div className="bc-player-stage">
        <div ref={boxRef} className="bc-player-box">
          <div ref={hostRef} data-testid="replay-view" className="absolute inset-0">
            {meshReady ? (
              <Replay3DView
                meshPath={meshUrl(matchId, quality)}
                variantPath={variant.path}
                variantPending={variant.pending}
                variantProgress={variant.progress}
                weaponsPath="/api/weapons"
                armor={armor}
                doc={doc}
                frameRef={frameRef}
                viewpoint={viewpoint}
                colorOfXuid={identity.colorOfXuid}
                locale="en"
                width={size.width}
                height={size.height}
                action={action}
                playWindow={replayContext.playWindow}
                timeLimitMs={replayContext.timeLimitMs}
                soundListenerRef={sound.listener}
                onLoadState={onLoadState}
                view={view}
                onMinimapClick={() => setView('top')}
                cameraMode={camera.mode}
              />
            ) : (
              <MeshBuildGate line={buildLine} build={gate.build} cancel={gate.cancel} cancelling={gate.cancelling} />
            )}
            {scoreboardHeld && (
              <ReplayScoreboardOverlay
                reading={scoreboardReading}
                sheet={scoreboardSheet}
                followedXuid={camera.followed}
                teamColorOfXuid={identity.colorOfXuid}
              />
            )}
            <canvas ref={exportCanvasRef} hidden />
          </div>

          {(settingsOpen || cameraOpen || (exportOpen && exportScene)) && (
            <div className="bc-panel">
              {settingsOpen && (
                <ReplaySettingsDrawer
                  locale="en"
                  sound={sound}
                  show={show}
                  toggle={toggle}
                  triggerRef={settingsButtonRef}
                  onClose={() => closePanel('settings')}
                />
              )}
              {cameraOpen && view === '3d' && (
                <CameraScriptPanel
                  editor={editor}
                  players={doc.roster.map((r) => ({ xuid: r.xuid, name: cameraNameOfXuid(r.xuid) }))}
                  nameOfXuid={cameraNameOfXuid}
                  onClose={() => closePanel('camera')}
                />
              )}
              {exportOpen && exportScene && capture.videoExport && (
                <ReplayExportDialog exporter={capture.videoExport} locale="en" onClose={() => closePanel('export')} threeDOnly cameraScript={editor.script} />
              )}
            </div>
          )}
        </div>
      </div>

      <div
        className={`bc-player-bottom ${chromeClass}`}
        onPointerEnter={chrome.onScopeEnter}
        onPointerLeave={chrome.onScopeLeave}
      >
        <PlayerTransport
          doc={doc}
          frame={frame}
          playing={playing}
          speed={speed}
          viewpoint={camera.followed}
          cameraMode={camera.mode}
          onSetCameraMode={camera.setMode}
          events={marks.events}
          onStepEvent={marks.stepEvent}
          sound={sound}
          onTogglePlay={togglePlay}
          onRestart={restart}
          onSetSpeed={setSpeed}
          onSetViewpoint={camera.setPov}
          view={view}
          onSetView={setView}
          onScrub={onScrub}
          onToggleScoreboard={() => setScoreboard(!scoreboardHeld)}
          scoreboardOn={scoreboardHeld}
          onToggleSettings={() => togglePanel('settings')}
          settingsRef={settingsButtonRef}
          onToggleCamera={view === '3d' ? () => togglePanel('camera') : undefined}
          cameraOpen={cameraOpen}
          onToggleExport={() => togglePanel('export')}
          exportDisabled={!exportScene || !capture.videoExport?.supported}
          exportProgress={capture.videoExport && isExportBusy(capture.videoExport.state) ? capture.videoExport.state.pct : null}
          onToggleFullscreen={fullscreen.toggle}
          fullscreenActive={fullscreen.active}
          onScrubbingChange={setScrubbing}
          rootRef={barRef}
        />
      </div>

      {autoExport.pill}
    </div>
  )
}

/** The in-viewer mesh gate: shown while the chosen quality's map is not ready (a quality
 *  switched to a not-yet-built file). It renders `useMeshBuild`'s line and the same build,
 *  retry and cancel actions the pre-game offers, so a High switch runs the real build flow
 *  with its progress before the scene loads the new files. */
export function MeshBuildGate({
  line,
  build,
  cancel,
  cancelling,
}: {
  line: { text: string; action: 'build' | 'retry' | 'cancel' | null; actionLabel: string | null; fraction?: number | null }
  build: () => void
  cancel: () => void
  cancelling: boolean
}) {
  return (
    <div data-testid="mesh-build-gate" className="bc-gate absolute inset-0 flex flex-col items-center justify-center gap-4">
      <ProgressLine label={line.text} fraction={line.fraction ?? null} />
      {line.action && line.actionLabel ? (
        <button
          type="button"
          className={line.action === 'cancel' ? 'bc-signout' : 'bc-cta'}
          onClick={line.action === 'cancel' ? cancel : build}
          disabled={line.action === 'cancel' ? cancelling : false}
        >
          {line.actionLabel}
        </button>
      ) : null}
    </div>
  )
}

export function MatchViewScreen({
  matchId,
  onBack,
}: {
  matchId: string
  onBack: () => void
}) {
  // Keyed by match: going from one match straight to another must start a fresh pre-game
  // (its countdown runs once per mount).
  return <PreGameScreen key={matchId} matchId={matchId} onBack={onBack} />
}
