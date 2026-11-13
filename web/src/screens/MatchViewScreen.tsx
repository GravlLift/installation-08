/**
 * MatchViewScreen — fetches one match's replay document from the standalone server, checks
 * its map mesh is built, and mounts the lifted 3D view with its match context.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Replay3DView } from '../features/match-replay/ui/Replay3DView'
import type { PageAction3dInputs } from '../features/match-replay/scene3d/action3dInputs'
import { useReplayInks } from '../features/match-replay/layers/useReplayInks'
import { normalizeMapObjectives } from '../features/match-replay/layers/objectivesLayer'
import { buildShotFx } from '../features/match-replay/model/shotFx'
import { displayPlayerName } from '../lib/players/displayName'
import { useMatchReplayContext } from './useMatchReplayContext'
import { buildDocumentTeamIdentity } from '../lib/replay/teamIdentityFromDocument'
import { formatClock, frameToMs, framesPerSecond } from '../lib/replay/replayLogic'
import { normalizeReplayDocument, type ReplayDocumentReady } from '../lib/replay/replayNormalize'
import {
  checkMesh,
  fetchReplayDocument,
  meshUrl,
  MeshNotBuiltError,
} from '../lib/api/standalone'
import { useReplaySettings } from '../features/match-replay/settings/useReplaySettings'
import { useReplayFullscreen } from '../features/match-replay/hooks/useReplayFullscreen'
import { useReplayShortcuts } from '../features/match-replay/hooks/useReplayShortcuts'
import { ReplaySettingsDrawer } from '../features/match-replay/settings/ReplaySettingsDrawer'
import type { Action3dShow } from '../features/match-replay/scene3d/action3dInputs'
import { usePlaybackLoop } from './usePlaybackLoop'
import { useDefaultViewpoint } from './useDefaultViewpoint'
import { useVariantLayer } from './useVariantLayer'
import { useMeshBuild, type MeshBuildPhase } from './useMeshBuild'
import { useMatchSummary, useRemoteMatch } from './useMatchSummary'
import { MatchHeaderBar } from './MatchHeaderBar'
import { useReplaySound, type ReplaySound } from '../features/match-replay/sound/useReplaySound'
import { replaySpartanPiecesPath, type ReplayArmorSource } from '../lib/replay/spartanArmor'
import { ReplaySoundControls } from '../features/match-replay/sound/ReplaySoundControls'
import { endMatchSoundSpec } from '../features/match-replay/sound/endMatchSound'

const SPEEDS = [0.25, 0.5, 1, 2, 4] as const

/** The arrow/J/L seek step, in seconds — the same magnitude as LevelUp's `SKIP_SECONDS`
 *  (`layers/replayCanvasConfig.ts`, not lifted here: a single constant, not worth a file). */
const SKIP_SECONDS = 10

/** Builds the `Action3dShow` flags and their toggles from `useReplaySettings`, the only mapping
 *  point between the drawer's persisted preferences and what the 3D view reads every frame. */
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

/** Aim-hold window for shot direction, in frames: the same magnitude as the death/shot-flash
 *  hold used elsewhere on this page (0.6 s of gameplay). The settings drawer does not expose
 *  this one (LevelUp does not either — it is a fixed constant there too). */
function aimHoldFramesOf(doc: ReplayDocumentReady): number {
  return Math.round(0.6 * framesPerSecond(doc))
}

type ViewState =
  | { phase: 'loading'; step: 'document' | 'mesh' }
  | { phase: 'mesh-not-built'; moduleKey: string; doc: ReplayDocumentReady }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; doc: ReplayDocumentReady }

