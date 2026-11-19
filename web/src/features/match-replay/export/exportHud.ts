// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { resolveToken } from '@/lib/accessibility/resolveToken'
import { formatClock, frameToMs } from '@/lib/replay/replayLogic'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import type { ReplayLocale } from '../i18n/i18n'
import { hudClock, readHud, readKillFeed, readScoreHud, prepareHud } from '../model/hud3d_logic'
import { shieldFlash } from '../model/shieldHud'
import { SHIELD_BAR_H, SHIELD_BAR_W, SHIELD_CENTER } from '../ui/shieldBarGeometry'
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
  // The game's damage-arc bitmap, awaited with the icons so the first exported frame has it
  // (only when the match has damage events: without them no arc is ever drawn).
  if (doc.damages?.length) urls.add(DAMAGE_ARC_URL)
  const images = new Map<string, HTMLImageElement>()
  await Promise.all([...urls].map((url) => new Promise<void>((resolve) => {
    const img = new Image()
    img.onload = () => { images.set(url, img); resolve() }
    img.onerror = () => resolve()
    img.src = url
  })))
  const painted = new Map<string, HTMLCanvasElement>()
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
    ctx.font = `700 ${size}px system-ui`
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0,0,0,.8)'
    ctx.shadowBlur = 3
    if (score) {
      const left = score.allyOnLeft ? score.ally : score.enemy
      const right = score.allyOnLeft ? score.enemy : score.ally
      const colors = score.allyOnLeft ? [ally, enemy] : [enemy, ally]
      const y = h * 0.94 - size * 0.7
      const bar = size * 4.2
      ctx.font = `700 ${size * 0.65}px system-ui`
      ctx.textAlign = 'center'
      ctx.fillText(formatClock(hudClock(timeLimitMs, displayClockMs(frameToMs(frame, doc), playWindow))), w / 2, y)
      for (const [index, side] of [left, right].entries()) {
        const x = index === 0 ? w / 2 - size * 1.6 - bar : w / 2 + size * 1.6
        ctx.fillStyle = 'rgba(0,0,0,.8)'; ctx.fillRect(x, y - size * 0.4, bar, size * 0.8)
        ctx.globalAlpha = 0.7; ctx.fillStyle = colors[index]; const fill = bar * Math.max(0, Math.min(1, side.fill)); ctx.fillRect(index === 0 ? x + bar - fill : x, y - size * 0.4, fill, size * 0.8)
        ctx.globalAlpha = 1; ctx.fillStyle = white; ctx.textAlign = index === 0 ? 'right' : 'left'; ctx.fillText(String(side.score), index === 0 ? x + bar - 5 : x + 5, y)
      }
    }
    if (ath) {
      if (ath.shieldState) {
        // The shield bar, the same glass bar as `ShieldBar3d`: drawn in its 1000x74 unit box,
        // scaled and centered where the export already put the old bar.
        const bw = Math.min(h * 0.5, w * 0.9), bh = bw * SHIELD_BAR_H / SHIELD_BAR_W
        const ox = (w - bw) / 2, oy = h * 0.08
        const s = bw / SHIELD_BAR_W
        const state = ath.shieldState.state
        const low = state === 'low'
        const alert = low || state === 'broken'
        const flash = shieldFlash(frameToMs(ath.shieldState.since, doc), frameToMs(frame, doc))
        const pulse = alert ? 0.35 + 0.65 * flash : 1
        const alertInk = resolveToken('replay-hud-shield-alert')
        const mainInk = low ? alertInk : resolveToken('replay-hud-shield')
        const deepInk = low ? mixSrgb(alertInk, 0.65) : resolveToken('replay-hud-shield-deep')
        const trackInk = resolveToken('replay-hud-shield-track')
        const rimInk = resolveToken('replay-hud-shield-rim')
        const half = SHIELD_CENTER * Math.max(0, Math.min(1, ath.shieldState.fraction))
        const toX = (u: number) => ox + u * s
        const toY = (v: number) => oy + v * s
        // The bar's glass: track fill under the bar outline.
        ctx.beginPath()
        ctx.moveTo(toX(20), toY(6)); ctx.quadraticCurveTo(toX(500), toY(34), toX(980), toY(6))
        ctx.lineTo(toX(1000), toY(40)); ctx.lineTo(toX(988), toY(56))
        ctx.quadraticCurveTo(toX(500), toY(86), toX(12), toY(56))
        ctx.lineTo(toX(0), toY(40)); ctx.closePath()
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
        // The rim: the bar outline, pale blue at rest, pulsing red when low or broken.
        ctx.beginPath()
        ctx.moveTo(toX(20), toY(6)); ctx.quadraticCurveTo(toX(500), toY(34), toX(980), toY(6))
        ctx.lineTo(toX(1000), toY(40)); ctx.lineTo(toX(988), toY(56))
        ctx.quadraticCurveTo(toX(500), toY(86), toX(12), toY(56))
        ctx.lineTo(toX(0), toY(40)); ctx.closePath()
        ctx.strokeStyle = alert ? alertInk : rimInk; ctx.lineWidth = 1.25; ctx.lineJoin = 'round'; ctx.globalAlpha = alert ? pulse : 0.9; ctx.stroke()
        ctx.globalAlpha = 1
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
      ctx.font = `${CALLOUT_LABEL.weight} ${fontPx}px system-ui`
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
        ctx.font = `700 ${size * 0.6}px system-ui`
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
      const grenadeLabel = ath.grenade.rank != null ? doc.grenadeLabels?.[ath.grenade.rank] : undefined
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
      ctx.textAlign = 'right'; ctx.font = `700 ${size}px system-ui`
      const ammo = [ath.ammo?.mag, ath.ammo?.res].filter((v) => v != null).join(' | ')
      if (ammo) ctx.fillText(ammo, w * 0.97 - (hasWeapon ? iconWidth + size * 0.3 : 0), h * 0.92)
      // The in-hand weapon's name tag, under the in-hand row, right-aligned, fading with the game:
      // a dark translucent plate behind the letters, the whole thing at the tag's opacity.
      if (ath.nameTag) {
        ctx.save(); ctx.globalAlpha = ath.nameTag.opacity
        const tagSize = size * 0.55, tagY = h * 0.94 + size * 0.45
        ctx.font = `600 ${tagSize}px system-ui`
        ctx.letterSpacing = `${0.08 * tagSize}px`
        ctx.textAlign = 'right'
        const tagWidth = ctx.measureText(ath.nameTag.text).width
        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        ctx.fillRect(w * 0.97 - tagWidth - 1.2 * tagSize, tagY - 0.85 * tagSize, tagWidth + 1.2 * tagSize, 1.7 * tagSize)
        ctx.fillStyle = white
        ctx.fillText(ath.nameTag.text, w * 0.97, tagY)
        ctx.restore()
      }
    }
    ctx.restore()

    /** The kill feed, left, above the place label; leaves the alpha at 1. */
    function paintFeed() {
      ctx.fillStyle = white; ctx.font = `600 ${size * 0.48}px system-ui`; ctx.textAlign = 'left'
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
