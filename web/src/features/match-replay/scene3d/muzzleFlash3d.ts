// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * muzzleFlash3d.ts — L'ÉCLAIR DE BOUCHE d'un tir : une gerbe de pétales au bout du canon du modèle
 * d'arme DESSINÉ, le temps d'une à deux images à 60 Hz.
 *
 * La gerbe a deux couronnes de pétales (`petalGeometry` : cœur blanc, bords noirs, en mélange
 * additif) : des pétales longs dans des plans qui contiennent le canon (le cône vu de profil), et une
 * étoile de pétales courts autour de la bouche, ouverte vers l'avant (vue de derrière, en 1re
 * personne, l'étoile). Le tout tourne autour du canon d'un angle tiré du germe du tir (`flashRoll`) :
 * deux tirs voisins n'ont pas la même gerbe, et la même image rend toujours la même.
 *
 * L'éclair ne se dessine qu'au bout d'une arme dessinée (`muzzleFlashSite`) : sans modèle d'arme en
 * main (pas chargé, joueur caché, tir d'un véhicule), pas de gerbe. En 1re personne, l'arme
 * dessinée est le rig bras + arme, qui n'a pas de modèle en main du Spartan : la gerbe y est alors
 * à la bouche du rig dont le vol est parti (`rigFlashSite`), le long de la direction du tir. Rien
 * n'est jamais posé à l'œil.
 */
import * as THREE from 'three'

import type { DrawnWeapon } from './avatar3d'
import { drawnMuzzle } from './muzzle3d'

/** La durée de l'éclair : deux images à 60 Hz. */
export const MUZZLE_FLASH_SECONDS = 2 / 60
// Ce que la gerbe perd de sa force jusqu'à sa fin (la seconde image est plus faible que la première).
const FADE = 0.6
// Les pétales le long du canon (u, ~24 cm sur ~7) et leur nombre : vus de profil, ils dépassent du
// corps du tireur ; vus de derrière (1re personne), ils filent vers le centre et ne masquent rien.
const SIDE_LENGTH = 0.08
const SIDE_WIDTH = 0.024
const SIDE_PETALS = 3
// L'étoile autour de la bouche (u, ~9 cm sur ~4), ouverte de STAR_TILT vers l'avant.
const STAR_LENGTH = 0.03
const STAR_WIDTH = 0.013
const STAR_PETALS = 5
const STAR_TILT = THREE.MathUtils.degToRad(35)
// Chaque pétale varie de longueur autour de sa taille (± JITTER / 2), au germe du tir.
const JITTER = 0.5
// La gerbe naît un peu plus petite à sa dernière image.
const SHRINK = 0.3

/**
 * muzzleFlashStrength : la force de l'éclair (0..1) `age` secondes après le tir : pleine au tir,
 * affaiblie à la seconde image, éteinte au-delà de `MUZZLE_FLASH_SECONDS` ; 0 avant le tir.
 */
export function muzzleFlashStrength(age: number): number {
  if (age < 0 || age >= MUZZLE_FLASH_SECONDS) return 0
  return 1 - FADE * (age / MUZZLE_FLASH_SECONDS)
}

/** unitHash : un nombre de [0, 1) tiré de l'entier `n` (mélange entier : voisins sans parenté). */
function unitHash(n: number): number {
  let h = Math.floor(n) | 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** flashRoll : l'angle (radians, [0, 2π)) dont la gerbe du tir de germe `seed` tourne autour du canon. */
export function flashRoll(seed: number): number {
  return unitHash(seed) * 2 * Math.PI
}

/**
 * muzzleFlashSite : où la gerbe d'un tir se dessine, écrit dans `pos` (bouche, monde) et `barrel`
 * (axe du canon, monde, unitaire) : au bout de l'arme dessinée `drawn` ; faux (pas de gerbe) sans
 * arme dessinée ou pour un tir de véhicule.
 */
export function muzzleFlashSite(vehicleShot: boolean, drawn: DrawnWeapon | null, pos: THREE.Vector3, barrel: THREE.Vector3): boolean {
  if (vehicleShot || !drawn) return false
  drawnMuzzle(drawn, pos, barrel)
  return true
}

/**
 * rigFlashSite : où se dessine la gerbe d'un tir de 1re personne dont l'arme dessinée est le rig
 * (pas d'arme en main du Spartan, `muzzleFlashSite` ne donne rien) : à la bouche du rig dont le vol
 * est parti (`from`, mesurée sur le même rig que l'origine du vol), le long de la direction du tir
 * (`to`). `rigDrawn` : le tir est celui du joueur suivi en 1re personne, hors véhicule, et le rig
 * de son arme est chargé. Faux sans rig dessiné ou sans direction de vol (`to` null) : aucune gerbe
 * hors d'une bouche dessinée.
 */
export function rigFlashSite(
  rigDrawn: boolean,
  path: { from: THREE.Vector3; to: THREE.Vector3 | null },
  pos: THREE.Vector3,
  barrel: THREE.Vector3,
): boolean {
  if (!rigDrawn || path.to === null) return false
  pos.copy(path.from)
  barrel.subVectors(path.to, path.from).normalize()
  return true
}

/** Un pétale de la gerbe : son orientation (Y du pétale = sa pointe) et sa taille (X largeur, Y longueur). */
export interface FlashPetal {
  rotation: THREE.Quaternion
  size: THREE.Vector3
}

const across = new THREE.Vector3()
const side = new THREE.Vector3()
const tip = new THREE.Vector3()
const width = new THREE.Vector3()
const normal = new THREE.Vector3()
const basis = new THREE.Matrix4()
const UP = new THREE.Vector3(0, 1, 0)
const EAST = new THREE.Vector3(1, 0, 0)

/**
 * flashPetals : les pétales de la gerbe d'un tir de germe `seed`, canon le long de `barrel`
 * (unitaire), à la force `k` ; `out` est réécrit (ses pétales sont réutilisés d'un appel à l'autre).
 */
export function flashPetals(barrel: THREE.Vector3, k: number, seed: number, out: FlashPetal[]): FlashPetal[] {
  // Une perpendiculaire au canon, d'où part l'angle de la gerbe.
  across.crossVectors(barrel, Math.abs(barrel.y) < 0.9 ? UP : EAST).normalize()
  const roll = flashRoll(seed)
  const grow = 1 - SHRINK * (1 - k)
  let n = 0
  const put = (dir: THREE.Vector3, w: THREE.Vector3, length: number, breadth: number) => {
    const p = out[n] ?? (out[n] = { rotation: new THREE.Quaternion(), size: new THREE.Vector3() })
    normal.crossVectors(w, dir)
    p.rotation.setFromRotationMatrix(basis.makeBasis(w, dir, normal))
    p.size.set(breadth * grow, length * grow * (1 - JITTER / 2 + JITTER * unitHash(seed * 31 + n)), 1)
    n++
  }
  for (let i = 0; i < SIDE_PETALS; i++) {
    // Un plan qui contient le canon : la largeur du pétale y est perpendiculaire.
    width.copy(across).applyAxisAngle(barrel, roll + (i * Math.PI) / SIDE_PETALS)
    put(barrel, width, SIDE_LENGTH, SIDE_WIDTH)
  }
  for (let i = 0; i < STAR_PETALS; i++) {
    side.copy(across).applyAxisAngle(barrel, roll + (i * 2 * Math.PI) / STAR_PETALS)
    tip.copy(side).multiplyScalar(Math.cos(STAR_TILT)).addScaledVector(barrel, Math.sin(STAR_TILT))
    // La largeur, perpendiculaire au canon et au pétale : l'étoile fait face à qui regarde le long du canon.
    width.crossVectors(barrel, side).normalize()
    put(tip, width, STAR_LENGTH, STAR_WIDTH)
  }
  out.length = n
  return out
}
