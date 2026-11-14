/**
 * cadenceImages_logic.ts — the frame rate of the screen, measured on the render loop.
 *
 * Pure module (neither React nor three.js): a fixed ring of frame durations, written by the loop
 * at each frame, read by the small corner display four times a second. `noterImage`
 * allocates nothing: the loop runs at the screen's frame rate, not the measurement that would slow it down.
 */

/** The size of the ring: the last 120 frames, i.e. two seconds at 60 frames/s. */
const TAILLE_ANNEAU = 120
/** Below that, not enough frames yet for an average that means something. */
const MINIMUM_ECHANTILLONS = 10
/** A larger gap: the tab was hidden (or the app in the background), it is not counted. */
const MAXI_CREUX_MS = 1000

export interface EtatCadence {
  anneau: Float32Array
  indice: number
  compteur: number
  derniereMs: number
  /** The compute time of a frame on the script side (scene setup + render submission), smoothed, in ms. */
  travailMs: number
}

/** The weight of a new measurement in the smoothed average of the compute time. */
const LISSAGE_TRAVAIL = 0.1

/** Records the compute time of the frame (ms): smoothed average, no allocation. */
export function noterTravail(etat: EtatCadence, dureeMs: number): void {
  if (!(dureeMs >= 0)) return
  etat.travailMs = etat.travailMs + (dureeMs - etat.travailMs) * LISSAGE_TRAVAIL
}

/** Creates the state: the ring is ready, the first frame called serves as the starting point. */
export function nouvelleCadence(): EtatCadence {
  return { anneau: new Float32Array(TAILLE_ANNEAU), indice: 0, compteur: 0, derniereMs: NaN, travailMs: 0 }
}

/**
 * Records the frame at the given `maintenantMs`: the duration since the previous frame goes into
 * the ring. The first frame does not count (no duration), nor a gap beyond the
 * maximum (the tab was hidden): the starting point restarts from that frame.
 */
export function noterImage(etat: EtatCadence, maintenantMs: number): void {
  const duree = maintenantMs - etat.derniereMs
  etat.derniereMs = maintenantMs
  // `!(duree > 0)` also excludes the first frame, whose duration is not a number.
  if (!(duree > 0) || duree > MAXI_CREUX_MS) return
  etat.anneau[etat.indice] = duree
  etat.indice = (etat.indice + 1) % TAILLE_ANNEAU
  etat.compteur = Math.min(etat.compteur + 1, TAILLE_ANNEAU)
}

/** The reading of the frame rate: null until we have the minimum of frames. */
export interface LectureCadence {
  /** Frames per second: 1000 over the average duration, integer. */
  ips: number
  /** The worst frame of the window, in milliseconds, one decimal. */
  pireMs: number
  /** The average duration, in milliseconds, one decimal. */
  moyenneMs: number
  /** The compute time on the script side per frame, in milliseconds, one decimal. */
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
