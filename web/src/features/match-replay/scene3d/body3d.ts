// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * body3d.ts — LES COTES DU JOUEUR dans la scène 3D, en unités monde Halo (1 u = 3,048 m),
 * mesurées depuis les pieds. La capsule, la caméra et les calques d'action (bouche de l'arme,
 * objets portés au-dessus de la tête) les partagent.
 */

/** Rayon et longueur du cylindre de la capsule ; centre du corps au-dessus des pieds. */
export const BODY_RADIUS = 0.12
export const BODY_LENGTH = 0.45
export const BODY_CENTER = 0.345
/** L'œil : ~1,9 m, celui d'un Spartiate. */
export const EYE_HEIGHT = 0.62
/** La visée part du haut du buste (au-dessus du centre du corps). */
export const AIM_HEIGHT = 0.27
/** La bouche de l'arme : à hauteur de visée. */
export const MUZZLE_HEIGHT = BODY_CENTER + AIM_HEIGHT
/** Le sommet de la tête : ce qu'un joueur porte au-dessus de lui se pose là. */
export const HEAD_TOP = BODY_CENTER + BODY_RADIUS + BODY_LENGTH / 2
/** Accroupi, le corps perd cette hauteur. */
export const CROUCH_DROP = 0.27
/** L'étiquette du joueur. */
export const TAG_HEIGHT = 0.85
