/**
 * PlayerTransport — the lower third of the player: the scrub bar (our own slider element, with
 * the played part, a head and one mark per kill in the killer's color) and the controls row:
 * play/pause, back and forward 10 s, restart, the clock, the speed segments, the viewpoint
 * picker, sound, scoreboard, settings, film export and fullscreen.
 *
 * It owns no playback state: every control calls back into the viewer. Left and Right are not
 * handled on the slider because the viewer's shortcuts already seek on those keys from anywhere
 * (handling them here too would seek twice); the slider adds Home and End.
 */
import { useCallback, useMemo, useRef, type RefObject } from 'react'

import { formatClock, frameToMs, framesPerSecond } from '../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../lib/replay/replayNormalize'
import { SPEED_MULTIPLIERS } from '../features/match-replay/settings/useReplaySettings'
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
  viewpoint: string | null
  kills: ReplayKill[]
  colorOfXuid: (xuid: string) => string | null
  sound: ReplaySound
  onTogglePlay: () => void
  onRestart: () => void
  onSetSpeed: (speed: number) => void
  onSetViewpoint: (xuid: string | null) => void
  onScrub: (frame: number) => void
  onSeekBy: (seconds: number) => void
  onToggleScoreboard: () => void
  scoreboardOn: boolean
  onToggleSettings: () => void
  settingsRef: RefObject<HTMLButtonElement | null>
  onToggleExport: () => void
  exportDisabled: boolean
  onToggleFullscreen: () => void
  fullscreenActive: boolean
  onScrubbingChange?: (scrubbing: boolean) => void
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
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragging.current = true
    onScrubbingChange?.(true)
    seekAt(event.clientX)
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

export function PlayerTransport(props: PlayerTransportProps) {
  const { doc, frame, playing, speed, viewpoint, sound } = props
  const clock = formatClock(frameToMs(frame, doc))
  const total = formatClock(frameToMs(doc.frameCount - 1, doc))
  return (
    <div className="bc-player-transport">
      <ScrubBar
        doc={doc}
        frame={frame}
        kills={props.kills}
        colorOfXuid={props.colorOfXuid}
        onScrub={props.onScrub}
        onScrubbingChange={props.onScrubbingChange}
      />
      <div className="bc-ctl">
        <button type="button" className="bc-play" onClick={props.onTogglePlay} aria-label={playing ? 'Pause' : 'Play'} title="Play or pause (Space)">
          {playing ? '❚❚' : '▶'}
        </button>
        <button type="button" className="bc-ctl-btn" onClick={() => props.onSeekBy(-10)} aria-label="Back 10 seconds" title="Back 10 s (Left)">-10</button>
        <button type="button" className="bc-ctl-btn" onClick={() => props.onSeekBy(10)} aria-label="Forward 10 seconds" title="Forward 10 s (Right)">+10</button>
        <button type="button" className="bc-ctl-btn" onClick={props.onRestart} aria-label="Restart" title="Restart (R)">↺</button>
        <span className="bc-time">{clock} <i>/</i> {total}</span>
        <div className="bc-seg" role="group" aria-label="Speed">
          {SPEED_MULTIPLIERS.map((value) => (
            <button key={value} type="button" className={value === speed ? 'on' : ''} aria-pressed={value === speed} onClick={() => props.onSetSpeed(value)}>
              {value}×
            </button>
          ))}
        </div>
        <span className="bc-lbl">POV</span>
        <select
          className="bc-pov"
          value={viewpoint ?? ''}
          onChange={(event) => props.onSetViewpoint(event.target.value || null)}
          aria-label="Viewpoint"
        >
          <option value="">Free camera</option>
          {doc.roster.map((entry) => (
            <option key={entry.xuid} value={entry.xuid}>{displayPlayerName(entry.name, entry.xuid)}</option>
          ))}
        </select>
        <span className="bc-gap" />
        <span className="bc-sound"><ReplaySoundControls sound={sound} locale="en" /></span>
        <button type="button" className="bc-ctl-btn" aria-pressed={props.scoreboardOn} onClick={props.onToggleScoreboard} title="Scoreboard (hold Tab)">Scoreboard</button>
        <button ref={props.settingsRef} type="button" className="bc-ctl-btn" onClick={props.onToggleSettings}>Settings</button>
        <button type="button" className="bc-ctl-btn" onClick={props.onToggleExport} disabled={props.exportDisabled}>Export film</button>
        <button type="button" className="bc-ctl-btn" onClick={props.onToggleFullscreen} title="Fullscreen (F)">
          {props.fullscreenActive ? 'Exit fullscreen' : 'Fullscreen'}
        </button>
      </div>
    </div>
  )
}
