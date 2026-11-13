/**
 * cadenceImages_logic.ts — la cadence des images de l'écran, mesurée sur la boucle de rendu.
 *
 * Module pur (ni React ni three.js) : un anneau fixe de durées d'images, écrit par la boucle
 * à chaque image, lu par le petit affichage du coin quatre fois par seconde. `noterImage`
 * n'alloue rien : la boucle tourne à la cadence de l'écran, pas la mesure qui la ralentit.
 */

/** La taille de l'anneau : les 120 dernières images, soit deux secondes à 60 images/s. */
const TAILLE_ANNEAU = 120
/** En dessous, pas encore assez d'images pour une moyenne qui signifie quelque chose. */
const MINIMUM_ECHANTILLONS = 10
/** Un écart plus grand : l'onglet était caché (ou l'app en arrière-plan), on ne le compte pas. */
const MAXI_CREUX_MS = 1000

export interface EtatCadence {
  anneau: Float32Array
  indice: number
  compteur: number
  derniereMs: number
  /** Le temps de calcul d'une image côté script (pose de la scène + envoi du rendu), lissé, en ms. */
  travailMs: number
}

/** Le poids d'une nouvelle mesure dans la moyenne lissée du temps de calcul. */
const LISSAGE_TRAVAIL = 0.1

/** Note le temps de calcul de l'image (ms) : moyenne lissée, sans allocation. */
export function noterTravail(etat: EtatCadence, dureeMs: number): void {
  if (!(dureeMs >= 0)) return
  etat.travailMs = etat.travailMs + (dureeMs - etat.travailMs) * LISSAGE_TRAVAIL
}

/** Crée l'état : l'anneau est prêt, la première image appelée sert de point de départ. */
export function nouvelleCadence(): EtatCadence {
  return { anneau: new Float32Array(TAILLE_ANNEAU), indice: 0, compteur: 0, derniereMs: NaN, travailMs: 0 }
}

/**
 * Note l'image du `maintenantMs` donné : la durée depuis l'image précédente entre dans
 * l'anneau. La première image ne compte pas (pas de durée), ni un écart au-delà du
 * maxi (l'onglet était caché) : le point de départ repart de cette image-là.
 */
export function noterImage(etat: EtatCadence, maintenantMs: number): void {
  const duree = maintenantMs - etat.derniereMs
  etat.derniereMs = maintenantMs
  // `!(duree > 0)` écarte aussi la première image, dont la durée n'est pas un nombre.
  if (!(duree > 0) || duree > MAXI_CREUX_MS) return
  etat.anneau[etat.indice] = duree
  etat.indice = (etat.indice + 1) % TAILLE_ANNEAU
  etat.compteur = Math.min(etat.compteur + 1, TAILLE_ANNEAU)
}

/** La lecture de la cadence : null tant qu'on n'a pas le minimum d'images. */
export interface LectureCadence {
  /** Images par seconde : 1000 sur la durée moyenne, entier. */
  ips: number
  /** La pire image de la fenêtre, en millisecondes, une décimale. */
  pireMs: number
  /** La durée moyenne, en millisecondes, une décimale. */
  moyenneMs: number
  /** Le temps de calcul côté script par image, en millisecondes, une décimale. */
  travailMs: number
}

export function lireCadence(etat: EtatCadence): LectureCadence | null {
  if (etat.compteur < MINIMUM_ECHANTILLONS) return null
  let total = 0
  let pire = 0
  for (let i = 0; i < etat.compteur; i++) {
    const duree = etat.anneau[i]
    total += duree
    if (duree > pire) pire = duree
  }
  const moyenne = total / etat.compteur
  return {
    ips: Math.round(1000 / moyenne),
    pireMs: Math.round(pire * 10) / 10,
    moyenneMs: Math.round(moyenne * 10) / 10,
    travailMs: Math.round(etat.travailMs * 10) / 10,
  }
}
