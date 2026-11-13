/**
 * replayFullRate.ts — LA VIE AU DÉBIT DU FILM (schéma 109), relue à la frontière.
 *
 * Le serveur publie, à côté des points de la grille (`tracks[].points`, un par image), TOUS les
 * échantillons de position et de visée que le film réplique pour la vie (`tracks[].fullRate`), en
 * colonnes DIFFÉRENTIELLES d'entiers : la première valeur d'une colonne est absolue, chaque suivante
 * est l'écart à la précédente. Le producteur en décrit l'encodage
 * (`libs/film/replay/tracks_plein_debit.go`) ; ce module en est le SEUL lecteur.
 *
 * CE QUE LA LECTURE REND, dans les unités du reste du document :
 *  - `t`, `aimT` : l'IMAGE FRACTIONNAIRE de chaque échantillon (millisecondes / `frameIntervalMs`),
 *    sur le même axe que `points[].t` — sa partie entière est l'image où la grille le range ;
 *  - `x`, `y`, `z` : unités monde, les valeurs de `points[]` (centièmes) ;
 *  - `h`, `p` : degrés, mêmes conventions que `points[].h` / `points[].p`, au quantum du film
 *    (cap 360/4096, élévation 360/2048) au lieu du dixième de degré arrondi ;
 *  - `gaps` : les indices des échantillons qu'une LACUNE précède (la règle de `points[].g`) — on
 *    tient la position jusqu'à eux, on n'interpole pas au travers.
 *
 * Position et visée gardent CHACUNE leurs instants : la visée n'arrive pas sur chaque record de
 * position, et la lecture ne rééchantillonne pas l'une sur l'autre.
 */
import type { ReplayFullRateTrack } from '@/lib/api/types'

/** Quanta du cap de visée sur un tour (R(12) du composant i21). */
export const FULL_RATE_HEADING_QUANTA = 4096
/** Quanta de l'élévation sur un tour, centrée sur la moitié (R(11) du composant i21). */
export const FULL_RATE_PITCH_QUANTA = 2048

/** La vie au débit du film, relue : cf. l'en-tête du module. */
export interface ReplayFullRateReady {
  t: number[]
  x: number[]
  y: number[]
  z: number[]
  gaps: number[]
  aimT: number[]
  h: number[]
  p: number[]
}

/**
 * Somme cumulée d'une colonne différentielle, divisée par `divisor` (null = colonne vide). La somme
 * reste ENTIÈRE et la division vient en dernier : `1234 / 100` rend exactement le nombre que
 * `JSON.parse("12.34")` rend pour le point de la grille.
 */
function cumulate(col: readonly number[] | null | undefined, divisor: number): number[] {
  const values = col ?? []
  const out = new Array<number>(values.length)
  let acc = 0
  for (let i = 0; i < values.length; i++) {
    acc += values[i]
    out[i] = acc / divisor
  }
  return out
}

/**
 * decodeFullRate relit la piste au plein débit d'une vie. `frameIntervalMs` est celui du document
 * (`frameIntervalMs`), qui fixe l'échelle de l'image.
 */
export function decodeFullRate(raw: ReplayFullRateTrack, frameIntervalMs: number): ReplayFullRateReady {
  const hq = cumulate(raw.h, 1)
  const pq = cumulate(raw.p, 1)
  return {
    t: cumulate(raw.t, frameIntervalMs),
    x: cumulate(raw.x, 100),
    y: cumulate(raw.y, 100),
    z: cumulate(raw.z, 100),
    gaps: [...(raw.gaps ?? [])],
    aimT: cumulate(raw.aimT, frameIntervalMs),
    h: hq.map((q) => ((q + 0.5) * 360) / FULL_RATE_HEADING_QUANTA),
    p: pq.map((q) => ((q + 0.5) * 360) / FULL_RATE_PITCH_QUANTA - 180),
  }
}
