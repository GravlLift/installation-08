// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { WeaponIcon } from '@/components/ui/WeaponIcon'
import { tokenCssVar } from '@/lib/accessibility/semantic-tokens'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import { REPLAY_TEXT, type ReplayLocale } from '../i18n/i18n'
import { catalogText } from '../i18n/catalogLabel'
import type { ReplayKill } from '../model/killFeedLogic'
import { horlogeHud, lireAth, lireFilAth, lirePopupsAth, lireScoreAth, preparerAth } from '../model/ath3d_logic'
import { magsPourArme } from '../model/scopeLogic'
import { adsAmmoText } from '../model/adsOverlay'
import { aimHudAt, heldModelKey, RETICLE_DOT_R, RETICLE_HEIGHT_SHARE, RETICLE_KILL_STROKE, RETICLE_MIN_PX, RETICLE_STROKE, reticleGeometry, segmentsPath } from '../model/aimHud'
import { displayClockMs, type ReplayWindowBounds } from '../model/replayWindow'
import { ReplayAthFil3d } from './ReplayAthFil3d'
import { ReplayAthLunette3d } from './ReplayAthLunette3d'
import { ReplayKillPopup3d } from './ReplayKillPopup3d'
import { ShieldBar3d } from './ShieldBar3d'
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

/**
 * ScoreBanner — the match score and clock, bottom center: drawn at every HUD level (`hudLevel`),
 * the 2D view's 'score' level keeps it alone.
 */
