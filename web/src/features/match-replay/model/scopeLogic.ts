/**
 * scopeLogic.ts — THE ZOOM OF THE FIRST-PERSON VIEW, a pure function of the frame.
 *
 * The film carries the scope level on the track points (`Point.s`: 0 or absent = at the
 * hip, 1, 2). This level is read with THE SAME AGE RULE as the 2D aim cone (`heldReading`
 * of `replayLogic`: a level whose age exceeds that of the aim snap, or the hold window,
 * belongs to another aim and is refused).
 *
 * THE SMOOTHED RATIO (0..1) is a pure function of the frame: it is deduced from the frame where the
 * level changed (arrival of a point or expiration of its window), never from hidden state —
 * going back in the timeline therefore returns exactly the same frame as playing forward.
 */
import {
  heldReading,
  isAliveAt,
  lastIndexAt,
  msToFrames,
} from '@/lib/replay/replayLogic'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import { REPLAY_TIMING_MS } from '../hooks/useReplayTiming'

/** The scope kind of a weapon. */
export type ScopeKind = 'scope' | 'smartLink' | 'bandit'

/**
 * The overlay style of a mounted scope: the sniper circle (black mask + cross)
 * or the holographic frame (side vignette, bands and reticle, no mask).
 */
export type ScopeStyle = 'cercle' | 'holo'

/**
 * The scope of a weapon: its kind and overlay style. The MAGNIFICATION per level comes from the
 * weapon index (the tag's own values), not from a hand table: the film does not publish a level 2
 * for a one-level scope, so a missing level is read on the last one.
 */
export interface ScopeSpec {
  kind: ScopeKind
  /** The overlay style; the sniper circle when absent. */
  style?: ScopeStyle
}

const LUNETTES = {
  s7: { kind: 'scope' },
  choc: { kind: 'scope', style: 'holo' },
  stalker: { kind: 'scope' },
  skewer: { kind: 'scope' },
  br75: { kind: 'scope' },
  vk78: { kind: 'scope' },
  bandit: { kind: 'bandit' },
} satisfies Record<string, ScopeSpec>

/**
 * SINGLE TABLE of the scopes, by MODEL KEY (the first eight digits of the
 * weapon identifier, canonical writing) when the model is known. It gives the KIND and the STYLE;
 * the magnification per level comes from the weapon index.
 */
export const SCOPES_PAR_MODELE: Readonly<Record<string, ScopeSpec>> = {
  '0a1992bc': LUNETTES.s7,
  '1a22fee6': LUNETTES.choc,
  '2b1824d5': LUNETTES.br75,
  'fd98554c': LUNETTES.vk78,
  '6acdc44d': LUNETTES.bandit,
  '2fb21c87': LUNETTES.bandit,
}

/** SINGLE TABLE, by LABEL KEY of the document (`weaponLabels[identifiant].key`). */
export const SCOPES_PAR_ETIQUETTE: Readonly<Record<string, ScopeSpec>> = {
  hinf_s7_sniper: LUNETTES.s7,
  hinf_shock_rifle: LUNETTES.choc,
  hinf_stalker_rifle: LUNETTES.stalker,
  hinf_skewer: LUNETTES.skewer,
  hinf_br75: LUNETTES.br75,
  hinf_vk78_commando: LUNETTES.vk78,
  hinf_bandit: LUNETTES.bandit,
}

/**
 * Any weapon the index gives a zoom to but the table does not list: it zooms like the game, with
 * the default kind (a light smart-link zoom, the weapon stays visible on screen) and the default
 * style (the sniper circle).
 */
export const LUNETTE_PAR_DEFAUT: ScopeSpec = { kind: 'smartLink' }

/**
 * specLunette gives the scope of a weapon: by model key first (the most stable), then by
 * label key, otherwise the default scope.
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

/** The overlay style of the scope `spec`: the sniper circle when it does not specify one. */
export function styleLunette(spec: ScopeSpec): ScopeStyle {
  return spec.style ?? 'cercle'
}

/** The label key of the weapon whose model key is `cleModele` (first eight digits of the identifier). */
export function etiquetteDe(doc: ReplayDocumentReady, cleModele: string): string | null {
  const identifiant = Object.keys(doc.weaponLabels ?? {}).find((id) => id.startsWith(cleModele))
  return identifiant ? (doc.weaponLabels?.[identifiant]?.key ?? null) : null
}

