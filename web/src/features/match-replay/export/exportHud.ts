// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { resolveToken } from '@/lib/accessibility/resolveToken'
import { formatClock, frameToMs } from '@/lib/replay/replayLogic'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import type { ReplayLocale } from '../i18n/i18n'
import { hudClock, readHud, readKillFeed, readScoreHud, prepareHud, NAME_TAG_EM, NAME_TAG_PAD_X, NAME_TAG_PAD_Y } from '../model/hud3d_logic'
import { SHIELD_CHASE_INK, SHIELD_CHASE_URL, SHIELD_QUAD_URL, shieldFlash } from '../model/shieldHud'
import { TEAM_EMBLEM_GAP_SHARE, TEAM_EMBLEM_HEIGHT_SHARE, teamEmblemUrl } from '../model/teamEmblem'
import { SHIELD_BAR_H, SHIELD_BAR_W, SHIELD_CENTER, SHIELD_QUAD_H, SHIELD_QUAD_W, SHIELD_QUAD_CENTER, SHIELD_QUAD_HALF, SHIELD_QUAD_CHASE_H, SHIELD_QUAD_CHASE_Y, SHIELD_QUAD_SHAPE_GAIN, SHIELD_QUAD_HEX_OPACITY, SHIELD_QUAD_FILL_OPACITY } from '../ui/shieldBarGeometry'
import type { ReplayKill } from '../model/killFeedLogic'
import { displayClockMs, type ReplayWindowBounds } from '../model/replayWindow'
import { weaponFullIcon } from '../model/weaponFullIcon'
import { tintedIconCanvas } from '../layers/replayDraw'
import { REPLAY_TEXT } from '../i18n/i18n'
import { catalogText } from '../i18n/catalogLabel'
import type { FilmAllegiance } from '@/lib/replay/filmAllegiance'
import { adsAmmoText } from '../model/adsOverlay'
import { aimHudAt, heldModelKey, RETICLE_DOT_R, RETICLE_KILL_STROKE, RETICLE_STROKE, reticleBoxPx, reticleGeometry, type ReticleGeometry, type Segment } from '../model/aimHud'
import { buildLivesByXuid } from '../model/livesPosition'
import { CALLOUT_LABEL, calloutName, calloutOfLivesAt, type PreparedCallouts } from '../model/mapCallouts'
import type { HeldWeapon } from '../scene3d/redReticle3d'
import { DAMAGE_ARC_URL, paintDamageArcs } from '../ui/damageArcPaint'
import { paintScoreMeter, readScoreMeterMask, SCORE_METER_URL, type ScoreMeterMask } from '../ui/scoreMeter'
import { tintedChase } from '../ui/shieldChaseArt'
import { ensureHudFonts, HUD_FONT_FAMILY, HUD_SCORE_FONT_FAMILY } from '../ui/hudFonts'
import { adsOverlaysOfDoc, createAdsOverlayAtlas, paintAdsAmmo, type SvgImageLoader } from './adsOverlayRaster'