function ScoreBanner({ locale, frame, doc, playWindow, timeLimitMs, leftSide, rightSide }: { locale: ReplayLocale; frame: number; doc: ReplayDocumentReady; playWindow: ReplayWindowBounds | null; timeLimitMs: number | null; leftSide: { team: 'team-ally' | 'team-enemy'; score: number; part: number }; rightSide: { team: 'team-ally' | 'team-enemy'; score: number; part: number } }) {
  // `data-map-inset`: the 2D view's map fits over it (`topDownView3d.readInsets`).
  return <div role="group" data-map-inset="bottom" aria-label={REPLAY_TEXT[locale].scoreBannerLabel} style={{ position: 'absolute', bottom: '6%', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: '0.6em', fontSize: '0.65em', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}><ScoreBar team={leftSide.team} score={leftSide.score} part={leftSide.part} towardCenter /><span aria-label={REPLAY_TEXT[locale].scoreBannerClock}>{formatClock(horlogeHud(timeLimitMs, displayClockMs(frameToMs(frame, doc), playWindow)))}</span><ScoreBar team={rightSide.team} score={rightSide.score} part={rightSide.part} /></div>
}

export function ReplayAth3d({ doc, xuid, frameRef, locale, kills, nameOfXuid, playWindow, timeLimitMs, sceneRef, hud = 'full', callouts = null }: { doc: ReplayDocumentReady; xuid: string; frameRef: RefObject<number>; locale: ReplayLocale; kills: readonly ReplayKill[]; nameOfXuid?: (xuid: string) => string | null; playWindow: ReplayWindowBounds | null; timeLimitMs: number | null; sceneRef?: RefObject<ReplayScene3d | null>; hud?: HudLevel; callouts?: PreparedCallouts | null }) {
  const [frame, setFrame] = useState(0)
  const [onEnemy, setOnEnemy] = useState(false)
  // The held weapon and its zoom level, read by the frame loop below (its range decides the red reticle).
  const heldRef = useRef<HeldWeapon | null>(null)
  const source = useMemo(() => preparerAth(doc, xuid, kills), [doc, xuid, kills])
  const lives = useMemo(() => buildLivesByXuid(doc.tracks), [doc])
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const frame = frameRef.current ?? 0
      setFrame(frame)
      setOnEnemy(hud === 'full' && (sceneRef?.current?.redReticle(frame, source.allegeance, heldRef.current) ?? false))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [frameRef, sceneRef, source, hud])
  const ath = lireAth(source, frame, locale)
  const fil = lireFilAth(source, frame)
  const popups = lirePopupsAth(source, frame)
  const score = lireScoreAth(source, frame)
  // Dead or not yet spawned (`ath` null), the player keeps the score, clock and feed: only
  // the shield, reticle and weapon corner belong to a life.
  // The game arranges the bars by team id, not by allegiance: the left side carries
  // `towardCenter`, and the color (`team`) stays that of each team's own allegiance.
  const leftSide = score && (score.allieAGauche
    ? { team: 'team-ally' as const, score: score.ally.score, part: score.ally.fill }
    : { team: 'team-enemy' as const, score: score.enemy.score, part: score.enemy.fill })
  const rightSide = score && (score.allieAGauche
    ? { team: 'team-enemy' as const, score: score.enemy.score, part: score.enemy.fill }
    : { team: 'team-ally' as const, score: score.ally.score, part: score.ally.fill })
  const weaponKey = heldModelKey(ath?.armeId)
  // The magnification per level comes from the weapon index (the tag's own values); the hand
  // table gives only the kind and the style. A weapon the index has no zoom for does not zoom.
  const mags = magsPourArme(weaponKey, sceneRef?.current?.magnifications(weaponKey ?? '') ?? null)
  // The weapon's ADS overlay (`adsOverlay`): drawn from the first frame of the zoom, fading with it;
  // an overlay with its own center reticle replaces the hip reticle past half the fade (`aimHud`,
  // shared with the video export).
  const aimState = aimHudAt(doc, xuid, frame, weaponKey, ath?.etiquette?.key, mags)
  const { zoom, ads } = aimState
  const weaponId = ath?.armeId ?? null
  useEffect(() => {
    heldRef.current = weaponId ? { weaponId, zoomLevel: zoom.level } : null
  }, [weaponId, zoom.level])
  const reticle = ath ? reticleGeometry(ath.forme, ath.elimination, ath.touche) : null
  const icon = ath?.etiquette?.img ? weaponFullIcon(ath.etiquette.img) : null
  const reticleColor = ath?.armeId && onEnemy ? tokenCssVar('reticle-hostile') : undefined
  const banner = score && leftSide && rightSide ? <ScoreBanner locale={locale} frame={frame} doc={doc} playWindow={playWindow} timeLimitMs={timeLimitMs} leftSide={leftSide} rightSide={rightSide} /> : null
  // The levels (`hudLevel`): 2D keeps the score strip, free view adds the kill feed, third person
  // is the full HUD without the aim (reticle, scope masks, Bandit frame), first person is all of it.
  if (hud === 'score') return <div className="pointer-events-none absolute inset-0" style={HUD_STYLE}>{banner}</div>
  if (hud === 'spectator') return <div className="pointer-events-none absolute inset-0" style={HUD_STYLE}><ReplayAthFil3d fil={fil} locale={locale} nameOfXuid={nameOfXuid} />{banner}</div>
  const aim = hud === 'full'
  // The place name under the game's motion tracker (mapCallouts): bottom left, under the kill feed.
  const place = calloutName(calloutOfLivesAt(callouts, lives.get(xuid), frame), locale)
  return <div className="pointer-events-none absolute inset-0" style={HUD_STYLE}>
    <ReplayAthFil3d fil={fil} locale={locale} nameOfXuid={nameOfXuid} />
    {banner}
    {/* The shield never sits under the player's top strip (its safe inset, `usePlayerChromeInsets`). */}
    {ath?.bouclierEtat && <div style={{ position: 'absolute', top: 'max(8%, calc(var(--bc-chrome-top, 0px) + 6px))', left: '50%', width: 'min(39cqh, 90%)', minWidth: 160, transform: 'translateX(-50%)' }}>
      <ShieldBar3d fraction={ath.bouclierEtat.fraction} state={ath.bouclierEtat.state} flash={shieldFlash(frameToMs(ath.bouclierEtat.since, doc), frameToMs(frame, doc))} label={REPLAY_TEXT[locale].shieldLabel} />
    </div>}
    {aim && ath && ads && <ReplayAthLunette3d spec={ads} levelIndex={aimState.adsLevel} amount={zoom.amount} reticleColor={reticleColor} ammo={adsAmmoText(ath.munitions?.mag)} />}
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
    {/* The game's bottom-right corner: grenades above, then mag | reserve and the weapon to their right, barrel pointing left (the atlas's native direction; artwork outside the atlas is flipped). */}
    {ath && <div style={{ position: 'absolute', right: '3%', bottom: '6%', display: 'flex', flexDirection: 'column', alignItems: 'end', gap: '0.35em', lineHeight: 1, color: tokenCssVar('replay-hud-weapon') }}>
      <div style={{ display: 'flex', gap: '0.25em', fontSize: '0.6em' }}>{ath.equipement && <EquipmentHud3d doc={doc} rank={ath.equipement.rank} uses={ath.equipement.uses} locale={locale} />}{ath.grenades.map((g) => <span key={g.rank} style={{ display: 'flex', alignItems: 'center', gap: '0.25em', padding: '0.2em 0.4em', border: '1px solid currentColor', background: 'var(--replay-hud-shadow)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{doc.grenadeLabels?.[g.rank]?.img ? <WeaponIcon imageUrl={doc.grenadeLabels[g.rank].img} tinted={doc.grenadeLabels[g.rank].tinted} label={g.name} width="1.3em" height="1.3em" /> : g.name} {g.count}</span>)}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3em' }}>
        <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{ath.munitions?.mag}</span>
        {ath.munitions?.res != null && <span style={{ fontSize: '0.6em', opacity: 0.75, paddingLeft: '0.5em', borderLeft: '1px solid currentColor', fontVariantNumeric: 'tabular-nums' }}>{ath.munitions.res}</span>}
        {icon && <WeaponIcon imageUrl={icon.url} tinted={ath.etiquette?.tinted} label={catalogText(ath.etiquette, locale) ?? ''} width="2.8em" height="1.1em" style={icon.mirrored ? undefined : MIRROR_STYLE} />}
      </div>
    </div>}
  </div>
}

/**
 * The game's equipment slot, left of the grenades: the carried equipment's icon and its uses left
 * (`equipmentSlotHud`); spent down to zero uses, the icon dims until the equipment is gone.
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