/**
 * zoomAt gives the zoom of the followed player at the frame `frame`: its level, the scope kind,
 * the smoothed ratio (0..1) and the effective magnification (1 = no zoom). Outside life: no zoom.
 */
export interface Zoom3d {
  /** The scope level (0, 1 or 2). */
  level: number
  kind: ScopeKind
  /** The smoothed ratio, 0..1: pure function of the frame (cf. file header). */
  amount: number
  /** The effective magnification of the field of view: 1 + (magnification of the level − 1) × ratio. */
  mag: number
}

/** The duration of the zoom smoothing, in real time: the film does not escape the tempo of the game. */
export const ZOOM_LISSAGE_MS = 120

/** The search window of the last level change, in frames: well beyond the smoothing. */
const FENETRE_RECHERCHE = 300

/** The life of the followed player that covers the frame, null outside life (no point is read outside life). */
function vieCouvrante(doc: ReplayDocumentReady, xuid: string, frame: number) {
  return doc.tracks.find((track) => track.xuid === xuid && isAliveAt(track, frame)) ?? null
}

/**
 * niveauDe reads the scope level of the points at the frame, with THE SHARED AGE RULE: one keeps
 * the last level transmitted, unless it dates earlier than the last aim snap (it
 * then belongs to an earlier aim) or it exceeds the hold window of the gaze.
 */
function niveauDe(points: ReplayDocumentReady['tracks'][number]['points'], frame: number, maintien: number): number {
  const visee = heldReading(points, frame, (p) => p.h, maintien)
  if (visee === null) return 0
  const cran = heldReading(points, frame, (p) => p.s, maintien)
  if (cran === null || cran.age > visee.age) return 0
  return cran.value > 0 ? Math.min(2, cran.value) : 0
}

/**
 * magCran is the magnification of the level `level` from the weapon's index magnifications
 * (`mags`, index = level - 1): 1 at the hip (level 0), and for a level past the declared ones the
 * last one (the film does not publish a level 2 for a one-level scope).
 */
function magCran(mags: number[], level: number): number {
  if (level <= 0 || mags.length === 0) return 1
  return mags[Math.min(level, mags.length) - 1]
}

/** The missing-magnification warnings, once per weapon key (the index may still be loading). */
const sansAmplification = new Set<string>()

/**
 * magsPourArme resolves the held weapon's magnifications from the index `mags`, or null when it
 * has none for the weapon (yet): a weapon the table knows but the index has no magnification for
 * does not zoom. The missing case is warned once per weapon key, the project's missing-data log.
 */
export function magsPourArme(cle: string | null | undefined, mags: number[] | null): number[] | null {
  if (mags && mags.length > 0) return mags
  if (cle && !sansAmplification.has(cle)) {
    sansAmplification.add(cle)
    console.warn('rejeu 3D : arme sans amplification dans l’index, pas de zoom', cle)
  }
  return null
}

/** The U-shaped smoothing (0..1): slow at both ends, fast in the middle. */
function lissage(u: number): number {
  const x = Math.max(0, Math.min(1, u))
  return x * x * (3 - 2 * x)
}

/**
 * dernierChangement seeks, going back from `frame`, the frame where the level changed: an
 * arrival of a point or the expiration of its hold window (t + maintien + 1). Outside the
 * search window, the level has been constant too long for the smoothing to feel it: null.
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

export function zoomAt(doc: ReplayDocumentReady, xuid: string, frame: number, spec: ScopeSpec, mags: number[] | null): Zoom3d {
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
  // From level to level (1 to 2) the ratio stays full: only the passage through 0 is smoothed.
  const amount = c === null ? 1 : avant === 0 ? lissage((frame - c) / lissageFrames) : avant > 0 ? 1 : 0
  return { level, kind: spec.kind, amount, mag: 1 + (magCran(mags ?? [], level) - 1) * amount }
}

/**
 * zoomedFov brings the vertical field of view `baseFovDeg` to the magnification `magnification`: a
 * vertical field of view θ becomes 2·atan(tan(θ/2) / magnification), in degrees.
 */
export function zoomedFov(baseFovDeg: number, magnification: number): number {
  if (magnification <= 1) return baseFovDeg
  const demi = (baseFovDeg * Math.PI) / 360
  return (2 * Math.atan(Math.tan(demi) / magnification) * 180) / Math.PI
}
