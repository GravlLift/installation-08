// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { buildPlayers, playerStateAt, vitalityPresence } from '@/lib/replay/rosterLogic'
import { buildFilmAllegiance } from '@/lib/replay/filmAllegiance'
import { scoreTimelineOf } from '@/lib/replay/scoreTimeline'
import { readScoreBanner, type ScoreBannerReading } from './scoreBannerLogic'
import { frameToMs } from '@/lib/replay/replayLogic'
import type { ReplayDocumentReady, ReplayTrackReady } from '@/lib/replay/replayNormalize'
import { shieldHudAt, shieldHudTrackOf, type ShieldHudTrack } from './shieldHud'
import { REPLAY_TEXT, type ReplayLocale } from '../i18n/i18n'
import { catalogText } from '../i18n/catalogLabel'
import type { ReplayKill } from './killFeedLogic'
import { weaponInHand } from './weaponInHand'
import { equipmentSlotAt } from './equipmentSlotHud'
import { grenadeBoxAt, grenadesCarriedFrom, inventoryAt } from './inventoryReading'
import { weaponClassOfKey } from '../scene3d/weaponClass3d'

export function formeReticule(cle: string | undefined): 'cercle' | 'precision' | 'pistolet' | 'point' | 'large' | 'defaut' {
  if (!cle) return 'defaut'
  if (['hinf_br75', 'hinf_vk78_commando', 'hinf_bandit', 'hinf_shock_rifle'].includes(cle)) return 'precision'
  if (['hinf_s7_sniper'].includes(cle)) return 'point'
  if (['hinf_cqs48_bulldog', 'hinf_heatwave', 'hinf_cindershot'].includes(cle) || weaponClassOfKey(cle) === 'missile') return 'large'
  if (weaponClassOfKey(cle) === 'pistol') return 'pistolet'
  return weaponClassOfKey(cle) === 'rifle' ? 'cercle' : 'defaut'
}

export function marqueImpact(ageMs: number, dureeMs: number): number {
  return ageMs >= 0 && ageMs < dureeMs ? 1 - ageMs / dureeMs : 0
}

/** The first-person HUD clock: when the match's time limit is known, it
 * counts down from it and is bounded at zero; unknown limit (`null`) = the elapsed time,
 * like the timeline. */
export function horlogeHud(limitMs: number | null, elapsedMs: number): number {
  return limitMs == null ? elapsedMs : Math.max(0, limitMs - elapsedMs)
}

export function preparerAth(doc: ReplayDocumentReady, xuid: string, kills: readonly ReplayKill[]) {
  const impacts = new Map<number, number[]>()
  for (const degat of doc.damages) {
    if (degat.by === undefined) continue
    const temps = impacts.get(degat.by) ?? []
    temps.push(frameToMs(degat.t, doc))
    impacts.set(degat.by, temps)
  }
  for (const temps of impacts.values()) temps.sort((a, b) => a - b)
  const eliminations = kills.filter((k) => k.xuid === xuid).map((k) => k.replayMs).sort((a, b) => a - b)
  const joueurs = buildPlayers(doc, [])
  const allegeance = buildFilmAllegiance(joueurs, xuid)
  const fil = [...kills].sort((a, b) => a.replayMs - b.replayMs)
  return { doc, xuid, allegeance, fil, score: scoreTimelineOf(doc), joueur: joueurs.find((p) => p.xuid === xuid), presence: vitalityPresence(doc), impacts, eliminations, munitions: suivreMunitions(doc), boucliers: new Map<ReplayTrackReady, ShieldHudTrack>() }
}

/** The shield bar of a life (`shieldHud`), built on its first read and kept for the source's life. */
function barreBouclier(source: ReturnType<typeof preparerAth>, vie: ReplayTrackReady): ShieldHudTrack {
  let piste = source.boucliers.get(vie)
  if (!piste) source.boucliers.set(vie, (piste = shieldHudTrackOf(vie.points, frameToMs(1, source.doc), vie.points[0]?.t)))
  return piste
}

/** The ammo of a weapon slot of a life across the film: each read carries forward what it does not say. */
export interface SuiviMunitions {
  ms: number[]
  mag: (number | undefined)[]
  res: (number | undefined)[]
}

const cleMunitions = (slot: number, w: number) => slot * 8 + w

/** suivreMunitions buckets `doc.ammoReads` (already sorted by instant) by life and weapon slot. */
export function suivreMunitions(doc: ReplayDocumentReady): Map<number, SuiviMunitions> {
  const suivis = new Map<number, SuiviMunitions>()
  for (const lecture of doc.ammoReads) {
    const cle = cleMunitions(lecture.slot, lecture.w)
    let suivi = suivis.get(cle)
    if (!suivi) suivis.set(cle, (suivi = { ms: [], mag: [], res: [] }))
    const dernier = suivi.ms.length - 1
    suivi.ms.push(lecture.ms)
    suivi.mag.push(lecture.mag ?? suivi.mag[dernier])
    suivi.res.push(lecture.res ?? suivi.res[dernier])
  }
  return suivis
}

/** munitionsA: the last read of the slot at instant `ms`, null before the first. */
export function munitionsA(suivi: SuiviMunitions | undefined, ms: number): { mag?: number; res?: number } | null {
  if (!suivi) return null
  let debut = 0
  let fin = suivi.ms.length
  while (debut < fin) {
    const milieu = (debut + fin) >> 1
    if (suivi.ms[milieu] <= ms) debut = milieu + 1
    else fin = milieu
  }
  return debut ? { mag: suivi.mag[debut - 1], res: suivi.res[debut - 1] } : null
}

