// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * bakedLight.ts — THE GAME'S BAKED LIGHT: its irradiance probes (`stlm`), published in the GLB
 * by `cmd/mapfond-build --maillage` under `scenes[0].extras.levelupProbes` (see
 * `libs/himap/himap/sondes.go` and `glb_sondes.go`).
 *
 * Each region is a box cut into cells, one probe at the center of each; each probe, an 8 x 8
 * tile of R11G11B10 floats: a 6 x 6 octahedron in HALO AXES (center = up, columns +X, rows +Y)
 * bordered by one texel. Both conventions are measured, not assumed
 * (`sondes_gamefiles_test.go`). The
 * tiles of every region are packed into a single half-float atlas, which the map materials'
 * shader interpolates (eight probes, trilinear and face weight, buried probes excluded); nested
 * regions win by priority and yield at their blend edge.
 *
 * This irradiance REPLACES the view's indirect light (sky, diffuse share of captured probes)
 * wherever a region covers the point; elsewhere the fallback lighting remains.
 */
import * as THREE from 'three'

const TILE = 8
const INNER = TILE - 2
const ATLAS_COLUMNS = 128
/** More regions than this: the least prioritized are ignored (the shader caps its loop). */
export const MAX_REGIONS = 16
const HALF_ONE = 0x3c00

interface RegionExtras {
  min: number[]
  max: number[]
  count: number[]
  priority: number
  blend: number[]
  irradiance: number
}

/** A region ready for the shader: bounds and grid in Halo axes, first rank in the atlas. */
export interface BakedRegion {
  min: THREE.Vector3
  max: THREE.Vector3
  count: THREE.Vector3
  priority: number
  blend: THREE.Vector2
  base: number
}

interface GltfParser {
  getDependency(type: 'bufferView', index: number): Promise<ArrayBuffer>
}

/** A region read from the GLB, its texels still in the game's own format. */
interface RawRegion extends BakedRegion {
  texels: Uint32Array
}

/**
 * readBakedRegions reads the regions published in the scene's extras; null without probes or if
 * a field is missing (a map built before they were read).
 */
export async function readBakedRegions(extras: unknown, parser: GltfParser): Promise<RawRegion[] | null> {
  const probes = (extras as { levelupProbes?: { tile?: number; regions?: RegionExtras[] } } | null)?.levelupProbes
  if (!probes || probes.tile !== TILE || !Array.isArray(probes.regions) || probes.regions.length === 0) return null
  const out: RawRegion[] = []
  let base = 0
  for (const r of probes.regions) {
    const [nx, ny, nz] = r.count
    const view = await parser.getDependency('bufferView', r.irradiance)
    const texels = new Uint32Array(view.slice(0))
    if (!(nx > 0 && ny > 0 && nz > 0) || texels.length !== nx * ny * nz * TILE * TILE) return null
    out.push({
      min: new THREE.Vector3(...r.min),
      max: new THREE.Vector3(...r.max),
      count: new THREE.Vector3(nx, ny, nz),
      priority: r.priority,
      blend: new THREE.Vector2(r.blend[0], r.blend[1]),
      base,
      texels,
    })
    base += nx * ny * nz
  }
  return out
}

/**
 * An 11- or 10-bit float (5-bit exponent, bias 15, unsigned) to a half-float: same exponent,
 * mantissa shifted left.
 */
function toHalf(bits: number, mantissa: number): number {
  return ((bits >>> mantissa) << 10) | ((bits & ((1 << mantissa) - 1)) << (10 - mantissa))
}

/**
 * The irradiance atlas, half-float RGBA: a tile's alpha is 1 if the probe is active, 0 if it's
 * buried (all zero). A single texture: the map's layered materials already hold 15 of a
 * shader's 16 texture units. Lamps add their data to this atlas.
 */
export interface BakedAtlas {
  irradiance: THREE.DataTexture
  columns: number
  activeCount: number
  total: number
}

/** packAtlas packs every region's tiles, X first then Y then Z, in region order. */
export function packAtlas(regions: readonly RawRegion[]): BakedAtlas {
  const total = regions.reduce((n, r) => n + r.count.x * r.count.y * r.count.z, 0)
  const rows = Math.max(1, Math.ceil(total / ATLAS_COLUMNS))
  const width = ATLAS_COLUMNS * TILE
  const height = rows * TILE
  const pixels = new Uint16Array(width * height * 4)
  let activeCount = 0
  for (const r of regions) {
    const [nx, ny, nz] = [r.count.x, r.count.y, r.count.z]
    const rowTexels = nx * TILE
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const k = r.base + x + nx * (y + ny * z)
          const ax = (k % ATLAS_COLUMNS) * TILE
          const ay = Math.floor(k / ATLAS_COLUMNS) * TILE
          let lit = false
          for (let j = 0; j < TILE; j++) {
            for (let i = 0; i < TILE; i++) {
              const p = r.texels[z * rowTexels * ny * TILE + (y * TILE + j) * rowTexels + x * TILE + i]
              if (p !== 0) lit = true
              const o = ((ay + j) * width + ax + i) * 4
              pixels[o] = toHalf(p & 0x7ff, 6)
              pixels[o + 1] = toHalf((p >>> 11) & 0x7ff, 6)
              pixels[o + 2] = toHalf((p >>> 22) & 0x3ff, 5)
            }
          }
          if (lit) {
            activeCount++
            for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) pixels[((ay + j) * width + ax + i) * 4 + 3] = HALF_ONE
          }
        }
      }
    }
  }
  const irradiance = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.HalfFloatType)
  irradiance.magFilter = irradiance.minFilter = THREE.LinearFilter
  irradiance.generateMipmaps = false
  irradiance.needsUpdate = true
  return { irradiance, columns: ATLAS_COLUMNS, activeCount, total }
}

export { INNER as PROBE_INNER, TILE as PROBE_TILE }
