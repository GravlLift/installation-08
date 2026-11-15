/**
 * energyField3d.ts — THE ENERGY FIELDS OF A WEAPON (the Energy Sword's blade).
 *
 * The blade's materials (`mat_e134dc33`, `mat_ef3c315a`, shader 1273268522) are alpha blended
 * (`extras.melange` 3) and carry no texture: the game draws them with an energy shader whose
 * parameters neither the reader nor Ekur's export reads (no textures, shader type Unknown). The
 * library writes them untextured and translucent, which `darkMetalFallback` used to turn into
 * opaque dark glass: a slate-gray blade. They are not glass (no `extras.vitre`), so they are drawn
 * as a self-lit additive field instead.
 *
 * The field's color is the weapon's own: the emissive swatch of its painted materials (the
 * sword's default style lights its hilt with intention 46ec02bd, blue, emission 16), at that
 * swatch's emission, through the field's alpha. Before the weapon is painted (or with no coating
 * table) the field keeps the tint the GLB wrote, at `ENERGY_INTENSITY`.
 */
import * as THREE from 'three'

import type { Coat } from './armorCoat3d'
import { ZONES } from './armorCoating3d'
import { VEC4_PER_SLOT } from './armorMaterial3d'

/** The alpha blend mode the reader writes as `extras.melange` (`himap.MelangeAlpha`). */
const MELANGE_ALPHA = 3
/** The field's emission before the weapon's emissive swatch is known (a rendering choice). */
export const ENERGY_INTENSITY = 4

/** The emissive color of a weapon's paint and its emission (`energyTintOf`). */
export interface EnergyTint {
  color: [number, number, number]
  intensity: number
}

/**
 * isEnergyField: an untextured, alpha-blended material that is not glass and not a painted
 * (raw-masked) surface.
 */
export function isEnergyField(m: THREE.Material): m is THREE.MeshStandardMaterial {
  return m instanceof THREE.MeshStandardMaterial && !m.map && !m.emissiveMap && m.transparent &&
    m.userData.melange === MELANGE_ALPHA && !m.userData.vitre && !m.userData.surfaceBrute
}

/** isEnergized: a material `energize` has prepared. */
export function isEnergized(m: THREE.Material): m is THREE.MeshStandardMaterial {
  return m instanceof THREE.MeshStandardMaterial && !!m.userData.energy
}

/**
 * energize draws the energy field `m` as a self-lit additive field of its GLB tint; true when it
 * changed `m` (once: an energized material is left as it is).
 */
export function energize(m: THREE.Material): boolean {
  if (!isEnergyField(m) || m.userData.energy) return false
  m.userData.energy = true
  m.emissive.copy(m.color)
  m.emissiveIntensity = ENERGY_INTENSITY
  m.color.setRGB(0, 0, 0)
  m.metalness = 0
  m.roughness = 1
  m.blending = THREE.AdditiveBlending
  m.depthWrite = false
  m.needsUpdate = true
  return true
}

/**
 * energyTintOf: the brightest emissive swatch among the paints of `coat` whose material passes
 * `filter` (lit zones only); null when none glows.
 */
export function energyTintOf(coat: Coat, filter: (m: THREE.Material) => boolean = () => true): EnergyTint | null {
  let best: EnergyTint | null = null
  for (const [m, p] of coat) {
    if (!filter(m)) continue
    const data = p.paint.data
    for (let k = 0; k < ZONES; k++) {
      const o = k * VEC4_PER_SLOT * 4
      const emission = data[o + 7]
      if (data[o] !== 1 || !(emission > 0) || (best && emission <= best.intensity)) continue
      best = { color: [data[o + 4], data[o + 5], data[o + 6]], intensity: emission }
    }
  }
  return best
}

/** energyCopy: a copy of the energized material `m` lit in the weapon's tint. */
export function energyCopy(m: THREE.MeshStandardMaterial, tint: EnergyTint): THREE.MeshStandardMaterial {
  const copy = m.clone()
  copy.emissive.setRGB(tint.color[0], tint.color[1], tint.color[2])
  copy.emissiveIntensity = tint.intensity
  return copy
}
