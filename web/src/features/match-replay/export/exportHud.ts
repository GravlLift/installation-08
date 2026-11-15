import { resolveToken } from '@/lib/accessibility/resolveToken'
import { formatClock, frameToMs } from '@/lib/replay/replayLogic'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import type { ReplayLocale } from '../i18n/i18n'
import { horlogeHud, lireAth, lireFilAth, lireScoreAth, preparerAth } from '../model/ath3d_logic'
import { shieldFlash } from '../model/shieldHud'
import { SHIELD_BAR_H, SHIELD_BAR_W, SHIELD_CENTER } from '../ui/shieldBarGeometry'
import type { ReplayKill } from '../model/killFeedLogic'
import { displayClockMs, type ReplayWindowBounds } from '../model/replayWindow'
import { weaponFullIcon } from '../model/weaponFullIcon'
import { tintedIconCanvas } from '../layers/replayDraw'
import { REPLAY_TEXT } from '../i18n/i18n'

/** `color-mix(in srgb, color, #000 65%)` in hex: darken `hex` toward black by `amount` (0..1). */
function mixSrgb(hex: string, amount: number): string {
  const h = hex.replace(/^#/, '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(full.slice(0, 2), 16), g = parseInt(full.slice(2, 4), 16), b = parseInt(full.slice(4, 6), 16)
  const mix = (c: number) => Math.round(c * amount)
  return `#${[mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

export async function createExportHud(doc: ReplayDocumentReady, xuid: string, kills: readonly ReplayKill[], playWindow: ReplayWindowBounds | null, timeLimitMs: number | null, locale: ReplayLocale) {
  const source = preparerAth(doc, xuid, kills)
  const names = new Map(doc.roster.map((p) => [p.xuid, p.name || p.xuid]))
  const white = '#eaf2f5'
  const weaponInk = resolveToken('replay-hud-weapon')
  const urls = new Set<string>()
  for (const label of Object.values(doc.weaponLabels ?? {})) if (label.img) urls.add(weaponFullIcon(label.img).url)
  for (const label of Object.values(doc.grenadeLabels ?? {})) if (label.img) urls.add(label.img)
  for (const kill of kills) if (kill.weaponImageUrl) urls.add(weaponFullIcon(kill.weaponImageUrl).url)
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
    const ath = lireAth(source, frame, locale)
    const score = lireScoreAth(source, frame)
    ctx.save()
    ctx.fillStyle = white
    ctx.strokeStyle = white
    ctx.lineWidth = 1.5
    ctx.font = `700 ${size}px system-ui`
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0,0,0,.8)'
    ctx.shadowBlur = 3
    if (score) {
      const left = score.allieAGauche ? score.ally : score.enemy
      const right = score.allieAGauche ? score.enemy : score.ally
      const colors = score.allieAGauche ? [ally, enemy] : [enemy, ally]
      const y = h * 0.94 - size * 0.7
      const bar = size * 4.2
      ctx.font = `700 ${size * 0.65}px system-ui`
      ctx.textAlign = 'center'
      ctx.fillText(formatClock(horlogeHud(timeLimitMs, displayClockMs(frameToMs(frame, doc), playWindow))), w / 2, y)
      for (const [index, side] of [left, right].entries()) {
        const x = index === 0 ? w / 2 - size * 1.6 - bar : w / 2 + size * 1.6
        ctx.fillStyle = 'rgba(0,0,0,.8)'; ctx.fillRect(x, y - size * 0.4, bar, size * 0.8)
        ctx.globalAlpha = 0.7; ctx.fillStyle = colors[index]; const fill = bar * Math.max(0, Math.min(1, side.fill)); ctx.fillRect(index === 0 ? x + bar - fill : x, y - size * 0.4, fill, size * 0.8)
        ctx.globalAlpha = 1; ctx.fillStyle = white; ctx.textAlign = index === 0 ? 'right' : 'left'; ctx.fillText(String(side.score), index === 0 ? x + bar - 5 : x + 5, y)
      }
    }
    if (ath) {
      if (ath.bouclierEtat) {
        // The shield bar, the same glass bar as `ShieldBar3d`: drawn in its 1000x74 unit box,
        // scaled and centered where the export already put the old bar.
        const bw = Math.min(h * 0.5, w * 0.9), bh = bw * SHIELD_BAR_H / SHIELD_BAR_W
        const ox = (w - bw) / 2, oy = h * 0.08
        const s = bw / SHIELD_BAR_W
        const state = ath.bouclierEtat.state
        const low = state === 'low'
        const alert = low || state === 'broken'
        const flash = shieldFlash(frameToMs(ath.bouclierEtat.since, doc), frameToMs(frame, doc))
        const pulse = alert ? 0.35 + 0.65 * flash : 1
        const alertInk = resolveToken('replay-hud-shield-alert')
        const mainInk = low ? alertInk : resolveToken('replay-hud-shield')
        const deepInk = low ? mixSrgb(alertInk, 0.65) : resolveToken('replay-hud-shield-deep')
        const trackInk = resolveToken('replay-hud-shield-track')
        const rimInk = resolveToken('replay-hud-shield-rim')
        const half = SHIELD_CENTER * Math.max(0, Math.min(1, ath.bouclierEtat.fraction))
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
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.max(8, h * 0.025), 0, Math.PI * 2); ctx.stroke()
      ctx.beginPath(); ctx.arc(w / 2, h / 2, 1.5, 0, Math.PI * 2); ctx.fill()
      const weapon = ath.etiquette?.img ? weaponFullIcon(ath.etiquette.img) : null
      const iconWidth = size * 2.8, iconHeight = size * 1.1
      const hasWeapon = weapon && icon(ctx, weapon.url, weaponInk, !!ath.etiquette?.tinted, !weapon.mirrored, w * 0.97 - iconWidth, h * 0.94 - iconHeight, iconWidth, iconHeight)
      ctx.fillStyle = weaponInk
      ctx.textAlign = 'right'; ctx.font = `700 ${size}px system-ui`
      const ammo = [ath.munitions?.mag, ath.munitions?.res].filter((v) => v != null).join(' | ')
      if (ammo) ctx.fillText(ammo, w * 0.97 - (hasWeapon ? iconWidth + size * 0.3 : 0), h * 0.92)
      ctx.font = `700 ${size * 0.6}px system-ui`
      let right = w * 0.97
      for (const grenade of [...ath.grenades].reverse()) {
        const label = doc.grenadeLabels?.[grenade.rank]
        const count = String(grenade.count), countWidth = ctx.measureText(count).width
        const width = size * 0.78, height = size * 0.78
        const hasIcon = !!label?.img && images.has(label.img)
        const labelWidth = hasIcon ? width : ctx.measureText(grenade.name).width
        const boxWidth = countWidth + labelWidth + size * 0.45
        ctx.fillStyle = 'rgba(0,0,0,.8)'; ctx.fillRect(right - boxWidth, h * 0.86 - height / 2, boxWidth, height)
        ctx.strokeStyle = weaponInk; ctx.strokeRect(right - boxWidth, h * 0.86 - height / 2, boxWidth, height)
        ctx.fillStyle = weaponInk; ctx.fillText(count, right - size * 0.12, h * 0.86); right -= countWidth + size * 0.15
        if (icon(ctx, label?.img, weaponInk, !!label?.tinted, false, right - width, h * 0.86 - height / 2, width, height)) right -= width
        else { ctx.fillText(grenade.name, right, h * 0.86); right -= ctx.measureText(grenade.name).width }
        right -= size * 0.3
      }
    }
    ctx.fillStyle = white; ctx.font = `600 ${size * 0.48}px system-ui`; ctx.textAlign = 'left'
    const feed = lireFilAth(source, frame)
    feed.forEach(({ kill, opacite, mien, tueur, victime }, i) => {
      ctx.globalAlpha = opacite
      const y = h * 0.78 - (feed.length - i) * size * 0.62
      if (mien) {
        // The followed player's own kill: a light wash of his team color behind the row.
        const rowWidth = ctx.measureText(names.get(kill.xuid) ?? kill.xuid).width + ctx.measureText(kill.victimGamertag ?? names.get(kill.victimXuid) ?? '').width + size * 1.6
        ctx.save(); ctx.globalAlpha = opacite * 0.3; ctx.fillStyle = ally
        ctx.fillRect(w * 0.03 - size * 0.2, y - size * 0.3, rowWidth + size * 0.4, size * 0.6); ctx.restore()
      }
      const color = tueur === true ? ally : tueur === false ? enemy : white
      const killer = names.get(kill.xuid) ?? kill.xuid
      let x = w * 0.03
      ctx.fillStyle = color; ctx.fillText(killer, x, y); x += ctx.measureText(killer).width + size * 0.2
      const width = size * 0.96, height = size * 0.48
      // The game's kill feed draws the FULL weapon pointing at the victim: the silhouette,
      // mirrored (the atlases point left).
      const feedIcon = kill.weaponImageUrl ? weaponFullIcon(kill.weaponImageUrl) : null
      if (feedIcon && icon(ctx, feedIcon.url, color, !!kill.weaponTinted, feedIcon.mirrored, x, y - height / 2, width, height)) x += width + size * 0.2
      else {
        const label = (kill.weaponLabel || REPLAY_TEXT[locale].killFeedUnknownWeapon).split(/\s*\/\s*/)[0]
        ctx.fillText(label, x, y); x += ctx.measureText(label).width + size * 0.2
      }
      ctx.fillStyle = victime === true ? ally : victime === false ? enemy : white
      ctx.fillText(kill.victimGamertag ?? names.get(kill.victimXuid) ?? '', x, y)
    })
    ctx.restore()
  }
}
