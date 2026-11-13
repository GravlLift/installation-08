/**
 * App — the whole standalone page: load one replay document and one map mesh from
 * `/dev/`, mount the lifted 3D scene, and drive it with plain playback controls.
 *
 * This is the "page" LevelUp's `Replay3DView` otherwise sits inside: it owns the replay
 * clock (`frameRef`), the followed player (`viewpoint`), per-player ink (`colorOfXuid`),
 * and feeds `action` as empty/neutral (no 2D canvas has pre-baked shots, kills or
 * objective markers here) — the 3D scene renders the map, players, vehicles and weapons
 * on its own; the enrichment layers (shot lines, kill markers, objective glyphs) simply
 * have nothing to draw, which is how the scene already degrades when a layer is empty.
 */
import { useEffect, useMemo, useRef, useState } from 'react'

import { Replay3DView } from './features/match-replay/ui/Replay3DView'
import type { PageAction3dInputs } from './features/match-replay/scene3d/action3dInputs'
import { useReplayInks } from './features/match-replay/layers/useReplayInks'
import { displayPlayerName } from './lib/players/displayName'
import { NO_ALLEGIANCE } from './lib/replay/filmAllegiance'
import { framesPerSecond } from './lib/replay/replayLogic'
import { normalizeReplayDocument, type ReplayDocumentReady } from './lib/replay/replayNormalize'
import type { ReplayDocument } from './lib/api/types'

const MESH_PATH = '/dev/map.glb'
const REPLAY_PATH = '/dev/replay.json'
const SPEEDS = [0.25, 0.5, 1, 2, 4] as const

/** A stable, deterministic color per xuid (hash to hue) — no team/roster data assumed. */
function colorOfXuid(xuid: string): string {
  let hash = 0
  for (let i = 0; i < xuid.length; i++) hash = (hash * 31 + xuid.charCodeAt(i)) >>> 0
  return `hsl(${hash % 360}, 70%, 55%)`
}

function useReplayDocument(): { doc: ReplayDocumentReady | null; error: string | null } {
  const [doc, setDoc] = useState<ReplayDocumentReady | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch(REPLAY_PATH)
        if (!res.ok) throw new Error(`${REPLAY_PATH}: HTTP ${res.status}`)
        const raw = (await res.json()) as ReplayDocument
        if (alive) setDoc(normalizeReplayDocument(raw))
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      alive = false
    }
  }, [])
  return { doc, error }
}

/** Plain, functional playback controls — no design work, see task scope. */
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
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const step = (now: number) => {
      const deltaFrames = ((now - last) / 1000) * fps * speed
      last = now
      const next = Math.min(doc.frameCount - 1, Math.max(0, (frameRef.current ?? 0) + deltaFrames))
      frameRef.current = next
      setFrame(Math.round(next))
      if (next < doc.frameCount - 1) raf = requestAnimationFrame(step)
      else setPlaying(false)
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, fps, doc.frameCount, frameRef, setFrame, setPlaying])

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

function ReplayViewer({ doc }: { doc: ReplayDocumentReady }) {
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
  const action = useMemo<PageAction3dInputs>(() => {
    const inputs: PageAction3dInputs = {
      shotFx: [],
      kills: [],
      mapObjectives: [],
      allegiance: NO_ALLEGIANCE,
      pageAllegiance: NO_ALLEGIANCE,
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
      colorOfSlot: () => null,
      colorOfXuid,
      nameOfSlot: () => null,
      nameOfXuid: (xuid: string) => {
        const entry = doc.roster.find((r) => r.xuid === xuid)
        return entry ? displayPlayerName(entry.name, entry.xuid) : null
      },
      seatedOfXuid: () => true,
      locale: 'en',
    }
    return inputs
  }, [doc, inks])

  return (
    <div className="flex h-screen flex-col">
      <div ref={hostRef} className="relative min-h-0 flex-1">
        <Replay3DView
          meshPath={MESH_PATH}
          variantPath={null}
          weaponsPath={null}
          armor={null}
          doc={doc}
          frameRef={frameRef}
          viewpoint={viewpoint}
          colorOfXuid={colorOfXuid}
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

export function App() {
  const { doc, error } = useReplayDocument()
  if (error) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-destructive">
        Failed to load {REPLAY_PATH}: {error}
      </div>
    )
  }
  if (!doc) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Loading replay document…
      </div>
    )
  }
  return <ReplayViewer doc={doc} />
}

