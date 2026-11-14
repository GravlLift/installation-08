/**
 * aids3d.ts — LES REPÈRES D'ANALYSE de la vue 3D : ce que la vue sait tracer et que le jeu ne
 * montre pas. Tous éteints par défaut : la vue ressemble au jeu, le tiroir les allume.
 *
 * Types seulement : le tiroir et ses préférences les lisent sans tirer three.js dans le paquet
 * de la page.
 */

export interface Aids3d {
  /** Le vol entier de chaque tir, de la bouche au mur, et le trait du tueur vers sa victime. */
  shotLines: boolean
  /** Les croix au sol des morts et leur étiquette « tueur › victime · arme » dans la scène. */
  deathMarkers: boolean
  /** Le chemin parcouru par les grenades et les projectiles de tir. */
  projectilePaths: boolean
  /** La sphère du rayon de dégâts d'une explosion, une seconde après la détonation. */
  blastRadius: boolean
  /** Le câble du grappin en trait épais et clair, et son point d'accroche. */
  grappleLines: boolean
  /** La flèche de la poussée du répulseur, de la couleur de son auteur. */
  knockbackArrows: boolean
  /**
   * Les formes des poses hors mur, capteur et champ de réparation (que le jeu montre, et qui restent
   * allumés) : écran occultant, traqueur, failles du translocateur, objets lâchés.
   */
  placementShapes: boolean
  /** L'étiquette de chaque joueur à toute distance ; éteint, seulement à portée (`nameTags3d`). */
  allNameTags: boolean
}

/** L'ordre du tiroir : tirs et morts, projectiles, équipement, joueurs. */
export const AIDS3D_ORDER: readonly (keyof Aids3d)[] = [
  'shotLines',
  'deathMarkers',
  'projectilePaths',
  'blastRadius',
  'grappleLines',
  'knockbackArrows',
  'placementShapes',
  'allNameTags',
]

export const AIDS3D_DEFAULT: Aids3d = {
  shotLines: false,
  deathMarkers: false,
  projectilePaths: false,
  blastRadius: false,
  grappleLines: false,
  knockbackArrows: false,
  placementShapes: false,
  allNameTags: false,
}
