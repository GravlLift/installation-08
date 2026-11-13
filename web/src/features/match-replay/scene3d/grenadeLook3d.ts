/**
 * grenadeLook3d.ts — LA MISE EN FORME D'UNE GRENADE SELON SON RANG : une fonction pure du type de
 * grenade à son dessin.
 *
 * `flights3d` y lit les deux décisions qui peuvent varier par type — la forme du vol (seule la
 * grenade plasma s'écarte du look frag pour l'instant : un orbe lumineuse, cœur bleu-blanc et
 * halo bleu saturé) et la nature de la détonation (vocabulaire de `fxInk`) — de sorte que, quand
 * Dynamo et Spike auront leur propre mise en forme, on changera ce fichier, pas le calque.
 *
 * L'orbe se dessine comme le faisceau du tir de choc (`shots3d`) : un second lobe plus large, à
 * une fraction de l'intensité du cœur. Le pulsé est une fonction pure du temps, périodique : la
 * même image rend toujours le même orbe, en avant comme en arrière.
 */
import type { FxTint } from '../layers/fxInk'
import { explosionTintOf } from '../model/grenadeFx'

/** Rang de la grenade plasma dans `GrenadeLabels` (0 frag, 1 plasma, 2 dynamo, 3 spike). */
export const PLASMA_RANK = 1

/** La forme du vol d'une grenade : le modèle du jeu (ou la tête sphérique), ou l'orbe plasma. */
export type GrenadeFlightLook = 'model' | 'orb'

/** Le look d'une grenade : la forme de son vol, et la nature de sa détonation. */
export interface GrenadeLook {
  flight: GrenadeFlightLook
  tint: FxTint
}

/** grenadeLookOf — le passage type de grenade -> look, seul détenteur de cette correspondance. */
export function grenadeLookOf(rank: number): GrenadeLook {
  if (rank === PLASMA_RANK) return { flight: 'orb', tint: 'plasma_cool' }
  return { flight: 'model', tint: explosionTintOf(rank) }
}

/** Le rayon du cœur de l'orbe (u) : celui de la tête d'une frag. */
export const PLASMA_CORE_RADIUS = 0.02
/** Le halo : un second lobe à ce multiple du rayon du cœur. */
export const PLASMA_HALO_MULT = 2
/** Le halo, à cette fraction de l'intensité du cœur. */
export const PLASMA_HALO_DIM = 0.7
/** La fréquence du pulsé de l'orbe (pulsés par seconde). */
export const PLASMA_PULSE_RATE = 1.5
/** L'amplitude du pulsé : l'intensité et le rayon varient de cette fraction autour de leur moyenne. */
export const PLASMA_PULSE_DEPTH = 0.3
/** Le bleu-blanc du cœur : cette fraction d'incandescence dans la teinte plasma. */
export const PLASMA_CORE_MIX = 0.3

/**
 * plasmaPulse — l'intensité du pulsé de l'orbe, fonction pure du temps en secondes : une valeur
 * entre 0 et 1, périodique de période `1 / PLASMA_PULSE_RATE`.
 */
export function plasmaPulse(seconds: number): number {
  return 0.5 + 0.5 * Math.sin(seconds * PLASMA_PULSE_RATE * Math.PI * 2)
}
