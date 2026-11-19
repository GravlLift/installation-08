// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { useEffect, useId, useState } from 'react'
import { tokenCssVar } from '@/lib/accessibility/semantic-tokens'
import { SHIELD_CHASE_INK, SHIELD_CHASE_URL, SHIELD_QUAD_URL, type ShieldHudState } from '../model/shieldHud'
import { shieldBarPath, shieldGlossPath, shieldStreakPaths, SHIELD_BAR_H, SHIELD_BAR_W, SHIELD_CENTER, SHIELD_QUAD_H, SHIELD_QUAD_W, SHIELD_QUAD_CENTER, SHIELD_QUAD_HALF, SHIELD_QUAD_CHASE_H, SHIELD_QUAD_CHASE_Y, SHIELD_QUAD_SHAPE_GAIN as QUAD_SHAPE_GAIN, SHIELD_QUAD_HEX_OPACITY as QUAD_HEX_OPACITY, SHIELD_QUAD_FILL_OPACITY } from './shieldBarGeometry'
import { tintedChaseUrl } from './shieldChaseArt'
import { SHIELD_BLOOM_BLUR, SHIELD_BLOOM_LAYERS, SHIELD_BLOOM_TABLE, shieldBloomIntensity } from '../model/shieldBloom'
import { HEALTH_BAR_RGB, HEALTH_BAR_URL, healthStripBox, healthStripHalf, healthStripShown, SHIELD_ALERT_RGB, SHIELD_BURST_URL, SHIELD_GLOW_BOTTOM_BELOW_CENTER, SHIELD_GLOW_GAIN, SHIELD_GLOW_H, SHIELD_GLOW_SEAM_TRIM, SHIELD_GLOW_URL, SHIELD_GLOW_W, shieldBurstAt, shieldBurstBox, shieldFrameFlash, shieldGlowShown } from '../model/shieldAlert'

/** An feColorMatrix that paints every pixel `rgb` (0..255) at its alpha times `gain`. */
const solidMatrix = ([r, g, b]: readonly number[], gain = 1) => `0 0 0 0 ${r / 255} 0 0 0 0 ${g / 255} 0 0 0 0 ${b / 255} 0 0 0 ${gain} 0`
/**
 * An feColorMatrix for a gray-on-black bitmap meant to be added: every pixel `rgb` (0..255) at an
 * alpha of its gray level. Added (plus-lighter) or blended normally, it reads the same as the gray
 * times `rgb` added, and its black background stays transparent even where the blend is isolated
 * (the SVG's drop-shadow filter isolates it from the scene).
 */
const lumaMatrix = ([r, g, b]: readonly number[]) => `0 0 0 0 ${r / 255} 0 0 0 0 ${g / 255} 0 0 0 0 ${b / 255} 1 0 0 0 0`

/** The game's chase-band bitmap, loaded once; the bar draws it tinted when it is ready. */
const chaseImage = new Image()
chaseImage.src = SHIELD_CHASE_URL

/** The game's shield bar quad, loaded once; the bar masks to its alpha (the bar's shape) when it is ready. */
const quadImage = new Image()
quadImage.src = SHIELD_QUAD_URL

