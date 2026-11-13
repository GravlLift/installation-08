/**
 * fovLogic.ts — LE CHAMP DE VISION du rejeu 3D, fonctions pures de l'image.
 *
 * Le réglage du jeu (70 à 120) est un angle HORIZONTAL à 16:9 : le jeu garde l'angle vertical
 * quand la fenêtre est plus étroite (les côtés sont rognés). La caméra 3D porte l'angle
 * VERTICAL équivalent, calculé ici ; le zoom de lunette multiplie depuis cette base
 * (`scopeLogic`), et le rig première personne (`brasPremierePersonne3d`) se contre-échelle à
 * sa base de réglage (`viewmodelScale`) pour garder la taille d'arme posée à l'œil.
 */

/** La borne basse du réglage de champ du jeu, en degrés horizontaux à 16:9. */
export const GAME_FOV_MIN = 70
/** La borne haute du réglage de champ du jeu, en degrés horizontaux à 16:9. */
export const GAME_FOV_MAX = 120
/** Le réglage de champ par défaut, en degrés horizontaux à 16:9. */
export const GAME_FOV_DEFAULT = 100

/**
 * verticalFovOf donne l'angle VERTICAL en degrés du champ horizontal `gameFovDeg` à 16:9 :
 * les demi-champs se comparent par tangente, et le rapport des demi-champs est 16 : 9.
 */
export function verticalFovOf(gameFovDeg: number): number {
  const demi = (gameFovDeg * Math.PI) / 360
  return (2 * Math.atan(Math.tan(demi) * (9 / 16)) * 180) / Math.PI
}

/**
 * viewmodelScale donne le facteur d'échelle d'un rig réglé à un champ vertical
 * `viewmodelFovDeg` pour le porter sous un champ vertical `cameraFovDeg` : la taille projetée
 * d'un objet à distance fixe suit le demi-champ (tangente).
 */
export function viewmodelScale(cameraFovDeg: number, viewmodelFovDeg: number): number {
  return Math.tan((cameraFovDeg * Math.PI) / 360) / Math.tan((viewmodelFovDeg * Math.PI) / 360)
}
