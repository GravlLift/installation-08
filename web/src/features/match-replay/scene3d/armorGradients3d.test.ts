import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { GradientAtlas, LAYER_BYTES, SWATCH_SIZE, redBlue } from './armorGradients3d'

const layer = (v: number) => new Uint8Array(LAYER_BYTES).fill(v)

describe('GradientAtlas', () => {
  it('une couche par dégradé, posée une fois, à son rang ; texture à deux canaux de données', () => {
    const atlas = new GradientAtlas(2)
    expect(atlas.add('a', layer(1))).toBe(0)
    expect(atlas.add('b', layer(2))).toBe(1)
    expect(atlas.add('a', layer(9))).toBe(0)
    expect(atlas.layer('b')).toBe(1)
    expect(atlas.layer('z')).toBeUndefined()
    const t = atlas.uniform.value
    expect([t.image.width, t.image.height, t.image.depth]).toEqual([SWATCH_SIZE, SWATCH_SIZE, 2])
    expect([t.format, t.colorSpace, t.wrapS]).toEqual([THREE.RGFormat, THREE.NoColorSpace, THREE.RepeatWrapping])
  })

  it('grandit par doublement : couches gardées, même uniforme, ancienne texture libérée', () => {
    const atlas = new GradientAtlas(2)
    const uniform = atlas.uniform
    const old = uniform.value
    let disposed = false
    old.addEventListener('dispose', () => (disposed = true))
    atlas.add('a', layer(1))
    atlas.add('b', layer(2))
    expect(atlas.add('c', layer(3))).toBe(2)
    expect(atlas.uniform).toBe(uniform)
    expect(uniform.value).not.toBe(old)
    expect(disposed).toBe(true)
    const data = uniform.value.image.data as Uint8Array
    expect([uniform.value.image.depth, data[0], data[LAYER_BYTES], data[2 * LAYER_BYTES]]).toEqual([4, 1, 2, 3])
  })

  it('refuse une couche de mauvaise taille', () => {
    expect(() => new GradientAtlas().add('a', new Uint8Array(4))).toThrow()
  })
})

describe('redBlue', () => {
  it('garde le rouge (choix de couleur) et le bleu (rugosité) de chaque pixel', () => {
    const rgba = new Uint8ClampedArray(SWATCH_SIZE * SWATCH_SIZE * 4)
    rgba.set([10, 20, 30, 255, 40, 50, 60, 255])
    expect(Array.from(redBlue(rgba).slice(0, 4))).toEqual([10, 30, 40, 60])
  })
})
