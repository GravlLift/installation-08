/**
 * MatchViewScreen — fetches one match's replay document from the standalone server, checks
 * its map mesh is built, and mounts the lifted 3D view with everything the DOCUMENT ALONE
 * can feed it (see `docs/PARITY.md` for what still needs data this server does not serve).
 */
import { useEffect, useMemo, useRef, useState } from 'react'

import { Replay3DView } from '../features/match-replay/ui/Replay3DView'
import type { PageAction3dInputs } from '../features/match-replay/scene3d/action3dInputs'
import { useReplayInks } from '../features/match-replay/layers/useReplayInks'
import { normalizeMapObjectives } from '../features/match-replay/layers/objectivesLayer'
import { buildShotFx } from '../features/match-replay/model/shotFx'
import { displayPlayerName } from '../lib/players/displayName'
import { buildKillsFromDocument } from '../lib/replay/killsFromDocument'
import { buildDocumentTeamIdentity } from '../lib/replay/teamIdentityFromDocument'
import { framesPerSecond } from '../lib/replay/replayLogic'
import { normalizeReplayDocument, type ReplayDocumentReady } from '../lib/replay/replayNormalize'
import {
  checkMesh,
  fetchReplayDocument,
  meshUrl,
  MeshNotBuiltError,
} from '../lib/api/standalone'
import { usePlaybackLoop } from './usePlaybackLoop'

const SPEEDS = [0.25, 0.5, 1, 2, 4] as const

/** Aim-hold window for shot direction, in frames: the same magnitude as the death/shot-flash
 *  hold used elsewhere on this page (0.6 s of gameplay) — there is no page setting for it
 *  here (no settings drawer, see PARITY §2), so this is a reasonable fixed default. */
function aimHoldFramesOf(doc: ReplayDocumentReady): number {
  return Math.round(0.6 * framesPerSecond(doc))
}

type ViewState =
  | { phase: 'loading'; step: 'document' | 'mesh' }
  | { phase: 'mesh-not-built'; moduleKey: string }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; doc: ReplayDocumentReady }

function useMatchDocument(matchId: string): ViewState {
  const [state, setState] = useState<ViewState>({ phase: 'loading', step: 'document' })
  useEffect(() => {
    const controller = new AbortController()
    setState({ phase: 'loading', step: 'document' })
    void (async () => {
      try {
        const raw = await fetchReplayDocument(matchId, controller.signal)
        if (controller.signal.aborted) return
        const doc = normalizeReplayDocument(raw)
        setState({ phase: 'loading', step: 'mesh' })
        await checkMesh(matchId, controller.signal)
        if (controller.signal.aborted) return
        setState({ phase: 'ready', doc })
      } catch (err) {
        if (controller.signal.aborted) return
        if (err instanceof MeshNotBuiltError) {
          setState({ phase: 'mesh-not-built', moduleKey: err.moduleKey })
          return
        }
        setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    })()
    return () => controller.abort()
  }, [matchId])
  return state
}

function PlaybackBar({
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
}) {
  const fps = framesPerSecond(doc)
  usePlaybackLoop({ doc, playing, speed, fps, frameRef, setFrame, setPlaying })

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border bg-card px-3 py-2 text-sm text-foreground">
      <button
        type="button"
        className="rounded bg-primary px-3 py-1 text-primary-foreground"
        onClick={() => setPlaying(!playing)}
      >
        {playing ? 'Pause' : 'Play'}
      </button>
      <input
        type="range"
        min={0}
        max={Math.max(0, doc.frameCount - 1)}
        value={frame}
        onChange={(e) => {
          const next = Number(e.target.value)
          frameRef.current = next
          setFrame(next)
        }}
        className="flex-1"
      />
      <span className="font-mono text-xs text-muted-foreground">
        {frame} / {doc.frameCount - 1}
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

function ReplayViewer({ matchId, doc }: { matchId: string; doc: ReplayDocumentReady }) {
  const frameRef = useRef(0)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [viewpoint, setViewpoint] = useState<string | null>(doc.roster[0]?.xuid ?? null)
  const [size, setSize] = useState({ width: 960, height: 540 })
  const hostRef = useRef<HTMLDivElement>(null)

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

  const inks = useReplayInks(0)

  // Everything below is read from the document alone (see docs/PARITY.md for what still
  // needs data this server does not serve — Match View context, mesh variant/weapons/armor).
  const mapObjectives = useMemo(() => normalizeMapObjectives(doc.mapObjectives), [doc])
  const kills = useMemo(() => buildKillsFromDocument(doc), [doc])
  const shotFx = useMemo(() => buildShotFx(doc, aimHoldFramesOf(doc)), [doc])
  const identity = useMemo(
    () => buildDocumentTeamIdentity(doc, viewpoint, inks.teamColorOf, inks.neutral),
    [doc, viewpoint, inks],
  )

  const action = useMemo<PageAction3dInputs>(() => {
    const inputs: PageAction3dInputs = {
      shotFx,
      kills,
      mapObjectives,
      allegiance: identity.allegiance,
      pageAllegiance: identity.allegiance,
      inks,
      show: {
        shots: true,
        kills: true,
        weaponPads: true,
        groundWeapons: true,
        groundWeaponsSpecialOnly: false,
        groundWeaponsStarting: false,
        placements: true,
        vehicles: true,
        objectives: true,
        flags: true,
        vipCrown: true,
        bombCarrier: true,
      },
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
  }, [doc, shotFx, kills, mapObjectives, identity, inks])

  return (
    <div className="flex h-screen flex-col">
      <div ref={hostRef} className="relative min-h-0 flex-1">
        <Replay3DView
          meshPath={meshUrl(matchId)}
          variantPath={null}
          weaponsPath={null}
          armor={null}
          doc={doc}
          frameRef={frameRef}
          viewpoint={viewpoint}
          colorOfXuid={identity.colorOfXuid}
          locale="en"
          width={size.width}
          height={size.height}
          action={action}
          playWindow={null}
          timeLimitMs={null}
        />
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
      />
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

  if (state.phase === 'mesh-not-built') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 text-sm">
        <p className="text-destructive">
          Map mesh not built for this match (module: {state.moduleKey || 'unknown'}).
        </p>
        <button type="button" className="text-xs underline" onClick={onBack}>
          Back to matches
        </button>
      </div>
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

  return <ReplayViewer matchId={matchId} doc={state.doc} />
}
