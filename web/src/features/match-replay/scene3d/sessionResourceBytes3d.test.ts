import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { geometryBytes, surfaceModelBytes, textureBytes } from './sessionResourceBytes3d'

describe('geometryBytes', () => {
  it('sums every attribute array plus the index, once each', () => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3)) // 36 B
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3)) // 36 B
    geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(6), 1)) // 12 B
    expect(geometryBytes(geometry)).toBe(36 + 36 + 12)
  })
})

describe('textureBytes', () => {
  it('is zero for a texture without a decoded image yet', () => {
    const texture = new THREE.Texture()
    expect(textureBytes(texture)).toBe(0)
  })

  it('estimates an uncompressed RGBA8 texture at width x height x 4 x 1.33', () => {
    const texture = new THREE.Texture()
    texture.image = { width: 256, height: 128 }
    expect(textureBytes(texture)).toBe(Math.round(256 * 128 * 4 * 1.33))
  })

  it('estimates a compressed texture by its block size, not by width x height x bytes-per-texel', () => {
    const texture = new THREE.CompressedTexture([], 256, 256)
    texture.format = THREE.RGBA_S3TC_DXT5_Format
    texture.image = { width: 256, height: 256 } as unknown as THREE.CompressedTexture['image']
    const blocks = Math.ceil(256 / 4) * Math.ceil(256 / 4)
    expect(textureBytes(texture)).toBe(Math.round(blocks * 16 * 1.33))
    expect(textureBytes(texture)).toBeLessThan(256 * 256 * 4) // far under the uncompressed size
  })
})

describe('surfaceModelBytes', () => {
  it('counts a geometry or texture shared by several meshes only once', () => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(300), 3)) // 1200 B
    const texture = new THREE.Texture()
    texture.image = { width: 64, height: 64 }
    const material = new THREE.MeshStandardMaterial({ map: texture })
    const root = new THREE.Group()
    root.add(new THREE.Mesh(geometry, material))
    root.add(new THREE.Mesh(geometry, material)) // the same geometry and material again

    const once = geometryBytes(geometry) + textureBytes(texture)
    expect(surfaceModelBytes(root)).toBe(once)
  })
})
