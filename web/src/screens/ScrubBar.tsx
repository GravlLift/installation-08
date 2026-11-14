/**
 * ScrubBar — the player's scrub bar: our own slider element with the played part and the head,
 * and the selected player's events as marks (`scrubMarks`): medals in a lane above the track,
 * kills on it, deaths below it. Click or drag the track to seek (the pointer is captured, so a
 * drag keeps following outside the bar); Home and End on the keyboard. A mark is its own hit
 * target, wider than what it draws: clicking it seeks `MARK_LEAD_SECONDS` before the event
 * and never starts a track drag. Hovering a mark shows what it is and its clock.
 *
 * The bar stays one tab stop; `[` and `]` (the viewer's shortcuts) step through the marks.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { formatClock, frameToMs, framesPerSecond } from '../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../lib/replay/replayNormalize'
import { clampUnit, frameAt, fractionAtFrame } from './scrubMath'
import { groupMarks, type PlayerEvent, type ScrubMark } from './scrubMarks'

/** Past this bar position a mark's tooltip opens leftward, so it stays inside the bar. */
const TIP_FLIP_FRACTION = 0.75

export interface ScrubBarProps {
  doc: ReplayDocumentReady
  frame: number
  /** The selected player's events, in time order. */
  events: readonly PlayerEvent[]
  onScrub: (frame: number) => void
  onScrubbingChange?: (scrubbing: boolean) => void
}

/** The bar's width in px, followed as it resizes; Infinity until measured (no grouping). */
function useBarWidth(barRef: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(Number.POSITIVE_INFINITY)
  useEffect(() => {
    const bar = barRef.current
    if (!bar || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      setWidth(w > 0 ? w : Number.POSITIVE_INFINITY)
    })
    observer.observe(bar)
    return () => observer.disconnect()
  }, [barRef])
  return width
}

function Mark({ mark, onScrub }: { mark: ScrubMark; onScrub: (frame: number) => void }) {
  const many = mark.events.length > 1
  return (
    <button
      type="button"
      tabIndex={-1}
      className={`bc-scrub-mark bc-scrub-mark-${mark.kind}${many ? ' bc-scrub-mark-many' : ''}`}
      style={{ left: `${mark.fraction * 100}%` }}
      aria-label={mark.title.replace(/\n/g, '; ')}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); onScrub(mark.frame) }}
    >
      <i />
      <span className={`bc-scrub-mark-tip${mark.fraction > TIP_FLIP_FRACTION ? ' bc-scrub-mark-tip-end' : ''}`}>{mark.title}</span>
    </button>
  )
}

export function ScrubBar({ doc, frame, events, onScrub, onScrubbingChange }: ScrubBarProps) {
  const barRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const last = doc.frameCount - 1
  const fps = framesPerSecond(doc)
  const width = useBarWidth(barRef)

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

  const marks = useMemo(() => groupMarks(events, { fps, frameCount: doc.frameCount }, width), [events, fps, doc.frameCount, width])
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
      title="Click or drag to seek. Marks: the selected player's medals (top), kills, deaths (bottom); [ and ] step through them"
      className="bc-scrub"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    >
      <div className="bc-scrub-track" />
      <div className="bc-scrub-played" style={{ width: `${fraction * 100}%` }} />
      <div className="bc-scrub-head" style={{ left: `${fraction * 100}%` }} />
      {marks.map((mark) => <Mark key={mark.key} mark={mark} onScrub={onScrub} />)}
    </div>
  )
}
