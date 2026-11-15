import { useEffect, useRef, type RefObject } from 'react'
import { tokenCssVar } from '@/lib/accessibility/semantic-tokens'

import { readPlayback, type PlaybackMeter, type PlaybackReading } from '../model/playbackMeter_logic'
import { ETAPES_PROFIL, PASS_COST_NAMES, type PassCostName, type ProfilRendu } from '../scene3d/profilRendu3d'
import type { ReplayLocale } from '../i18n/i18n'
import { SCENE3D_TEXT } from '../i18n/scene3dText'
import { useReplay3dMeter } from '../settings/useReplay3dMeter'

/** The key that shows or hides the meter (the drawer's "Show playback FPS" toggle flips the same flag). */
const METER_KEY_STROKE = '`'
/** How often the meter is read (ms): four times a second. */
const READ_EVERY_MS = 250

/** typing: the keystroke goes to an input field, the key belongs to it. */
function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

/** The snapshot published on `window.__it3dPerf` at each reading (console reads, A/B measurements). */
export interface PerfSnapshot {
  at: number
  playbackFps: number
  filmFps: number
  realtime: number
  frameMsAvg: number
  frameMsWorst: number
  scriptMs: number
  stagesMs: Record<(typeof ETAPES_PROFIL)[number], number>
  calls: number
  triangles: number
  geometries: number
  textures: number
  pixelRatio: number
  width: number
  height: number
  /** The GPU time of the frame's draws (ms, smoothed); null without the timer extension. */
  gpuMs: number | null
  /** What each pass drew at the last frame (the scene pass without the shadow updates). */
  passes: Record<PassCostName, { calls: number; triangles: number }>
}

declare global {
  interface Window {
    __it3dPerf?: Readonly<PerfSnapshot>
  }
}

/** snapshotOf: the reading and the render profile as one plain object. */
export function snapshotOf(r: PlaybackReading, filmFps: number, p: ProfilRendu | null, at: number): PerfSnapshot {
  const stagesMs = Object.fromEntries(ETAPES_PROFIL.map((name, i) => [name, round1(p?.ms[i] ?? 0)])) as PerfSnapshot['stagesMs']
  return {
    at,
    playbackFps: round1(r.displayedFps),
    filmFps: round1(filmFps),
    realtime: Math.round(r.realtime * 100) / 100,
    frameMsAvg: round1(r.frameMsAvg),
    frameMsWorst: round1(r.frameMsWorst),
    scriptMs: round1(r.scriptMs),
    stagesMs,
    calls: p?.appels ?? 0,
    triangles: p?.triangles ?? 0,
    geometries: p?.geometries ?? 0,
    textures: p?.textures ?? 0,
    pixelRatio: p?.pixelRatio ?? 1,
    width: p?.width ?? 0,
    height: p?.height ?? 0,
    gpuMs: p?.gpuMs == null ? null : round1(p.gpuMs),
    passes: Object.fromEntries(PASS_COST_NAMES.map((n) => [n, { calls: p?.passes[n].calls ?? 0, triangles: p?.passes[n].triangles ?? 0 }])) as PerfSnapshot['passes'],
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

/** meterLines: the headline (« 13 / 30 fps · 1.00x ») and the smaller lines (frame time and render cost, stages, passes). */
export function meterLines(s: PerfSnapshot, t: (typeof SCENE3D_TEXT)[ReplayLocale]): [string, string, string, string] {
  const ratio = s.realtime > 0 ? `${s.realtime.toFixed(2)}x` : t.cadencePaused
  const head = `${Math.round(s.playbackFps)} / ${s.filmFps} ${t.cadenceIps} · ${ratio}`
  const cost = `${s.frameMsAvg.toFixed(1)} ms · ${t.cadencePire} ${s.frameMsWorst.toFixed(1)} ms · js ${s.scriptMs.toFixed(1)} ms${s.gpuMs === null ? '' : ` · gpu ${s.gpuMs.toFixed(1)} ms`} · ${s.calls} calls · ${(s.triangles / 1e6).toFixed(2)}M tri · ${s.geometries} geo · ${s.textures} tex`
  const stages = `${ETAPES_PROFIL.map((name) => `${name} ${s.stagesMs[name].toFixed(1)}`).join(' · ')} · x${s.pixelRatio} ${s.width}x${s.height}`
  const passes = PASS_COST_NAMES.filter((n) => s.passes[n].calls > 0).map((n) => `${n} ${(s.passes[n].triangles / 1e6).toFixed(2)}M/${s.passes[n].calls}`).join(' · ')
  return [head, cost, stages, passes]
}

/**
 * ReplayCadence3d — the playback meter, read from the 3D view's render loop: film frames displayed
 * per second against the film's native rate, the real-time ratio, then frame time and render cost.
 * Hidden by default: the drawer's toggle or the ` key shows it, and the choice is kept.
 *
 * The meter ref is filled by the loop (one sample per frame, no allocation); this component reads
 * it four times a second and writes the lines straight into the DOM: no React state per frame or
 * per reading. Each reading is also published on `window.__it3dPerf`, shown or not. It sits on the
 * right under the corner minimap: clear of the camera selector (top left) and the minimap.
 */
export function ReplayCadence3d({ meterRef, profil, filmFps, locale }: { meterRef: RefObject<PlaybackMeter | null>; profil: () => ProfilRendu | null; filmFps: number; locale: ReplayLocale }) {
  const t = SCENE3D_TEXT[locale]
  const [shown, toggle] = useReplay3dMeter()
  const toggleRef = useRef(toggle)
  toggleRef.current = toggle
  const boxRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const costRef = useRef<HTMLDivElement>(null)
  const stagesRef = useRef<HTMLDivElement>(null)
  const passesRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== METER_KEY_STROKE || e.ctrlKey || e.altKey || e.metaKey || typing(e.target)) return
      toggleRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    const read = () => {
      const m = meterRef.current
      const now = performance.now()
      const r = m ? readPlayback(m, filmFps, now) : null
      const box = boxRef.current
      if (!r) {
        if (box) box.style.visibility = 'hidden'
        return
      }
      const snap = snapshotOf(r, filmFps, profil(), now)
      window.__it3dPerf = Object.freeze(snap)
      if (!box || !headRef.current || !costRef.current || !stagesRef.current || !passesRef.current) return
      const [head, cost, stages, passes] = meterLines(snap, t)
      headRef.current.textContent = head
      costRef.current.textContent = cost
      stagesRef.current.textContent = stages
      passesRef.current.textContent = passes
      box.style.visibility = 'visible'
    }
    read()
    const timer = setInterval(read, READ_EVERY_MS)
    return () => clearInterval(timer)
  }, [meterRef, profil, filmFps, t, shown])
  if (!shown) return null
  return (
    <div
      ref={boxRef}
      className="pointer-events-none absolute select-all text-right font-mono"
      style={{
        right: 16,
        // Under the minimap (`minimapRect`: chrome top + 8 px, side 24 % of the view's height).
        top: 'calc(var(--bc-chrome-top, 0px) + 16px + 24cqh)',
        visibility: 'hidden',
        color: tokenCssVar('replay-hud-on-dark'),
        fontVariantNumeric: 'tabular-nums',
        textShadow: '0 1px 2px var(--replay-hud-shadow)',
      }}
    >
      <div ref={headRef} className="text-sm font-semibold" />
      <div ref={costRef} className="text-[10px] opacity-90" />
      <div ref={stagesRef} className="text-[10px] opacity-75" />
      <div ref={passesRef} className="text-[10px] opacity-75" />
    </div>
  )
}
