/**
 * scopeLogic.ts — LE ZOOM DE LA VUE 1re PERSONNE, fonction pure de l'image.
 *
 * Le film porte le cran de lunette sur les points des pistes (`Point.s` : 0 ou absent = à la
 * hanche, 1, 2). On lit ce cran avec LA MEME REGLE D'ÂGE que le cône de visée 2D (`heldReading`
 * de `replayLogic` : un cran dont l'âge dépasse celui du cap de visée, ou la fenêtre de maintien,
 * appartient à une autre visée et est refusé).
 *
 * L'AMPLISSÉE LISSÉE (0..1) est une fonction pure de l'image : elle se déduit de l'image où le
 * cran a changé (arrivée d'un point ou expiration de sa fenêtre), jamais d'un état caché —
 * revenir en arrière dans la frise rend donc exactement la même image que de jouer.
 */
import {
  heldReading,
  isAliveAt,
  lastIndexAt,
  msToFrames,
} from '@/lib/replay/replayLogic'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import { REPLAY_TIMING_MS } from '../hooks/useReplayTiming'

/** Le genre de lunette d'une arme. */
export type ScopeKind = 'scope' | 'smartLink' | 'bandit'

/**
 * Le style de l'overlay d'une lunette montée : le cercle du tireur d'élite (masque noir + croix)
 * ou le cadre holographique (vignette latérale, bandes et réticule, sans masque).
 */
export type ScopeStyle = 'cercle' | 'holo'

/**
 * La lunette d'une arme : son genre et l'AMPLIFICATION par cran (index = cran - 1 ; un cran
 * manquant se lit sur le dernier — le film ne publie pas de cran 2 pour une lunette à un cran).
 * Valeurs de départ : le réglage fin se fera à l'écran, d'oici une table unique nommée.
 */
export interface ScopeSpec {
  kind: ScopeKind
  mags: number[]
  /** Le style de l'overlay ; le cercle du tireur d'élite quand absent. */
  style?: ScopeStyle
}

const LUNETTES = {
  s7: { kind: 'scope', mags: [5, 10] },
  choc: { kind: 'scope', mags: [2.5, 5], style: 'holo' },
  stalker: { kind: 'scope', mags: [2.5, 5] },
  skewer: { kind: 'scope', mags: [2.5, 5] },
  br75: { kind: 'scope', mags: [2] },
  vk78: { kind: 'scope', mags: [1.5] },
  bandit: { kind: 'bandit', mags: [1.6] },
} satisfies Record<string, ScopeSpec>

/**
 * TABLE UNIQUE des lunettes, par CLÉ DE MODÈLE (les huit premiers chiffres de l'identifiant de
 * l'arme, écriture canonique) quand le modèle est connu.
 */
export const SCOPES_PAR_MODELE: Readonly<Record<string, ScopeSpec>> = {
  '0a1992bc': LUNETTES.s7,
  '1a22fee6': LUNETTES.choc,
  '2b1824d5': LUNETTES.br75,
  'fd98554c': LUNETTES.vk78,
  '6acdc44d': LUNETTES.bandit,
  '2fb21c87': LUNETTES.bandit,
}

/** TABLE UNIQUE, par CLÉ DE LIBELLÉ du document (`weaponLabels[identifiant].key`). */
export const SCOPES_PAR_ETIQUETTE: Readonly<Record<string, ScopeSpec>> = {
  hinf_s7_sniper: LUNETTES.s7,
  hinf_shock_rifle: LUNETTES.choc,
  hinf_stalker_rifle: LUNETTES.stalker,
  hinf_skewer: LUNETTES.skewer,
  hinf_br75: LUNETTES.br75,
  hinf_vk78_commando: LUNETTES.vk78,
  hinf_bandit: LUNETTES.bandit,
}

/** Toute arme non listée : un léger zoom, l'arme reste visible à l'écran. */
export const LUNETTE_PAR_DEFAUT: ScopeSpec = { kind: 'smartLink', mags: [1.4] }

/**
 * specLunette donne la lunette d'une arme : par clé de modèle d'abord (la plus stable), puis par
 * clé de libellé, sinon la lunette par défaut.
 */
export function specLunette(
  cleModele: string | null | undefined,
  cleEtiquette: string | null | undefined,
): ScopeSpec {
  if (cleModele) {
    const parModele = SCOPES_PAR_MODELE[cleModele]
    if (parModele) return parModele
  }
  if (cleEtiquette) {
    const parEtiquette = SCOPES_PAR_ETIQUETTE[cleEtiquette]
    if (parEtiquette) return parEtiquette
  }
  return LUNETTE_PAR_DEFAUT
}

/** Le style d'overlay de la lunette `spec` : le cercle du tireur d'élite quand elle n'en précise pas. */
export function styleLunette(spec: ScopeSpec): ScopeStyle {
  return spec.style ?? 'cercle'
}

/** La clé de libellé de l'arme dont la clé de modèle est `cleModele` (huit premiers chiffres de l'identifiant). */
export function etiquetteDe(doc: ReplayDocumentReady, cleModele: string): string | null {
  const identifiant = Object.keys(doc.weaponLabels ?? {}).find((id) => id.startsWith(cleModele))
  return identifiant ? (doc.weaponLabels?.[identifiant]?.key ?? null) : null
}

