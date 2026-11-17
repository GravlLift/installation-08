// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
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

  // Shaped like what `ktx2Textures3d.ts`'s `arrayTexture` (`layeredArrays3d.ts`) actually builds for
  // a map's merged layered materials: a compressed 2D ARRAY texture, one layer per merged material.
  it('multiplies a compressed array texture (layeredArrays3d) by its layer count (image.depth)', () => {
    const arrayTexture = new THREE.CompressedArrayTexture([], 512, 512, 12, THREE.RGBA_S3TC_DXT5_Format)
    const blocksPerLayer = Math.ceil(512 / 4) * Math.ceil(512 / 4)
    expect(textureBytes(arrayTexture)).toBe(Math.round(blocksPerLayer * 16 * 12 * 1.33))
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

  // GLTFLoader (and this app's own KTX2 path, `DirectKtx2Images`) hands a second use of the same
  // image a CLONE: a distinct `THREE.Texture` object sharing the original's `source`, never a
  // decode of its own. Deduping by the `Texture` object (not by `source`) would count the same
  // decoded pixels once per use instead of once per image — the bug that turned a map's real
  // texture budget into a terabyte-scale one when many surfaces reuse a handful of base images.
  it('counts a texture used by many surfaces once, even though each use is its own clone sharing one source', () => {
    const base = new THREE.Texture()
    base.image = { width: 2048, height: 2048 }
    const root = new THREE.Group()
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3))
    for (let i = 0; i < 50; i++) {
      // Each surface's own material clone, its own clone of the shared texture (as GLTFLoader's
      // `sourceCache`-then-`clone()` pattern does for every use after the first).
      const clonedTexture = base.clone()
      const material = new THREE.MeshStandardMaterial({ map: clonedTexture })
      root.add(new THREE.Mesh(geometry, material))
    }
    expect(surfaceModelBytes(root)).toBe(geometryBytes(geometry) + textureBytes(base))
  })

  it('counts a merged layered material\'s array textures and parameter texture (userData.textures)', () => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3))
    const arrayTexture = new THREE.DataArrayTexture(null, 256, 256, 4)
    const params = new THREE.DataTexture(new Float32Array(4), 1, 1)
    const material = new THREE.MeshStandardMaterial()
    material.userData = { textures: [arrayTexture, params], couchesFusionnees: true }
    const root = new THREE.Group()
    root.add(new THREE.Mesh(geometry, material))
    expect(surfaceModelBytes(root)).toBe(geometryBytes(geometry) + textureBytes(arrayTexture) + textureBytes(params))
  })

  // THE REAL STREETS BUG: GLTFLoader caches one BufferAttribute per glTF accessor, so when a big
  // map's structure is exported as many small per-material submeshes that all slice one shared
  // vertex pool (same position/normal accessor, each submesh only bringing its own index range),
  // every submesh's geometry is a DISTINCT BufferGeometry object wrapping the exact SAME shared
  // position/normal BufferAttribute. Summing each geometry's own attribute bytes independently (as
  // this used to) counted that one shared buffer once per submesh instead of once — for Streets'
  // ~2,000 structure submeshes sharing one pool, that is what produced the terabyte-scale number
  // (the texture/source-dedup fix alone never touched this, since it is a geometry, not a texture).
  it('counts a position/normal buffer shared by many distinct submesh geometries only once', () => {
    const sharedPosition = new THREE.BufferAttribute(new Float32Array(900_000), 3) // one big vertex pool
    const sharedNormal = new THREE.BufferAttribute(new Float32Array(900_000), 3)
    const root = new THREE.Group()
    const material = new THREE.MeshStandardMaterial()
    for (let i = 0; i < 2000; i++) {
      // Each submesh: its own BufferGeometry and its own index range, but the SAME shared attribute
      // objects for position/normal — exactly what GLTFLoader's accessor cache hands back.
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', sharedPosition)
      geometry.setAttribute('normal', sharedNormal)
      geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([i, i + 1, i + 2]), 1)) // each submesh's own index
      root.add(new THREE.Mesh(geometry, material))
    }
    const sharedBytes = sharedPosition.array.byteLength + sharedNormal.array.byteLength
    const ownIndexBytes = 2000 * (3 * 2) // Uint16Array(3) per submesh, never shared
    expect(surfaceModelBytes(root)).toBe(sharedBytes + ownIndexBytes)
    // The bug this guards against: before the fix, this would have been ~2000x too high
    // (sharedBytes counted again for every submesh) instead of counted once.
    expect(surfaceModelBytes(root)).toBeLessThan(sharedBytes * 2)
  })
})
