// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { useEffect, useId, useState } from 'react'
import { tokenCssVar } from '@/lib/accessibility/semantic-tokens'
import { SHIELD_CHASE_INK, SHIELD_CHASE_URL, SHIELD_QUAD_URL, type ShieldHudState } from '../model/shieldHud'
import { shieldBarPath, shieldGlossPath, shieldStreakPaths, SHIELD_BAR_H, SHIELD_BAR_W, SHIELD_CENTER } from './shieldBarGeometry'
import { tintedChaseUrl } from './shieldChaseArt'

/** The game's chase-band bitmap, loaded once; the bar draws it tinted when it is ready. */
const chaseImage = new Image()
chaseImage.src = SHIELD_CHASE_URL

/** The game's shield bar quad, loaded once; the bar masks to its alpha (the bar's shape) when it is ready. */
const quadImage = new Image()
quadImage.src = SHIELD_QUAD_URL

// The bar's shape in the game's own units: the quad bitmap's size. When it is loaded the bar masks
// to the quad's alpha and the chase band sits at its game size inside the 80-tall quad.
const QUAD_W = 940
const QUAD_H = 80
const QUAD_CX = 470 // center: the fill drains from both ends toward it
const QUAD_HALF = 470 // half-width: a full shield spans the whole quad
const CHASE_H = 64 // the chase bitmap's own height
// INFERRED: where the 64-tall chase sits vertically in the 80-tall quad. The screen dump does not
// settle a clean nested offset (both quads render at the same 40-unit height from bitmaps of
// different native heights, the main quad's margin_top -8 vs the chase's 0), so it is centered.
const CHASE_Y = (QUAD_H - CHASE_H) / 2

/**
 * ShieldBar3d — the first-person shield bar. When the game's own quad (`SHIELD_QUAD_URL`, a
 * 940x80 bitmap whose alpha is the bar's shape) is loaded, the bar masks to that shape in the
 * game's 940x80 units and the chase band sits at its own 940x64 size inside it. Until then (a HUD
 * set built before the quad) it draws a hand-made bar in a 1000 x SHIELD_BAR_H box. In both the
 * fill drains from both ends toward the center, `low` turns the fill red and pulses it, `broken`
 * leaves the empty glass with a pulsing red alert, `recharging` marks the fill's growing edges.
 * Right after a drop the bar carries the game's chase band (`chase`, `shieldChaseAt`): the shield
 * just lost, additive over the fill, closing on it over the recent-damage window. `flash` (0..1)
 * is the pulse of the moment (`shieldFlash`), so the drawing stays a function of the frame.
 */