function useMatchDocument(matchId: string): ViewState {
  const [state, setState] = useState<ViewState>({ phase: 'loading', step: 'document' })
  useEffect(() => {
    const controller = new AbortController()
    setState({ phase: 'loading', step: 'document' })
    void (async () => {
      let doc: ReplayDocumentReady | null = null
      try {
        const raw = await fetchReplayDocument(matchId, controller.signal)
        if (controller.signal.aborted) return
        doc = normalizeReplayDocument(raw)
        setState({ phase: 'loading', step: 'mesh' })
        await checkMesh(matchId, controller.signal)
        if (controller.signal.aborted) return
        setState({ phase: 'ready', doc })
      } catch (err) {
        if (controller.signal.aborted) return
        // The document fetch above already succeeded whenever `doc` is set here — only the
        // mesh check failed with `MeshNotBuiltError`. Keep that document so the build panel
        // below can mount the 3D view the moment the build finishes, with no re-fetch or reload.
        if (err instanceof MeshNotBuiltError && doc) {
          setState({ phase: 'mesh-not-built', moduleKey: err.moduleKey, doc })
          return
        }
        setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    })()
    return () => controller.abort()
  }, [matchId])
  return state
}

/** The panel shown instead of the 3D view while the match's map mesh is not built. Checks the
 *  build state once on mount (a build may already be queued or running from another tab), lets
 *  the viewer start one, and polls every two seconds; `onReady` fires the moment the mesh is
 *  built, so the caller can mount the 3D view without a reload. */
export function MeshBuildPanel({
  matchId,
  moduleKey,
  onReady,
  onBack,
}: {
  matchId: string
  moduleKey: string
  onReady: () => void
  onBack: () => void
}) {
  const { phase, build, cancel, cancelling } = useMeshBuild(matchId)

  useEffect(() => {
    if (phase.phase === 'ready') onReady()
  }, [phase.phase, onReady])

  // The initial moduleKey (from the mesh-not-built 404) covers the gap before the build-state
  // route answers for the first time; after that, the server's own moduleKey is authoritative.
  const effectiveModuleKey = (phase.phase !== 'checking' && phase.moduleKey) || moduleKey

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 text-sm">
      <p className="text-foreground">
        Map module: <span className="font-mono">{effectiveModuleKey || 'unknown'}</span>
      </p>
      <div className="flex items-center gap-3">
        <p className={phase.phase === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>{meshBuildStatusText(phase)}</p>
        {phase.phase === 'building' && <button type="button" onClick={cancel} disabled={cancelling} className="rounded bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50">{cancelling ? 'Cancelling…' : 'Cancel'}</button>}
      </div>
      {(phase.phase === 'absent' || phase.phase === 'cancelled') && (
        <button
          type="button"
          className="rounded bg-primary px-3 py-1.5 text-primary-foreground"
          onClick={build}
        >
          Build map
        </button>
      )}
      {phase.phase === 'failed' && (
        <button
          type="button"
          className="rounded bg-primary px-3 py-1.5 text-primary-foreground"
          onClick={build}
        >
          Retry
        </button>
      )}
      <button type="button" className="text-xs underline" onClick={onBack}>
        Back to matches
      </button>
    </div>
  )
}

function meshBuildStatusText(phase: MeshBuildPhase): string {
  switch (phase.phase) {
    case 'checking':
      return 'Checking build status…'
    case 'absent':
      return 'This match’s map has not been built yet.'
    case 'queued':
      return typeof phase.queuePosition === 'number'
        ? `Queued (position ${phase.queuePosition})…`
        : 'Queued…'
    case 'building':
      return typeof phase.elapsedMs === 'number'
        ? `Building the map… ${Math.round(phase.elapsedMs / 1000)}s elapsed`
        : 'Building the map…'
    case 'ready':
      return 'Map built, loading…'
    case 'failed':
      return `Build failed: ${phase.error}`
    case 'cancelled':
      return 'Build cancelled.'
  }
}

export function PlaybackBar({
  doc,
  frameRef,
  frame,
  setFrame,
  playing,
  setPlaying,
  speed,
  setSpeed,
  viewpoint,
  setViewpoint,
  sound,
}: {
  doc: ReplayDocumentReady
  frameRef: React.RefObject<number>
  frame: number
  setFrame: (f: number) => void
  playing: boolean
  setPlaying: (p: boolean) => void
  speed: number
  setSpeed: (s: number) => void
  viewpoint: string | null
  setViewpoint: (xuid: string | null) => void
  sound: ReplaySound
}) {
  const fps = framesPerSecond(doc)
  usePlaybackLoop({ doc, playing, speed, fps, frameRef, setFrame, setPlaying, tick: sound.tick, onEnded: sound.endMatch })

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border bg-card px-3 py-2 text-sm text-foreground">
      <button
        type="button"
        className="rounded bg-primary px-3 py-1 text-primary-foreground"
        onClick={() => { sound.wake(); if (!playing && frameRef.current === 0) sound.intro(); setPlaying(!playing) }}
      >
        {playing ? 'Pause' : 'Play'}
      </button>
      <input
        type="range"
        data-replay-timeline=""
        min={0}
        max={Math.max(0, doc.frameCount - 1)}
        value={frame}
        onChange={(e) => {
          const next = Number(e.target.value)
          frameRef.current = next
          sound.seek(next * 1000 / fps)
          setFrame(next)
        }}
        className="flex-1"
      />
      <span className="font-mono text-xs text-muted-foreground">
        {formatClock(frameToMs(frame, doc))} / {formatClock(frameToMs(doc.frameCount - 1, doc))}
      </span>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        Speed
        <select
          className="rounded border border-border bg-background px-1 py-0.5 text-foreground"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>
      </label>
      <ReplaySoundControls sound={sound} locale="en" />
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        Follow
        <select
          className="rounded border border-border bg-background px-1 py-0.5 text-foreground"
          value={viewpoint ?? ''}
          onChange={(e) => setViewpoint(e.target.value || null)}
        >
          <option value="">(none — free view)</option>
          {doc.roster.map((r) => (
            <option key={r.xuid} value={r.xuid}>
              {displayPlayerName(r.name, r.xuid)}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

export function ReplayViewer({ matchId, doc, onBack }: { matchId: string; doc: ReplayDocumentReady; onBack: () => void }) {
  const frameRef = useRef(0)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [viewpoint, setViewpoint] = useDefaultViewpoint(doc.roster)
  const [size, setSize] = useState({ width: 960, height: 540 })
  const hostRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
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
  const sound = useReplaySound(doc, replayContext.kills, speed, { allegiance: identity.allegiance, endMatch, locale: 'en' })
  useEffect(() => sound.setTransportPlaying(playing), [playing, sound.setTransportPlaying])

  // The 2D pan and zoom shortcuts are omitted from this 3D-only viewer.
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
  const togglePlay = useCallback(() => { sound.wake(); if (!playing && frameRef.current === 0) sound.intro(); setPlaying((p) => !p) }, [playing, sound.wake, sound.intro])
  const restart = useCallback(() => { sound.wake(); stepFrames(-Infinity) }, [stepFrames, sound.wake])
  useReplayShortcuts({
    togglePlay,
    seekBy,
    stepFrames,
    restart,
    toggleSound: sound.toggle,
    toggleFullscreen: fullscreen.toggle,
    skipSeconds: SKIP_SECONDS,
    enabled: true,
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
  const armor = useMemo<ReplayArmorSource>(
    () => ({ matchId, piecesPath: replaySpartanPiecesPath() }),
    [matchId],
  )

  // Scene inputs are independent of the scoreboard overlay.
  const mapObjectives = useMemo(() => normalizeMapObjectives(doc.mapObjectives), [doc])
  const kills = replayContext.kills
  const shotFx = useMemo(() => buildShotFx(doc, aimHoldFramesOf(doc)), [doc])

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
      // Bot-takeover "fiche" gating is not ported here (seatLogic.ts was left behind, see
      // PARITY §1) — every owned slot draws, same as the dev shell before this change.
      seatedOfXuid: () => true,
      locale: 'en',
    }
    return inputs
  }, [doc, shotFx, kills, mapObjectives, identity, inks, show])

  return (
    <div className="flex min-h-screen flex-col">
      <MatchHeaderBar summary={summary} remote={remote} onBack={onBack} />
      <div ref={viewerRef} data-testid="replay-viewer" className={fullscreen.active ? 'flex h-full w-full flex-col justify-center bg-black' : 'flex w-full flex-col bg-black'}>
      <div className="flex justify-end gap-2 bg-card px-3 py-2">
        <button type="button" onClick={fullscreen.toggle} className="rounded bg-card px-2 py-1 text-xs text-foreground hover:bg-muted">
          {fullscreen.active ? 'Exit fullscreen' : 'Fullscreen'}
        </button>
        <button ref={settingsButtonRef} type="button" onClick={() => setSettingsOpen((v) => !v)} className="rounded bg-card px-2 py-1 text-xs text-foreground hover:bg-muted">
          Settings
        </button>
      </div>
      <div ref={hostRef} data-testid="replay-view" className="relative mx-auto aspect-video w-full" style={{ maxWidth: fullscreen.active ? 'min(100%, calc((100vh - 7rem) * 16 / 9))' : 'min(100%, calc((100vh - 10rem) * 16 / 9))' }}>
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
        />
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
      </div>
      <PlaybackBar
        doc={doc}
        frameRef={frameRef}
        frame={frame}
        setFrame={setFrame}
        playing={playing}
        setPlaying={setPlaying}
        speed={speed}
        setSpeed={setSpeed}
        viewpoint={viewpoint}
        setViewpoint={setViewpoint}
        sound={sound}
      />
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
  const state = useMatchDocument(matchId)
  // Once the build panel reports `ready`, mount the 3D view immediately — no reload, no
  // re-fetch of the document (it is already held by the `mesh-not-built` state below).
  const [meshJustBuilt, setMeshJustBuilt] = useState(false)
  useEffect(() => {
    setMeshJustBuilt(false)
  }, [matchId])

  if (state.phase === 'loading') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <p>{state.step === 'document' ? 'Loading replay document…' : 'Checking map mesh…'}</p>
        <button type="button" className="text-xs underline" onClick={onBack}>
          Back to matches
        </button>
      </div>
    )
  }

  if (state.phase === 'mesh-not-built' && !meshJustBuilt) {
    return (
      <MeshBuildPanel
        matchId={matchId}
        moduleKey={state.moduleKey}
        onBack={onBack}
        onReady={() => setMeshJustBuilt(true)}
      />
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 text-sm">
        <p className="text-destructive">Failed to load match {matchId}: {state.message}</p>
        <button type="button" className="text-xs underline" onClick={onBack}>
          Back to matches
        </button>
      </div>
    )
  }

  const doc = state.phase === 'ready' ? state.doc : state.phase === 'mesh-not-built' ? state.doc : null
  if (!doc) {
    // Unreachable: the three branches above cover 'loading', 'mesh-not-built' (while not just
    // built) and 'error'. TypeScript cannot narrow `state` across the `meshJustBuilt` flag, so
    // this is a defensive fallback rather than a reachable state.
    return null
  }
  return <ReplayViewer matchId={matchId} doc={doc} onBack={onBack} />
}
