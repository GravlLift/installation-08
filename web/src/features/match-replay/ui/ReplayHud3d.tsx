// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { WeaponIcon } from '@/components/ui/WeaponIcon'
import { tokenCssVar } from '@/lib/accessibility/semantic-tokens'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import { REPLAY_TEXT, type ReplayLocale } from '../i18n/i18n'
import { catalogText } from '../i18n/catalogLabel'
import type { ReplayKill } from '../model/killFeedLogic'
import { hudClock, readHud, readKillFeed, readKillPopups, readScoreHud, prepareHud } from '../model/hud3d_logic'
import { magsForWeapon } from '../model/scopeLogic'
import { adsAmmoText } from '../model/adsOverlay'
import { aimHudAt, heldModelKey, RETICLE_DOT_R, RETICLE_HEIGHT_SHARE, RETICLE_KILL_STROKE, RETICLE_MIN_PX, RETICLE_STROKE, reticleGeometry, segmentsPath } from '../model/aimHud'
import { displayClockMs, type ReplayWindowBounds } from '../model/replayWindow'
import { ReplayHudFeed3d } from './ReplayHudFeed3d'
import { ReplayHudScope3d } from './ReplayHudScope3d'
import { ReplayKillPopup3d } from './ReplayKillPopup3d'
import { ShieldBar3d } from './ShieldBar3d'
import { DAMAGE_ARC_URL, paintDamageArcs } from './damageArcPaint'
import { shieldFlash } from '../model/shieldHud'
import { frameToMs, formatClock } from '@/lib/replay/replayLogic'
import { MIRROR_STYLE, weaponFullIcon } from '../model/weaponFullIcon'
import type { ReplayScene3d } from '../scene3d/replayScene3d'
import type { HeldWeapon } from '../scene3d/redReticle3d'
import type { HudLevel } from '../model/hudLevel'
import { buildLivesByXuid } from '../model/livesPosition'
import { CALLOUT_LABEL, calloutName, calloutOfLivesAt, type PreparedCallouts } from '../model/mapCallouts'

/** The hip reticle box (`aimHud.reticleBoxPx`, in container units). */
const RETICLE_CSS_SIZE = `max(${RETICLE_MIN_PX}px, ${RETICLE_HEIGHT_SHARE * 100}cqh)`

const HUD_STYLE = { color: tokenCssVar('replay-hud-on-dark'), fontSize: 'clamp(19px, calc(7.7px + 2.87cqh), 39px)', textShadow: '0 1px 2px var(--replay-hud-shadow)' }

/** The game's damage-arc bitmap, loaded once; the canvas layer below paints with it when it is ready. */
const damageArcImage = new Image()
damageArcImage.src = DAMAGE_ARC_URL

/**
 * ScoreBanner — the match score and clock, bottom center: drawn at every HUD level (`hudLevel`),
 * the 2D view's 'score' level keeps it alone.
 */