export function ShieldBar3d({ fraction, state, flash, chase, label }: { fraction: number; state: ShieldHudState; flash: number; chase: number; label: string }) {
  const id = `shield${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  // Repaint once the bitmaps have loaded (a paused frame would otherwise stay on the flat band).
  const [chaseReady, setChaseReady] = useState(() => chaseImage.complete && chaseImage.naturalWidth > 0)
  useEffect(() => {
    if (chaseReady) return
    const onLoad = () => setChaseReady(true)
    chaseImage.addEventListener('load', onLoad)
    return () => chaseImage.removeEventListener('load', onLoad)
  }, [chaseReady])
  const [quadReady, setQuadReady] = useState(() => quadImage.complete && quadImage.naturalWidth > 0)
  useEffect(() => {
    if (quadReady) return
    const onLoad = () => setQuadReady(true)
    quadImage.addEventListener('load', onLoad)
    return () => quadImage.removeEventListener('load', onLoad)
  }, [quadReady])
  // The game's own quad when it is loaded, the hand-made bar before that.
  const isQuad = quadReady
  const W = isQuad ? QUAD_W : SHIELD_BAR_W
  const H = isQuad ? QUAD_H : SHIELD_BAR_H
  const cx = isQuad ? QUAD_CX : SHIELD_CENTER
  const hw = isQuad ? QUAD_HALF : SHIELD_CENTER
  const half = hw * Math.max(0, Math.min(1, fraction))
  // The chase band's edges: the game's `shield_chase` quad spans the just-lost shield, from the
  // live value out to the lagging value (`shieldChaseAt`), drawn additively (`SHIELD_CHASE_INK`).
  const chaseHalf = hw * Math.max(0, Math.min(1, chase))
  const low = state === 'low'
  const alert = low || state === 'broken'
  const pulse = alert ? 0.35 + 0.65 * flash : 1
  const alertInk = tokenCssVar('replay-hud-shield-alert')
  const main = low ? alertInk : tokenCssVar('replay-hud-shield')
  const deep = low ? `color-mix(in srgb, ${alertInk} 65%, #000)` : tokenCssVar('replay-hud-shield-deep')
  // The chase band: the shield just lost, from the live fill out to the lagging chase, additive over
  // the fill, closing on it over the recent-damage window. The quad mode draws the bitmap at its own
  // size at the part-1 position; the legacy mode stretches it to the bar's box. INFERRED (legacy):
  // the reveal is clipped to the band's two x ranges because the bitmap's B ramp is linear in x, so
  // the clip equals the game's B-threshold reveal to within a few pixels, flush with the fill edge.
  const chaseBand = chaseHalf > half && (chaseReady ? <g style={{ mixBlendMode: 'plus-lighter' }} clipPath={`url(#${id}-chase)`}>
    <image href={tintedChaseUrl(chaseImage)} x={0} y={isQuad ? CHASE_Y : 0} width={W} height={isQuad ? CHASE_H : H} preserveAspectRatio="none" />
  </g> : <g style={{ mixBlendMode: 'plus-lighter', fill: SHIELD_CHASE_INK }}>
    <rect x={cx - chaseHalf} y={0} width={chaseHalf - half} height={H} />
    <rect x={cx + half} y={0} width={chaseHalf - half} height={H} />
  </g>)
  return <svg viewBox={isQuad ? `0 0 ${QUAD_W} ${QUAD_H}` : `0 0 ${SHIELD_BAR_W} ${SHIELD_BAR_H}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} data-shield-state={state}
    style={{ display: 'block', width: '100%', height: 'auto', overflow: 'visible', filter: 'drop-shadow(0 1px 2px var(--replay-hud-shadow))' }}>
    <defs>
      {/* The bar's shape: the quad's alpha as an SVG mask, or the hand-made path as a clip. */}
      {isQuad
        ? <mask id={`${id}-bar`} style={{ maskType: 'alpha' }} maskUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
          <image href={SHIELD_QUAD_URL} width={W} height={H} />
        </mask>
        : <clipPath id={`${id}-bar`}><path d={shieldBarPath()} /></clipPath>}
      <clipPath id={`${id}-fill`}><rect x={cx - half} y={0} width={2 * half} height={H} /></clipPath>
      {/* The chase band's two x ranges: the bitmap is revealed by clipping to them. */}
      <clipPath id={`${id}-chase`}>
        <rect x={cx - chaseHalf} y={0} width={Math.max(0, chaseHalf - half)} height={H} />
        <rect x={cx + half} y={0} width={Math.max(0, chaseHalf - half)} height={H} />
      </clipPath>
      <linearGradient id={`${id}-ink`} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={W} y2={0}>
        <stop offset={0} style={{ stopColor: deep }} />
        <stop offset={0.5} style={{ stopColor: main }} />
        <stop offset={1} style={{ stopColor: deep }} />
      </linearGradient>
    </defs>
    <g {...(isQuad ? { mask: `url(#${id}-bar)` } : { clipPath: `url(#${id}-bar)` })}>
      <rect width={W} height={H} style={{ fill: tokenCssVar('replay-hud-shield-track') }} />
      {state === 'broken' && <rect width={W} height={H} style={{ fill: alertInk }} opacity={0.18 * flash} />}
      {half > 0 && <g clipPath={`url(#${id}-fill)`}>
        <rect width={W} height={H} fill={`url(#${id}-ink)`} opacity={low ? 0.45 + 0.45 * flash : 0.82} />
        {/* The gloss and streaks were traced for the hand-made shape; the quad's own alpha replaces them. */}
        {!isQuad && <path d={shieldGlossPath()} fill="none" stroke="#fff" strokeOpacity={0.45} strokeWidth={6} />}
        {!isQuad && shieldStreakPaths().map((d) => <path key={d} d={d} fill="none" stroke="#fff" strokeOpacity={0.1} strokeWidth={3} />)}
      </g>}
      {chaseBand}
      {state === 'recharging' && half > 0 && half < hw && <g style={{ stroke: tokenCssVar('replay-hud-shield-rim') }} strokeWidth={2} vectorEffect="non-scaling-stroke" opacity={0.9}>
        <line x1={cx - half} y1={0} x2={cx - half} y2={H} vectorEffect="non-scaling-stroke" />
        <line x1={cx + half} y1={0} x2={cx + half} y2={H} vectorEffect="non-scaling-stroke" />
      </g>}
    </g>
    {!isQuad && <path d={shieldBarPath()} fill="none" style={{ stroke: alert ? alertInk : tokenCssVar('replay-hud-shield-rim') }} strokeWidth={1.25} vectorEffect="non-scaling-stroke" opacity={alert ? pulse : 0.9} strokeLinejoin="round" />}
  </svg>
}
