import { useEffect, useMemo, useState, type RefObject } from 'react'
import { WeaponIcon } from '@/components/ui/WeaponIcon'
import { tokenCssVar } from '@/lib/accessibility/semantic-tokens'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import { REPLAY_TEXT, type ReplayLocale } from '../i18n/i18n'
import { SCENE3D_TEXT } from '../i18n/scene3dText'
import { catalogText } from '../i18n/catalogLabel'
import type { ReplayKill } from '../model/killFeedLogic'
import { horlogeHud, lireAth, lireFilAth, lirePopupsAth, lireScoreAth, preparerAth } from '../model/ath3d_logic'
import { specLunette, styleLunette, zoomAt } from '../model/scopeLogic'
import { displayClockMs, type ReplayWindowBounds } from '../model/replayWindow'
import { ReplayAthFil3d } from './ReplayAthFil3d'
import { ReplayAthLunette3d } from './ReplayAthLunette3d'
import { ReplayKillPopup3d } from './ReplayKillPopup3d'
import { frameToMs, formatClock } from '@/lib/replay/replayLogic'
import { MIRROR_STYLE, weaponFullIcon } from '../model/weaponFullIcon'
import type { ReplayScene3d } from '../scene3d/replayScene3d'

export function ReplayAth3d({ doc, xuid, frameRef, locale, kills, nameOfXuid, playWindow, timeLimitMs, sceneRef }: { doc: ReplayDocumentReady; xuid: string; frameRef: RefObject<number>; locale: ReplayLocale; kills: readonly ReplayKill[]; nameOfXuid?: (xuid: string) => string | null; playWindow: ReplayWindowBounds | null; timeLimitMs: number | null; sceneRef?: RefObject<ReplayScene3d | null> }) {
  const [frame, setFrame] = useState(0)
  const [onEnemy, setOnEnemy] = useState(false)
  const source = useMemo(() => preparerAth(doc, xuid, kills), [doc, xuid, kills])
  useEffect(() => {
    let raf = 0
    const lire = () => {
      const frame = frameRef.current ?? 0
      setFrame(frame)
      setOnEnemy(sceneRef?.current?.redReticle(frame, source.allegeance) ?? false)
      raf = requestAnimationFrame(lire)
    }
    raf = requestAnimationFrame(lire)
    return () => cancelAnimationFrame(raf)
  }, [frameRef, sceneRef, source])
  const ath = lireAth(source, frame, locale)
  const fil = lireFilAth(source, frame)
  const popups = lirePopupsAth(source, frame)
  const score = lireScoreAth(source, frame)
  // Mort ou pas encore apparu (`ath` nul), le joueur garde le score, l'horloge et le fil : seuls
  // le bouclier, le réticule et le coin de l'arme appartiennent à une vie.
  // Le jeu range les barres par identifiant d'équipe, pas par allégeance : le camp à gauche
  // porte `versCentre`, et l'encre (`camp`) reste celle de l'allégeance de chaque équipe.
  const coteGauche = score && (score.allieAGauche
    ? { camp: 'team-ally' as const, score: score.ally.score, part: score.ally.fill }
    : { camp: 'team-enemy' as const, score: score.enemy.score, part: score.enemy.fill })
  const coteDroite = score && (score.allieAGauche
    ? { camp: 'team-enemy' as const, score: score.enemy.score, part: score.enemy.fill }
    : { camp: 'team-ally' as const, score: score.ally.score, part: score.ally.fill })
  const cle = ath?.armeId?.replace(/^0x/i, '').slice(0, 8).toLowerCase()
  const spec = specLunette(cle, ath?.etiquette?.key)
  const zoom = zoomAt(doc, xuid, frame, spec)
  const lunetteMontee = spec.kind === 'scope' && zoom.amount > 0.5
  // Un lien intelligent garde le réticule, réduit de 30 % avec l'amplissée du zoom.
  const reticuleEchelle = spec.kind === 'smartLink' ? 1 - 0.3 * zoom.amount : 1
  const icone = ath?.etiquette?.img ? weaponFullIcon(ath.etiquette.img) : null
  const reticleColor = ath?.armeId && onEnemy ? tokenCssVar('team-enemy') : undefined
  return <div className="pointer-events-none absolute inset-0" style={{ color: tokenCssVar('replay-hud-on-dark'), fontSize: 'clamp(19px, calc(7.7px + 2.87cqh), 39px)', textShadow: '0 1px 2px var(--replay-hud-shadow)' }}>
    <ReplayAthFil3d fil={fil} locale={locale} nameOfXuid={nameOfXuid} />
    {score && coteGauche && coteDroite && <div role="group" aria-label={REPLAY_TEXT[locale].scoreBannerLabel} style={{ position: 'absolute', bottom: '6%', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: '0.6em', fontSize: '0.65em', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}><BarreScore camp={coteGauche.camp} score={coteGauche.score} part={coteGauche.part} versCentre /><span aria-label={REPLAY_TEXT[locale].scoreBannerClock}>{formatClock(horlogeHud(timeLimitMs, displayClockMs(frameToMs(frame, doc), playWindow)))}</span><BarreScore camp={coteDroite.camp} score={coteDroite.score} part={coteDroite.part} /></div>}
    {ath && ath.bouclier !== null && <div style={{ position: 'absolute', top: '8%', left: '50%', width: 'min(50cqh, 90%)', transform: 'translateX(-50%)', height: '3.2%', minHeight: 8, border: `1px solid ${ath.bouclier <= 0 ? tokenCssVar('destructive') : 'currentColor'}`, clipPath: 'polygon(2% 0, 98% 0, 100% 100%, 0 100%)' }}><div style={{ position: 'absolute', inset: 0, width: `${Math.max(0, Math.min(1, ath.bouclier)) * 100}%`, background: tokenCssVar('info'), opacity: 0.85 }} /></div>}
    {ath && spec.kind === 'bandit' && zoom.amount > 0.5 && <ReplayAthBandit3d amount={zoom.amount} label={SCENE3D_TEXT[locale].banditZoom} />}
    {ath && (lunetteMontee ? <ReplayAthLunette3d amount={zoom.amount} style={styleLunette(spec)} reticleColor={reticleColor} /> : (
      <svg viewBox="0 0 100 100" aria-hidden="true" style={{ color: reticleColor, position: 'absolute', width: 'max(50px, 10cqh)', height: 'max(50px, 10cqh)', left: '50%', top: '50%', transform: `translate(-50%, -50%) scale(${reticuleEchelle})`, overflow: 'visible' }} fill="none" stroke="currentColor" strokeWidth="1.5">
        {['cercle', 'precision', 'large', 'defaut'].includes(ath.forme) && <circle cx="50" cy="50" r={ath.forme === 'large' ? 32 : ath.forme === 'precision' ? 15 : 25} />}
        {['precision', 'pistolet', 'point', 'defaut'].includes(ath.forme) && <circle cx="50" cy="50" r="1.7" fill="currentColor" stroke="none" />}
        {['cercle', 'pistolet'].includes(ath.forme) && <path d="M50 18v5 M50 77v5 M18 50h5 M77 50h5" />}
        {(ath.elimination > 0 || ath.touche > 0) && <path d="M20 20l7 7 M80 20l-7 7 M20 80l7-7 M80 80l-7-7" stroke={ath.elimination > 0 ? tokenCssVar('team-enemy') : 'currentColor'} strokeWidth={ath.elimination > 0 ? 2.5 : 1.5} opacity={ath.elimination || ath.touche} />}
      </svg>
    ))}
    <ReplayKillPopup3d popups={popups} locale={locale} />
    {/* Le coin bas droit du jeu : grenades au-dessus, puis chargeur | réserve et l'arme à leur droite, canon vers la gauche (le sens natif de l'atlas ; un dessin hors atlas est retourné). */}
    {ath && <div style={{ position: 'absolute', right: '3%', bottom: '6%', display: 'flex', flexDirection: 'column', alignItems: 'end', gap: '0.35em', lineHeight: 1, color: tokenCssVar('replay-hud-weapon') }}>
      <div style={{ display: 'flex', gap: '0.25em', fontSize: '0.6em' }}>{ath.grenades.map((g) => <span key={g.rank} style={{ display: 'flex', alignItems: 'center', gap: '0.25em', padding: '0.2em 0.4em', border: '1px solid currentColor', background: 'var(--replay-hud-shadow)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{doc.grenadeLabels?.[g.rank]?.img ? <WeaponIcon imageUrl={doc.grenadeLabels[g.rank].img} tinted={doc.grenadeLabels[g.rank].tinted} label={g.name} width="1.3em" height="1.3em" /> : g.name} {g.count}</span>)}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3em' }}>
        <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{ath.munitions?.mag}</span>
        {ath.munitions?.res != null && <span style={{ fontSize: '0.6em', opacity: 0.75, paddingLeft: '0.5em', borderLeft: '1px solid currentColor', fontVariantNumeric: 'tabular-nums' }}>{ath.munitions.res}</span>}
        {icone && <WeaponIcon imageUrl={icone.url} tinted={ath.etiquette?.tinted} label={catalogText(ath.etiquette, locale) ?? ''} width="2.8em" height="1.1em" style={icone.mirrored ? undefined : MIRROR_STYLE} />}
      </div>
    </div>}
  </div>
}

/** Le cadre du Bandit assombrit l'extérieur sans masquer le réticule. */
function ReplayAthBandit3d({ amount, label }: { amount: number; label: string }) {
  return <div aria-hidden="true" style={{ position: 'absolute', inset: 0, overflow: 'hidden', opacity: amount }}>
    <div style={{ position: 'absolute', left: '50%', top: '17%', width: 'min(103cqh, 92%)', transform: 'translateX(-50%)', height: '66%', border: '1px solid currentColor', borderRadius: '3cqh', boxShadow: '0 0 0 200cqmax var(--replay-hud-shadow)' }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} fill="none" stroke="currentColor" strokeWidth="0.7" vectorEffect="non-scaling-stroke">
        <path d="M0 12V6 Q0 0 6 0H12 M88 0H94 Q100 0 100 6V12 M0 88V94 Q0 100 6 100H12 M88 100H94 Q100 100 100 94V88" />
      </svg>
      <span style={{ position: 'absolute', left: '1%', top: '50%', transform: 'translateY(-50%)', fontSize: '0.45em', fontWeight: 700 }}>{label}</span>
    </div>
  </div>
}

/**
 * BarreScore : le score d'un camp à la manière du jeu, une barre à sa couleur remplie de `part`
 * (0..1) et le nombre posé à son bout intérieur. `versCentre` : barre de gauche, remplie depuis
 * le centre de l'écran.
 */
function BarreScore({ camp, score, part, versCentre = false }: { camp: 'team-ally' | 'team-enemy'; score: number; part: number; versCentre?: boolean }) {
  const cote = versCentre ? 'right' : 'left'
  return <span style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: versCentre ? 'flex-end' : 'flex-start', width: '6.5em', height: '1.15em', padding: '0 0.3em', background: 'var(--replay-hud-shadow)', [versCentre ? 'borderRight' : 'borderLeft']: `2px solid ${tokenCssVar(camp)}` }}>
    <span aria-hidden="true" style={{ position: 'absolute', top: 0, bottom: 0, [cote]: 0, width: `${Math.max(0, Math.min(1, part)) * 100}%`, background: tokenCssVar(camp), opacity: 0.7 }} />
    <span style={{ position: 'relative' }}>{score}</span>
  </span>
}
