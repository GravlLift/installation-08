// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { WeaponIcon } from '@/components/ui/WeaponIcon'
import { resolveToken } from '@/lib/accessibility/resolveToken'
import { tokenCssVar } from '@/lib/accessibility/semantic-tokens'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import { REPLAY_TEXT, type ReplayLocale } from '../i18n/i18n'
import { catalogText } from '../i18n/catalogLabel'
import type { ReplayKill } from '../model/killFeedLogic'
import { hudClock, readHud, readKillFeed, readKillPopups, readScoreHud, prepareHud, HUD_RULE_ALPHA, NAME_TAG_EM, NAME_TAG_PAD_X, NAME_TAG_PAD_Y } from '../model/hud3d_logic'
import { magsForWeapon } from '../model/scopeLogic'
import { adsAmmoText } from '../model/adsOverlay'
import { aimHudAt, heldModelKey, RETICLE_DOT_R, RETICLE_HALO_OPACITY, RETICLE_HALO_STROKE, RETICLE_HEIGHT_SHARE, RETICLE_KILL_STROKE, RETICLE_MIN_PX, RETICLE_STROKE, reticleGeometry, segmentsPath } from '../model/aimHud'
import { displayClockMs, type ReplayWindowBounds } from '../model/replayWindow'
import { ReplayHudFeed3d } from './ReplayHudFeed3d'
import { ReplayHudScope3d } from './ReplayHudScope3d'
import { ReplayKillPopup3d } from './ReplayKillPopup3d'
import { ShieldBar3d } from './ShieldBar3d'
import { DAMAGE_ARC_URL, paintDamageArcs } from './damageArcPaint'
import { getScoreMeterMask, paintScoreMeter, type ScoreMeterMask } from './scoreMeter'
import { hexRgb, shieldFloodAt, shieldFloodTint } from '../model/shieldFlood'
import { SCORE_BAR_BAND_BOTTOM, SCORE_BAR_BAND_SHARE, SCORE_BAR_BAND_TOP, SCORE_BAR_BODY_SHARE } from '../model/scoreBarBand'
import { ensureHudFonts, HUD_FONT_FAMILY, HUD_SCORE_FONT_FAMILY } from './hudFonts'
import { shieldFlash } from '../model/shieldHud'
import { TEAM_EMBLEM_GAP_SHARE, TEAM_EMBLEM_HEIGHT_SHARE, teamEmblemUrl } from '../model/teamEmblem'
import { frameToMs, formatClock } from '@/lib/replay/replayLogic'
import { MIRROR_STYLE, weaponFullIcon } from '../model/weaponFullIcon'
import type { ReplayScene3d } from '../scene3d/replayScene3d'
import type { HeldWeapon } from '../scene3d/redReticle3d'
import type { HudLevel } from '../model/hudLevel'
import { buildLivesByXuid } from '../model/livesPosition'
import { CALLOUT_LABEL, calloutName, calloutOfLivesAt, type PreparedCallouts } from '../model/mapCallouts'

/** The hip reticle box (`aimHud.reticleBoxPx`, in container units). */
const RETICLE_CSS_SIZE = `max(${RETICLE_MIN_PX}px, ${RETICLE_HEIGHT_SHARE * 100}cqh)`

// The game's HUD faces (Normative Pro by default), registered once; until they load, and on
// a set built before them, the fallback face draws.
void ensureHudFonts()
const HUD_STYLE = { color: tokenCssVar('replay-hud-on-dark'), fontFamily: HUD_FONT_FAMILY, fontSize: 'clamp(19px, calc(7.7px + 2.87cqh), 39px)', textShadow: '0 1px 2px var(--replay-hud-shadow)' }

/** The weapon corner's thin rules (`HUD_RULE_ALPHA`): the weapon ink, partly see-through. */
const RULE = `max(1px, 0.05em) solid color-mix(in srgb, currentColor ${HUD_RULE_ALPHA * 100}%, transparent)`
/** A grenade or equipment slot: the game's outline, with no backdrop. */
const SLOT_STYLE = { display: 'flex', alignItems: 'center', padding: '0.2em 0.4em', border: RULE } as const

/** The game's damage-arc bitmap, loaded once; the canvas layer below paints with it when it is ready. */
const damageArcImage = new Image()
damageArcImage.src = DAMAGE_ARC_URL

/**
 * ScoreBanner — the match score and clock, bottom center: drawn at every HUD level (`hudLevel`),
 * the 2D view's 'score' level keeps it alone.
 */
