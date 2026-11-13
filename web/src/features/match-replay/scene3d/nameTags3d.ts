/**
 * nameTags3d.ts — L'ÉTIQUETTE D'UN JOUEUR selon sa distance à la caméra.
 *
 * Comme en jeu, un joueur n'est nommé qu'à portée : pleinement jusqu'à `NAME_TAG_FULL_U`, puis
 * l'étiquette s'efface jusqu'à disparaître à `NAME_TAG_RANGE_U` (pas de saut à la limite). Le
 * joueur suivi garde la sienne à toute distance, et le repère d'analyse `aids3d.allNameTags`
 * rend toutes les étiquettes à toute distance.
 *
 * Portée choisie pour une arène (les joueurs de Recharge parcourent environ 35 u sur 37 u) :
 * 14 u (~43 m) couvre un échange à moyenne portée sans nommer toute la carte d'une vue d'ensemble.
 */
import type * as THREE from 'three'
import type { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'

import { TAG_HEIGHT } from './body3d'

/** Jusqu'à cette distance de la caméra (u), l'étiquette est pleine. */
export const NAME_TAG_FULL_U = 10
/** Au-delà de cette distance (u), plus d'étiquette. */
export const NAME_TAG_RANGE_U = 14

/**
 * nameTagOpacity — l'opacité de l'étiquette à `distance` (u) de la caméra : 1 à portée pleine,
 * fondu en douceur (courbe en S) jusqu'à 0 à la limite, 0 au-delà ; 1 partout quand `always`.
 */
export function nameTagOpacity(distance: number, always: boolean): number {
  if (always || distance <= NAME_TAG_FULL_U) return 1
  if (!(distance < NAME_TAG_RANGE_U)) return 0
  const t = (NAME_TAG_RANGE_U - distance) / (NAME_TAG_RANGE_U - NAME_TAG_FULL_U)
  return t * t * (3 - 2 * t)
}

/**
 * placeTag — pose l'étiquette au-dessus des pieds `feet` et règle sa visibilité. `eye` : la
 * position de la caméra, null quand l'étiquette ne se montre pas (soi-même en 1re personne).
 */
export function placeTag(tag: CSS2DObject, feet: THREE.Vector3, eye: THREE.Vector3 | null, always: boolean): void {
  tag.position.set(feet.x, feet.y + TAG_HEIGHT, feet.z)
  // Au centième : une étiquette qui s'écrirait « 0 » est cachée, pas posée transparente.
  const opacity = eye ? Math.round(nameTagOpacity(tag.position.distanceTo(eye), always) * 100) / 100 : 0
  tag.visible = opacity > 0
  // Une valeur vide rend l'opacité du style de la pastille : pas d'écriture tant qu'elle ne change pas.
  const css = opacity >= 1 ? '' : String(opacity)
  if (tag.element.style.opacity !== css) tag.element.style.opacity = css
}
