/**
 * MatchViewScreen — fetches one match's replay document from the standalone server, checks
 * its map mesh is built, and mounts the lifted 3D view with its match context.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Replay3DView } from '../features/match-replay/ui/Replay3DView'
import type { LoadState } from '../features/match-replay/model/chargement3d_logic'
import type { PageAction3dInputs } from '../features/match-replay/scene3d/action3dInputs'
import { useReplayInks } from '../features/match-replay/layers/useReplayInks'
import { normalizeMapObjectives } from '../features/match-replay/layers/objectivesLayer'
import { buildShotFx } from '../features/match-replay/model/shotFx'
import { displayPlayerName } from '../lib/players/displayName'
import { useMatchReplayContext } from './useMatchReplayContext'
import { buildDocumentTeamIdentity } from '../lib/replay/teamIdentityFromDocument'
import { framesPerSecond } from '../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../lib/replay/replayNormalize'
import { meshUrl } from '../lib/api/standalone'
import { useReplaySettings } from '../features/match-replay/settings/useReplaySettings'
import { useReplayFullscreen } from '../features/match-replay/hooks/useReplayFullscreen'
import { useReplayShortcuts } from '../features/match-replay/hooks/useReplayShortcuts'
import { ReplaySettingsDrawer } from '../features/match-replay/settings/ReplaySettingsDrawer'
import type { Action3dShow } from '../features/match-replay/scene3d/action3dInputs'
import { usePlaybackLoop } from './usePlaybackLoop'
import { useScoreboardHold } from './useScoreboardHold'
import { readReplayScoreboard } from '../features/match-replay/model/replayScoreboardLogic'
import { ReplayScoreboardOverlay } from '../features/match-replay/ui/ReplayScoreboardOverlay'
import { useDefaultViewpoint } from './useDefaultViewpoint'
import { useVariantLayer } from './useVariantLayer'
import { PreGameScreen } from './PreGameScreen'
import { useMatchSummary, useRemoteMatch } from './useMatchSummary'
import { useCoatingsNotice, COATING_NOTICE_TOOLTIP } from './useCoatingsNotice'
import { useReplaySound } from '../features/match-replay/sound/useReplaySound'
import { replaySpartanPiecesPath, type ReplayArmorSource } from '../lib/replay/spartanArmor'
import { endMatchSoundSpec } from '../features/match-replay/sound/endMatchSound'
import { useReplayCapture } from '../features/match-replay/export/useReplayCapture'
import { ReplayExportDialog } from '../features/match-replay/export/ReplayExportDialog'
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
}

export function ReplayViewer({ matchId, doc, onBack, held = false, onLoadState }: ReplayViewerProps) {
  const frameRef = useRef(0)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(!held)
  const [speed, setSpeed] = useState(1)
  const [viewpoint, setViewpoint] = useDefaultViewpoint(doc.roster)
  const [size, setSize] = useState({ width: 960, height: 540 })
  const hostRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const [scoreboardHeld, setScoreboard] = useScoreboardHold()
  const [scrubbing, setScrubbing] = useState(false)
  const { show, toggle } = useAction3dShow()
  const fullscreen = useReplayFullscreen(viewerRef)
  const fps = framesPerSecond(doc)
  const variantPath = useVariantLayer(matchId)
  const replayContext = useMatchReplayContext(matchId, doc)
  const inks = useReplayInks(0)
  const identity = useMemo(
    () => buildDocumentTeamIdentity(doc, viewpoint, inks.teamColorOf, inks.neutral),
    [doc, viewpoint, inks],
  )
  const endMatch = useMemo(() => endMatchSoundSpec(identity.allegiance, replayContext.context?.scoreboard ?? [], replayContext.context?.header.outcome_code, 'en'), [identity.allegiance, replayContext.context])
  const sound = useReplaySound(doc, replayContext.kills, speed, { allegiance: identity.allegiance, endMatch, locale: 'en', followed: viewpoint, medals: replayContext.medals })
  useEffect(() => sound.setTransportPlaying(playing), [playing, sound.setTransportPlaying])
  const exportCanvasRef = useRef<HTMLCanvasElement>(null)
  const exportLayout = useExportLayout()
  const exportScene = useReplay3DExport()
  const [exportOpen, setExportOpen] = useState(false)
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

  const stepFrames = useCallback(
    (delta: number) => {
      const next = Math.min(doc.frameCount - 1, Math.max(0, frameRef.current + delta))
      frameRef.current = next
      sound.seek(next * 1000 / fps)
      setFrame(Math.round(next))
    },
    [doc.frameCount, fps, sound.seek],
  )
  const seekBy = useCallback((seconds: number) => stepFrames(seconds * fps), [stepFrames, fps])
  const togglePlay = useCallback(() => { if (held) return; sound.wake(); if (!playing && frameRef.current === 0) sound.intro(); setPlaying((p) => !p) }, [held, playing, sound.wake, sound.intro])
  const wasHeld = useRef(held)
  useEffect(() => {
    if (wasHeld.current && !held) { sound.wake(); if (frameRef.current === 0) sound.intro(); setPlaying(true) }
    wasHeld.current = held
  }, [held, sound.wake, sound.intro])
  const restart = useCallback(() => { sound.wake(); stepFrames(-Infinity) }, [stepFrames, sound.wake])
  useReplayShortcuts({
    togglePlay,
    seekBy,
    stepFrames,
    restart,
    toggleSound: sound.toggle,
    toggleFullscreen: fullscreen.toggle,
    skipSeconds: SKIP_SECONDS,
    enabled: !held,
  })

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

  // The playback loop lives here (it did in the old PlaybackBar).
  usePlaybackLoop({ doc, playing, speed, fps, frameRef, setFrame, setPlaying, tick: sound.tick, onEnded: sound.endMatch })

  const onScrub = useCallback((next: number) => {
    frameRef.current = next
    sound.seek(next * 1000 / fps)
    setFrame(next)
  }, [frameRef, sound.seek, fps])

  const menuOpen = settingsOpen || exportOpen || scoreboardHeld
  const chrome = usePlayerChromeVisibility({ playing, menuOpen, scrubbing })

  // The top strip content.
  const mapName = summary ? cleanMapName(summary.mapName || summary.mapModule || '') : remote?.map ? cleanMapName(remote.map) : null
  const meta = playerTopMeta(summary, remote)

  return (
    <div
      ref={(el) => { viewerRef.current = el; chrome.scopeRef.current = el }}
      data-testid="replay-viewer"
      className="bc-player"
    >
      <div className="bc-player-box">
        <div ref={hostRef} data-testid="replay-view" className="absolute inset-0">
            <Replay3DView
              meshPath={meshUrl(matchId)}
              variantPath={variantPath}
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
            />
            {scoreboardHeld && (
              <ReplayScoreboardOverlay
                reading={scoreboardReading}
                sheet={scoreboardSheet}
                followedXuid={viewpoint}
              />
            )}
            {settingsOpen && (
              <ReplaySettingsDrawer
                locale="en"
                sound={sound}
                show={show}
                toggle={toggle}
                triggerRef={settingsButtonRef}
                onClose={() => setSettingsOpen(false)}
              />
            )}
            <canvas ref={exportCanvasRef} hidden />
            {exportOpen && exportScene && capture.videoExport && (
              <ReplayExportDialog exporter={capture.videoExport} locale="en" onClose={() => setExportOpen(false)} threeDOnly />
            )}
        </div>

        <div
          className={`bc-player-top bc-chrome ${chrome.visible ? '' : 'bc-hidden'}`}
          onPointerEnter={chrome.onScopeEnter}
          onPointerLeave={chrome.onScopeLeave}
        >
          <button type="button" className="bc-player-back" onClick={onBack}>← Matches</button>
          {mapName && <span className="bc-player-map">{mapName}</span>}
          {meta && <span className="bc-player-meta">{meta}</span>}
          <span className="bc-spacer" />
          {coatings.notice && (
            <span data-testid="coatings-notice" title={COATING_NOTICE_TOOLTIP} className="bc-player-notice">
              {coatings.notice}
            </span>
          )}
        </div>

        <div
          className={`bc-chrome ${chrome.visible ? '' : 'bc-hidden'}`}
          onPointerEnter={chrome.onScopeEnter}
          onPointerLeave={chrome.onScopeLeave}
        >
          <PlayerTransport
            doc={doc}
            frame={frame}
            playing={playing}
            speed={speed}
            viewpoint={viewpoint}
            kills={kills}
            colorOfXuid={identity.colorOfXuid}
            sound={sound}
            onTogglePlay={togglePlay}
            onRestart={restart}
            onSetSpeed={setSpeed}
            onSetViewpoint={setViewpoint}
            onScrub={onScrub}
            onSeekBy={seekBy}
            onToggleScoreboard={() => setScoreboard(!scoreboardHeld)}
            scoreboardOn={scoreboardHeld}
            onToggleSettings={() => setSettingsOpen((v) => !v)}
            settingsRef={settingsButtonRef}
            onToggleExport={() => setExportOpen((v) => !v)}
            exportDisabled={!exportScene || !capture.videoExport?.supported}
            onToggleFullscreen={fullscreen.toggle}
            fullscreenActive={fullscreen.active}
            onScrubbingChange={setScrubbing}
          />
        </div>
      </div>
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
  return <PreGameScreen matchId={matchId} onBack={onBack} />
}