function ScoreBanner({ locale, frame, doc, playWindow, timeLimitMs, leftSide, rightSide }: { locale: ReplayLocale; frame: number; doc: ReplayDocumentReady; playWindow: ReplayWindowBounds | null; timeLimitMs: number | null; leftSide: { team: 'team-ally' | 'team-enemy'; score: number; part: number }; rightSide: { team: 'team-ally' | 'team-enemy'; score: number; part: number } }) {
  // `data-map-inset`: the 2D view's map fits over it (`topDownView3d.readInsets`).
  return <div role="group" data-map-inset="bottom" aria-label={REPLAY_TEXT[locale].scoreBannerLabel} style={{ position: 'absolute', bottom: '6%', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: '0.6em', fontSize: '0.65em', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}><ScoreBar team={leftSide.team} score={leftSide.score} part={leftSide.part} towardCenter /><span aria-label={REPLAY_TEXT[locale].scoreBannerClock}>{formatClock(hudClock(timeLimitMs, displayClockMs(frameToMs(frame, doc), playWindow)))}</span><ScoreBar team={rightSide.team} score={rightSide.score} part={rightSide.part} /></div>
}

export function ReplayHud3d({ doc, xuid, frameRef, locale, kills, nameOfXuid, playWindow, timeLimitMs, sceneRef, hud = 'full', callouts = null }: { doc: ReplayDocumentReady; xuid: string; frameRef: RefObject<number>; locale: ReplayLocale; kills: readonly ReplayKill[]; nameOfXuid?: (xuid: string) => string | null; playWindow: ReplayWindowBounds | null; timeLimitMs: number | null; sceneRef?: RefObject<ReplayScene3d | null>; hud?: HudLevel; callouts?: PreparedCallouts | null }) {
  const [frame, setFrame] = useState(0)
  const [onEnemy, setOnEnemy] = useState(false)
  // The held weapon and its zoom level, read by the frame loop below (its range decides the red reticle).
  const heldRef = useRef<HeldWeapon | null>(null)
  // The damage-arc canvas: a full-size layer under the reticle, repainted each frame.
  const damageArcCanvasRef = useRef<HTMLCanvasElement | null>(null)
  // Repaint once the bitmap has loaded (a paused frame would otherwise stay without its arcs).
  const [damageArcReady, setDamageArcReady] = useState(() => damageArcImage.complete && damageArcImage.naturalWidth > 0)
  useEffect(() => {
    if (damageArcReady) return
    const onLoad = () => setDamageArcReady(true)
    damageArcImage.addEventListener('load', onLoad)
    return () => damageArcImage.removeEventListener('load', onLoad)
  }, [damageArcReady])
  const source = useMemo(() => prepareHud(doc, xuid, kills), [doc, xuid, kills])
  const lives = useMemo(() => buildLivesByXuid(doc.tracks), [doc])
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const frame = frameRef.current ?? 0
      setFrame(frame)
      setOnEnemy(hud === 'full' && (sceneRef?.current?.redReticle(frame, source.allegiance, heldRef.current) ?? false))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [frameRef, sceneRef, source, hud])
  const ath = readHud(source, frame, locale)
  const fil = readKillFeed(source, frame)
  const popups = readKillPopups(source, frame)
  const score = readScoreHud(source, frame)
  // Dead or not yet spawned (`ath` null), the player keeps the score, clock and feed: only
  // the shield, reticle and weapon corner belong to a life.
  // The game arranges the bars by team id, not by allegiance: the left side carries
  // `towardCenter`, and the color (`team`) stays that of each team's own allegiance.
  const leftSide = score && (score.allyOnLeft
    ? { team: 'team-ally' as const, score: score.ally.score, part: score.ally.fill }
    : { team: 'team-enemy' as const, score: score.enemy.score, part: score.enemy.fill })
  const rightSide = score && (score.allyOnLeft
    ? { team: 'team-enemy' as const, score: score.enemy.score, part: score.enemy.fill }
    : { team: 'team-ally' as const, score: score.ally.score, part: score.ally.fill })
  const weaponKey = heldModelKey(ath?.weaponId)
  // The magnification per level comes from the weapon index (the tag's own values); the hand
  // table gives only the kind and the style. A weapon the index has no zoom for does not zoom.
  const mags = magsForWeapon(weaponKey, sceneRef?.current?.magnifications(weaponKey ?? '') ?? null)
  // The weapon's ADS overlay (`adsOverlay`): drawn from the first frame of the zoom, fading with it;
  // an overlay with its own center reticle replaces the hip reticle past half the fade (`aimHud`,
  // shared with the video export).
  const aimState = aimHudAt(doc, xuid, frame, weaponKey, ath?.label?.key, mags)
  const { zoom, ads } = aimState
  const weaponId = ath?.weaponId ?? null
  useEffect(() => {
    heldRef.current = weaponId ? { weaponId, zoomLevel: zoom.level } : null
  }, [weaponId, zoom.level])
  const reticle = ath ? reticleGeometry(ath.shape, ath.elimination, ath.hit) : null
  // Repaint the damage-arc ring when the frame moves (the arcs derive from it). The canvas is
  // only mounted under the shield bar's condition, so the ref is null otherwise and this no-ops.
  const damageArcs = ath?.damageArcs ?? []
  useEffect(() => {
    const canvas = damageArcCanvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (w === 0 || h === 0) return
    const bw = Math.round(w * dpr)
    const bh = Math.round(h * dpr)
    if (canvas.width !== bw) canvas.width = bw
    if (canvas.height !== bh) canvas.height = bh
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    paintDamageArcs(ctx, damageArcs, { x: w / 2, y: h / 2 }, h, damageArcReady ? damageArcImage : null)
  }, [frame, damageArcs, damageArcReady])
  const icon = ath?.label?.img ? weaponFullIcon(ath.label.img) : null
  // The away weapon (small, dimmed, left of the upper row) and the selected grenade's label
  // (rank null = the selection is indeterminate, the box carries the generic text).
  const away = ath?.away ?? null
  const awayIcon = away?.label?.img ? weaponFullIcon(away.label.img) : null
  const grenadeLabel = ath?.grenade.rank != null ? doc.grenadeLabels?.[ath.grenade.rank] : undefined
  const reticleColor = ath?.weaponId && onEnemy ? tokenCssVar('reticle-hostile') : undefined
  const banner = score && leftSide && rightSide ? <ScoreBanner locale={locale} frame={frame} doc={doc} playWindow={playWindow} timeLimitMs={timeLimitMs} leftSide={leftSide} rightSide={rightSide} /> : null
  // The levels (`hudLevel`): 2D keeps the score strip, free view adds the kill feed, third person
  // is the full HUD without the aim (reticle, scope masks, Bandit frame), first person is all of it.
  if (hud === 'score') return <div className="pointer-events-none absolute inset-0" style={HUD_STYLE}>{banner}</div>
  if (hud === 'spectator') return <div className="pointer-events-none absolute inset-0" style={HUD_STYLE}><ReplayHudFeed3d fil={fil} locale={locale} nameOfXuid={nameOfXuid} />{banner}</div>
  const aim = hud === 'full'
  // The place name under the game's motion tracker (mapCallouts): bottom left, under the kill feed.
  const place = calloutName(calloutOfLivesAt(callouts, lives.get(xuid), frame), locale)
  return <div className="pointer-events-none absolute inset-0" style={HUD_STYLE}>
    <ReplayHudFeed3d fil={fil} locale={locale} nameOfXuid={nameOfXuid} />
    {banner}
    {/* The shield never sits under the player's top strip (its safe inset, `usePlayerChromeInsets`). */}
    {ath?.shieldState && <div style={{ position: 'absolute', top: 'max(8%, calc(var(--bc-chrome-top, 0px) + 6px))', left: '50%', width: 'min(39cqh, 90%)', minWidth: 160, transform: 'translateX(-50%)' }}>
      <ShieldBar3d fraction={ath.shieldState.fraction} state={ath.shieldState.state} flash={shieldFlash(frameToMs(ath.shieldState.since, doc), frameToMs(frame, doc))} chase={ath.shieldState.chase} label={REPLAY_TEXT[locale].shieldLabel} />
    </div>}
    {aim && ath && ads && <ReplayHudScope3d spec={ads} levelIndex={aimState.adsLevel} amount={zoom.amount} reticleColor={reticleColor} ammo={adsAmmoText(ath.ammo?.mag)} />}
    {/* The directional damage ring (damageArcs): a full-size canvas under the reticle, shown
        with the shield bar. */}
    {ath?.shieldState && <canvas ref={damageArcCanvasRef} aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />}
    {aim && reticle && aimState.reticleShown && (
      <svg viewBox="0 0 100 100" aria-hidden="true" style={{ color: reticleColor, position: 'absolute', width: RETICLE_CSS_SIZE, height: RETICLE_CSS_SIZE, left: '50%', top: '50%', transform: `translate(-50%, -50%) scale(${aimState.reticleScale})`, overflow: 'visible' }} fill="none" stroke="currentColor" strokeWidth={RETICLE_STROKE}>
        {reticle.ring !== null && <circle cx="50" cy="50" r={reticle.ring} />}
        {reticle.dot && <circle cx="50" cy="50" r={RETICLE_DOT_R} fill="currentColor" stroke="none" />}
        {reticle.ticks.length > 0 && <path d={segmentsPath(reticle.ticks)} />}
        {reticle.hit && <path d={segmentsPath(reticle.hit.segments)} stroke={reticle.hit.kill ? tokenCssVar('team-enemy') : 'currentColor'} strokeWidth={reticle.hit.kill ? RETICLE_KILL_STROKE : RETICLE_STROKE} opacity={reticle.hit.opacity} />}
      </svg>
    )}
    <ReplayKillPopup3d popups={popups} locale={locale} />
    {place && <div data-hud-callout style={{ position: 'absolute', left: `${CALLOUT_LABEL.left * 100}%`, bottom: `${CALLOUT_LABEL.bottom * 100}%`, fontSize: `${CALLOUT_LABEL.em}em`, fontWeight: CALLOUT_LABEL.weight, letterSpacing: `${CALLOUT_LABEL.tracking}em`, textTransform: 'uppercase', lineHeight: 1 }}>{place}</div>}
    {/* The game's bottom-right corner: the away weapon (small, dimmed), the one grenade box and
        the equipment on the upper row; mag | reserve and the in-hand weapon below; the in-hand
        weapon's name under it, only right after a swap, fading as the game fades it. The name tag
        hangs out of the column's flow (absolute, below the box) so the corner never shifts when
        the tag appears or fades away. */}
    {ath && <div style={{ position: 'absolute', right: '3%', bottom: '6%', display: 'flex', flexDirection: 'column', alignItems: 'end', gap: '0.35em', lineHeight: 1, color: tokenCssVar('replay-hud-weapon') }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25em', fontSize: '0.6em' }}>
        {awayIcon && away && <WeaponIcon imageUrl={awayIcon.url} tinted={away.label?.tinted} label={catalogText(away.label, locale) ?? ''} width="2.8em" height="1.1em" style={awayIcon.mirrored ? { opacity: 0.5 } : { ...MIRROR_STYLE, opacity: 0.5 }} />}
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25em', padding: '0.2em 0.4em', border: '1px solid currentColor', background: 'var(--replay-hud-shadow)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{grenadeLabel?.img ? <WeaponIcon imageUrl={grenadeLabel.img} tinted={grenadeLabel.tinted} label={ath.grenade.name} width="1.3em" height="1.3em" /> : ath.grenade.name}{ath.grenade.count != null && <span>{ath.grenade.count}</span>}</span>
        {ath.equipment && <EquipmentHud3d doc={doc} rank={ath.equipment.rank} uses={ath.equipment.uses} locale={locale} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3em' }}>
        <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{ath.ammo?.mag}</span>
        {ath.ammo?.res != null && <span style={{ fontSize: '0.6em', opacity: 0.75, paddingLeft: '0.5em', borderLeft: '1px solid currentColor', fontVariantNumeric: 'tabular-nums' }}>{ath.ammo.res}</span>}
        {icon && <WeaponIcon imageUrl={icon.url} tinted={ath.label?.tinted} label={catalogText(ath.label, locale) ?? ''} width="2.8em" height="1.1em" style={icon.mirrored ? undefined : MIRROR_STYLE} />}
      </div>
      {ath.nameTag && <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '0.35em', fontSize: '0.55em', fontWeight: 600, letterSpacing: '0.08em', lineHeight: 1, padding: '0.35em 0.6em', background: 'rgba(0, 0, 0, 0.55)', color: '#fff', opacity: ath.nameTag.opacity }}>{ath.nameTag.text}</div>}
    </div>}
  </div>
}

