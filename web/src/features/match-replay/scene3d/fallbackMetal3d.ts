/**
 * fallbackMetal3d.ts — LE MÉTAL SOMBRE DES SURFACES SANS TEXTURE (armes, armures, bras).
 *
 * Un matériau d'un modèle d'arme ou d'armure dont le GLB ne porte pas de texture sort à sa teinte
 * de repli, presque blanche. Dans le jeu ces pièces (mécanique, articulations, dessous d'armure)
 * sont en métal sombre : `darkMetalFallback` leur donne cette matière, et un verre sombre aux
 * pièces translucides sans texture (lunette, viseur). Ne sont pas touchés : un matériau texturé
 * ou lumineux (voyant). An untextured alpha-blended field that is not glass (the Energy Sword's
 * blade) is energized instead (`energyField3d`), and a self-lit surface without a color map (a
 * light strip, an ammo screen) is drawn as light only (`selfLit3d`).
 */
import * as THREE from 'three'

import { energize } from './energyField3d'
import { lightSelfLit } from './selfLit3d'

/** Le gris métal (linéaire, légèrement bleuté), sa part de métal et sa rugosité. */
export const DARK_METAL = { r: 0.15, g: 0.16, b: 0.18, metalness: 0.55, roughness: 0.5 } as const

/**
 * Le verre sombre des optiques sans texture (lunette, viseur, écran d'arme) : le jeu y affiche une
 * image que la vue ne rend pas ; une vitre presque noire et lisse s'y fond mieux que la teinte de
 * repli claire.
 */
export const DARK_GLASS = { r: 0.012, g: 0.014, b: 0.018, metalness: 0, roughness: 0.12 } as const

/** isPlain : matériau standard sans texture de couleur et sans lumière propre. */
function isPlain(m: THREE.Material): m is THREE.MeshStandardMaterial {
  if (!(m instanceof THREE.MeshStandardMaterial) || m.map) return false
  const glows = m.emissiveIntensity > 0 && (m.emissive.r > 0 || m.emissive.g > 0 || m.emissive.b > 0)
  return !glows && !m.emissiveMap
}

/** isUntextured : matériau standard opaque, sans texture de couleur et sans lumière propre. */
export function isUntextured(m: THREE.Material): m is THREE.MeshStandardMaterial {
  return isPlain(m) && !m.transparent && m.opacity >= 1
}

/**
 * darkMetalFallback : le métal sombre sur `m` s'il est opaque et sans texture, le verre sombre
 * opaque s'il est translucide et sans texture ; vrai s'il a été changé.
 */
export function darkMetalFallback(m: THREE.Material): boolean {
  // An energy field (the Energy Sword's blade: alpha blended, untextured, not glass) is a
  // self-lit field, not dark glass (`energyField3d`).
  if (energize(m)) return true
  // A self-lit surface (a weapon's light strip, its ammo screen) is light only (`selfLit3d`).
  if (lightSelfLit(m)) return true
  // `isPlain` and `isUntextured` are both type predicates to the same type; negating the
  // second after the first narrows to `never` under this TypeScript/@types/three
  // combination. The cast is a type-only fix — `plain` is exactly `m` once `isPlain` holds.
  if (isPlain(m) && !isUntextured(m)) {
    const plain = m as THREE.MeshStandardMaterial
    plain.color.setRGB(DARK_GLASS.r, DARK_GLASS.g, DARK_GLASS.b)
    plain.metalness = DARK_GLASS.metalness
    plain.roughness = DARK_GLASS.roughness
    plain.transparent = false
    plain.opacity = 1
    plain.depthWrite = true
    return true
  }
  if (!isUntextured(m)) return false
  m.color.setRGB(DARK_METAL.r, DARK_METAL.g, DARK_METAL.b)
  m.metalness = DARK_METAL.metalness
  m.roughness = DARK_METAL.roughness
  return true
}