/**
 * zoomAt donne le zoom du joueur suivi à l'image `frame` : son cran, le genre de lunette,
 * l'amplissée lissée (0..1) et l'amplification effective (1 = aucun zoom). Hors vie : pas de zoom.
 */
export interface Zoom3d {
  /** Le cran de lunette (0, 1 ou 2). */
  level: number
  kind: ScopeKind
  /** L'amplissée lissée, 0..1 : fonction pure de l'image (cf. tête de fichier). */
  amount: number
  /** L'amplification effective du champ : 1 + (amplification du cran − 1) × amplissée. */
  mag: number
}

/** La durée du lissage du zoom, en temps réel : le film n'échappe pas au tempo du jeu. */
export const ZOOM_LISSAGE_MS = 120

/** La fenêtre de recherche du dernier changement de cran, en frames : bien au-delà du lissage. */
const FENETRE_RECHERCHE = 300

/** La vie du joueur suivi qui couvre l'image, null hors vie (aucun point n'est lu hors vie). */
function vieCouvrante(doc: ReplayDocumentReady, xuid: string, frame: number) {
  return doc.tracks.find((track) => track.xuid === xuid && isAliveAt(track, frame)) ?? null
}

/**
 * niveauDe lit le cran de lunette des points à l'image, avec LA REGLE D'ÂGE PARTAGÉE : on garde
 * le dernier cran transmis, sauf s'il date plus longtemps que le dernier cap de visée (il
 * appartient alors à une visée antérieure) ou s'il dépasse la fenêtre de maintien du regard.
 */
function niveauDe(points: ReplayDocumentReady['tracks'][number]['points'], frame: number, maintien: number): number {
  const visee = heldReading(points, frame, (p) => p.h, maintien)
  if (visee === null) return 0
  const cran = heldReading(points, frame, (p) => p.s, maintien)
  if (cran === null || cran.age > visee.age) return 0
  return cran.value > 0 ? Math.min(2, cran.value) : 0
}

/** L'amplification du cran `level` pour la lunette (1 : hanche). */
function magCran(spec: ScopeSpec, level: number): number {
  if (level <= 0) return 1
  return spec.mags[Math.min(level, spec.mags.length) - 1]
}

/** Le lissage en U (0..1) : lent aux deux bouts, vite au milieu. */
function lissage(u: number): number {
  const x = Math.max(0, Math.min(1, u))
  return x * x * (3 - 2 * x)
}

/**
 * dernierChangement cherche, en remontant depuis `frame`, l'image où le cran a changé : une
 * arrivée de point ou l'expiration de sa fenêtre de maintien (t + maintien + 1). Hors la fenêtre
 * de recherche, le cran est constant depuis trop longtemps pour que le lissage le sente : null.
 */
function dernierChangement(
  points: ReplayDocumentReady['tracks'][number]['points'],
  debutVie: number,
  frame: number,
  maintien: number,
): number | null {
  const niveau = (f: number) => (f < debutVie ? 0 : niveauDe(points, f, maintien))
  const candidats: number[] = []
  const borne = Math.max(FENETRE_RECHERCHE, maintien + 1)
  const i = lastIndexAt(points, frame)
  for (let k = i; k >= 0; k--) {
    const t = points[k].t
    if (t < frame - borne) break
    candidats.push(t, t + maintien + 1)
  }
  candidats.push(debutVie)
  candidats.sort((a, b) => b - a)
  let precedent = Infinity
  for (const c of candidats) {
    if (c > frame || c === precedent) continue
    precedent = c
    if (niveau(c) !== niveau(c - 1)) return c
  }
  return null
}

export function zoomAt(doc: ReplayDocumentReady, xuid: string, frame: number, spec: ScopeSpec): Zoom3d {
  const vie = vieCouvrante(doc, xuid, frame)
  if (!vie) return { level: 0, kind: spec.kind, amount: 0, mag: 1 }
  const maintien = msToFrames(REPLAY_TIMING_MS.aimHold, doc)
  const lissageFrames = Math.max(1, msToFrames(ZOOM_LISSAGE_MS, doc))
  const level = niveauDe(vie.points, frame, maintien)
  if (level === 0) {
    const c = dernierChangement(vie.points, vie.startFrame ?? 0, frame, maintien)
    const amount = c === null ? 0 : 1 - lissage((frame - c) / lissageFrames)
    return { level: 0, kind: spec.kind, amount, mag: 1 }
  }
  const c = dernierChangement(vie.points, vie.startFrame ?? 0, frame, maintien)
  const avant = c === null ? level : c - 1 < (vie.startFrame ?? 0) ? 0 : niveauDe(vie.points, c - 1, maintien)
  // De cran à cran (1 vers 2) l'amplissée reste pleine : seul le passage par 0 se lisse.
  const amount = c === null ? 1 : avant === 0 ? lissage((frame - c) / lissageFrames) : avant > 0 ? 1 : 0
  return { level, kind: spec.kind, amount, mag: 1 + (magCran(spec, level) - 1) * amount }
}

/**
 * zoomedFov ramène le champ vertical `baseFovDeg` à l'amplification `magnification` : un champ
 * vertical θ devient 2·atan(tan(θ/2) / magnification), en degrés.
 */
export function zoomedFov(baseFovDeg: number, magnification: number): number {
  if (magnification <= 1) return baseFovDeg
  const demi = (baseFovDeg * Math.PI) / 360
  return (2 * Math.atan(Math.tan(demi) / magnification) * 180) / Math.PI
}
