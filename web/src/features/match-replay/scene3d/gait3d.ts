/**
 * gait3d.ts — L'ALLURE D'UN JOUEUR LUE SUR SA PISTE : vitesse au sol, direction du déplacement et
 * distance parcourue depuis le début de sa vie, à une image (fractionnaire).
 *
 * Tout se tire des points de la vie, sans état : la même image rend la même allure, en avant comme
 * en arrière dans le rejeu. La distance est la longueur du trajet au sol, cumulée point à point
 * (un trou de réplication, `g` > 0, n'en ajoute pas : la position y saute, le joueur n'y marche pas) ;
 * elle fait avancer la phase des clips de locomotion (`motion3d`), qui suit ainsi le sol et non
 * l'horloge. La vitesse
 * se mesure sur une fenêtre (`GAIT_WINDOW`) qui lisse le tremblé des positions publiées.
 *
 * Unités du monde Halo (u, X et Y au sol), images du document ; `fps` convertit en secondes.
 */

/** Un point de piste, tel que la vue 3D le tient. */
export interface GaitPoint {
  t: number
  x: number
  y: number
  /** > 0 : trou de réplication AVANT ce point (pas d'interpolation à travers). */
  g: number
}

/** L'allure d'un joueur à une image. */
export interface Gait {
  /** Vitesse au sol (u/s). */
  speed: number
  /** Direction du déplacement (degrés, comme le cap : 0 = +X Halo, 90 = +Y). */
  heading: number
  /** Distance parcourue au sol depuis le début de la vie (u). */
  distance: number
}

/** La fenêtre de mesure de la vitesse (s) : deux images à la cadence de 10 images/s des films. */
export const GAIT_WINDOW = 0.2

/** L'intervalle de points qui encadre l'image `f` et la part `u` du chemin de `lo` à `hi`. */
export interface Bracket {
  lo: number
  hi: number
  u: number
}

/**
 * bracketAt : les points qui encadrent l'image `f` (bornée aux extrémités de la vie). Après un trou
 * de réplication, la position tient (`u` = 0) jusqu'au point suivant. Écrit dans `out` quand il est
 * donné.
 */
export function bracketAt(pts: readonly GaitPoint[], f: number, out?: Bracket): Bracket {
  const br = out ?? { lo: 0, hi: 0, u: 0 }
  let lo = 0
  let hi = pts.length - 1
  br.u = 0
  if (f <= pts[0].t) hi = 0
  else if (f >= pts[hi].t) lo = hi
  else {
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (pts[mid].t <= f) lo = mid
      else hi = mid
    }
    const b = pts[hi]
    br.u = b.g > 0 ? 0 : (f - pts[lo].t) / (b.t - pts[lo].t)
  }
  br.lo = lo
  br.hi = hi
  return br
}

/** lifeDistances : la distance au sol cumulée à chaque point de la vie (u), 0 au premier. */
export function lifeDistances(pts: readonly GaitPoint[]): number[] {
  const out = new Array<number>(pts.length)
  let d = 0
  pts.forEach((p, i) => {
    if (i > 0 && p.g <= 0) d += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y)
    out[i] = d
  })
  return out
}

/** lerpAt : la valeur par point `values` à l'intervalle `br`, interpolée. */
export function lerpAt(values: ArrayLike<number>, br: Bracket): number {
  return values[br.lo] + (values[br.hi] - values[br.lo]) * br.u
}

// Les intervalles de `gaitAt`, réécrits à chaque appel.
const NOW: Bracket = { lo: 0, hi: 0, u: 0 }
const THEN: Bracket = { lo: 0, hi: 0, u: 0 }

/**
 * gaitAt : l'allure à l'image `f` d'une vie de points `pts` (distances `dist` de `lifeDistances`),
 * `fps` images par seconde. La vitesse est le déplacement sur la fenêtre, jamais plus que le trajet
 * parcouru dans cette fenêtre : un saut de trou de réplication ne compte pas. Écrite dans `out`
 * quand il est donné (aucune allocation), sinon dans une allure neuve.
 */
export function gaitAt(pts: readonly GaitPoint[], dist: readonly number[], f: number, fps: number, out?: Gait): Gait {
  const g = out ?? { speed: 0, heading: 0, distance: 0 }
  const now = bracketAt(pts, f, NOW)
  g.distance = lerpAt(dist, now)
  g.speed = 0
  g.heading = 0
  const from = Math.max(pts[0].t, f - GAIT_WINDOW * fps)
  const seconds = (f - from) / fps
  if (seconds <= 0) return g
  const then = bracketAt(pts, from, THEN)
  const a = pts[then.lo]
  const b = pts[then.hi]
  const c = pts[now.lo]
  const d = pts[now.hi]
  const dx = c.x + (d.x - c.x) * now.u - (a.x + (b.x - a.x) * then.u)
  const dy = c.y + (d.y - c.y) * now.u - (a.y + (b.y - a.y) * then.u)
  const moved = Math.min(Math.hypot(dx, dy), g.distance - lerpAt(dist, then))
  g.heading = (Math.atan2(dy, dx) * 180) / Math.PI
  g.speed = moved / seconds
  return g
}
