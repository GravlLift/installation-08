/** Grille mondiale des lampes, indépendante de la caméra. */
import * as THREE from 'three'
import type { PlacedLight } from './placedLights'

// Borne de la boucle du shader : une cellule plus chargée ne garde que ses lampes les plus fortes en son centre.
export const MAX_CELL_LAMPS = 32
export const LAMP_CELL_SIZE = 2
const LAMP_SCALE = 2
export interface LampGrid {
  min: THREE.Vector3
  size: number
  dims: THREE.Vector3
  cells: number[][]
  indices: number[]
  overflow: number
  maxBeforeCap: number
}

function strength(lamp: PlacedLight, center: THREE.Vector3): number {
  const delta = center.clone().sub(lamp.position)
  const distance = delta.length()
  let falloff = Math.max(0, 1 - (distance / lamp.range) ** 4) ** 2 / Math.max(distance ** 2, 0.01)
  if (lamp.kind === 'spot') {
    const outer = Math.min(THREE.MathUtils.degToRad(lamp.cone[1] / 2), Math.PI / 2)
    const penumbra = lamp.cone[1] > 0 ? THREE.MathUtils.clamp(1 - lamp.cone[0] / lamp.cone[1], 0, 1) : 0
    const a = Math.cos(outer), b = Math.cos(outer * (1 - penumbra))
    const t = THREE.MathUtils.clamp((delta.normalize().dot(lamp.direction) - a) / Math.max(b - a, 1e-6), 0, 1)
    falloff *= t * t * (3 - 2 * t)
  }
  return lamp.energy * Math.max(lamp.color.r, lamp.color.g, lamp.color.b) * falloff
}

function intersects(lamp: PlacedLight, min: THREE.Vector3, size: number): boolean {
  let distance = 0
  for (const axis of ['x', 'y', 'z'] as const) {
    const d = Math.max(min[axis] - lamp.position[axis], 0, lamp.position[axis] - min[axis] - size)
    distance += d * d
  }
  return distance <= lamp.range * lamp.range
}

/** Construit les listes des sphères touchant chaque cellule et compte les entrées écartées. */
export function buildLampGrid(lamps: readonly PlacedLight[], size = LAMP_CELL_SIZE): LampGrid {
  const grid: LampGrid = { min: new THREE.Vector3(), size, dims: new THREE.Vector3(), cells: [], indices: [], overflow: 0, maxBeforeCap: 0 }
  if (!lamps.length) return grid
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
  grid.min.set(Infinity, Infinity, Infinity)
  for (const lamp of lamps) {
    grid.min.min(lamp.position.clone().addScalar(-lamp.range))
    max.max(lamp.position.clone().addScalar(lamp.range))
  }
  grid.min.divideScalar(size).floor().multiplyScalar(size)
  grid.dims.copy(max.sub(grid.min).divideScalar(size)).ceil().max(new THREE.Vector3(1, 1, 1))
  const { x: nx, y: ny, z: nz } = grid.dims
  grid.cells = Array.from({ length: nx * ny * nz }, () => [])
  for (let i = 0; i < lamps.length; i++) {
    const lamp = lamps[i]
    const lo = lamp.position.clone().addScalar(-lamp.range).sub(grid.min).divideScalar(size).floor().max(new THREE.Vector3())
    const hi = lamp.position.clone().addScalar(lamp.range).sub(grid.min).divideScalar(size).floor().min(grid.dims.clone().addScalar(-1))
    for (let z = lo.z; z <= hi.z; z++) for (let y = lo.y; y <= hi.y; y++) for (let x = lo.x; x <= hi.x; x++) {
      const corner = new THREE.Vector3(x, y, z).multiplyScalar(size).add(grid.min)
      if (intersects(lamp, corner, size)) grid.cells[x + nx * (y + ny * z)].push(i)
    }
  }
  for (let k = 0; k < grid.cells.length; k++) {
    const cell = grid.cells[k]
    grid.maxBeforeCap = Math.max(grid.maxBeforeCap, cell.length)
    if (cell.length > MAX_CELL_LAMPS) {
      const center = new THREE.Vector3(k % nx, Math.floor(k / nx) % ny, Math.floor(k / (nx * ny))).addScalar(0.5).multiplyScalar(size).add(grid.min)
      cell.sort((a, b) => strength(lamps[b], center) - strength(lamps[a], center))
      grid.overflow += cell.length - MAX_CELL_LAMPS
      cell.length = MAX_CELL_LAMPS
    }
    grid.indices.push(...cell)
  }
  return grid
}

/** Retourne les indices de la cellule contenant un point du monde. */
export function cellLamps(grid: LampGrid, point: THREE.Vector3): number[] {
  const p = point.clone().sub(grid.min).divideScalar(grid.size).floor()
  const { x, y, z } = p, d = grid.dims
  if (x < 0 || y < 0 || z < 0 || x >= d.x || y >= d.y || z >= d.z) return []
  return grid.cells[x + d.x * (y + d.y * z)]
}

/** Les texels des cellules, indices et lampes suivent les sondes dans le même atlas RGBA. */
export function appendLampData(atlas: import('./bakedLight').BakedAtlas, grid: LampGrid, lamps: readonly PlacedLight[]): { table: number; list: number; records: number } {
  const image = atlas.irradiance.image as unknown as { data: Uint16Array; width: number; height: number }
  const table = image.width * image.height
  const list = table + grid.cells.length
  const records = list + Math.ceil(grid.indices.length / 4)
  const end = records + lamps.length * 3
  const height = Math.ceil(end / image.width)
  if (height > 2048 || end >= 16777216) throw new Error('Atlas de lampes trop grand pour WebGL2')
  const data = new Float32Array(image.width * height * 4)
  for (let i = 0; i < image.data.length; i++) data[i] = THREE.DataUtils.fromHalfFloat(image.data[i])
  let offset = 0
  grid.cells.forEach((cell, i) => {
    data.set([offset, cell.length, 0, 0], (table + i) * 4)
    offset += cell.length
  })
  grid.indices.forEach((index, i) => { data[list * 4 + i] = index })
  lamps.forEach((lamp, i) => {
    const outer = Math.min(THREE.MathUtils.degToRad(lamp.cone[1] / 2), Math.PI / 2)
    const penumbra = lamp.cone[1] > 0 ? THREE.MathUtils.clamp(1 - lamp.cone[0] / lamp.cone[1], 0, 1) : 0
    data.set([lamp.position.x, lamp.position.y, lamp.position.z, lamp.range], (records + i * 3) * 4)
    data.set([lamp.color.r * lamp.energy * LAMP_SCALE, lamp.color.g * lamp.energy * LAMP_SCALE, lamp.color.b * lamp.energy * LAMP_SCALE, lamp.kind === 'spot' ? Math.cos(outer) : -2], (records + i * 3 + 1) * 4)
    data.set([lamp.direction.x, lamp.direction.y, lamp.direction.z, Math.cos(outer * (1 - penumbra))], (records + i * 3 + 2) * 4)
  })
  atlas.irradiance.dispose()
  const texture = new THREE.DataTexture(data, image.width, height, THREE.RGBAFormat, THREE.FloatType)
  texture.generateMipmaps = false
  texture.needsUpdate = true
  atlas.irradiance = texture
  return { table, list, records }
}