/** `color-mix(in srgb, color, #000 65%)` in hex: darken `hex` toward black by `amount` (0..1). */
function mixSrgb(hex: string, amount: number): string {
  const h = hex.replace(/^#/, '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(full.slice(0, 2), 16), g = parseInt(full.slice(2, 4), 16), b = parseInt(full.slice(4, 6), 16)
  const mix = (c: number) => Math.round(c * amount)
  return `#${[mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** What the export HUD draws beyond the followed player's own state. */
export interface ExportHudOptions {
  /**
   * First person (`hudLevel` 'full'): the aim, i.e. the hip reticle and the ADS overlays. Third
   * person draws the rest of the HUD without it, as the screen does.
   */
  aim?: boolean
  /** The map's named areas the view already loaded: the place label, bottom left. */
  callouts?: PreparedCallouts | null
  /** The scene's red-reticle test at the frame just rendered (`ReplayScene3d.redReticle`). */
  redReticle?: (frame: number, allegiance: Pick<FilmAllegiance, 'ofXuid'>, held: HeldWeapon | null) => boolean
  /** The file's pixel size, the ADS overlays' raster size (defaults to 1920x1080). */
  frameSize?: { width: number; height: number }
  /** Loads a rasterized ADS overlay (tests inject one). */
  loadSvg?: SvgImageLoader
}

export async function createExportHud(doc: ReplayDocumentReady, xuid: string, kills: readonly ReplayKill[], playWindow: ReplayWindowBounds | null, timeLimitMs: number | null, locale: ReplayLocale, options: ExportHudOptions = {}) {
  const source = prepareHud(doc, xuid, kills)
  const names = new Map(doc.roster.map((p) => [p.xuid, p.name || p.xuid]))
  const lives = buildLivesByXuid(doc.tracks)
  const white = '#eaf2f5'
  const weaponInk = resolveToken('replay-hud-weapon')
  const aimOn = options.aim === true
  const atlas = aimOn
    ? await createAdsOverlayAtlas(adsOverlaysOfDoc(doc), options.frameSize ?? { width: 1920, height: 1080 }, { hostile: !!options.redReticle, load: options.loadSvg })
    : null
  const urls = new Set<string>()
  for (const label of Object.values(doc.weaponLabels ?? {})) if (label.img) urls.add(weaponFullIcon(label.img).url)
  for (const label of Object.values(doc.grenadeLabels ?? {})) if (label.img) urls.add(label.img)
  for (const label of Object.values(doc.abilityLabels ?? {})) if (label.img) urls.add(label.img)
  for (const kill of kills) if (kill.weaponImageUrl) urls.add(weaponFullIcon(kill.weaponImageUrl).url)
  // The game's shield bar quad, awaited with the icons so the first exported frame has it: the
  // bar masks to the quad's alpha whenever the player's life carries shield samples (damage
  // events are not involved, so this is not gated on them, as the chase bitmap below is).
  urls.add(SHIELD_QUAD_URL)
  // The game's score meter bitmap, awaited with the icons so the first exported frame fills the
  // score bars with it: the bars show whenever the document has a score timeline, damage events
  // or not, so it preloads with every build (as the quad does).
  urls.add(SCORE_METER_URL)
  // The game's team emblems (the score bars' outer ends): one per camp the document's score
  // timeline names, so a document without a score layer preloads none.
  for (const team of doc.scoreTimeline?.teams ?? []) {
    const emblem = teamEmblemUrl(team.teamId)
    if (emblem) urls.add(emblem)
  }
  // The game's damage-arc bitmap, awaited with the icons so the first exported frame has it
  // (only when the match has damage events: without them no arc is ever drawn).
  if (doc.damages?.length) {
    urls.add(DAMAGE_ARC_URL)
    // The game's chase-band bitmap too: the band only ever shows right after a hit.
    urls.add(SHIELD_CHASE_URL)
  }
  const images = new Map<string, HTMLImageElement>()
  // The game's HUD faces, loaded before the first frame (a canvas draws with whatever face is
  // loaded at paint time, so a late font would change the text mid-video).
  const fontsReady = ensureHudFonts()
  await Promise.all([fontsReady, ...[...urls].map((url) => new Promise<void>((resolve) => {
    const img = new Image()
    img.onload = () => { images.set(url, img); resolve() }
    img.onerror = () => resolve()
    img.src = url
  }))])
  // The shield quad's two masks, built once from its alpha: `solid` (the alpha times
  // SHIELD_QUAD_SHAPE_GAIN, the bar's shape) and `hex` (the raw alpha in white, the hex pattern).
  // Where a canvas cannot be read (a headless test), both fall back to the bitmap itself.
  let quadMaskCache: { solid: CanvasImageSource; hex: CanvasImageSource } | null = null
  function quadMasks(img: HTMLImageElement): { solid: CanvasImageSource; hex: CanvasImageSource } {
    if (quadMaskCache) return quadMaskCache
    quadMaskCache = { solid: img, hex: img }
    try {
      const w = SHIELD_QUAD_W, h = SHIELD_QUAD_H
      const make = (scale: number): HTMLCanvasElement | null => {
        const c = document.createElement('canvas'); c.width = w; c.height = h
        const cx2 = c.getContext('2d')
        if (!cx2) return null
        cx2.drawImage(img, 0, 0, w, h)
        const data = cx2.getImageData(0, 0, w, h)
        const px = data.data
        for (let i = 0; i < px.length; i += 4) { px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = Math.min(255, px[i + 3] * scale) }
        cx2.putImageData(data, 0, 0)
        return c
      }
      const solid = make(SHIELD_QUAD_SHAPE_GAIN), hex = make(1)
      if (solid && hex) quadMaskCache = { solid, hex }
    } catch { /* keep the bitmap fallback */ }
    return quadMaskCache
  }
  const painted = new Map<string, HTMLCanvasElement>()
  // The score meter's mask, read once from the preloaded bitmap: the bars fill with it whenever
  // it is loaded, and fall back to the flat fill when it is not.
  const meterImage = images.get(SCORE_METER_URL)
  const meterMask: ScoreMeterMask | null = meterImage ? readScoreMeterMask(meterImage) : null
  function icon(ctx: CanvasRenderingContext2D, url: string | undefined, color: string, tinted: boolean, mirror: boolean, x: number, y: number, w: number, h: number): boolean {
    const img = url ? images.get(url) : undefined
    if (!img || !url) return false
    const key = `${url}|${color}|${tinted}|${mirror}`
    let canvas = painted.get(key)
    if (!canvas) { canvas = tintedIconCanvas(img, color, { tinted, mirrored: mirror }); painted.set(key, canvas) }
    const scale = Math.min(w / canvas.width, h / canvas.height)
    const width = canvas.width * scale, height = canvas.height * scale
    ctx.drawImage(canvas, x + (w - width) / 2, y + (h - height) / 2, width, height)
    return true
  }
  return (ctx: CanvasRenderingContext2D, view: { width: number; height: number }, frame: number) => {
    // LIVE READ AT PAINT TIME: the team colors are a user preference that can change after the
    // HUD was built; resolving them here (not once above) keeps the export on the current colors.
    const ally = resolveToken('team-ally')
    const enemy = resolveToken('team-enemy')
    const { width: w, height: h } = view
    const size = Math.max(19, Math.min(39, 7.7 + h * 0.0287))
    const ath = readHud(source, frame, locale)
    const score = readScoreHud(source, frame)
    ctx.save()
    ctx.fillStyle = white
    ctx.strokeStyle = white
    ctx.lineWidth = 1.5
    ctx.font = `700 ${size}px ${HUD_FONT_FAMILY}`
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0,0,0,.8)'
    ctx.shadowBlur = 3
    if (score) {
      const left = score.allyOnLeft ? score.ally : score.enemy
      const right = score.allyOnLeft ? score.enemy : score.ally
      const colors = score.allyOnLeft ? [ally, enemy] : [enemy, ally]
      const y = h * 0.94 - size * 0.7
      const bar = size * 4.2
      ctx.font = `600 ${size * 0.65}px ${HUD_SCORE_FONT_FAMILY}`
      ctx.textAlign = 'center'
      ctx.fillText(formatClock(hudClock(timeLimitMs, displayClockMs(frameToMs(frame, doc), playWindow))), w / 2, y)
      for (const [index, side] of [left, right].entries()) {
        const x = index === 0 ? w / 2 - size * 1.6 - bar : w / 2 + size * 1.6
        ctx.fillStyle = 'rgba(0,0,0,.8)'; ctx.fillRect(x, y - size * 0.4, bar, size * 0.8)
        const fraction = Math.max(0, Math.min(1, side.fill))
        ctx.globalAlpha = 0.7
        if (meterMask) {
          // The game's meter bitmap fills the bar's box (the right side is the mirrored bitmap):
          // the fill grows from the high-G end, so both bars fill from the center.
          paintScoreMeter(ctx, meterMask, x, y - size * 0.4, bar, size * 0.8, fraction, colors[index], index === 1)
        } else {
          ctx.fillStyle = colors[index]
          const fill = bar * fraction
          ctx.fillRect(index === 0 ? x + bar - fill : x, y - size * 0.4, fill, size * 0.8)
        }
        ctx.globalAlpha = 1; ctx.fillStyle = white; ctx.textAlign = index === 0 ? 'right' : 'left'; ctx.fillText(String(side.score), index === 0 ? x + bar - 5 : x + 5, y)
        // The game's team emblem at the bar's OUTER end (cusc 21a7dab4): 1.55 x the bar's
        // height (`size * 0.8` here), a gap of 0.27 x the bar's height beyond the end,
        // centered on the bar, untinted at opacity 0.7. A set built before the emblems
        // preloaded no image, and nothing is drawn then.
        const emblemUrl = teamEmblemUrl(side.teamId)
        const emblem = emblemUrl ? images.get(emblemUrl) : undefined
        if (emblem) {
          const emblemSize = size * 0.8 * TEAM_EMBLEM_HEIGHT_SHARE
          const gap = size * 0.8 * TEAM_EMBLEM_GAP_SHARE
          ctx.globalAlpha = 0.7
          ctx.drawImage(emblem, index === 0 ? x - gap - emblemSize : x + bar + gap, y - emblemSize / 2, emblemSize, emblemSize)
          ctx.globalAlpha = 1
        }
      }
    }
    if (ath) {
      if (ath.shieldState) {
        // The shield bar, the same bar as `ShieldBar3d`: when the game's own quad bitmap is
        // loaded, the bar is painted in the quad's 940x80 unit box and masked to the quad's
        // alpha; before that it is the hand-made bar in its 1000x74 unit box. Both are scaled
        // and centered where the export already put the old bar.
        const bw = Math.min(h * 0.5, w * 0.9)
        const ox = (w - bw) / 2, oy = h * 0.08
        const state = ath.shieldState.state
        const low = state === 'low'
        const alert = low || state === 'broken'
        const flash = shieldFlash(frameToMs(ath.shieldState.since, doc), frameToMs(frame, doc))
        const alertInk = resolveToken('replay-hud-shield-alert')
        const mainInk = low ? alertInk : resolveToken('replay-hud-shield')
        const deepInk = low ? mixSrgb(alertInk, 0.65) : resolveToken('replay-hud-shield-deep')
        const trackInk = resolveToken('replay-hud-shield-track')
        const rimInk = resolveToken('replay-hud-shield-rim')
        const quadBitmap = images.get(SHIELD_QUAD_URL)
        if (quadBitmap) {
          // QUAD MODE: the game's own 940x80 bitmap, the same layers as `ShieldBar3d`'s quad
          // mode, composed on an offscreen canvas at the bar's pixel size and masked to the
          // quad's alpha (a canvas has no SVG-style mask; `destination-in` keeps only the
          // quad's opaque pixels).
          const bh = bw * SHIELD_QUAD_H / SHIELD_QUAD_W
          const pixelW = Math.max(1, Math.round(bw)), pixelH = Math.max(1, Math.round(bh))
          const off = document.createElement('canvas')
          off.width = pixelW; off.height = pixelH
          const octx = off.getContext('2d')
          if (octx) {
            const u = pixelW / SHIELD_QUAD_W
            // The bar's glass: the track fill over the whole box (the shape comes from the mask).
            octx.fillStyle = trackInk; octx.fillRect(0, 0, pixelW, pixelH)
            if (state === 'broken') { octx.fillStyle = alertInk; octx.globalAlpha = 0.18 * flash; octx.fillRect(0, 0, pixelW, pixelH); octx.globalAlpha = 1 }
            const half = SHIELD_QUAD_HALF * Math.max(0, Math.min(1, ath.shieldState.fraction))
            if (half > 0) {
              // The fill: the center band, clipped to the fill's x range, bright at the center.
              const grad = octx.createLinearGradient(0, 0, pixelW, 0)
              grad.addColorStop(0, deepInk); grad.addColorStop(0.5, mainInk); grad.addColorStop(1, deepInk)
              octx.save()
              octx.beginPath(); octx.rect((SHIELD_QUAD_CENTER - half) * u, 0, 2 * half * u, pixelH); octx.clip()
              octx.globalAlpha = low ? 0.45 + 0.45 * flash : SHIELD_QUAD_FILL_OPACITY
              octx.fillStyle = grad; octx.fillRect(0, 0, pixelW, pixelH)
              // The quad's hex pattern and outline, light over the fill (its raw alpha, in white).
              octx.globalAlpha = SHIELD_QUAD_HEX_OPACITY
              octx.drawImage(quadMasks(quadBitmap).hex, 0, 0, pixelW, pixelH)
              octx.restore()
              // `recharging`: the fill's growing edges, marked with the rim color, as ShieldBar3d.
              if (state === 'recharging' && half < SHIELD_QUAD_HALF) {
                octx.save()
                octx.globalAlpha = 0.9; octx.strokeStyle = rimInk; octx.lineWidth = 2
                octx.beginPath()
                octx.moveTo((SHIELD_QUAD_CENTER - half) * u, 0); octx.lineTo((SHIELD_QUAD_CENTER - half) * u, pixelH)
                octx.moveTo((SHIELD_QUAD_CENTER + half) * u, 0); octx.lineTo((SHIELD_QUAD_CENTER + half) * u, pixelH)
                octx.stroke()
                octx.restore()
              }
            }
            // The chase band: the shield just lost, from the live fill out to the lagging chase
            // (`shieldHud.chase`), additive over the fill, the game's `shield_chase` quad at its
            // own size in the 80-tall quad. Outside the fill's branch: a hit that empties the
            // shield (fill 0) still shows the band it took off.
            const chaseHalf = SHIELD_QUAD_HALF * Math.max(0, Math.min(1, ath.shieldState.chase))
            if (chaseHalf > half) {
              octx.save()
              octx.globalCompositeOperation = 'lighter'
              octx.beginPath()
              octx.rect((SHIELD_QUAD_CENTER - chaseHalf) * u, 0, (chaseHalf - half) * u, pixelH)
              octx.rect((SHIELD_QUAD_CENTER + half) * u, 0, (chaseHalf - half) * u, pixelH)
              octx.clip()
              const chaseBitmap = images.get(SHIELD_CHASE_URL)
              if (chaseBitmap) {
                octx.drawImage(tintedChase(chaseBitmap), 0, SHIELD_QUAD_CHASE_Y * u, pixelW, SHIELD_QUAD_CHASE_H * u)
              } else {
                // The bitmap not loaded: the flat tinted band it replaces.
                octx.fillStyle = SHIELD_CHASE_INK
                octx.fillRect((SHIELD_QUAD_CENTER - chaseHalf) * u, 0, (chaseHalf - half) * u, pixelH)
                octx.fillRect((SHIELD_QUAD_CENTER + half) * u, 0, (chaseHalf - half) * u, pixelH)
              }
              octx.restore()
            }
            // The bar's shape: the quad's alpha times the gain (`quadMasks`), over the whole box.
            octx.globalCompositeOperation = 'destination-in'
            octx.drawImage(quadMasks(quadBitmap).solid, 0, 0, pixelW, pixelH)
            octx.globalCompositeOperation = 'source-over'
            ctx.drawImage(off, ox, oy, bw, bh)
          }
        } else {
          // LEGACY: the hand-made glass bar as `ShieldBar3d` draws it before the quad loads.
          const bh = bw * SHIELD_BAR_H / SHIELD_BAR_W
          const s = bw / SHIELD_BAR_W
          const pulse = alert ? 0.35 + 0.65 * flash : 1
          const half = SHIELD_CENTER * Math.max(0, Math.min(1, ath.shieldState.fraction))
          const toX = (u: number) => ox + u * s
          const toY = (v: number) => oy + v * s
          // The bar's glass: track fill under the bar outline.
          const barPath = () => {
            ctx.beginPath()
            ctx.moveTo(toX(20), toY(6)); ctx.quadraticCurveTo(toX(500), toY(34), toX(980), toY(6))
            ctx.lineTo(toX(1000), toY(40)); ctx.lineTo(toX(988), toY(56))
            ctx.quadraticCurveTo(toX(500), toY(86), toX(12), toY(56))
            ctx.lineTo(toX(0), toY(40)); ctx.closePath()
          }
          barPath()
          ctx.fillStyle = trackInk; ctx.fill()
          if (state === 'broken') { ctx.fillStyle = alertInk; ctx.globalAlpha = 0.18 * flash; ctx.fill(); ctx.globalAlpha = 1 }
          if (half > 0) {
            // The fill: the center band, clipped to the bar, with the gradient bright at the center.
            const grad = ctx.createLinearGradient(toX(0), 0, toX(1000), 0)
            grad.addColorStop(0, deepInk); grad.addColorStop(0.5, mainInk); grad.addColorStop(1, deepInk)
            ctx.save()
            ctx.clip()
            ctx.globalAlpha = low ? 0.45 + 0.45 * flash : 0.82
            ctx.fillStyle = grad
            ctx.fillRect(toX(SHIELD_CENTER - half), oy, 2 * half * s, bh)
            ctx.globalAlpha = 1
            // The glass light: a gloss line under the top edge and two faint streaks.
            ctx.beginPath()
            ctx.moveTo(toX(24), toY(11)); ctx.quadraticCurveTo(toX(500), toY(39), toX(976), toY(11))
            ctx.strokeStyle = '#fff'; ctx.globalAlpha = 0.45; ctx.lineWidth = 6 * s; ctx.stroke()
            ctx.globalAlpha = 0.1; ctx.lineWidth = 3 * s
            ctx.beginPath()
            ctx.moveTo(toX(0), toY(30)); ctx.quadraticCurveTo(toX(500), toY(58), toX(1000), toY(30))
            ctx.moveTo(toX(0), toY(44)); ctx.quadraticCurveTo(toX(500), toY(72), toX(1000), toY(44))
            ctx.stroke()
            ctx.globalAlpha = 1
            // `recharging`: the fill's growing edges, marked with the rim color.
            if (state === 'recharging' && half < SHIELD_CENTER) {
              ctx.globalAlpha = 0.9
              ctx.strokeStyle = rimInk; ctx.lineWidth = 2
              ctx.beginPath(); ctx.moveTo(toX(SHIELD_CENTER - half), toY(0)); ctx.lineTo(toX(SHIELD_CENTER - half), toY(SHIELD_BAR_H))
              ctx.moveTo(toX(SHIELD_CENTER + half), toY(0)); ctx.lineTo(toX(SHIELD_CENTER + half), toY(SHIELD_BAR_H))
              ctx.stroke()
              ctx.globalAlpha = 1
            }
            ctx.restore()
          }
          // The chase band: the shield just lost, from the live fill out to the lagging chase
          // (`shieldHud.chase`), additive over the fill, the game's `shield_chase` quad. Outside the
          // fill's branch: a hit that empties the shield (fill 0) still shows the band it took off.
          const chaseHalf = SHIELD_CENTER * Math.max(0, Math.min(1, ath.shieldState.chase))
          if (chaseHalf > half) {
            ctx.save()
            barPath()
            ctx.clip()
            ctx.globalCompositeOperation = 'lighter'
            const chaseBitmap = images.get(SHIELD_CHASE_URL)
            if (chaseBitmap) {
              // The game's bitmap stretched to the bar's box, revealed by clipping to the band's
              // two x ranges: INFERRED the clip equals the game's B-threshold reveal (the ramp is
              // linear in x, 128 at the center) to within a few pixels.
              ctx.beginPath()
              ctx.rect(toX(SHIELD_CENTER - chaseHalf), oy, (chaseHalf - half) * s, bh)
              ctx.rect(toX(SHIELD_CENTER + half), oy, (chaseHalf - half) * s, bh)
              ctx.clip()
              ctx.drawImage(tintedChase(chaseBitmap), ox, oy, bw, bh)
            } else {
              // The bitmap not loaded: the flat tinted band it replaces.
              ctx.fillStyle = SHIELD_CHASE_INK
              ctx.fillRect(toX(SHIELD_CENTER - chaseHalf), oy, (chaseHalf - half) * s, bh)
              ctx.fillRect(toX(SHIELD_CENTER + half), oy, (chaseHalf - half) * s, bh)
            }
            ctx.restore()
          }
          // The rim: the bar outline, pale blue at rest, pulsing red when low or broken.
          ctx.beginPath()
          ctx.moveTo(toX(20), toY(6)); ctx.quadraticCurveTo(toX(500), toY(34), toX(980), toY(6))
          ctx.lineTo(toX(1000), toY(40)); ctx.lineTo(toX(988), toY(56))
          ctx.quadraticCurveTo(toX(500), toY(86), toX(12), toY(56))
          ctx.lineTo(toX(0), toY(40)); ctx.closePath()
          ctx.strokeStyle = alert ? alertInk : rimInk; ctx.lineWidth = 1.25; ctx.lineJoin = 'round'; ctx.globalAlpha = alert ? pulse : 0.9; ctx.stroke()
          ctx.globalAlpha = 1
        }
      }
      // The directional damage ring (`damageArcs`): the game's DamageArc bitmap, the same
      // layer as the live HUD (under the reticle, over the rest of the HUD).
      if (ath.shieldState) paintDamageArcs(ctx, ath.damageArcs ?? [], { x: w / 2, y: h / 2 }, h, images.get(DAMAGE_ARC_URL))
    }
    paintFeed()
    // THE STACKING OF THE LIVE HUD (`ReplayHud3d`): the kill feed, the score and the shield sit
    // under the ADS overlay (a scope's shade darkens them); the reticle, the place label and the
    // weapon corner sit over it.
    if (aimOn && ath) {
      const aim = aimHudAt(doc, xuid, frame, heldModelKey(ath.weaponId), ath.label?.key, null)
      const onEnemy = !!ath.weaponId && !!options.redReticle?.(frame, source.allegiance, { weaponId: ath.weaponId, zoomLevel: aim.zoom.level })
      if (aim.ads && atlas) {
        const raster = atlas.get(aim.ads, aim.adsLevel, onEnemy)
        if (raster) {
          ctx.save()
          ctx.shadowColor = 'transparent'
          ctx.globalAlpha = aim.zoom.amount
          ctx.drawImage(raster, 0, 0, w, h)
          if (aim.ads.ammo) paintAdsAmmo(ctx, view, aim.ads.design, adsAmmoText(ath.ammo?.mag), resolveToken('display'))
          ctx.restore()
        }
      }
      if (aim.reticleShown) {
        paintReticle(ctx, view, reticleGeometry(ath.shape, ath.elimination, ath.hit), aim.reticleScale, onEnemy ? resolveToken('reticle-hostile') : resolveToken('replay-hud-on-dark'), enemy)
      }
    }
    // The place name under the game's motion tracker (`mapCallouts`), bottom left.
    const place = calloutName(calloutOfLivesAt(options.callouts ?? null, lives.get(xuid), frame), locale)
    if (place) {
      const fontPx = size * CALLOUT_LABEL.em
      ctx.save()
      ctx.globalAlpha = 1
      ctx.fillStyle = resolveToken('replay-hud-on-dark')
      ctx.font = `${CALLOUT_LABEL.weight} ${fontPx}px ${HUD_FONT_FAMILY}`
      ctx.letterSpacing = `${CALLOUT_LABEL.tracking * fontPx}px`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'bottom'
      ctx.fillText(place.toLocaleUpperCase(locale), w * CALLOUT_LABEL.left, h * (1 - CALLOUT_LABEL.bottom))
      ctx.restore()
    }
    if (ath) {
      // THE CORNER LAYOUT OF THE LIVE HUD (`ReplayHud3d`): the upper row, from the right edge
      // leftward = the equipment box, the one grenade box and the away weapon (small, dimmed);
      // the mag | reserve and the in-hand weapon below; the in-hand weapon's name under it, only
      // right after a swap, fading as the game fades it.
      const right = w * 0.97
      // One bordered box of the upper row: an icon (or its name when the image is not loaded),
      // a trailing number; laid out from its right edge leftward, its center line at `cy`.
      // Returns its left edge so the next item sits to its left.
      const box = (right: number, cy: number, text: string, img: string | undefined, tinted: boolean, num: number | null, alpha: number): number => {
        ctx.font = `700 ${size * 0.6}px ${HUD_FONT_FAMILY}`
        const count = num != null ? String(num) : '', countWidth = ctx.measureText(count).width
        const width = size * 0.78, height = size * 0.78
        const hasIcon = !!img && images.has(img)
        const labelWidth = hasIcon ? width : ctx.measureText(text).width
        const boxWidth = countWidth + labelWidth + size * 0.45
        ctx.save(); ctx.globalAlpha = alpha; ctx.textAlign = 'right'
        ctx.fillStyle = 'rgba(0,0,0,.8)'; ctx.fillRect(right - boxWidth, cy - height / 2, boxWidth, height)
        ctx.strokeStyle = weaponInk; ctx.strokeRect(right - boxWidth, cy - height / 2, boxWidth, height)
        ctx.fillStyle = weaponInk; ctx.fillText(count, right - size * 0.12, cy)
        const iconX = right - countWidth - size * 0.15
        if (!icon(ctx, img, weaponInk, tinted, false, iconX - width, cy - height / 2, width, height)) ctx.fillText(text, iconX, cy)
        ctx.restore()
        return right - boxWidth
      }
      // The carried equipment, rightmost: the icon and its uses left, dimmed when spent.
      let left = right
      if (ath.equipment) {
        const label = doc.abilityLabels?.[String(ath.equipment.rank)]
        left = box(left, h * 0.86, catalogText(label, locale) ?? `rank ${ath.equipment.rank}`, label?.img, !!label?.tinted, ath.equipment.uses, ath.equipment.uses === 0 ? 0.45 : 1) - size * 0.3
      }
      // The one grenade box the game draws at a time (`ath.grenade`).
      const grenadeLabel = doc.grenadeLabels?.[ath.grenade.rank]
      left = box(left, h * 0.86, ath.grenade.name, grenadeLabel?.img, !!grenadeLabel?.tinted, ath.grenade.count, 1) - size * 0.3
      // The away weapon: small (60% of the in-hand icon), dimmed, the silhouette the same way
      // the in-hand icon is painted.
      const awayIcon = ath.away?.label?.img ? weaponFullIcon(ath.away.label.img) : null
      if (awayIcon) {
        const awayWidth = size * 1.68, awayHeight = size * 0.66
        ctx.save(); ctx.globalAlpha = 0.5; ctx.textAlign = 'right'
        if (!icon(ctx, awayIcon.url, weaponInk, !!ath.away?.label?.tinted, !awayIcon.mirrored, left - awayWidth, h * 0.86 - awayHeight / 2, awayWidth, awayHeight)) ctx.fillText(catalogText(ath.away?.label, locale) ?? '', left - size * 0.2, h * 0.86)
        ctx.restore()
      }
      const weapon = ath.label?.img ? weaponFullIcon(ath.label.img) : null
      const iconWidth = size * 2.8, iconHeight = size * 1.1
      const hasWeapon = weapon && icon(ctx, weapon.url, weaponInk, !!ath.label?.tinted, !weapon.mirrored, w * 0.97 - iconWidth, h * 0.94 - iconHeight, iconWidth, iconHeight)
      ctx.fillStyle = weaponInk
      ctx.textAlign = 'right'; ctx.font = `700 ${size}px ${HUD_FONT_FAMILY}`
      const ammo = [ath.ammo?.mag, ath.ammo?.res].filter((v) => v != null).join(' | ')
      if (ammo) ctx.fillText(ammo, w * 0.97 - (hasWeapon ? iconWidth + size * 0.3 : 0), h * 0.92)
      // The in-hand weapon's name tag, under the in-hand row, right-aligned, fading with the game:
      // a dark translucent plate behind the letters, the whole thing at the tag's opacity.
      if (ath.nameTag) {
        ctx.save(); ctx.globalAlpha = ath.nameTag.opacity
        // The live tag's box (`NAME_TAG_*`): text and padding in ems of the tag's text, the
        // box's right edge flush with the corner, the text right-aligned inside its padding.
        const tagSize = size * NAME_TAG_EM, tagY = h * 0.94 + size * 0.45
        const padX = NAME_TAG_PAD_X * tagSize, boxH = (1 + 2 * NAME_TAG_PAD_Y) * tagSize
        ctx.font = `600 ${tagSize}px ${HUD_FONT_FAMILY}`
        ctx.letterSpacing = `${0.08 * tagSize}px`
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'
        const tagWidth = ctx.measureText(ath.nameTag.text).width
        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        ctx.fillRect(w * 0.97 - tagWidth - 2 * padX, tagY - boxH / 2, tagWidth + 2 * padX, boxH)
        ctx.fillStyle = white
        ctx.fillText(ath.nameTag.text, w * 0.97 - padX, tagY)
        ctx.restore()
      }
    }
    ctx.restore()

    /** The kill feed, left, above the place label; leaves the alpha at 1. */
    function paintFeed() {
      ctx.fillStyle = white; ctx.font = `600 ${size * 0.48}px ${HUD_FONT_FAMILY}`; ctx.textAlign = 'left'
      const feed = readKillFeed(source, frame)
      feed.forEach(({ kill, opacity, mine, killer: killerSide, victim: victimSide }, i) => {
        ctx.globalAlpha = opacity
        const y = h * 0.78 - (feed.length - i) * size * 0.62
        if (mine) {
          // The followed player's own kill: a light wash of his team color behind the row.
          const rowWidth = ctx.measureText(names.get(kill.xuid) ?? kill.xuid).width + ctx.measureText(kill.victimGamertag ?? names.get(kill.victimXuid) ?? '').width + size * 1.6
          ctx.save(); ctx.globalAlpha = opacity * 0.3; ctx.fillStyle = ally
          ctx.fillRect(w * 0.03 - size * 0.2, y - size * 0.3, rowWidth + size * 0.4, size * 0.6); ctx.restore()
        }
        const color = killerSide === true ? ally : killerSide === false ? enemy : white
        const killerName = names.get(kill.xuid) ?? kill.xuid
        let x = w * 0.03
        ctx.fillStyle = color; ctx.fillText(killerName, x, y); x += ctx.measureText(killerName).width + size * 0.2
        const width = size * 0.96, height = size * 0.48
        // The game's kill feed draws the FULL weapon pointing at the victim: the silhouette,
        // mirrored (the atlases point left).
        const feedIcon = kill.weaponImageUrl ? weaponFullIcon(kill.weaponImageUrl) : null
        if (feedIcon && icon(ctx, feedIcon.url, color, !!kill.weaponTinted, feedIcon.mirrored, x, y - height / 2, width, height)) x += width + size * 0.2
        else {
          const label = (kill.weaponLabel || REPLAY_TEXT[locale].killFeedUnknownWeapon).split(/\s*\/\s*/)[0]
          ctx.fillText(label, x, y); x += ctx.measureText(label).width + size * 0.2
        }
        ctx.fillStyle = victimSide === true ? ally : victimSide === false ? enemy : white
        ctx.fillText(kill.victimGamertag ?? names.get(kill.victimXuid) ?? '', x, y)
      })
      ctx.globalAlpha = 1
    }
  }
}

/**
 * paintReticle draws the hip reticle (`aimHud.reticleGeometry`) the way the live SVG does: its
 * 100-unit box centered on the view, `reticleBoxPx` wide, scaled by `scale`, lines in `color`, a
 * kill's hit marker in the enemy color and heavier.
 */
export function paintReticle(ctx: CanvasRenderingContext2D, view: { width: number; height: number }, geometry: ReticleGeometry, scale: number, color: string, enemyInk: string): void {
  const k = (reticleBoxPx(view.height) * scale) / 100
  const cx = view.width / 2, cy = view.height / 2
  const at = (u: number, c: number) => c + (u - 50) * k
  const strokeSegments = (segments: readonly Segment[]) => {
    ctx.beginPath()
    for (const [x1, y1, x2, y2] of segments) { ctx.moveTo(at(x1, cx), at(y1, cy)); ctx.lineTo(at(x2, cx), at(y2, cy)) }
    ctx.stroke()
  }
  ctx.save()
  ctx.shadowColor = 'transparent'
  ctx.globalAlpha = 1
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = RETICLE_STROKE * k
  if (geometry.ring !== null) { ctx.beginPath(); ctx.arc(cx, cy, geometry.ring * k, 0, Math.PI * 2); ctx.stroke() }
  if (geometry.dot) { ctx.beginPath(); ctx.arc(cx, cy, RETICLE_DOT_R * k, 0, Math.PI * 2); ctx.fill() }
  if (geometry.ticks.length > 0) strokeSegments(geometry.ticks)
  if (geometry.hit) {
    ctx.globalAlpha = geometry.hit.opacity
    ctx.strokeStyle = geometry.hit.kill ? enemyInk : color
    ctx.lineWidth = (geometry.hit.kill ? RETICLE_KILL_STROKE : RETICLE_STROKE) * k
    strokeSegments(geometry.hit.segments)
  }
  ctx.restore()
}
