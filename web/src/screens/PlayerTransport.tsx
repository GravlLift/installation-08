/**
 * PlayerTransport — the lower third of the player: the scrub bar (our own slider element, with
 * the played part, a head and one mark per kill in the killer's color) and the controls row:
 * play/pause, back and forward 10 s, restart, the clock, the speed segments, the camera group
 * (view 3D / 2D, camera mode, POV picker: the one home of every camera choice), sound,
 * scoreboard, settings, film export and fullscreen.
 *
 * The row is made of groups that never break inside; when the row does not fit (a narrow
 * window), whole groups wrap to a second row.
 *
 * It owns no playback state: every control calls back into the viewer. Left and Right are not
 * handled on the slider because the viewer's shortcuts already seek on those keys from anywhere
 * (handling them here too would seek twice); the slider adds Home and End.
 */
import { useCallback, useMemo, useRef, type RefObject } from 'react'

import { formatClock, frameToMs, framesPerSecond } from '../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../lib/replay/replayNormalize'
import { SPEED_MULTIPLIERS } from '../features/match-replay/settings/useReplaySettings'
import type { SceneView3d } from '../features/match-replay/scene3d/topDownLogic'
import type { CameraMode3d } from '../features/match-replay/scene3d/replayScene3d'
import { SCENE3D_TEXT } from '../features/match-replay/i18n/scene3dText'
import { ReplaySoundControls } from '../features/match-replay/sound/ReplaySoundControls'
import type { ReplaySound } from '../features/match-replay/sound/useReplaySound'
import type { ReplayKill } from '../features/match-replay/model/killFeedLogic'
import { displayPlayerName } from '../lib/players/displayName'
import { clampUnit, frameAt, fractionAtFrame } from './scrubMath'

export interface PlayerTransportProps {
  doc: ReplayDocumentReady
  frame: number
  playing: boolean
  speed: number
  /** The followed player: null in free view (the picker then reads "Free camera"). */
  viewpoint: string | null
  cameraMode: CameraMode3d
  onSetCameraMode: (mode: CameraMode3d) => void
  kills: ReplayKill[]
  colorOfXuid: (xuid: string) => string | null
  sound: ReplaySound
  onTogglePlay: () => void
  onRestart: () => void
  onSetSpeed: (speed: number) => void
  onSetViewpoint: (xuid: string | null) => void
  view: SceneView3d
  onSetView: (view: SceneView3d) => void
  onScrub: (frame: number) => void
  onSeekBy: (seconds: number) => void
  onToggleScoreboard: () => void
  scoreboardOn: boolean
  onToggleSettings: () => void
  settingsRef: RefObject<HTMLButtonElement | null>
  onToggleExport: () => void
  exportDisabled: boolean
  /** The running export's progress (0..100), null when none runs: the button carries it, so
   *  closing the dialog mid-export never loses the way back to its Cancel. */
  exportProgress?: number | null
  onToggleFullscreen: () => void
  fullscreenActive: boolean
  onScrubbingChange?: (scrubbing: boolean) => void
  /** The transport's own element, for the player's safe insets (`usePlayerChromeInsets`). */
  rootRef?: RefObject<HTMLDivElement | null>
}

type ScrubBarProps = Pick<
  PlayerTransportProps,
  'doc' | 'frame' | 'kills' | 'colorOfXuid' | 'onScrub' | 'onScrubbingChange'
>

/** The scrub bar: click or drag to seek (the pointer is captured, so a drag keeps following
 *  outside the bar), Home and End on the keyboard. */
