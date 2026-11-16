/**
 * selfLit3d.ts — THE SELF-LIT SURFACES OF A MODEL (a weapon's light strips and ammo screens).
 *
 * The game's `illum` and `illum_full` shaders draw light only: no lit color, no reflection. The
 * library writes them as a glTF material with an emissive color, strength and (for `illum`) its
 * color map as the `emissiveTexture`, but no base color map; the base color it writes is a
 * placeholder (light gray, or the translucent blue of the see-through placeholder for an additive
 * one). `lightSelfLit` keeps the light and drops the placeholder: black base color, and for an
 * additive material (`extras.melange` 1) additive blending at full opacity, so the black of its
 * texture adds nothing, as in the game.
 */
import * as THREE from 'three'

/** The alpha blend mode the reader writes as `extras.melange` for additive (`himap.MelangeAdditif`). */
export const MELANGE_ADDITIVE = 1

/**
 * isSelfLit: a standard material that emits light and has no base color map, and is neither glass,
 * a painted (raw-masked) surface nor an energy field (`energyField3d`, which lights its own).
 */
export function isSelfLit(m: THREE.Material): m is THREE.MeshStandardMaterial {
  if (!(m instanceof THREE.MeshStandardMaterial) || m.map) return false
  if (m.userData.vitre || m.userData.surfaceBrute || m.userData.energy) return false
  return m.emissiveIntensity > 0 && (m.emissive.r > 0 || m.emissive.g > 0 || m.emissive.b > 0)
}

/** lightSelfLit draws `m` as light only; true when it changed `m` (once). */
export function lightSelfLit(m: THREE.Material): boolean {
  if (!isSelfLit(m) || m.userData.selfLit) return false
  m.userData.selfLit = true
  m.color.setRGB(0, 0, 0)
  m.metalness = 0
  m.roughness = 1
  if (m.userData.melange === MELANGE_ADDITIVE) {
    m.transparent = true
    m.opacity = 1
    m.blending = THREE.AdditiveBlending
    m.depthWrite = false
  }
  m.needsUpdate = true
  return true
}
