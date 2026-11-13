/**
 * armorGradients3d.ts — LES DÉGRADÉS DES REVÊTEMENTS D'UNE SESSION, en UNE texture à couches
 * (`DataArrayTexture`) : un matériau peint nomme jusqu'à huit dégradés (sept zones et la salissure),
 * plus que d'unités de texture libres ; chaque zone lit sa couche par son rang.
 *
 * Une couche par bitmap du jeu (`swatch-<id>.png`), ramenée à `SWATCH_SIZE` de côté, deux canaux :
 * le rouge du dégradé (choix bas, milieu, haut) et son bleu (rugosité). La texture grandit par
 * doublement ; tous les matériaux partagent l'uniforme `uniform`, dont la valeur suit la croissance.
 */
import * as THREE from 'three'

/** Le côté d'une couche (celui des nuanciers de la bibliothèque, `himap.coteNuancier`). */
export const SWATCH_SIZE = 256
/** Octets d'une couche : deux canaux. */
export const LAYER_BYTES = SWATCH_SIZE * SWATCH_SIZE * 2
const FIRST_CAPACITY = 16

export class GradientAtlas {
  /** L'uniforme commun des matériaux peints : la texture courante. */
  readonly uniform: THREE.IUniform<THREE.DataArrayTexture>
  private readonly layers = new Map<string, number>()
  private data: Uint8Array<ArrayBuffer>
  private capacity: number

  constructor(capacity = FIRST_CAPACITY) {
    this.capacity = capacity
    this.data = new Uint8Array(LAYER_BYTES * capacity)
    this.uniform = { value: this.texture() }
  }

  /** layer rend la couche du dégradé `id`, undefined s'il n'est pas posé. */
  layer(id: string): number | undefined {
    return this.layers.get(id)
  }

  /** add pose le dégradé `id` (`LAYER_BYTES` octets, rouge et bleu de l'image) ; rend sa couche. */
  add(id: string, pixels: Uint8Array): number {
    const known = this.layers.get(id)
    if (known !== undefined) return known
    if (pixels.length !== LAYER_BYTES) throw new Error(`dégradé ${id} : ${pixels.length} octets`)
    const n = this.layers.size
    if (n >= this.capacity) this.grow()
    this.data.set(pixels, n * LAYER_BYTES)
    this.layers.set(id, n)
    this.uniform.value.needsUpdate = true
    return n
  }

  dispose(): void {
    this.uniform.value.dispose()
    this.layers.clear()
  }

  private grow(): void {
    this.capacity *= 2
    const data = new Uint8Array(LAYER_BYTES * this.capacity)
    data.set(this.data)
    this.data = data
    const old = this.uniform.value
    this.uniform.value = this.texture()
    old.dispose()
  }

  private texture(): THREE.DataArrayTexture {
    const t = new THREE.DataArrayTexture(this.data, SWATCH_SIZE, SWATCH_SIZE, this.capacity)
    t.format = THREE.RGFormat
    t.type = THREE.UnsignedByteType
    t.colorSpace = THREE.NoColorSpace
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.magFilter = THREE.LinearFilter
    t.minFilter = THREE.LinearMipmapLinearFilter
    t.generateMipmaps = true
    t.needsUpdate = true
    return t
  }
}

/** redBlue garde le rouge et le bleu de pixels RGBA (`SWATCH_SIZE` de côté). */
export function redBlue(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const out = new Uint8Array(LAYER_BYTES)
  for (let i = 0, o = 0; o < out.length; i += 4, o += 2) {
    out[o] = rgba[i]
    out[o + 1] = rgba[i + 2]
  }
  return out
}
