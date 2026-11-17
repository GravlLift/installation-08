/**
 * sessionResourceBytes3d.ts — estimates the GPU/CPU footprint of a loaded 3D resource, for
 * `sessionCache3d`'s byte cap: geometry attribute and index bytes, plus texture bytes (width x
 * height x bytes-per-texel x 1.33 for mips; a compressed format by its block size instead of a
 * per-texel size).
 */
import * as THREE from 'three'

/** The mip chain's overhead over the base level (geometric series of quarters, ~1/3 more). */
const MIP_OVERHEAD = 1.33

/** Compressed formats this app's GLBs use (`ktx2Textures3d`): bytes per 4x4 texel block. */
const COMPRESSED_BLOCK_BYTES = new Map<number, number>([
  [THREE.RGBA_S3TC_DXT1_Format, 8],
  [THREE.RGB_S3TC_DXT1_Format, 8],
  [THREE.RGBA_S3TC_DXT3_Format, 16],
  [THREE.RGBA_S3TC_DXT5_Format, 16],
  [THREE.RGB_ETC1_Format, 8],
  [THREE.RGB_ETC2_Format, 8],
  [THREE.RGBA_ETC2_EAC_Format, 16],
  [THREE.RGBA_ASTC_4x4_Format, 16],
  [THREE.RGBA_BPTC_Format, 16],
])

/** geometryBytes: a geometry's attribute arrays plus its index, counted once (shared buffers included). */
export function geometryBytes(geometry: THREE.BufferGeometry): number {
  let bytes = 0
  for (const name of Object.keys(geometry.attributes)) {
    const attr = geometry.attributes[name] as THREE.BufferAttribute | THREE.InterleavedBufferAttribute
    bytes += attr.array.byteLength
  }
  if (geometry.index) bytes += geometry.index.array.byteLength
  return bytes
}

function bytesPerTexel(texture: THREE.Texture): number {
  switch (texture.type) {
    case THREE.FloatType: return 16
    case THREE.HalfFloatType: return 8
    default: return 4 // RGBA8-equivalent for an uncompressed texture
  }
}

/** textureBytes: one texture's uploaded footprint, its mip chain included. Zero for a dimensionless image (not yet decoded). */
export function textureBytes(texture: THREE.Texture): number {
  const image = texture.image as { width?: number; height?: number } | undefined
  const width = image?.width ?? 0
  const height = image?.height ?? 0
  if (width <= 0 || height <= 0) return 0
  const blockBytes = COMPRESSED_BLOCK_BYTES.get((texture as THREE.CompressedTexture).format)
  const base = blockBytes !== undefined
    ? Math.ceil(width / 4) * Math.ceil(height / 4) * blockBytes
    : width * height * bytesPerTexel(texture)
  return Math.round(base * MIP_OVERHEAD)
}

/**
 * surfaceModelBytes: the estimated footprint of a loaded surface model (map, layer or library root),
 * every geometry and texture counted once even when several meshes or materials share it.
 */
export function surfaceModelBytes(root: THREE.Object3D): number {
  let bytes = 0
  const seenGeometries = new Set<THREE.BufferGeometry>()
  const seenTextures = new Set<THREE.Texture>()
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const geometry = o.geometry
    if (!seenGeometries.has(geometry)) {
      seenGeometries.add(geometry)
      bytes += geometryBytes(geometry)
    }
    const materials = Array.isArray(o.material) ? o.material : [o.material]
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture && !seenTextures.has(value)) {
          seenTextures.add(value)
          bytes += textureBytes(value)
        }
      }
    }
  })
  return bytes
}
