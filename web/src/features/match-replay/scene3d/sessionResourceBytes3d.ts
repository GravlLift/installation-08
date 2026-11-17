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

/** textureBytes: one texture's uploaded footprint, its mip chain included and an array texture's
 *  depth (layer count) multiplied in. Zero for a dimensionless image (not yet decoded). */
export function textureBytes(texture: THREE.Texture): number {
  const image = texture.image as { width?: number; height?: number; depth?: number } | undefined
  const width = image?.width ?? 0
  const height = image?.height ?? 0
  if (width <= 0 || height <= 0) return 0
  // A 2D array texture (the merged layered materials' atlases, `layeredArrays3d.ts`): one layer's
  // worth of texels, as many layers as `image.depth` says (1 for an ordinary 2D texture).
  const depth = Math.max(1, image?.depth ?? 1)
  const blockBytes = COMPRESSED_BLOCK_BYTES.get((texture as THREE.CompressedTexture).format)
  const base = blockBytes !== undefined
    ? Math.ceil(width / 4) * Math.ceil(height / 4) * blockBytes
    : width * height * bytesPerTexel(texture)
  return Math.round(base * depth * MIP_OVERHEAD)
}

/**
 * textureIdentity: the key `surfaceModelBytes` dedupes a texture by. GLTFLoader hands a second use
 * of the same image a CLONE (`loadImageSource`'s `sourceCache`, and this app's own KTX2 path,
 * `DirectKtx2Images` in `ktx2Textures3d.ts`, follows the same pattern): a distinct `THREE.Texture`
 * object per usage, but `Texture.copy` (what `clone()` calls) shares the clone's `source` with the
 * original, never copying it. Deduping by the `Texture` object itself (as this used to) counts the
 * same decoded pixels once per USE instead of once per unique image — for a map whose many surfaces
 * reuse a handful of base images (two thousand structure meshes on Streets, far fewer distinct
 * textures), that is exactly the kind of multiplier that turns a real few-hundred-MB texture budget
 * into a bogus terabyte-scale one. `source` falls back to the texture itself when absent (a bare
 * test double without a real `THREE.Texture` prototype).
 */
function textureIdentity(texture: THREE.Texture): unknown {
  return texture.source ?? texture
}

/**
 * surfaceModelBytes: the estimated footprint of a loaded surface model (map, layer or library root),
 * every geometry and texture counted once even when several meshes, materials or clones share it
 * (see `textureIdentity`). Includes a merged layered material's own array textures and parameter
 * texture (`layeredArrays3d.LayeredAtlas`), kept in `material.userData.textures` rather than a named
 * material property — the same place `mapModel.ts`'s own `dispose()` reads them from.
 */
export function surfaceModelBytes(root: THREE.Object3D): number {
  let bytes = 0
  for (const entry of collectResources(root)) bytes += entry.bytes
  return bytes
}

/** One resource `debugSurfaceModelBreakdown` found, as `surfaceModelBytes` would count it. */
export interface DebugResourceEntry {
  kind: 'geometry' | 'texture'
  bytes: number
  /** How many distinct meshes (geometry) or material slots (texture) reference this one resource. */
  uses: number
  /** geometry only: its vertex count and index count. */
  vertexCount?: number
  indexCount?: number
  /** texture only. */
  width?: number
  height?: number
  /** texture only: the array-texture layer count (`layeredArrays3d.ts`'s merged atlases), 1 otherwise. */
  depth?: number
  /** texture only: `THREE.*Format`/`THREE.*Type` numeric constants, and whether it is GPU-compressed. */
  format?: number
  type?: number
  compressed?: boolean
}

/**
 * collectResources walks `root` exactly as `surfaceModelBytes` does, but returns every unique
 * geometry and texture it counted instead of only their sum — for `window.__it3dCacheDebug`
 * (`sessionCacheDebug3d.ts`) to show which resources actually account for a cached entry's bytes.
 */
export function collectResources(root: THREE.Object3D): DebugResourceEntry[] {
  const geometries = new Map<THREE.BufferGeometry, number>()
  const textures = new Map<unknown, { texture: THREE.Texture; uses: number }>()
  const addTexture = (value: unknown): void => {
    if (!(value instanceof THREE.Texture)) return
    const identity = textureIdentity(value)
    const existing = textures.get(identity)
    if (existing) existing.uses++
    else textures.set(identity, { texture: value, uses: 1 })
  }
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    geometries.set(o.geometry, (geometries.get(o.geometry) ?? 0) + 1)
    const materials = Array.isArray(o.material) ? o.material : [o.material]
    for (const material of materials) {
      for (const value of Object.values(material)) addTexture(value)
      const layerTextures = (material.userData?.textures ?? []) as unknown[]
      for (const value of layerTextures) addTexture(value)
    }
  })
  const out: DebugResourceEntry[] = []
  for (const [geometry, uses] of geometries) {
    out.push({
      kind: 'geometry',
      bytes: geometryBytes(geometry),
      uses,
      vertexCount: geometry.getAttribute('position')?.count,
      indexCount: geometry.index?.count,
    })
  }
  for (const { texture, uses } of textures.values()) {
    const image = texture.image as { width?: number; height?: number; depth?: number } | undefined
    out.push({
      kind: 'texture',
      bytes: textureBytes(texture),
      uses,
      width: image?.width,
      height: image?.height,
      depth: Math.max(1, image?.depth ?? 1),
      format: texture.format,
      type: texture.type,
      compressed: (texture as THREE.CompressedTexture).isCompressedTexture === true,
    })
  }
  return out
}

/** debugSurfaceModelBreakdown: the top `limit` resources of `root` by counted bytes (default 20). */
export function debugSurfaceModelBreakdown(root: THREE.Object3D, limit = 20): DebugResourceEntry[] {
  return collectResources(root).sort((a, b) => b.bytes - a.bytes).slice(0, limit)
}
