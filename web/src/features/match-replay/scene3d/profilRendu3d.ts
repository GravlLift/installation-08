/**
 * profilRendu3d.ts — le temps de script d'une image de la scène, par étape.
 *
 * La boucle marque la fin de chaque étape ; chaque durée entre dans une moyenne lissée, sans
 * allocation. Le lecteur de cadence relit le profil quelques fois par seconde.
 */

/** Les étapes d'une image, dans l'ordre où `render` les enchaîne (codes courts, affichés tels quels). */
export const ETAPES_PROFIL = ['av', 'act', 'cam', 'shd', 'draw', 'lbl'] as const

export interface ProfilRendu {
  /** La durée lissée de chaque étape, en millisecondes, dans l'ordre de `ETAPES_PROFIL`. */
  ms: Float32Array
  /** Les appels de dessin et les triangles de la dernière image, toutes passes confondues. */
  appels: number
  triangles: number
}

const LISSAGE = 0.1

export function nouveauProfil(): ProfilRendu {
  return { ms: new Float32Array(ETAPES_PROFIL.length), appels: 0, triangles: 0 }
}

/** marquer clôt l'étape `etape` commencée à `debut` (ms) et rend l'instant de clôture, début de la suivante. */
export function marquer(profil: ProfilRendu, etape: number, debut: number): number {
  const fin = performance.now()
  profil.ms[etape] += (fin - debut - profil.ms[etape]) * LISSAGE
  return fin
}

/** formaterProfil : une ligne « av 1.2 · act 0.4 · … · 812 calls · 1.9M tri ». */
export function formaterProfil(profil: ProfilRendu): string {
  const etapes = ETAPES_PROFIL.map((nom, i) => `${nom} ${profil.ms[i].toFixed(1)}`).join(' · ')
  return `${etapes} · ${profil.appels} calls · ${(profil.triangles / 1e6).toFixed(2)}M tri`
}