function ScrubBar({ doc, frame, kills, colorOfXuid, onScrub, onScrubbingChange }: ScrubBarProps) {
  const barRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const last = doc.frameCount - 1
  const fps = framesPerSecond(doc)

  const seekAt = useCallback((clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    onScrub(frameAt(clampUnit((clientX - rect.left) / rect.width), doc.frameCount))
  }, [doc.frameCount, onScrub])

  const endDrag = useCallback(() => {
    if (!dragging.current) return
    dragging.current = false
    onScrubbingChange?.(false)
  }, [onScrubbingChange])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.focus()
    dragging.current = true
    onScrubbingChange?.(true)
    seekAt(event.clientX)
    // Capture keeps a drag following outside the bar. It throws for a pointer the browser no
    // longer tracks (a synthetic or already-released one): the click has still sought.
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      endDrag()
    }
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragging.current) seekAt(event.clientX)
  }
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Home') { event.preventDefault(); onScrub(0) }
    else if (event.key === 'End') { event.preventDefault(); onScrub(last) }
  }

  const marks = useMemo(() => kills
    .map((kill, i) => ({
      key: `${i}-${kill.xuid}`,
      fraction: fractionAtFrame((kill.replayMs * fps) / 1000, doc.frameCount),
      color: colorOfXuid(kill.xuid),
    }))
    .filter((mark) => mark.fraction > 0 && mark.fraction < 1), [kills, fps, doc.frameCount, colorOfXuid])

  const fraction = fractionAtFrame(frame, doc.frameCount)
  const clock = formatClock(frameToMs(frame, doc))
  return (
    <div
      ref={barRef}
      role="slider"
      aria-label="Match time"
      aria-valuemin={0}
      aria-valuemax={last}
      aria-valuenow={Math.round(frame)}
      aria-valuetext={clock}
      data-replay-timeline=""
      tabIndex={0}
      className="bc-scrub"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    >
      <div className="bc-scrub-track" />
      {marks.map((mark) => (
        <div
          key={mark.key}
          className="bc-scrub-mark"
          style={{ left: `${mark.fraction * 100}%`, ...(mark.color ? { background: mark.color } : {}) }}
        />
      ))}
      <div className="bc-scrub-played" style={{ width: `${fraction * 100}%` }} />
      <div className="bc-scrub-head" style={{ left: `${fraction * 100}%` }} />
    </div>
  )
}

const CAMERA_TEXT = SCENE3D_TEXT.en
const CAMERA_MODES: { mode: CameraMode3d; label: string; title: string }[] = [
  { mode: 'fp', label: CAMERA_TEXT.cameraFirst, title: `${CAMERA_TEXT.cameraFirst} (1)` },
  { mode: 'tp', label: CAMERA_TEXT.cameraThird, title: `${CAMERA_TEXT.cameraThird} (2)` },
  { mode: 'free', label: CAMERA_TEXT.cameraFree, title: `${CAMERA_TEXT.cameraFree} (3). ${CAMERA_TEXT.cameraFreeHint}` },
]

type CameraGroupProps = Pick<
  PlayerTransportProps,
  'doc' | 'viewpoint' | 'cameraMode' | 'onSetCameraMode' | 'onSetViewpoint' | 'view' | 'onSetView'
>

/** The camera group: view (3D / 2D), camera mode, POV. In 2D the mode segment is disabled (kept
 *  in place, so the bar does not jump); the POV picker still chooses whom the 2D cut follows. */
function CameraGroup({ doc, viewpoint, cameraMode, onSetCameraMode, onSetViewpoint, view, onSetView }: CameraGroupProps) {
  const in2d = view === 'top'
  return (
    <div className="bc-ctl-group" role="group" aria-label={CAMERA_TEXT.cameraGroup}>
      <span className="bc-lbl">{CAMERA_TEXT.cameraGroup}</span>
      <div className="bc-seg" role="group" aria-label="View" title="View (V)">
        <button type="button" className={view === '3d' ? 'on' : ''} aria-pressed={view === '3d'} onClick={() => onSetView('3d')}>3D</button>
        <button type="button" className={in2d ? 'on' : ''} aria-pressed={in2d} onClick={() => onSetView('top')}>2D</button>
      </div>
      <div className="bc-seg" role="group" aria-label="Camera mode">
        {CAMERA_MODES.map(({ mode, label, title }) => (
          <button
            key={mode}
            type="button"
            className={mode === cameraMode ? 'on' : ''}
            aria-pressed={mode === cameraMode}
            disabled={in2d}
            title={in2d ? 'Camera modes apply to the 3D view' : title}
            onClick={() => onSetCameraMode(mode)}
          >
            {label}
          </button>
        ))}
      </div>
      <select
        className="bc-pov"
        value={viewpoint ?? ''}
        onChange={(event) => onSetViewpoint(event.target.value || null)}
        aria-label="Viewpoint"
        title="The followed player; Free camera follows no one"
      >
        <option value="">Free camera</option>
        {doc.roster.map((entry) => (
          <option key={entry.xuid} value={entry.xuid}>{displayPlayerName(entry.name, entry.xuid)}</option>
        ))}
      </select>
    </div>
  )
}

