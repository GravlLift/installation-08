/**
 * fineTracks3d.ts — LA VIE AU DÉBIT DU FILM, MISE EN POINTS POUR LA VUE 3D.
 *
 * `tracks[].fullRate` (schéma 109, relu par `lib/replay/replayFullRate.ts`) porte chaque position
 * et chaque visée que le film réplique, à son instant : 60 ou 30 par seconde selon le film, contre
 * un point par image de 100 ms dans `points`. Ce module en tire la suite de points que
 * `tracks3d.ts` interpole, à la place des points de la grille.
 *
 * DEUX AXES DE TEMPS, ET AUCUN N'EST PLIÉ SUR L'AUTRE AU MOMENT DE LA LECTURE. Les points suivent
 * les instants des POSITIONS ; la visée de chaque point se lit sur l'axe des VISÉES, à l'instant du
 * point (interpolée entre les deux visées qui l'encadrent). Comme toute visée publiée vient d'un
 * record de position, chaque instant de visée est aussi un instant de point : la visée y est exacte.
 *
 * LE SILENCE N'EST PAS UN MOUVEMENT LENT. Le film ne réplique que ce qui change : un corps immobile
 * se tait, puis le premier record après le silence décrit le pas d'UN tick. Interpoler sur tout le
 * silence ferait glisser le joueur pendant qu'il était immobile ; on tient donc la dernière valeur
 * jusqu'à un tick avant la suivante (`holdUntil`), pour les positions comme pour la visée. Une
 * LACUNE (`gaps`, plus de 5 s) reste une rupture : le point qui la suit porte `g = 1`, et
 * l'interpolation ne la traverse pas (`gait3d.bracketAt`).
 */
import type { ReplayFullRateReady } from '@/lib/replay/replayFullRate'

/** Un point de vie au débit du film : la forme que `tracks3d.ts` interpole. */
export interface FineLifePoint {
  t: number
  x: number
  y: number
  z: number
  g: number
  h: number
  p: number
  aim: boolean
}

/** Au-delà de ce nombre de ticks sans échantillon, la valeur se tient au lieu de s'interpoler. */
export const HOLD_AFTER_TICKS = 3

/** Le tick de la vie, en images : l'écart médian entre deux positions (repli : 60 Hz sur 100 ms). */
export function lifeTick(t: readonly number[]): number {
  const dts: number[] = []
  for (let i = 1; i < t.length; i++) if (t[i] > t[i - 1]) dts.push(t[i] - t[i - 1])
  if (dts.length === 0) return 1 / 6
  dts.sort((a, b) => a - b)
  return dts[dts.length >> 1]
}

/**
 * aimAt : la visée (cap, élévation, en degrés) à l'image `f`, lue sur l'axe des visées. Avant la
 * première visée, la première ; après la dernière, la dernière ; entre deux visées proches,
 * l'interpolation (cap par le plus court chemin) ; après un silence, la tenue jusqu'à un tick avant
 * la suivante. `known` dit qu'une visée précède `f`.
 */
export function aimAt(fr: ReplayFullRateReady, f: number, tick: number): { h: number; p: number; known: boolean } {
  const n = fr.aimT.length
  if (n === 0) return { h: 0, p: 0, known: false }
  if (f < fr.aimT[0]) return { h: fr.h[0], p: fr.p[0], known: false }
  let lo = 0
  let hi = n - 1
  if (f >= fr.aimT[hi]) return { h: fr.h[hi], p: fr.p[hi], known: true }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (fr.aimT[mid] <= f) lo = mid
    else hi = mid
  }
  const u = holdFraction(fr.aimT[lo], fr.aimT[hi], f, tick)
  const dh = ((fr.h[hi] - fr.h[lo] + 540) % 360) - 180
  return { h: fr.h[lo] + dh * u, p: fr.p[lo] + (fr.p[hi] - fr.p[lo]) * u, known: true }
}

/** La fraction d'interpolation entre `a` et `b` à `f`, tenue à 0 jusqu'à un tick avant `b` après un silence. */
function holdFraction(a: number, b: number, f: number, tick: number): number {
  if (b <= a) return 0
  const from = b - a > HOLD_AFTER_TICKS * tick ? b - tick : a
  return f <= from ? 0 : (f - from) / (b - from)
}

/**
 * fineLifePoints : les points de la vie au débit du film, visée comprise. Après un silence de plus
 * de `HOLD_AFTER_TICKS` ticks (hors lacune), un point de tenue reprend la position précédente un tick
 * avant l'échantillon qui suit le silence, pour que l'interpolation linéaire de `tracks3d` tienne le
 * corps immobile pendant le silence.
 */
export function fineLifePoints(fr: ReplayFullRateReady): FineLifePoint[] {
  const tick = lifeTick(fr.t)
  const gaps = new Set(fr.gaps)
  const out: FineLifePoint[] = []
  const at = (t: number, i: number, g: number): FineLifePoint => {
    const a = aimAt(fr, t, tick)
    return { t, x: fr.x[i], y: fr.y[i], z: fr.z[i], g, h: a.h, p: a.p, aim: a.known }
  }
  for (let i = 0; i < fr.t.length; i++) {
    const gap = gaps.has(i)
    if (i > 0 && !gap && fr.t[i] - fr.t[i - 1] > HOLD_AFTER_TICKS * tick) {
      out.push(at(fr.t[i] - tick, i - 1, 0))
    }
    out.push(at(fr.t[i], i, gap ? 1 : 0))
  }
  return out
}