// The bar's shape in the game's own units: the quad bitmap's size (`SHIELD_QUAD_*`). When it is
// loaded the bar masks to the quad's alpha and the chase band sits at its game size inside the
// 80-tall quad.
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
 * In quad mode the bar also carries the game's empty-shield alert and health strip
 * (`model/shieldAlert`): the red glow over the frame and the frame flash while `broken`, the
 * break burst for 766 ms after it began (`stateAgeMs` counts from the state's start), and the
 * health strip (`health`, 0..1, null when the film records none) while the shield is not full.
 */

export function ShieldBar3d({ fraction, state, flash, chase, label, health = null, stateAgeMs = 0 }: { fraction: number; state: ShieldHudState; flash: number; chase: number; label: string; health?: number | null; stateAgeMs?: number }) {
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
  const W = isQuad ? SHIELD_QUAD_W : SHIELD_BAR_W
  const H = isQuad ? SHIELD_QUAD_H : SHIELD_BAR_H
  const cx = isQuad ? SHIELD_QUAD_CENTER : SHIELD_CENTER
  const hw = isQuad ? SHIELD_QUAD_HALF : SHIELD_CENTER
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
  // The empty-shield alert and the health strip (quad mode only: they are placed in the game's units).
  const glowOn = isQuad && shieldGlowShown(state)
  const cy = H / 2
  const glowY = cy + SHIELD_GLOW_BOTTOM_BELOW_CENTER - SHIELD_GLOW_H
  const burst = glowOn ? shieldBurstAt(stateAgeMs) : null
  const burstBox = burst ? shieldBurstBox(burst, cx, cy) : null
  const showHealth = isQuad && healthStripShown(state, health)
  const healthBox = healthStripBox(cx, H)
  const healthHalf = showHealth ? healthStripHalf(health ?? 0) : 0
  // The bloom's global intensity (the fall after a refill) and its filter margin, in bar units.
  const bloom = shieldBloomIntensity(state, stateAgeMs)
  const bloomPad = SHIELD_BLOOM_BLUR[SHIELD_BLOOM_BLUR.length - 1] * (isQuad ? 1 : SHIELD_BAR_W / SHIELD_QUAD_W)
  const chaseBand = chaseHalf > half && (chaseReady ? <g style={{ mixBlendMode: 'plus-lighter' }} clipPath={`url(#${id}-chase)`}>
    <image href={tintedChaseUrl(chaseImage)} x={0} y={isQuad ? SHIELD_QUAD_CHASE_Y : 0} width={W} height={isQuad ? SHIELD_QUAD_CHASE_H : H} preserveAspectRatio="none" />
  </g> : <g style={{ mixBlendMode: 'plus-lighter', fill: SHIELD_CHASE_INK }}>
    <rect x={cx - chaseHalf} y={0} width={chaseHalf - half} height={H} />
    <rect x={cx + half} y={0} width={chaseHalf - half} height={H} />
  </g>)
  return <svg viewBox={isQuad ? `0 0 ${SHIELD_QUAD_W} ${SHIELD_QUAD_H}` : `0 0 ${SHIELD_BAR_W} ${SHIELD_BAR_H}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} data-shield-state={state}
    style={{ display: 'block', width: '100%', height: 'auto', overflow: 'visible', filter: 'drop-shadow(0 1px 2px var(--replay-hud-shadow))' }}>
    <defs>
      {/* The bar's shape: the quad's alpha as an SVG mask, or the hand-made path as a clip. */}
      {isQuad
        ? <>
          {/* The shape: the quad's alpha times SHIELD_QUAD_SHAPE_GAIN (see shieldBarGeometry). */}
          <filter id={`${id}-solid`} x={0} y={0} width={W} height={H} filterUnits="userSpaceOnUse">
            <feComponentTransfer><feFuncA type="linear" slope={QUAD_SHAPE_GAIN} /></feComponentTransfer>
          </filter>
          <mask id={`${id}-bar`} style={{ maskType: 'alpha' }} maskUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
            <image href={SHIELD_QUAD_URL} width={W} height={H} filter={`url(#${id}-solid)`} />
          </mask>
          {/* The raw alpha again, for the hex pattern drawn lightly over the fill. */}
          <mask id={`${id}-hex`} style={{ maskType: 'alpha' }} maskUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
            <image href={SHIELD_QUAD_URL} width={W} height={H} />
          </mask>
        </>
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
      {/* The alert's red (the glow's alpha doubled), the burst's red tint, the health strip's color. */}
      <filter id={`${id}-glowink`} colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values={solidMatrix(SHIELD_ALERT_RGB, SHIELD_GLOW_GAIN)} /></filter>
      <filter id={`${id}-burstink`} colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values={lumaMatrix(SHIELD_ALERT_RGB)} /></filter>
      <filter id={`${id}-healthink`} colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values={solidMatrix(HEALTH_BAR_RGB)} /></filter>
      {/* Each glow half stops at the bar's center (see SHIELD_GLOW_SEAM_TRIM). */}
      <clipPath id={`${id}-glowleft`}><rect x={cx - SHIELD_GLOW_W} y={glowY} width={SHIELD_GLOW_W} height={SHIELD_GLOW_H} /></clipPath>
      <clipPath id={`${id}-glowright`}><rect x={cx} y={glowY} width={SHIELD_GLOW_W} height={SHIELD_GLOW_H} /></clipPath>
      <clipPath id={`${id}-health`}><rect x={cx - healthHalf} y={healthBox.y} width={2 * healthHalf} height={healthBox.h} /></clipPath>
      {/* The screen's bloom (`model/shieldBloom`): the bright part, blurred three ways, added back. */}
      <filter id={`${id}-bloom`} filterUnits="userSpaceOnUse" x={-3 * bloomPad} y={-3 * bloomPad} width={W + 6 * bloomPad} height={H + 6 * bloomPad} colorInterpolationFilters="linearRGB">
        <feComponentTransfer in="SourceGraphic" result="hi">
          <feFuncR type="table" tableValues={SHIELD_BLOOM_TABLE} />
          <feFuncG type="table" tableValues={SHIELD_BLOOM_TABLE} />
          <feFuncB type="table" tableValues={SHIELD_BLOOM_TABLE} />
        </feComponentTransfer>
        {SHIELD_BLOOM_BLUR.map((sd, i) => <feGaussianBlur key={sd} in="hi" stdDeviation={sd} result={`b${i}`} />)}
        <feComposite in="b0" in2="b1" operator="arithmetic" k2={bloom * SHIELD_BLOOM_LAYERS[0]} k3={bloom * SHIELD_BLOOM_LAYERS[1]} result="b01" />
        <feComposite in="b01" in2="b2" operator="arithmetic" k2={1} k3={bloom * SHIELD_BLOOM_LAYERS[2]} result="glow" />
        <feComposite in="SourceGraphic" in2="glow" operator="arithmetic" k2={1} k3={1} />
      </filter>
    </defs>
    {/* The empty-shield glow: two quads meeting at the bar's center, the right one mirrored. */}
    {glowOn && <g filter={`url(#${id}-glowink)`}>
      <g clipPath={`url(#${id}-glowleft)`}>
        <image href={SHIELD_GLOW_URL} x={cx + SHIELD_GLOW_SEAM_TRIM - SHIELD_GLOW_W} y={glowY} width={SHIELD_GLOW_W} height={SHIELD_GLOW_H} preserveAspectRatio="none" />
      </g>
      <g clipPath={`url(#${id}-glowright)`}>
        <image href={SHIELD_GLOW_URL} x={-cx + SHIELD_GLOW_SEAM_TRIM - SHIELD_GLOW_W} y={glowY} width={SHIELD_GLOW_W} height={SHIELD_GLOW_H} preserveAspectRatio="none" transform="scale(-1 1)" />
      </g>
    </g>}
    <g filter={`url(#${id}-bloom)`}>
    <g {...(isQuad ? { mask: `url(#${id}-bar)` } : { clipPath: `url(#${id}-bar)` })}>
      <rect width={W} height={H} style={{ fill: tokenCssVar('replay-hud-shield-track') }} />
      {/* Broken: the game's frame flash (quad mode, the bar's own outline in the alert red), else the old tint. */}
      {state === 'broken' && (isQuad
        ? <rect width={W} height={H} fill={`rgb(${SHIELD_ALERT_RGB.join(',')})`} mask={`url(#${id}-hex)`} opacity={shieldFrameFlash(stateAgeMs)} />
        : <rect width={W} height={H} style={{ fill: alertInk }} opacity={0.18 * flash} />)}
      {half > 0 && <g clipPath={`url(#${id}-fill)`}>
        <rect width={W} height={H} fill={`url(#${id}-ink)`} opacity={low ? 0.45 + 0.45 * flash : isQuad ? SHIELD_QUAD_FILL_OPACITY : 0.82} />
        {/* The quad's hex pattern and outline, light over the fill (the raw alpha). */}
        {isQuad && <rect width={W} height={H} fill="#fff" mask={`url(#${id}-hex)`} opacity={QUAD_HEX_OPACITY} />}
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
    </g>
    {/* The health strip: the game's bitmap in the measured color, lit from the center out to the health. */}
    {showHealth && healthHalf > 0 && <g clipPath={`url(#${id}-health)`} filter={`url(#${id}-healthink)`}>
      <image href={HEALTH_BAR_URL} x={healthBox.x} y={healthBox.y} width={healthBox.w} height={healthBox.h} preserveAspectRatio="none" />
    </g>}
    {/* The break burst: the bitmap flipped in y, red, added over everything. */}
    {burst && burstBox && <g style={{ mixBlendMode: 'plus-lighter' }} opacity={burst.opacity} filter={`url(#${id}-burstink)`}>
      <image href={SHIELD_BURST_URL} x={burstBox.x} y={-(burstBox.y + burstBox.h)} width={burstBox.w} height={burstBox.h} preserveAspectRatio="none" transform="scale(1 -1)" />
    </g>}
    {!isQuad && <path d={shieldBarPath()} fill="none" style={{ stroke: alert ? alertInk : tokenCssVar('replay-hud-shield-rim') }} strokeWidth={1.25} vectorEffect="non-scaling-stroke" opacity={alert ? pulse : 0.9} strokeLinejoin="round" />}
  </svg>
}
