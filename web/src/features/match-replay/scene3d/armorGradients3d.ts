// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * armorGradients3d.ts — A SESSION'S COATING GRADIENTS, in ONE layered texture
 * (`DataArrayTexture`): a painted material names up to eight gradients (seven zones and the
 * grime), more than there are free texture units; each zone reads its layer by its rank.
 *
 * One layer per game bitmap (`swatch-<id>.png`), resized to `SWATCH_SIZE` on a side, two
 * channels: the gradient's red (choice of low, mid, high) and its blue (roughness). The
 * texture grows by doubling; every material shares the `uniform`, whose value follows the
 * growth.
 */
import * as THREE from 'three'

/** The side length of a layer (that of the library's swatches, `himap.coteNuancier`). */
export const SWATCH_SIZE = 256
/** Bytes of a layer: two channels. */
export const LAYER_BYTES = SWATCH_SIZE * SWATCH_SIZE * 2
const FIRST_CAPACITY = 16

export class GradientAtlas {
  /** The shared uniform of painted materials: the current texture. */
  readonly uniform: THREE.IUniform<THREE.DataArrayTexture>
  private readonly layers = new Map<string, number>()
  private data: Uint8Array<ArrayBuffer>
  private capacity: number

  constructor(capacity = FIRST_CAPACITY) {
    this.capacity = capacity
    this.data = new Uint8Array(LAYER_BYTES * capacity)
    this.uniform = { value: this.texture() }
  }

  /** layer returns the layer of gradient `id`, undefined if it isn't placed. */
  layer(id: string): number | undefined {
    return this.layers.get(id)
  }

  /** bytes: the footprint of the layered texture (current capacity, not just the placed layers). */
  get bytes(): number {
    return this.data.byteLength
  }

  /** add places gradient `id` (`LAYER_BYTES` bytes, the image's red and blue); returns its layer. */
  add(id: string, pixels: Uint8Array): number {
    const known = this.layers.get(id)
    if (known !== undefined) return known
    if (pixels.length !== LAYER_BYTES) throw new Error(`gradient ${id}: ${pixels.length} bytes`)
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

/** redBlue keeps the red and blue of RGBA pixels (`SWATCH_SIZE` on a side). */
export function redBlue(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const out = new Uint8Array(LAYER_BYTES)
  for (let i = 0, o = 0; o < out.length; i += 4, o += 2) {
    out[o] = rgba[i]
    out[o + 1] = rgba[i + 2]
  }
  return out
}
