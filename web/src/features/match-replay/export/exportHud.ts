import { resolveToken } from '@/lib/accessibility/resolveToken'
import { formatClock, frameToMs } from '@/lib/replay/replayLogic'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import type { ReplayLocale } from '../i18n/i18n'
import { horlogeHud, lireAth, lireFilAth, lireScoreAth, preparerAth } from '../model/ath3d_logic'
import type { ReplayKill } from '../model/killFeedLogic'
import { displayClockMs, type ReplayWindowBounds } from '../model/replayWindow'
import { weaponFullIcon } from '../model/weaponFullIcon'
import { tintedIconCanvas } from '../layers/replayDraw'
import { REPLAY_TEXT } from '../i18n/i18n'

export async function createExportHud(doc: ReplayDocumentReady, xuid: string, kills: readonly ReplayKill[], playWindow: ReplayWindowBounds | null, timeLimitMs: number | null, locale: ReplayLocale) {
  const source = preparerAth(doc, xuid, kills)
  const names = new Map(doc.roster.map((p) => [p.xuid, p.name || p.xuid]))
  const white = '#eaf2f5'
  const weaponInk = resolveToken('replay-hud-weapon')
  const urls = new Set<string>()
  for (const label of Object.values(doc.weaponLabels ?? {})) if (label.img) urls.add(weaponFullIcon(label.img).url)
  for (const label of Object.values(doc.grenadeLabels ?? {})) if (label.img) urls.add(label.img)
  for (const kill of kills) if (kill.weaponImageUrl) urls.add(kill.weaponImageUrl)
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
      if (ath.bouclier !== null) {
        const bar = Math.min(h * 0.5, w * 0.9), x = (w - bar) / 2, y = h * 0.08
        ctx.strokeRect(x, y, bar, Math.max(8, h * 0.032))
        ctx.fillStyle = resolveToken('info'); ctx.fillRect(x, y, bar * Math.max(0, Math.min(1, ath.bouclier)), Math.max(8, h * 0.032)); ctx.fillStyle = white
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
    feed.forEach(({ kill, opacite, tueur, victime }, i) => {
      ctx.globalAlpha = opacite
      const y = h * 0.88 - (feed.length - i) * size * 0.62
      const color = tueur === true ? ally : tueur === false ? enemy : white
      const killer = names.get(kill.xuid) ?? kill.xuid
      let x = w * 0.03
      ctx.fillStyle = color; ctx.fillText(killer, x, y); x += ctx.measureText(killer).width + size * 0.2
      const width = size * 0.96, height = size * 0.48
      if (icon(ctx, kill.weaponImageUrl, color, !!kill.weaponTinted, false, x, y - height / 2, width, height)) x += width + size * 0.2
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