function derniereMarque(temps: readonly number[], maintenant: number, duree: number): number {
  let debut = 0
  let fin = temps.length
  while (debut < fin) {
    const milieu = Math.floor((debut + fin) / 2)
    if (temps[milieu] <= maintenant) debut = milieu + 1
    else fin = milieu
  }
  return debut ? marqueImpact(maintenant - temps[debut - 1], duree) : 0
}

export function lireAth(source: ReturnType<typeof preparerAth>, frame: number, locale: ReplayLocale) {
  const { doc, joueur, presence } = source
  if (!joueur) return null
  const etat = playerStateAt(joueur, frame, presence)
  if (!etat.alive || !etat.life) return null
  const slot = etat.life.slot
  const inventaire = inventoryAt(doc, slot, frame)
  const maintenant = frameToMs(frame, doc)
  const tenue = weaponInHand(doc, slot, frame)
  const enMain = tenue?.slotArme
  const arme = tenue
  const etiquette = arme ? doc.weaponLabels?.[arme.id] : undefined
  const image = enMain != null ? inventaire?.state.am?.[enMain] : undefined
  // The `ammoReads` axis tracks the magazine per shot; the inventory keyframe stands in without it.
  const fine = enMain != null ? munitionsA(source.munitions.get(cleMunitions(slot, enMain)), maintenant) : null
  const munitions = fine ? { ...image, mag: fine.mag ?? image?.mag, res: fine.res ?? image?.res } : image
  const boite = grenadeBoxAt(doc, slot, frame, inventaire)
  const grenades = boite ? grenadesCarriedFrom(boite.g, doc.grenadeLabels, locale) : []
  if (!grenades.some((g) => g.rank === 0)) grenades.unshift({ rank: 0, name: catalogText(doc.grenadeLabels?.[0], locale) ?? REPLAY_TEXT[locale].soundCategory.grenade, count: boite?.g[0] ?? 0 })
  const touche = derniereMarque(source.impacts.get(slot) ?? [], maintenant, 150)
  const elimination = derniereMarque(source.eliminations, maintenant, 400)
  const equipement = equipmentSlotAt(doc, slot, frame)
  // The shield bar: smooth recharge, instant drops (`shieldHud`); null when the film carries no shield.
  const bouclierEtat = etat.shield ? shieldHudAt(barreBouclier(source, etat.life), frame) : null
  return { bouclier: bouclierEtat?.fraction ?? null, bouclierEtat, armeId: arme?.id, etiquette, munitions, grenades, equipement, forme: formeReticule(etiquette?.key), touche, elimination }
}

/** Life window of an elimination of the followed player in the 3D HUD popup, in seconds. */
export const KILL_POPUP_SECONDS = 4

/** The linear drift of the opacity starts at the last second of the window. */
const KILL_POPUP_FADE_MS = 1000

/** An elimination of the followed player waiting to be displayed, with its own opacity. */
export interface KillPopup {
  /** The kill (victim and medals, in feed order). */
  kill: ReplayKill
  /** 1 during the window, then a linear drop to 0 over its last second. */
  opacite: number
}

/**
 * lirePopupsAth: the eliminations of the followed player to display beside the reticle — those
 * that happened at the latest by the current frame, within the KILL_POPUP_SECONDS window, the most
 * recent first, two at most. Pure function of the frame: a rewind replays
 * exactly what playback showed, and nothing is shown before its instant.
 */
export function lirePopupsAth(source: ReturnType<typeof preparerAth>, frame: number): KillPopup[] {
  const ms = frameToMs(frame, source.doc)
  const fenetre = KILL_POPUP_SECONDS * 1000
  return source.fil
    .filter((k) => k.xuid === source.xuid && k.replayMs <= ms && ms - k.replayMs < fenetre)
    .sort((a, b) => b.replayMs - a.replayMs)
    .slice(0, 2)
    .map((kill) => {
      const age = ms - kill.replayMs
      const debutFondu = fenetre - KILL_POPUP_FADE_MS
      return { kill, opacite: age >= debutFondu ? 1 - (age - debutFondu) / KILL_POPUP_FADE_MS : 1 }
    })
}

/** The feed is bounded by the instant of the film, independently of the direction of playback. */
export function lireFilAth(source: ReturnType<typeof preparerAth>, frame: number) {
  const ms = frameToMs(frame, source.doc)
  let debut = 0
  let fin = source.fil.length
  while (debut < fin) {
    const milieu = (debut + fin) >> 1
    if (source.fil[milieu].replayMs <= ms) debut = milieu + 1
    else fin = milieu
  }
  return source.fil.slice(Math.max(0, debut - 4), debut)
    .filter((k) => ms - k.replayMs < 6000)
    .map((kill) => ({ kill, opacite: Math.min(1, (6000 - (ms - kill.replayMs)) / 1000),
      implique: kill.xuid === source.xuid || kill.victimXuid === source.xuid,
      // A kill by the followed player: the feed highlights it with his team color.
      mien: kill.xuid === source.xuid,
      tueur: source.allegeance.ofXuid(kill.xuid), victime: source.allegeance.ofXuid(kill.victimXuid) }))
}

/** The LEFT team of the 3D banner: the game sorts by team identifier, the smallest on
 * the left. Unknown or equal: the ally team stays on the left. */
export function campAGauche(allyId: number | null | undefined, enemyId: number | null | undefined): boolean {
  if (allyId == null || enemyId == null) return true
  return allyId <= enemyId
}

/** The reading of the 3D HUD score banner: the two camps, and which camp sits on the left. */
export function lireScoreAth(source: ReturnType<typeof preparerAth>, frame: number): (ScoreBannerReading & { allieAGauche: boolean }) | null {
  const lecture = readScoreBanner(source.score, source.allegeance, frame)
  if (!lecture) return null
  return { ...lecture, allieAGauche: campAGauche(lecture.ally.teamId, lecture.enemy.teamId) }
}
