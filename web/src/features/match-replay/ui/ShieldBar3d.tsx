// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { useId } from 'react'
import { tokenCssVar } from '@/lib/accessibility/semantic-tokens'
import type { ShieldHudState } from '../model/shieldHud'
import { shieldBarPath, shieldGlossPath, shieldStreakPaths, SHIELD_BAR_H } from './shieldBarGeometry'

/**
 * ShieldBar3d — the first-person shield bar, drawn after the in-game captures: a long thin glass
 * bar whose edges sag toward the center, its ends chamfered to a point below the middle, light
 * steel blue, brighter at the center, under a pale rim. The fill drains from both ends toward the
 * center. `low` turns the fill red and pulses it, `broken` leaves the empty glass with a pulsing
 * red rim, `recharging` marks the fill's growing edges. `flash` (0..1) is the pulse of the moment
 * (`shieldFlash`), so the drawing stays a function of the frame.
 */

export function ShieldBar3d({ fraction, state, flash, label }: { fraction: number; state: ShieldHudState; flash: number; label: string }) {
  const id = `shield${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const half = 500 * Math.max(0, Math.min(1, fraction))
  const low = state === 'low'
  const alert = low || state === 'broken'
  const pulse = alert ? 0.35 + 0.65 * flash : 1
  const alertInk = tokenCssVar('replay-hud-shield-alert')
  const main = low ? alertInk : tokenCssVar('replay-hud-shield')
  const deep = low ? `color-mix(in srgb, ${alertInk} 65%, #000)` : tokenCssVar('replay-hud-shield-deep')
  return <svg viewBox={`0 0 1000 ${SHIELD_BAR_H}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} data-shield-state={state}
    style={{ display: 'block', width: '100%', height: 'auto', overflow: 'visible', filter: 'drop-shadow(0 1px 2px var(--replay-hud-shadow))' }}>
    <defs>
      <clipPath id={`${id}-bar`}><path d={shieldBarPath()} /></clipPath>
      <clipPath id={`${id}-fill`}><rect x={500 - half} y={0} width={2 * half} height={SHIELD_BAR_H} /></clipPath>
      <linearGradient id={`${id}-ink`} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={1000} y2={0}>
        <stop offset={0} style={{ stopColor: deep }} />
        <stop offset={0.5} style={{ stopColor: main }} />
        <stop offset={1} style={{ stopColor: deep }} />
      </linearGradient>
    </defs>
    <g clipPath={`url(#${id}-bar)`}>
      <rect width={1000} height={SHIELD_BAR_H} style={{ fill: tokenCssVar('replay-hud-shield-track') }} />
      {state === 'broken' && <rect width={1000} height={SHIELD_BAR_H} style={{ fill: alertInk }} opacity={0.18 * flash} />}
      {half > 0 && <g clipPath={`url(#${id}-fill)`}>
        <rect width={1000} height={SHIELD_BAR_H} fill={`url(#${id}-ink)`} opacity={low ? 0.45 + 0.45 * flash : 0.82} />
        <path d={shieldGlossPath()} fill="none" stroke="#fff" strokeOpacity={0.45} strokeWidth={6} />
        {shieldStreakPaths().map((d) => <path key={d} d={d} fill="none" stroke="#fff" strokeOpacity={0.1} strokeWidth={3} />)}
      </g>}
      {state === 'recharging' && half > 0 && half < 500 && <g style={{ stroke: tokenCssVar('replay-hud-shield-rim') }} strokeWidth={2} vectorEffect="non-scaling-stroke" opacity={0.9}>
        <line x1={500 - half} y1={0} x2={500 - half} y2={SHIELD_BAR_H} vectorEffect="non-scaling-stroke" />
        <line x1={500 + half} y1={0} x2={500 + half} y2={SHIELD_BAR_H} vectorEffect="non-scaling-stroke" />
      </g>}
    </g>
    <path d={shieldBarPath()} fill="none" style={{ stroke: alert ? alertInk : tokenCssVar('replay-hud-shield-rim') }} strokeWidth={1.25} vectorEffect="non-scaling-stroke" opacity={alert ? pulse : 0.9} strokeLinejoin="round" />
  </svg>
}