/**
 * The game's equipment slot, rightmost of the upper row (right of the grenade box): the carried
 * equipment's icon and its uses left (`equipmentSlotHud`); spent down to zero uses, the icon dims
 * until the equipment is gone.
 */
function EquipmentHud3d({ doc, rank, uses, locale }: { doc: ReplayDocumentReady; rank: number; uses: number | null; locale: ReplayLocale }) {
  const label = doc.abilityLabels?.[String(rank)]
  const name = catalogText(label, locale) ?? `rank ${rank}`
  return <span role="img" aria-label={uses === null ? name : `${name} ${uses}`} data-hud-equipment={label?.family ?? rank} style={{ display: 'flex', alignItems: 'center', gap: '0.25em', padding: '0.2em 0.4em', border: '1px solid currentColor', background: 'var(--replay-hud-shadow)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', opacity: uses === 0 ? 0.45 : 1 }}>
    {label?.img ? <WeaponIcon imageUrl={label.img} tinted={label.tinted} label={name} width="1.3em" height="1.3em" /> : name}
    {uses !== null && <span>{uses}</span>}
  </span>
}

/**
 * ScoreBar: one team's score the way the game draws it, a bar filled by `part` (0..1) with the
 * number at its inner end. The track is a dark shade of the team's color and the fill is the
 * team's own color (both follow the in-game team color the tokens carry). `towardCenter`: the
 * left bar, filled from the screen's center.
 */
function ScoreBar({ team, score, part, towardCenter = false }: { team: 'team-ally' | 'team-enemy'; score: number; part: number; towardCenter?: boolean }) {
  const side = towardCenter ? 'right' : 'left'
  const color = tokenCssVar(team)
  return <span data-score-bar={team} style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: towardCenter ? 'flex-end' : 'flex-start', width: '6.5em', height: '1.15em', padding: '0 0.3em', background: `color-mix(in srgb, ${color} 28%, #000)`, [towardCenter ? 'borderRight' : 'borderLeft']: `2px solid ${color}` }}>
    <span aria-hidden="true" style={{ position: 'absolute', top: 0, bottom: 0, [side]: 0, width: `${Math.max(0, Math.min(1, part)) * 100}%`, background: color }} />
    <span style={{ position: 'relative' }}>{score}</span>
  </span>
}
