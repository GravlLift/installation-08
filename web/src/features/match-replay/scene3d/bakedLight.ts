/**
 * bakedLight.ts — LA LUMIÈRE CUITE DU JEU : ses sondes d'irradiance (`stlm`), publiées dans le GLB
 * par `cmd/mapfond-build --maillage` sous `scenes[0].extras.levelupProbes` (cf.
 * `libs/himap/himap/sondes.go` et `glb_sondes.go`).
 *
 * Chaque région est une boîte découpée en cellules, une sonde au centre de chacune ; chaque sonde,
 * une tuile 8 x 8 de flottants R11G11B10 : un octaèdre 6 x 6 en AXES HALO (centre = haut, colonnes
 * +X, lignes +Y) bordé d'un texel. Les deux conventions sont mesurées, pas supposées
 * (`sondes_gamefiles_test.go`). Les
 * tuiles de toutes les régions sont rangées dans un seul atlas en demi-flottants, que le shader des
 * matériaux de la carte interpole (huit sondes, poids trilinéaire et de face, sondes enfouies
 * écartées) ; les régions emboîtées l'emportent par priorité et cèdent sur leur bord de fondu.
 *
 * Cette irradiance REMPLACE la lumière indirecte de la vue (ciel, part diffuse des sondes
 * capturées) là où une région couvre le point ; ailleurs l'éclairage de repli reste.
 */
import * as THREE from 'three'

const TILE = 8
const INNER = TILE - 2
const ATLAS_COLUMNS = 128
/** Plus de régions que cela : les moins prioritaires sont ignorées (le shader borne sa boucle). */
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

/** Une région prête pour le shader : bornes et grille en axes Halo, premier rang dans l'atlas. */
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

/** Une région lue du GLB, ses texels encore au format du jeu. */
interface RawRegion extends BakedRegion {
  texels: Uint32Array
}

/**
 * readBakedRegions lit les régions publiées dans les extras de la scène ; null sans sondes ou si
 * un champ manque (carte construite avant leur lecture).
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
 * Un flottant 11 ou 10 bits (5 bits d'exposant, biais 15, sans signe) vers un demi-flottant :
 * même exposant, mantisse recalée à gauche.
 */
function toHalf(bits: number, mantissa: number): number {
  return ((bits >>> mantissa) << 10) | ((bits & ((1 << mantissa) - 1)) << (10 - mantissa))
}

/**
 * L'atlas d'irradiance, RGBA demi-flottant : l'alpha d'une tuile vaut 1 si la sonde est active, 0
 * si elle est enfouie (tout à zéro). Une seule texture : les matériaux en couches de la carte en
 * tiennent déjà 15 sur les 16 d'un shader. Les lampes ajoutent leurs données à cet atlas.
 */
export interface BakedAtlas {
  irradiance: THREE.DataTexture
  columns: number
  activeCount: number
  total: number
}

/** packAtlas range les tuiles de toutes les régions, X d'abord puis Y puis Z, dans l'ordre des régions. */
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
