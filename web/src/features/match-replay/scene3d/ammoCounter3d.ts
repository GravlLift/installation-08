// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * ammoCounter3d.ts — THE AMMO COUNTER ON A FIRST-PERSON WEAPON (the BR75's, the Bandit's and the
 * Commando's digits).
 *
 * Each digit is a small self-lit quad whose texture is one image of a ten-image bitmap (0..9, the
 * game's font): the game picks the image from an engine input, mapped to 0..10 (`himap.ImagesEmissives`).
 * The library writes all the images side by side in one strip, scaled to show the first, and names
 * the input in the material's `extras.emissionImages`. The digits read `primary_ammunition_tens` and
 * `primary_ammunition_ones` (StringIDs below): each quad shows the digit of the rounds the HUD shows
 * for the weapon in hand (`hud3d_logic.magazineInHand`), its texture moved to that image. Other
 * inputs (the Stalker Rifle's and the Shock Rifle's gauges, names not resolved) keep their first image.
 */
import * as THREE from 'three'

/** `primary_ammunition_tens` (StringID): the tens digit's input. */
export const INPUT_TENS = 0x96e4a1a4
/** `primary_ammunition_ones` (StringID): the ones digit's input. */
export const INPUT_ONES = 0x688cb12a

/** A material's images, as the library writes them (`extras.emissionImages`). */
export interface CounterImages {
  /** The engine input that picks the image (StringID). */
  entree: number
  /** The function's output range: image floor(min + (max - min) x input). */
  min: number
  max: number
  /** The strip's image count. */
  nombre: number
}

/** readCounterImages reads `extras.emissionImages`; null without it or when it is malformed. */
export function readCounterImages(extras: { emissionImages?: unknown } | undefined): CounterImages | null {
  const v = extras?.emissionImages as Partial<CounterImages> | undefined
  if (!v || typeof v !== 'object') return null
  const { entree, min, max, nombre } = v
  if (typeof entree !== 'number' || typeof min !== 'number' || typeof max !== 'number' || typeof nombre !== 'number' || !(nombre > 1)) return null
  return { entree: entree >>> 0, min, max, nombre }
}

/** counterInput is input `entree`'s value for `rounds` loaded: its digit over 10; null for an input not known. */
export function counterInput(entree: number, rounds: number): number | null {
  const n = Math.max(0, Math.floor(rounds))
  if (entree >>> 0 === INPUT_TENS) return (Math.floor(n / 10) % 10) / 10
  if (entree >>> 0 === INPUT_ONES) return (n % 10) / 10
  return null
}

/** counterImage is the image `spec` shows for input value `input`, within the strip. */
export function counterImage(spec: CounterImages, input: number): number {
  // A digit over 10 times 10 lands a hair under the integer in floats (0.3 x 10): rounded first.
  const v = Math.round((spec.min + (spec.max - spec.min) * input) * 1e4) / 1e4
  return Math.min(spec.nombre - 1, Math.max(0, Math.floor(v)))
}

/** A counter quad of a rig: its mesh (its material is read each frame: painting may swap it) and images. */
export interface CounterQuad {
  mesh: THREE.Mesh
  spec: CounterImages
}

/** findCounterQuads lists the meshes of `root` whose material carries `emissionImages`. */
export function findCounterQuads(root: THREE.Object3D): CounterQuad[] {
  const out: CounterQuad[] = []
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return
    const spec = readCounterImages(object.material.userData)
    if (spec) out.push({ mesh: object, spec })
  })
  return out
}

/** Each counter texture's offset as the library wrote it (the strip's first image). */
const BASE = new WeakMap<THREE.Texture, number>()

/**
 * showRounds moves each quad's texture to the digit of `rounds` its input reads; null leaves the
 * quads as they are (the film does not say, or the player is dead). Each quad's material has a
 * texture of its own: GLTFLoader clones a texture for each material that transforms it.
 */
export function showRounds(quads: readonly CounterQuad[], rounds: number | null): void {
  if (rounds == null || !Number.isFinite(rounds)) return
  for (const { mesh, spec } of quads) {
    const m = mesh.material
    if (Array.isArray(m) || !(m instanceof THREE.MeshStandardMaterial) || !m.emissiveMap) continue
    const map = m.emissiveMap
    if (!BASE.has(map)) BASE.set(map, map.offset.x)
    const input = counterInput(spec.entree, rounds)
    if (input == null) continue
    map.offset.x = BASE.get(map)! + counterImage(spec, input) / spec.nombre
  }
}
