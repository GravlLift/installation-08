// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * PlayerTransport — the lower third of the player: the scrub bar (`ScrubBar`, with the selected
 * player's kills, deaths and medals as marks) and the controls row under it.
 *
 * The row is three columns, `1fr auto 1fr`, so the clock sits dead center whatever the sides
 * hold:
 *  - left: the camera group, the POV picker first at the far left, then view (3D / 2D) and
 *    camera mode (the one home of every camera choice); then, hugging the clock, restart,
 *    previous event, play/pause and next event;
 *  - center: the clock;
 *  - right: hugging the clock, the speed segments; at the far right, sound, then scoreboard,
 *    settings, film export and fullscreen as icon buttons with hover tooltips.
 * In a narrow bar the clock takes a row of its own (still centered) and the two sides share the
 * row under it.
 *
 * There are no seek buttons: Left and Right seek from anywhere through the viewer's shortcuts.
 * It owns no playback state: every control calls back into the viewer. Left and Right are not
 * handled on the slider because those shortcuts already seek on them (handling them here too
 * would seek twice); the slider adds Home and End.
 */
import type { CSSProperties, RefObject } from 'react'

import { formatClock, frameToMs } from '../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../lib/replay/replayNormalize'
import { SPEED_MULTIPLIERS } from '../features/match-replay/settings/useReplaySettings'
import type { SceneView3d } from '../features/match-replay/scene3d/topDownLogic'
import type { CameraMode3d } from '../features/match-replay/scene3d/replayScene3d'
import { SCENE3D_TEXT } from '../features/match-replay/i18n/scene3dText'
import { ReplaySoundControls } from '../features/match-replay/sound/ReplaySoundControls'
import type { ReplaySound } from '../features/match-replay/sound/useReplaySound'
import { displayPlayerName } from '../lib/players/displayName'
import { ScrubBar } from './ScrubBar'
import type { PlayerEvent } from './scrubMarks'
import {
  CameraScriptIcon,
  ExitFullscreenIcon,
  ExportIcon,
  FullscreenIcon,
  IconButton,
  NextEventIcon,
  PauseIcon,
  PlayIcon,
  PrevEventIcon,
  RestartIcon,
  ScoreboardIcon,
  SettingsIcon,
} from './PlayerTransportIcons'

export interface PlayerTransportProps {
  doc: ReplayDocumentReady
  frame: number
  playing: boolean
  speed: number
  /** The followed player: null in free view (the picker then reads "Free camera"). */
  viewpoint: string | null
  cameraMode: CameraMode3d
  onSetCameraMode: (mode: CameraMode3d) => void
  /** The selected player's kills, deaths and medals (`usePlayerMarks`), drawn as scrub marks. */
  events: readonly PlayerEvent[]
  /** Seeks to the previous (-1) or next (1) event of the selected player. */
  onStepEvent: (direction: -1 | 1) => void
  sound: ReplaySound
  onTogglePlay: () => void
  onRestart: () => void
  onSetSpeed: (speed: number) => void
  onSetViewpoint: (xuid: string | null) => void
  view: SceneView3d
  onSetView: (view: SceneView3d) => void
  onScrub: (frame: number) => void
  onToggleScoreboard: () => void
  scoreboardOn: boolean
  onToggleSettings: () => void
  settingsRef: RefObject<HTMLButtonElement | null>
  /** Toggles the camera-script panel; the button is shown only when this is given (the 3D view). */
  onToggleCamera?: () => void
  /** The camera-script panel is open (the button is pressed). */
  cameraOpen?: boolean
  onToggleExport: () => void
  exportDisabled: boolean
  /** The running export's progress (0..100), null when none runs: the button carries it, so
   *  closing the dialog mid-export never loses the way back to its Cancel. */
  exportProgress?: number | null
  onToggleFullscreen: () => void
  fullscreenActive: boolean
  onScrubbingChange?: (scrubbing: boolean) => void
  /** The transport's own element, for the player's safe insets in fullscreen (`usePlayerChromeInsets`). */
  rootRef?: RefObject<HTMLDivElement | null>
}

const CAMERA_TEXT = SCENE3D_TEXT.en
/** The bar shows the short name; the full one is the accessible name and leads the tooltip. */
const CAMERA_MODES: { mode: CameraMode3d; short: string; name: string; title: string }[] = [
  { mode: 'fp', short: CAMERA_TEXT.cameraFirstShort, name: CAMERA_TEXT.cameraFirst, title: `${CAMERA_TEXT.cameraFirst} (1)` },
  { mode: 'tp', short: CAMERA_TEXT.cameraThirdShort, name: CAMERA_TEXT.cameraThird, title: `${CAMERA_TEXT.cameraThird} (2)` },
  { mode: 'free', short: CAMERA_TEXT.cameraFreeShort, name: CAMERA_TEXT.cameraFree, title: `${CAMERA_TEXT.cameraFree} (3). ${CAMERA_TEXT.cameraFreeHint}` },
]

type CameraGroupProps = Pick<
  PlayerTransportProps,
  'doc' | 'viewpoint' | 'cameraMode' | 'onSetCameraMode' | 'onSetViewpoint' | 'view' | 'onSetView'
>

/** The camera group: POV (at the bar's far left), view (3D / 2D), camera mode. In 2D the mode
 *  segment is disabled (kept in place, so the bar does not jump); the POV picker still chooses
 *  whom the 2D cut follows. */
