// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * shields3d.ts — LE BOUCLIER D'UN JOUEUR, lu dans sa piste pour les effets du corps.
 *
 * Le document publie, par point de piste, la fraction de bouclier (`Point.sh`, 0..1, bornée à 1 :
 * un surbouclier ne s'y distingue pas). Le film ne la réplique QU'AU CHANGEMENT : une baisse est
 * un coup encaissé, un passage à zéro une rupture, une suite de hausses image après image une
 * recharge (mesuré sur 512155b9 : 962 baisses dont 235 ruptures, hausses de 0,047 par image).
 *
 * Les effets sont une FONCTION DE L'IMAGE : l'éclat décroît avec le temps écoulé depuis la
 * dernière baisse publiée avant l'image, la rupture avec le temps depuis le dernier passage à zéro,
 * la recharge vaut tant que deux mesures voisines de l'image montent. Rien ne s'accumule : avancer,
 * reculer ou sauter rend la même valeur à la même image.
 */

/** Les mesures de bouclier d'une vie, triées par image (seulement les points qui en portent). */
export interface ShieldSamples {
  t: number[]
  v: number[]
}

/** Ce que le corps montre du bouclier à une image. */
export interface ShieldFx {
  /** L'éclat d'un coup encaissé (0..1), plus fort pour une grosse baisse, décroissant. */
  hit: number
  /** La rupture (0..1) : 1 à l'instant où le bouclier tombe à zéro, puis décroissante. */
  broke: number
  /** Le temps (s) depuis la rupture, -1 sans rupture en cours : l'éclatement s'étend avec lui. */
  breakAge: number
  /** La recharge (0 ou 1) : le bouclier remonte autour de l'image. */
  recharge: number
  /** Le temps (s) depuis le début de la remontée en cours, -1 hors recharge. */
  rechargeAge: number
}

/** Durée de l'éclat d'un coup (s) : un tir soutenu le tient allumé, il s'éteint après le dernier. */
export const HIT_SECONDS = 0.4
/** Durée de l'éclatement d'une rupture (s) : un éclair bref. */
export const BREAK_SECONDS = 0.25
// En deçà, une différence de mesure n'est pas un changement (arrondi de publication).
const EPS = 0.005
// Deux mesures montantes à plus de tant d'images l'une de l'autre ne font pas une recharge : le film
// réplique la recharge à chaque image (mesuré), un écart plus long est un trou de réplication.
const RECHARGE_GAP_FRAMES = 2
// L'éclat d'une baisse : un plancher, plus la part de la baisse (0,25 = un coup de BR fait ~0,9).
const HIT_FLOOR = 0.4
const HIT_PER_DROP = 2

export const NO_SHIELD_FX: Readonly<ShieldFx> = Object.freeze({ hit: 0, broke: 0, breakAge: -1, recharge: 0, rechargeAge: -1 })

/** lastAtOrBefore : le rang de la dernière mesure à l'image `f` ou avant, -1 s'il n'y en a pas. */
function lastAtOrBefore(t: readonly number[], f: number): number {
  let lo = 0
  let hi = t.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (t[mid] <= f) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

/**
 * shieldFxAt : ce que le corps montre du bouclier à l'image `f` (fractionnaire), `fps` images par
 * seconde. `out` reçoit le résultat (aucune allocation par image) et est rendu.
 */
export function shieldFxAt(s: ShieldSamples, f: number, fps: number, out: ShieldFx): ShieldFx {
  Object.assign(out, NO_SHIELD_FX)
  const { t, v } = s
  const k = lastAtOrBefore(t, f)
  if (k < 0) return out
  const window = Math.max(HIT_SECONDS, BREAK_SECONDS) * fps
  for (let j = k; j >= 1 && f - t[j] < window; j--) {
    if (v[j] >= v[j - 1] - EPS) continue
    const age = (f - t[j]) / fps
    if (age < HIT_SECONDS) {
      const u = 1 - age / HIT_SECONDS
      out.hit = u * u * Math.min(1, HIT_FLOOR + HIT_PER_DROP * (v[j - 1] - v[j]))
    }
    if (v[j] <= EPS && v[j - 1] > EPS && age < BREAK_SECONDS) {
      out.broke = 1 - age / BREAK_SECONDS
      out.breakAge = age
    }
    break
  }
  out.recharge = rising(t, v, k, k + 1) || (f - t[k] <= RECHARGE_GAP_FRAMES && rising(t, v, k - 1, k)) ? 1 : 0
  if (out.recharge > 0) {
    // Le début de la remontée : la première mesure de la suite montante qui mène à l'image.
    let start = k
    while (rising(t, v, start - 1, start)) start--
    out.rechargeAge = Math.max(0, (f - t[start]) / fps)
  }
  return out
}

/** rising : la mesure `b` suit `a` de près et monte. */
function rising(t: readonly number[], v: readonly number[], a: number, b: number): boolean {
  return a >= 0 && b < t.length && t[b] - t[a] <= RECHARGE_GAP_FRAMES && v[b] > v[a] + EPS
}

/** shieldSamplesOf : les mesures de bouclier des points d'une piste (ceux qui en portent). */
export function shieldSamplesOf(points: readonly { t: number; sh?: number }[]): ShieldSamples {
  const out: ShieldSamples = { t: [], v: [] }
  for (const p of points) {
    if (p.sh === undefined) continue
    out.t.push(p.t)
    out.v.push(p.sh)
  }
  return out
}
