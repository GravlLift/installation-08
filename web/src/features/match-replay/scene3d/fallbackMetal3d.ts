// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * fallbackMetal3d.ts — THE DARK METAL OF UNTEXTURED SURFACES (weapons, armor, arms).
 *
 * A weapon or armor model's material whose GLB carries no texture comes out at its fallback
 * tint, almost white. In the game these parts (mechanisms, joints, underarmor) are dark metal:
 * `darkMetalFallback` gives them that material, and dark glass to untextured translucent parts
 * (scopes, sights). Left untouched: a textured or glowing (lit) material. An untextured
 * alpha-blended field that is not glass (the Energy Sword's blade) is energized instead
 * (`energyField3d`), and a self-lit surface without a color map (a light strip, an ammo screen)
 * is drawn as light only (`selfLit3d`).
 */
import * as THREE from 'three'

import { energize } from './energyField3d'
import { lightSelfLit } from './selfLit3d'

/** The metal gray (linear, slightly blue-tinted), its metalness, and its roughness. */
export const DARK_METAL = { r: 0.15, g: 0.16, b: 0.18, metalness: 0.55, roughness: 0.5 } as const

/**
 * The dark glass of untextured optics (scope, sight, weapon screen): the game displays an image
 * there that the view does not render; an almost-black, smooth pane blends better there than the
 * light fallback tint.
 */
export const DARK_GLASS = { r: 0.012, g: 0.014, b: 0.018, metalness: 0, roughness: 0.12 } as const

/** isPlain: a standard material with no color texture and no light of its own. */
function isPlain(m: THREE.Material): m is THREE.MeshStandardMaterial {
  if (!(m instanceof THREE.MeshStandardMaterial) || m.map) return false
  const glows = m.emissiveIntensity > 0 && (m.emissive.r > 0 || m.emissive.g > 0 || m.emissive.b > 0)
  return !glows && !m.emissiveMap
}

/** isUntextured: an opaque standard material, with no color texture and no light of its own. */
export function isUntextured(m: THREE.Material): m is THREE.MeshStandardMaterial {
  return isPlain(m) && !m.transparent && m.opacity >= 1
}

/**
 * darkMetalFallback: dark metal on `m` if it's opaque and untextured, opaque dark glass if it's
 * translucent and untextured; true if it was changed.
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