function CameraGroup({ doc, viewpoint, cameraMode, onSetCameraMode, onSetViewpoint, view, onSetView }: CameraGroupProps) {
  const in2d = view === 'top'
  return (
    <div className="bc-ctl-group bc-camera" role="group" aria-label={CAMERA_TEXT.cameraGroup}>
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
      <div className="bc-seg" role="group" aria-label="View" title="View (V)">
        <button type="button" className={view === '3d' ? 'on' : ''} aria-pressed={view === '3d'} onClick={() => onSetView('3d')}>3D</button>
        <button type="button" className={in2d ? 'on' : ''} aria-pressed={in2d} onClick={() => onSetView('top')}>2D</button>
      </div>
      <div className="bc-seg" role="group" aria-label="Camera mode">
        {CAMERA_MODES.map(({ mode, short, name, title }) => (
          <button
            key={mode}
            type="button"
            className={mode === cameraMode ? 'on' : ''}
            aria-pressed={mode === cameraMode}
            aria-label={name}
            disabled={in2d}
            title={in2d ? `${name}: camera modes apply to the 3D view` : title}
            onClick={() => onSetCameraMode(mode)}
          >
            {short}
          </button>
        ))}
      </div>
    </div>
  )
}

export function PlayerTransport(props: PlayerTransportProps) {
  const { doc, frame, playing, speed, sound } = props
  const clock = formatClock(frameToMs(frame, doc))
  const total = formatClock(frameToMs(doc.frameCount - 1, doc))
  const exporting = props.exportProgress != null
  const exportPct = Math.round(props.exportProgress ?? 0)
  const exportLabel = exporting ? `Exporting ${exportPct}%` : 'Export film'
  const noEvents = props.events.length === 0
  const fullscreenLabel = props.fullscreenActive ? 'Exit fullscreen' : 'Fullscreen'
  return (
    <div ref={props.rootRef} className="bc-player-transport">
      <ScrubBar
        doc={doc}
        frame={frame}
        events={props.events}
        onScrub={props.onScrub}
        onScrubbingChange={props.onScrubbingChange}
      />
      <div className="bc-ctl">
        <div className="bc-ctl-side bc-ctl-left">
          <CameraGroup
            doc={doc}
            viewpoint={props.viewpoint}
            cameraMode={props.cameraMode}
            onSetCameraMode={props.onSetCameraMode}
            onSetViewpoint={props.onSetViewpoint}
            view={props.view}
            onSetView={props.onSetView}
          />
          <div className="bc-ctl-group bc-ctl-play" role="group" aria-label="Playback">
            <IconButton label="Restart" tip="Restart (R)" onClick={props.onRestart}><RestartIcon /></IconButton>
            <IconButton label="Previous event" tip="Previous kill, death or medal ([)" disabled={noEvents} onClick={() => props.onStepEvent(-1)}>
              <PrevEventIcon />
            </IconButton>
            <IconButton label={playing ? 'Pause' : 'Play'} tip={`${playing ? 'Pause' : 'Play'} (Space)`} className="bc-play" onClick={props.onTogglePlay}>
              {playing ? <PauseIcon /> : <PlayIcon />}
            </IconButton>
            <IconButton label="Next event" tip="Next kill, death or medal (])" disabled={noEvents} onClick={() => props.onStepEvent(1)}>
              <NextEventIcon />
            </IconButton>
          </div>
        </div>
        <span className="bc-time">{clock} <i>/</i> {total}</span>
        <div className="bc-ctl-side bc-ctl-right">
          <div className="bc-seg bc-speed" role="group" aria-label="Speed">
            {SPEED_MULTIPLIERS.map((value) => (
              <button key={value} type="button" className={value === speed ? 'on' : ''} aria-pressed={value === speed} onClick={() => props.onSetSpeed(value)}>
                {value}×
              </button>
            ))}
          </div>
          <div className="bc-ctl-group bc-ctl-tools">
            <span className="bc-sound"><ReplaySoundControls sound={sound} locale="en" /></span>
            <IconButton label="Scoreboard" tip="Scoreboard (hold Tab)" pressed={props.scoreboardOn} onClick={props.onToggleScoreboard}>
              <ScoreboardIcon />
            </IconButton>
            <IconButton label="Settings" tip="Settings" buttonRef={props.settingsRef} onClick={props.onToggleSettings}>
              <SettingsIcon />
            </IconButton>
            {props.onToggleCamera && (
              <IconButton label="Camera script" tip="Camera script" pressed={props.cameraOpen} onClick={props.onToggleCamera}>
                <CameraScriptIcon />
              </IconButton>
            )}
            <IconButton
              label={exportLabel}
              tip={exportLabel}
              tipEnd
              className={exporting ? 'bc-exporting' : undefined}
              style={exporting ? ({ '--bc-progress-ratio': exportPct / 100 } as CSSProperties) : undefined}
              disabled={props.exportDisabled && !exporting}
              onClick={props.onToggleExport}
            >
              <ExportIcon />
            </IconButton>
            <IconButton label={fullscreenLabel} tip={`${fullscreenLabel} (F)`} tipEnd onClick={props.onToggleFullscreen}>
              {props.fullscreenActive ? <ExitFullscreenIcon /> : <FullscreenIcon />}
            </IconButton>
          </div>
        </div>
      </div>
    </div>
  )
}
