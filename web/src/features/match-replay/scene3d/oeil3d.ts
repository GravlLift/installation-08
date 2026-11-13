/**
 * oeil3d.ts — LA DESCENTE DE L'ŒIL : quelle hauteur (unités monde) l'œil perd accroupi ou en
 * glissade, en fondu à l'entrée comme à la sortie.
 *
 * Le jeu tient la 1re personne à la même hauteur d'œil accroupi et en glissade : les intervalles
 * des deux postures d'un emplacement se fusionnent, et la descente est leur enveloppe continue —
 * fondu à l'entrée, fondu à la sortie, jamais de saut, jamais au-delà de ce que le fondu d'entrée
 * a atteint. Fonction pure de l'image : rien n'est mémorisé entre deux images, et la même image
 * donne la même descente parcourue en avant comme en arrière.
 */
import { CROUCH_DROP } from './body3d'

/** Temps (secondes) du fondu de la descente quand l'accroupissement ou la glissade commence. */
export const DUREE_ENTREE_OEIL = 0.2
/** Temps (secondes) du retour de l'œil à la hauteur debout quand le dernier intervalle se termine. */
export const DUREE_SORTIE_OEIL = 0.25

/** Un intervalle de descente fusionné : [t0, fin) en images, la fin exclusive. */
export interface IntervalleOeil {
  t0: number
  fin: number
}

/** Sans intervalle : la liste vide partagée (aucun allouement par appel de dropOeil). */
export const SANS_INTERVALLE: readonly IntervalleOeil[] = []

/**
 * fusionnerIntervallees trie et unit les intervalles demi-ouverts [t0, fin) : ceux qui se touchent
 * ou se chevauchent n'en font qu'un, sans changer les bornes de l'union.
 */
export function fusionnerIntervallees(liste: readonly IntervalleOeil[]): IntervalleOeil[] {
  const triees = [...liste].sort((a, b) => a.t0 - b.t0)
  const fusionnes: IntervalleOeil[] = []
  for (const it of triees) {
    const dernier = fusionnes[fusionnes.length - 1]
    if (dernier && it.t0 <= dernier.fin) {
      if (it.fin > dernier.fin) dernier.fin = it.fin
    } else fusionnes.push({ ...it })
  }
  return fusionnes
}

/** Le smoothstep borné à [0, 1] : 0 en 0, 1/2 au milieu, 1 en 1. */
function lissage(u: number): number {
  const x = u < 0 ? 0 : u > 1 ? 1 : u
  return x * x * (3 - 2 * x)
}

/**
 * dropOeil : la descente de l'œil en unités monde à l'image fractionnaire `f` — 0 debout,
 * CROUCH_DROP enfoncé accroupi ou en glissade. Fondu de `entree` images à l'entrée, de `sortie`
 * à la sortie ; pour un intervalle plus court que le fondu, la descente est le fondu d'entrée
 * limité par le fondu de sortie (jamais de saut, jamais au-delà de ce que l'entrée a atteint).
 * `intervallees` : les intervalles fusionnés et triés de l'emplacement (`fusionnerIntervallees`).
 */
export function dropOeil(intervallees: readonly IntervalleOeil[], f: number, entree: number, sortie: number): number {
  if (intervallees.length === 0) return 0
  // Le dernier intervalle commencé (t0 <= f) ; après lui, rien n'est encore entré.
  let deb = 0, fin = intervallees.length
  while (deb < fin) {
    const m = (deb + fin) >> 1
    if (intervallees[m].t0 <= f) deb = m + 1
    else fin = m
  }
  let haut = deb - 1
  if (haut < 0) return 0
  // Le premier intervalle dont la queue de sortie couvre encore f ; avant lui, les fondues sont finies.
  deb = 0; fin = haut + 1
  while (deb < fin) {
    const m = (deb + fin) >> 1
    if (intervallees[m].fin > f - sortie) fin = m
    else deb = m + 1
  }
  let max = 0
  for (let i = deb; i <= haut; i++) {
    const it = intervallees[i]
    const entreeOeil = lissage((f - it.t0) / entree)
    const sortieOeil = 1 - lissage((f - it.fin) / sortie)
    const v = entreeOeil < sortieOeil ? entreeOeil : sortieOeil
    if (v > max) max = v
  }
  return max * CROUCH_DROP
}