export function PlayerTransport(props: PlayerTransportProps) {
  const { doc, frame, playing, speed, sound } = props
  const clock = formatClock(frameToMs(frame, doc))
  const total = formatClock(frameToMs(doc.frameCount - 1, doc))
  const exporting = props.exportProgress != null
  return (
    <div ref={props.rootRef} className="bc-player-transport">
      <ScrubBar
        doc={doc}
        frame={frame}
        kills={props.kills}
        colorOfXuid={props.colorOfXuid}
        onScrub={props.onScrub}
        onScrubbingChange={props.onScrubbingChange}
      />
      <div className="bc-ctl">
        <div className="bc-ctl-group">
          <button type="button" className="bc-play" onClick={props.onTogglePlay} aria-label={playing ? 'Pause' : 'Play'} title="Play or pause (Space)">
            {playing ? '❚❚' : '▶'}
          </button>
          <button type="button" className="bc-ctl-btn" onClick={() => props.onSeekBy(-10)} aria-label="Back 10 seconds" title="Back 10 s (Left)">-10</button>
          <button type="button" className="bc-ctl-btn" onClick={() => props.onSeekBy(10)} aria-label="Forward 10 seconds" title="Forward 10 s (Right)">+10</button>
          <button type="button" className="bc-ctl-btn" onClick={props.onRestart} aria-label="Restart" title="Restart (R)">↺</button>
          <span className="bc-time">{clock} <i>/</i> {total}</span>
        </div>
        <div className="bc-seg" role="group" aria-label="Speed">
          {SPEED_MULTIPLIERS.map((value) => (
            <button key={value} type="button" className={value === speed ? 'on' : ''} aria-pressed={value === speed} onClick={() => props.onSetSpeed(value)}>
              {value}×
            </button>
          ))}
        </div>
        <CameraGroup
          doc={doc}
          viewpoint={props.viewpoint}
          cameraMode={props.cameraMode}
          onSetCameraMode={props.onSetCameraMode}
          onSetViewpoint={props.onSetViewpoint}
          view={props.view}
          onSetView={props.onSetView}
        />
        <span className="bc-gap" />
        <div className="bc-ctl-group">
          <span className="bc-sound"><ReplaySoundControls sound={sound} locale="en" /></span>
          <button type="button" className="bc-ctl-btn" aria-pressed={props.scoreboardOn} onClick={props.onToggleScoreboard} title="Scoreboard (hold Tab)">Scoreboard</button>
          <button ref={props.settingsRef} type="button" className="bc-ctl-btn" onClick={props.onToggleSettings}>Settings</button>
          <button type="button" className="bc-ctl-btn" onClick={props.onToggleExport} disabled={props.exportDisabled && !exporting}>
            {exporting ? `Exporting ${Math.round(props.exportProgress ?? 0)}%` : 'Export film'}
          </button>
          <button type="button" className="bc-ctl-btn" onClick={props.onToggleFullscreen} title="Fullscreen (F)">
            {props.fullscreenActive ? 'Exit fullscreen' : 'Fullscreen'}
          </button>
        </div>
      </div>
    </div>
  )
}
