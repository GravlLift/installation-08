import { useEffect, useRef, useState } from 'react'
import { formatClock, frameToMs } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { SPEED_MULTIPLIERS } from '../settings/useReplaySettings'
import { ReplaySoundControls } from '../sound/ReplaySoundControls'
import type { ReplaySound } from '../sound/useReplaySound'

interface ReplayTransportProps {
  doc: ReplayDocumentReady
  frame: number
  playing: boolean
  onTogglePlay: () => void
  onRestart: () => void
  onSeekBy: (seconds: number) => void
  onScrub: (frame: number) => void
  speed: number
  onSetSpeed: (speed: number) => void
  sound: ReplaySound
}

export function ReplayTransport({ doc, frame, playing, onTogglePlay, onRestart, onSeekBy, onScrub, speed, onSetSpeed, sound }: ReplayTransportProps) {
  const [speedOpen, setSpeedOpen] = useState(false)
  const speedRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!speedOpen) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setSpeedOpen(false) }
    const onPointerDown = (event: PointerEvent) => { if (!speedRef.current?.contains(event.target as Node)) setSpeedOpen(false) }
    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => { window.removeEventListener('keydown', onKeyDown); document.removeEventListener('pointerdown', onPointerDown) }
  }, [speedOpen])
  const clock = formatClock(frameToMs(frame, doc))
  return (
    <div className="bg-background/40 px-3 pb-2.5 pt-3">
      <div className="flex items-center gap-3">
        <input type="range" aria-label="Match time" aria-valuetext={clock} data-replay-timeline="" min={0} max={Math.max(0, doc.frameCount - 1)} value={frame} onChange={(event) => onScrub(Number(event.target.value))} className="w-full" />
        <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{clock} / {formatClock(frameToMs(doc.frameCount - 1, doc))}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-3.5">
        <div className="flex flex-1 items-center gap-2">
          <ReplaySoundControls sound={sound} locale="en" />
          <div ref={speedRef} className="relative">
            <button type="button" aria-label="Speed" aria-expanded={speedOpen} onClick={() => setSpeedOpen((open) => !open)} className="rounded-full border border-input px-3 py-1 text-xs">{speed}×</button>
            {speedOpen && <div role="group" aria-label="Speed" data-replay-escape-layer="" className="absolute bottom-full right-0 z-20 flex flex-col rounded-lg border border-border bg-popover p-1">
              {SPEED_MULTIPLIERS.map((value) => <button type="button" key={value} aria-pressed={value === speed} onClick={() => { onSetSpeed(value); setSpeedOpen(false) }} className="rounded px-3 py-1 text-left text-xs hover:bg-accent">{value}×</button>)}
            </div>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={onRestart} aria-label="Restart (R)" title="Restart (R)" className="h-[30px] w-[30px] rounded-full hover:bg-accent"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M4.1 1.6v2.9H7" /></svg></button>
          <button type="button" onClick={() => onSeekBy(-10)} aria-label="Back 10 s (←)" className="h-[30px] w-[30px] rounded-full border border-input text-xs">−10</button>
          <button type="button" onClick={onTogglePlay} aria-label={playing ? 'Pause' : 'Play'} className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">{playing ? <svg viewBox="0 0 16 16" className="h-[17px] w-[17px]" fill="currentColor" aria-hidden="true"><rect x="3.5" y="2.5" width="3.4" height="11" rx="1" /><rect x="9.1" y="2.5" width="3.4" height="11" rx="1" /></svg> : <svg viewBox="0 0 16 16" className="h-[17px] w-[17px]" fill="currentColor" aria-hidden="true"><path d="M4.5 2.8a.8.8 0 0 1 1.2-.7l8 5.2a.8.8 0 0 1 0 1.4l-8 5.2a.8.8 0 0 1-1.2-.7z" /></svg>}</button>
          <button type="button" onClick={() => onSeekBy(10)} aria-label="Forward 10 s (→)" className="h-[30px] w-[30px] rounded-full border border-input text-xs">+10</button>
        </div>
        <div className="flex-1" />
      </div>
    </div>
  )
}
