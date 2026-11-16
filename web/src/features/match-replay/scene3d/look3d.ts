/**
 * look3d.ts — LES RÉGLAGES D'ÉCLAIRAGE de la vue 3D, tels que le tiroir les porte.
 *
 * Types seulement : le tiroir et ses préférences les lisent sans tirer three.js dans le paquet
 * de la page.
 */

export interface Look3d {
  /** Ombres portées du soleil : la carte et les joueurs. */
  shadows: boolean
  /** Reflets et lumière renvoyée par la carte (sondes d'environnement). */
  reflections: boolean
  /** Occlusion ambiante à l'écran : l'assombrissement des coins et des recoins. */
  ambientOcclusion: boolean
  /** La lumière du jeu : sondes d'irradiance cuites et lampes posées de la carte. */
  gameLight: boolean
  /** Bloom: self-lit surfaces (lamps, light strips, energy blades) glow past their edges (`bloom3d`). */
  bloom: boolean
}

export const LOOK3D_DEFAULT: Look3d = { shadows: true, reflections: true, ambientOcclusion: true, gameLight: true, bloom: true }