function ScoreBanner({ locale, frame, doc, playWindow, timeLimitMs, meterMask, leftSide, rightSide }: { locale: ReplayLocale; frame: number; doc: ReplayDocumentReady; playWindow: ReplayWindowBounds | null; timeLimitMs: number | null; meterMask: ScoreMeterMask | null; leftSide: { team: 'team-ally' | 'team-enemy'; teamId: number; score: number; part: number }; rightSide: { team: 'team-ally' | 'team-enemy'; teamId: number; score: number; part: number } }) {
  // `data-map-inset`: the 2D view's map fits over it (`topDownView3d.readInsets`).
  return <div role="group" data-map-inset="bottom" aria-label={REPLAY_TEXT[locale].scoreBannerLabel} style={{ position: 'absolute', bottom: '6%', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: '0.6em', fontSize: '0.65em', fontFamily: HUD_SCORE_FONT_FAMILY, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}><ScoreBar team={leftSide.team} score={leftSide.score} part={leftSide.part} towardCenter teamId={leftSide.teamId} meterMask={meterMask} /><span aria-label={REPLAY_TEXT[locale].scoreBannerClock}>{formatClock(hudClock(timeLimitMs, displayClockMs(frameToMs(frame, doc), playWindow)))}</span><ScoreBar team={rightSide.team} score={rightSide.score} part={rightSide.part} teamId={rightSide.teamId} meterMask={meterMask} /></div>
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
  // The game's score meter bitmap, loaded once; the score bars paint with its mask when it is
  // ready, and keep the flat fill until then (a HUD set built before it, or a failed load).
  const [meterMask, setMeterMask] = useState<ScoreMeterMask | null>(null)
  useEffect(() => {
    let live = true
    getScoreMeterMask().then((mask) => { if (live && mask) setMeterMask(mask) })
    return () => { live = false }
  }, [])
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
    ? { team: 'team-ally' as const, teamId: score.ally.teamId, score: score.ally.score, part: score.ally.fill }
    : { team: 'team-enemy' as const, teamId: score.enemy.teamId, score: score.enemy.score, part: score.enemy.fill })
  const rightSide = score && (score.allyOnLeft
    ? { team: 'team-enemy' as const, teamId: score.enemy.teamId, score: score.enemy.score, part: score.enemy.fill }
    : { team: 'team-ally' as const, teamId: score.ally.teamId, score: score.ally.score, part: score.ally.fill })
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
  // The away weapon (small, dimmed, left of the upper row) and the selected grenade's label.
  const away = ath?.away ?? null
  const awayIcon = away?.label?.img ? weaponFullIcon(away.label.img) : null
  const grenadeLabel = ath ? doc.grenadeLabels?.[ath.grenade.rank] : undefined
  const reticleColor = ath?.weaponId && onEnemy ? tokenCssVar('reticle-hostile') : undefined
  const banner = score && leftSide && rightSide ? <ScoreBanner locale={locale} frame={frame} doc={doc} playWindow={playWindow} timeLimitMs={timeLimitMs} meterMask={meterMask} leftSide={leftSide} rightSide={rightSide} /> : null
  // The levels (`hudLevel`): 2D keeps the score strip, free view adds the kill feed, third person
  // is the full HUD without the aim (reticle, scope masks, Bandit frame), first person is all of it.
  if (hud === 'score') return <div className="pointer-events-none absolute inset-0" style={HUD_STYLE}>{banner}</div>
  if (hud === 'spectator') return <div className="pointer-events-none absolute inset-0" style={HUD_STYLE}><ReplayHudFeed3d fil={fil} locale={locale} nameOfXuid={nameOfXuid} />{banner}</div>
  const aim = hud === 'full'
  // The place name under the game's motion tracker (mapCallouts): bottom left, under the kill feed.
  const place = calloutName(calloutOfLivesAt(callouts, lives.get(xuid), frame), locale)
  // The game's shield-break flood (`shieldFlood`): first person only, in the followed player's
  // team color, brightening and tinting the scene behind the HUD for half a second.
  const flood = aim && ath?.shieldState?.state === 'broken'
    ? shieldFloodAt(frameToMs(frame, doc) - frameToMs(ath.shieldState.since, doc))
    : null
  const floodTint = flood ? shieldFloodTint(flood, hexRgb(resolveToken('team-ally'))) : null
  return <div className="pointer-events-none absolute inset-0" style={HUD_STYLE}>
    {flood && floodTint && <>
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, backdropFilter: `brightness(${flood.exposure})`, WebkitBackdropFilter: `brightness(${flood.exposure})` }} />
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: `rgb(${floodTint.join(',')})`, mixBlendMode: 'multiply' }} />
    </>}
    <ReplayHudFeed3d fil={fil} locale={locale} nameOfXuid={nameOfXuid} />
    {banner}
    {/* The shield never sits under the player's top strip (its safe inset, `usePlayerChromeInsets`). */}
    {ath?.shieldState && <div style={{ position: 'absolute', top: 'max(8%, calc(var(--bc-chrome-top, 0px) + 6px))', left: '50%', width: 'min(39cqh, 90%)', minWidth: 160, transform: 'translateX(-50%)' }}>
      <ShieldBar3d fraction={ath.shieldState.fraction} state={ath.shieldState.state} flash={shieldFlash(frameToMs(ath.shieldState.since, doc), frameToMs(frame, doc))} chase={ath.shieldState.chase} label={REPLAY_TEXT[locale].shieldLabel} health={ath.health} stateAgeMs={frameToMs(frame, doc) - frameToMs(ath.shieldState.since, doc)} />
    </div>}
    {aim && ath && ads && <ReplayHudScope3d spec={ads} levelIndex={aimState.adsLevel} amount={zoom.amount} reticleColor={reticleColor} ammo={adsAmmoText(ath.ammo?.mag)} />}
    {/* The directional damage ring (damageArcs): a full-size canvas under the reticle, shown
        with the shield bar. */}
    {ath?.shieldState && <canvas ref={damageArcCanvasRef} aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />}
    {aim && reticle && aimState.reticleShown && (
      <svg viewBox="0 0 100 100" aria-hidden="true" style={{ color: reticleColor, position: 'absolute', width: RETICLE_CSS_SIZE, height: RETICLE_CSS_SIZE, left: '50%', top: '50%', transform: `translate(-50%, -50%) scale(${aimState.reticleScale})`, overflow: 'visible' }} fill="none" stroke="currentColor" strokeWidth={RETICLE_STROKE}>
        <g stroke="var(--replay-ads-ink)" strokeWidth={RETICLE_STROKE + RETICLE_HALO_STROKE} opacity={RETICLE_HALO_OPACITY}>
          {reticle.ring !== null && <circle cx="50" cy="50" r={reticle.ring} />}
          {reticle.dot && <circle cx="50" cy="50" r={RETICLE_DOT_R + RETICLE_HALO_STROKE / 2} fill="var(--replay-ads-ink)" stroke="none" />}
          {reticle.ticks.length > 0 && <path d={segmentsPath(reticle.ticks)} />}
        </g>
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
        <span style={{ ...SLOT_STYLE, gap: '0.25em', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{grenadeLabel?.img ? <WeaponIcon imageUrl={grenadeLabel.img} tinted={grenadeLabel.tinted} label={ath.grenade.name} width="1.3em" height="1.3em" /> : ath.grenade.name}<span>{ath.grenade.count}</span></span>
        {ath.equipment
          ? <EquipmentHud3d doc={doc} rank={ath.equipment.rank} uses={ath.equipment.uses} locale={locale} />
          : <span aria-hidden="true" data-hud-equipment="none" style={{ ...SLOT_STYLE, width: '1.3em', height: '1.3em', boxSizing: 'content-box' }} />}
      </div>
      {/* The ammo and weapon row between the game's two rules, the magazine count and the reserve
          parted by its upright rule (`HUD_RULE_ALPHA`). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3em', padding: '0.25em 0 0.25em 0.5em', borderTop: RULE, borderBottom: RULE }}>
        <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: tokenCssVar('replay-hud-weapon-mag') }}>{ath.ammo?.mag}</span>
        {ath.ammo?.res != null && <>
          {ath.ammo?.mag != null && <span aria-hidden="true" style={{ alignSelf: 'stretch', width: 0, margin: '0.05em 0.15em', borderLeft: RULE }} />}
          <span style={{ fontSize: '0.6em', fontVariantNumeric: 'tabular-nums' }}>{ath.ammo.res}</span>
        </>}
        {icon && <WeaponIcon imageUrl={icon.url} tinted={ath.label?.tinted} label={catalogText(ath.label, locale) ?? ''} width="2.8em" height="1.1em" style={icon.mirrored ? undefined : MIRROR_STYLE} />}
      </div>
      {ath.nameTag && <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '0.35em', fontSize: `${NAME_TAG_EM}em`, fontWeight: 600, letterSpacing: '0.08em', lineHeight: 1, padding: `${NAME_TAG_PAD_Y}em ${NAME_TAG_PAD_X}em`, background: 'rgba(0, 0, 0, 0.55)', color: '#fff', opacity: ath.nameTag.opacity }}>{ath.nameTag.text}</div>}
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
  return <span role="img" aria-label={uses === null ? name : `${name} ${uses}`} data-hud-equipment={label?.family ?? rank} style={{ ...SLOT_STYLE, gap: '0.25em', fontWeight: 700, fontVariantNumeric: 'tabular-nums', opacity: uses === 0 ? 0.45 : 1 }}>
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
function ScoreBar({ team, score, part, towardCenter = false, teamId, meterMask }: { team: 'team-ally' | 'team-enemy'; score: number; part: number; towardCenter?: boolean; teamId?: number; meterMask: ScoreMeterMask | null }) {
  const side = towardCenter ? 'right' : 'left'
  const color = tokenCssVar(team)
  // The fill: a canvas painted with the game's meter bitmap when its mask is loaded, the flat
  // colored span it replaces before that (and on a set built before the bitmap).
  const fillRef = useRef<HTMLCanvasElement | null>(null)
  const fraction = Math.max(0, Math.min(1, part))
  const ink = resolveToken(team)
  useEffect(() => {
    const canvas = fillRef.current
    if (!canvas || !meterMask) return
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
    // The fill grows from the high-G end: unflipped that is the RIGHT end, the screen's center
    // for the left bar. The right bar uses the mirrored bitmap (the game sets bitmap_flipx = 1
    // on the right team's quad), so only it flips (`!towardCenter`).
    paintScoreMeter(ctx, meterMask, 0, 0, w, h, fraction, ink, !towardCenter)
  }, [meterMask, fraction, ink, towardCenter])
  return <span data-score-bar={team} style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: towardCenter ? 'flex-end' : 'flex-start', width: '6.5em', height: '1.15em', padding: '0 0.3em', background: `color-mix(in srgb, ${color} ${SCORE_BAR_BODY_SHARE * 100}%, #000)`, [towardCenter ? 'borderRight' : 'borderLeft']: `2px solid ${color}` }}>
    {/* The game's brighter band through the bar's middle (`scoreBarBand`), under the fill. */}
    <span aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, top: `${SCORE_BAR_BAND_TOP * 100}%`, height: `${(SCORE_BAR_BAND_BOTTOM - SCORE_BAR_BAND_TOP) * 100}%`, background: `color-mix(in srgb, ${color} ${SCORE_BAR_BAND_SHARE * 100}%, #000)` }} />
    {meterMask
      ? <canvas ref={fillRef} aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      : <span aria-hidden="true" style={{ position: 'absolute', top: 0, bottom: 0, [side]: 0, width: `${fraction * 100}%`, background: color }} />}
    <span style={{ position: 'relative' }}>{score}</span>
    {teamId != null && <TeamEmblem teamId={teamId} color={color} towardCenter={towardCenter} />}
  </span>
}

/**
 * TeamEmblem: the team's emblem at the bar's OUTER end (the left bar's left, the right
 * bar's right), the game's own proportions (cusc 21a7dab4): 1.55 x the bar's height, a gap
 * of 0.27 x the bar's height beyond the bar's end, vertically centered on the bar, at opacity
 * 0.7, in the team's color (the white emblem used as a mask). The item screen sets no color of
 * its own, so the game's team tint reaches it from the parent, as the owner's frames show
 * (green cobra, red eagle). The bar is 1.15em tall (`ScoreBar`); a set built before the
 * emblems (a failed load) masks everything out and renders nothing.
 */
function TeamEmblem({ teamId, color, towardCenter = false }: { teamId: number; color: string; towardCenter?: boolean }) {
  const url = teamEmblemUrl(teamId)
  if (!url) return null
  const size = `${1.15 * TEAM_EMBLEM_HEIGHT_SHARE}em`
  const mask = `url("${url}") center / contain no-repeat`
  return <span aria-hidden="true" style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: size, height: size, [towardCenter ? 'right' : 'left']: '100%', [towardCenter ? 'marginRight' : 'marginLeft']: `${1.15 * TEAM_EMBLEM_GAP_SHARE}em`, background: color, mask, WebkitMask: mask, opacity: 0.7, pointerEvents: 'none' }} />
}
