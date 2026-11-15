import { useId } from 'react'
import { tokenCssVar } from '@/lib/accessibility/semantic-tokens'
import type { ShieldHudState } from '../model/shieldHud'

/**
 * ShieldBar3d — the first-person shield bar, drawn after the in-game captures: a long thin glass
 * bar whose edges sag toward the center, its ends chamfered to a point below the middle, light
 * steel blue, brighter at the center, under a pale rim. The fill drains from both ends toward the
 * center. `low` turns the fill red and pulses it, `broken` leaves the empty glass with a pulsing
 * red rim, `recharging` marks the fill's growing edges. `flash` (0..1) is the pulse of the moment
 * (`shieldFlash`), so the drawing stays a function of the frame.
 */

// The bar in a 1000-wide box: top edge from y 6 at the ends to 20 at the center, bottom edge from
// 56 to 71, end points at y 40 (read off the 1280x720 and 1920x1080 captures).
const BAR = 'M20 6 Q500 34 980 6 L1000 40 L988 56 Q500 86 12 56 L0 40 Z'
const VIEW_H = 74
// Light along the glass: a gloss line under the top edge and two faint streaks lower down.
const GLOSS = 'M24 11 Q500 39 976 11'
const STREAKS = ['M0 30 Q500 58 1000 30', 'M0 44 Q500 72 1000 44']

export function ShieldBar3d({ fraction, state, flash, label }: { fraction: number; state: ShieldHudState; flash: number; label: string }) {
  const id = `shield${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const half = 500 * Math.max(0, Math.min(1, fraction))
  const low = state === 'low'
  const alert = low || state === 'broken'
  const pulse = alert ? 0.35 + 0.65 * flash : 1
  const alertInk = tokenCssVar('replay-hud-shield-alert')
  const main = low ? alertInk : tokenCssVar('replay-hud-shield')
  const deep = low ? `color-mix(in srgb, ${alertInk} 65%, #000)` : tokenCssVar('replay-hud-shield-deep')
  return <svg viewBox={`0 0 1000 ${VIEW_H}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} data-shield-state={state}
    style={{ display: 'block', width: '100%', height: 'auto', overflow: 'visible', filter: 'drop-shadow(0 1px 2px var(--replay-hud-shadow))' }}>
    <defs>
      <clipPath id={`${id}-bar`}><path d={BAR} /></clipPath>
      <clipPath id={`${id}-fill`}><rect x={500 - half} y={0} width={2 * half} height={VIEW_H} /></clipPath>
      <linearGradient id={`${id}-ink`} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={1000} y2={0}>
        <stop offset={0} style={{ stopColor: deep }} />
        <stop offset={0.5} style={{ stopColor: main }} />
        <stop offset={1} style={{ stopColor: deep }} />
      </linearGradient>
    </defs>
    <g clipPath={`url(#${id}-bar)`}>
      <rect width={1000} height={VIEW_H} style={{ fill: tokenCssVar('replay-hud-shield-track') }} />
      {state === 'broken' && <rect width={1000} height={VIEW_H} style={{ fill: alertInk }} opacity={0.18 * flash} />}
      {half > 0 && <g clipPath={`url(#${id}-fill)`}>
        <rect width={1000} height={VIEW_H} fill={`url(#${id}-ink)`} opacity={low ? 0.45 + 0.45 * flash : 0.82} />
        <path d={GLOSS} fill="none" stroke="#fff" strokeOpacity={0.45} strokeWidth={6} />
        {STREAKS.map((d) => <path key={d} d={d} fill="none" stroke="#fff" strokeOpacity={0.1} strokeWidth={3} />)}
      </g>}
      {state === 'recharging' && half > 0 && half < 500 && <g style={{ stroke: tokenCssVar('replay-hud-shield-rim') }} strokeWidth={2} vectorEffect="non-scaling-stroke" opacity={0.9}>
        <line x1={500 - half} y1={0} x2={500 - half} y2={VIEW_H} vectorEffect="non-scaling-stroke" />
        <line x1={500 + half} y1={0} x2={500 + half} y2={VIEW_H} vectorEffect="non-scaling-stroke" />
      </g>}
    </g>
    <path d={BAR} fill="none" style={{ stroke: alert ? alertInk : tokenCssVar('replay-hud-shield-rim') }} strokeWidth={1.25} vectorEffect="non-scaling-stroke" opacity={alert ? pulse : 0.9} strokeLinejoin="round" />
  </svg>
}
