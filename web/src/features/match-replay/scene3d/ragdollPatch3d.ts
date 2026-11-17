// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * ragdollPatch3d.ts — THE MAP CHUNK A BODY FALLS INTO: the map's triangles around the death,
 * stored in a grid, and a sphere's contacts (a ragdoll particle, `ragdollSolver3d`) with them.
 *
 * The whole map (millions of triangles, one primitive per material covering the entire map) is
 * never walked: the triangles of a box around the body are read from the raycast index the map
 * already carries (`three-mesh-bvh`, `mapModel.indexSurfaces`), once per box, then stored in a
 * regular grid. Contacts: the closest point of each triangle in the cells the sphere touches,
 * pushed out of the triangle on the side the particle came from; a step longer than the radius is
 * swept first (segment against triangles) so it does not pass through a thin wall.
 *
 * Everything is deterministic: same box, same triangles in the same order, same contacts.
 */
import * as THREE from 'three'
import type { MeshBVH } from 'three-mesh-bvh'

import { surfaceFamily } from './surfaceProbe3d'

/** Something that can return the triangles (three axes, 9 numbers per triangle) touching a box. */
export interface TriangleSource {
  trianglesIn(box: THREE.Box3): Float32Array
}

/** A grid cell's size (u). */
const CELL = 0.1
const EPS = 1e-9
/** A particle's contact planes at most (`TrianglePatch.contacts`). */
export const MAX_CONTACTS = 4

export class TrianglePatch {
  readonly box: THREE.Box3
  readonly count: number
  private readonly tris: Float32Array
  /** Each triangle's bounding box: min x y z, max x y z. */
  private readonly bounds: Float32Array
  private readonly mx: number
  private readonly my: number
  private readonly mz: number
  private readonly nx: number
  private readonly ny: number
  private readonly nz: number
  private readonly start: Int32Array
  private readonly items: Int32Array
  private readonly stamp: Uint32Array
  private mark = 0
  private cand = new Int32Array(256)
  private readonly c = new Float64Array(3)
  private readonly dists = new Float64Array(MAX_CONTACTS)

  constructor(tris: Float32Array, box: THREE.Box3) {
    this.box = box.clone()
    this.tris = tris
    this.count = Math.floor(tris.length / 9)
    this.mx = box.min.x
    this.my = box.min.y
    this.mz = box.min.z
    this.nx = cells(box.max.x - box.min.x)
    this.ny = cells(box.max.y - box.min.y)
    this.nz = cells(box.max.z - box.min.z)
    this.stamp = new Uint32Array(this.count)
    this.bounds = new Float32Array(6 * this.count)
    for (let t = 0; t < this.count; t++) {
      const o = 9 * t
      const b = 6 * t
      this.bounds[b] = Math.min(tris[o], tris[o + 3], tris[o + 6])
      this.bounds[b + 1] = Math.min(tris[o + 1], tris[o + 4], tris[o + 7])
      this.bounds[b + 2] = Math.min(tris[o + 2], tris[o + 5], tris[o + 8])
      this.bounds[b + 3] = Math.max(tris[o], tris[o + 3], tris[o + 6])
      this.bounds[b + 4] = Math.max(tris[o + 1], tris[o + 4], tris[o + 7])
      this.bounds[b + 5] = Math.max(tris[o + 2], tris[o + 5], tris[o + 8])
    }
    const n = this.nx * this.ny * this.nz
    this.start = new Int32Array(n + 1)
    // Two passes: count per cell, then store (triangle order kept within each cell).
    this.eachCell(null)
    for (let i = 0; i < n; i++) this.start[i + 1] += this.start[i]
    this.items = new Int32Array(this.start[n])
    this.eachCell(this.start.slice(0, n))
  }

  /** inside: is point (x, y, z) within the box shrunk by `margin`? */
  inside(x: number, y: number, z: number, margin: number): boolean {
    const b = this.box
    return x > b.min.x + margin && x < b.max.x - margin && y > b.min.y + margin && y < b.max.y - margin &&
      z > b.min.z + margin && z < b.max.z - margin
  }

  /**
   * contacts writes into `out` (6 numbers per plane: point, normal) the contact planes of the
   * sphere centered at `p[o..o+2]`: one per triangle within `reach` of its center, at most `max`,
   * closest first. The normal points from the triangle toward `prev`'s side (the previous
   * position). With `anchor` (the body's center, first steps only), a previous position that was
   * not clearly off the surface (within radius `r`) does not decide: the body center's side
   * decides, and a particle that already starts under a surface (the film's feet slightly under a
   * floor) is pulled back up, not pushed through. Returns the number of planes.
   */
  contacts(p: Float64Array, o: number, r: number, reach: number, prev: Float64Array, anchor: readonly number[] | null, out: Float64Array, max: number): number {
    let n = 0
    const px = p[o], py = p[o + 1], pz = p[o + 2]
    const found = this.gather(px - reach, py - reach, pz - reach, px + reach, py + reach, pz + reach)
    const dists = this.dists
    for (let q = 0; q < found; q++) {
      const t = this.cand[q]
      closestOnTriangle(this.tris, 9 * t, px, py, pz, this.c)
      const cx = this.c[0], cy = this.c[1], cz = this.c[2]
      let nx = px - cx, ny = py - cy, nz = pz - cz
      const d = Math.sqrt(nx * nx + ny * ny + nz * nz)
      // `!(d < reach)` also rejects a degenerate triangle (NaN point).
      if (!(d < reach) || (n >= max && d >= dists[max - 1])) continue
      if (d < 1e-6) {
        triangleNormal(this.tris, 9 * t, this.c)
        nx = this.c[0]
        ny = this.c[1]
        nz = this.c[2]
      } else {
        nx /= d
        ny /= d
        nz /= d
      }
      const sp = (prev[o] - cx) * nx + (prev[o + 1] - cy) * ny + (prev[o + 2] - cz) * nz
      const flip = anchor
        ? sp < -r || (sp < r && (anchor[0] - cx) * nx + (anchor[1] - cy) * ny + (anchor[2] - cz) * nz < 0)
        : sp < 0
      if (flip) {
        nx = -nx
        ny = -ny
        nz = -nz
      }
      // Stored by increasing distance; past `max`, the furthest drops out.
      let k = Math.min(n, max - 1)
      while (k > 0 && dists[k - 1] > d) {
        out.copyWithin(6 * k, 6 * (k - 1), 6 * k)
        dists[k] = dists[k - 1]
        k--
      }
      out[6 * k] = cx
      out[6 * k + 1] = cy
      out[6 * k + 2] = cz
      out[6 * k + 3] = nx
      out[6 * k + 4] = ny
      out[6 * k + 5] = nz
      dists[k] = d
      if (n < max) n++
    }
    return n
  }

  /**
   * sweep: the first triangle the segment from `prev` to `p` crosses (a fast particle); the
   * particle is brought back to the impact point, `r` from the triangle on `prev`'s side. Returns
   * true if it crossed one.
   */
  sweep(p: Float64Array, o: number, r: number, prev: Float64Array): boolean {
    const ax = prev[o], ay = prev[o + 1], az = prev[o + 2]
    const dx = p[o] - ax, dy = p[o + 1] - ay, dz = p[o + 2] - az
    let best = 1
    let bt = -1
    const found = this.gather(Math.min(ax, p[o]), Math.min(ay, p[o + 1]), Math.min(az, p[o + 2]), Math.max(ax, p[o]), Math.max(ay, p[o + 1]), Math.max(az, p[o + 2]))
    for (let q = 0; q < found; q++) {
      const t = this.cand[q]
      const u = segmentTriangle(this.tris, 9 * t, ax, ay, az, dx, dy, dz)
      if (u >= 0 && u < best) {
        best = u
        bt = t
      }
    }
    if (bt < 0) return false
    triangleNormal(this.tris, 9 * bt, this.c)
    const s = dx * this.c[0] + dy * this.c[1] + dz * this.c[2] > 0 ? -1 : 1
    p[o] = ax + dx * best + this.c[0] * s * r
    p[o + 1] = ay + dy * best + this.c[1] * s * r
    p[o + 2] = az + dz * best + this.c[2] * s * r
    return true
  }

  /**
   * gather stores in `cand` the triangles (once each) of the cells the given box touches whose
   * bounding box also touches it; returns their count.
   */
  private gather(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number {
    const i0 = Math.max(0, Math.floor((x0 - this.mx) / CELL)), i1 = Math.min(this.nx - 1, Math.floor((x1 - this.mx) / CELL))
    const j0 = Math.max(0, Math.floor((y0 - this.my) / CELL)), j1 = Math.min(this.ny - 1, Math.floor((y1 - this.my) / CELL))
    const k0 = Math.max(0, Math.floor((z0 - this.mz) / CELL)), k1 = Math.min(this.nz - 1, Math.floor((z1 - this.mz) / CELL))
    if (i0 > i1 || j0 > j1 || k0 > k1) return 0
    this.mark = (this.mark + 1) >>> 0
    if (this.mark === 0) {
      this.stamp.fill(0)
      this.mark = 1
    }
    let n = 0
    const bd = this.bounds
    for (let k = k0; k <= k1; k++) {
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const cell = i + this.nx * (j + this.ny * k)
          for (let q = this.start[cell]; q < this.start[cell + 1]; q++) {
            const t = this.items[q]
            if (this.stamp[t] === this.mark) continue
            this.stamp[t] = this.mark
            const b = 6 * t
            if (bd[b] > x1 || bd[b + 3] < x0 || bd[b + 1] > y1 || bd[b + 4] < y0 || bd[b + 2] > z1 || bd[b + 5] < z0) continue
            if (n === this.cand.length) {
              const grown = new Int32Array(2 * n)
              grown.set(this.cand)
              this.cand = grown
            }
            this.cand[n++] = t
          }
        }
      }
    }
    return n
  }

  /** eachCell: without `fill`, counts each cell's triangles (into `start`); with it, stores them there. */
  private eachCell(fill: Int32Array | null): void {
    const bd = this.bounds
    const clampCell = (v: number, m: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor((v - m) / CELL)))
    for (let t = 0; t < this.count; t++) {
      const b = 6 * t
      const i0 = clampCell(bd[b], this.mx, this.nx), i1 = clampCell(bd[b + 3], this.mx, this.nx)
      const j0 = clampCell(bd[b + 1], this.my, this.ny), j1 = clampCell(bd[b + 4], this.my, this.ny)
      const k0 = clampCell(bd[b + 2], this.mz, this.nz), k1 = clampCell(bd[b + 5], this.mz, this.nz)
      for (let k = k0; k <= k1; k++) {
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const cell = i + this.nx * (j + this.ny * k)
            if (fill) this.items[fill[cell]++] = t
            else this.start[cell + 1]++
          }
        }
      }
    }
  }
}

function cells(size: number): number {
  return Math.max(1, Math.ceil(size / CELL))
}

/** triangleNormal writes into `out` the unit normal of the triangle at index `o` (zero if it is flat). */
function triangleNormal(tr: Float32Array, o: number, out: Float64Array): void {
  const ux = tr[o + 3] - tr[o]
  const uy = tr[o + 4] - tr[o + 1]
  const uz = tr[o + 5] - tr[o + 2]
  const vx = tr[o + 6] - tr[o]
  const vy = tr[o + 7] - tr[o + 1]
  const vz = tr[o + 8] - tr[o + 2]
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
  out[0] = nx / l
  out[1] = ny / l
  out[2] = nz / l
}

/**
 * closestOnTriangle writes into `out` the point of the triangle (index `o`) closest to (px, py, pz)
 * (Ericson, "Real-Time Collision Detection", 5.1.5: Voronoi regions of vertices and edges).
 */
export function closestOnTriangle(tr: Float32Array, o: number, px: number, py: number, pz: number, out: Float64Array): void {
  const ax = tr[o], ay = tr[o + 1], az = tr[o + 2]
  const abx = tr[o + 3] - ax, aby = tr[o + 4] - ay, abz = tr[o + 5] - az
  const acx = tr[o + 6] - ax, acy = tr[o + 7] - ay, acz = tr[o + 8] - az
  const apx = px - ax, apy = py - ay, apz = pz - az
  // Coordinates (u, v) of the closest point on a + u·ab + v·ac, by region.
  let u = 0
  let v = 0
  const d1 = abx * apx + aby * apy + abz * apz
  const d2 = acx * apx + acy * apy + acz * apz
  const bpx = px - tr[o + 3], bpy = py - tr[o + 4], bpz = pz - tr[o + 5]
  const d3 = abx * bpx + aby * bpy + abz * bpz
  const d4 = acx * bpx + acy * bpy + acz * bpz
  const cpx = px - tr[o + 6], cpy = py - tr[o + 7], cpz = pz - tr[o + 8]
  const d5 = abx * cpx + aby * cpy + abz * cpz
  const d6 = acx * cpx + acy * cpy + acz * cpz
  const vc = d1 * d4 - d3 * d2
  const vb = d5 * d2 - d1 * d6
  const va = d3 * d6 - d5 * d4
  if (d1 <= 0 && d2 <= 0) {
    // vertex a
  } else if (d3 >= 0 && d4 <= d3) {
    u = 1
  } else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    u = d1 / (d1 - d3)
  } else if (d6 >= 0 && d5 <= d6) {
    v = 1
  } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    v = d2 / (d2 - d6)
  } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    v = (d4 - d3) / (d4 - d3 + (d5 - d6))
    u = 1 - v
  } else if (va + vb + vc !== 0) {
    const denom = 1 / (va + vb + vc)
    u = vb * denom
    v = vc * denom
  }
  out[0] = ax + abx * u + acx * v
  out[1] = ay + aby * u + acy * v
  out[2] = az + abz * u + acz * v
}

/**
 * segmentTriangle: the fraction (0 to 1) of segment a + u·d where it crosses the triangle (index
 * `o`), -1 if it does not cross it (Möller-Trumbore, both sides).
 */
export function segmentTriangle(tr: Float32Array, o: number, ax: number, ay: number, az: number, dx: number, dy: number, dz: number): number {
  const e1x = tr[o + 3] - tr[o], e1y = tr[o + 4] - tr[o + 1], e1z = tr[o + 5] - tr[o + 2]
  const e2x = tr[o + 6] - tr[o], e2y = tr[o + 7] - tr[o + 1], e2z = tr[o + 8] - tr[o + 2]
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x
  const det = e1x * px + e1y * py + e1z * pz
  if (Math.abs(det) < EPS) return -1
  const inv = 1 / det
  const sx = ax - tr[o], sy = ay - tr[o + 1], sz = az - tr[o + 2]
  const u = (sx * px + sy * py + sz * pz) * inv
  if (u < 0 || u > 1) return -1
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x
  const v = (dx * qx + dy * qy + dz * qz) * inv
  if (v < 0 || u + v > 1) return -1
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv
  return t >= 0 && t <= 1 ? t : -1
}

/**
 * MeshTriangleSource: the triangles of the map's surfaces (`Ground.surfaces`) that touch a box,
 * read from each mesh's index (`geometry.boundsTree`); a mesh with no index is skipped. The
 * triangle-box test is the bounding-box one (conservative, fast).
 */
export class MeshTriangleSource implements TriangleSource {
  private readonly meshes: THREE.Mesh[]
  private readonly local = new THREE.Box3()
  private readonly inv = new THREE.Matrix4()
  private readonly v = new THREE.Vector3()

  /** `surfaces`: the meshes that stop a body (`bodySurfaces`); ones with no index get one. */
  constructor(surfaces: readonly THREE.Mesh[]) {
    for (const m of surfaces) if (!m.geometry.boundsTree) m.geometry.computeBoundsTree()
    this.meshes = [...surfaces]
  }

  /**
   * trianglesIn: the triangles touching `box`, read in leaf ranges of the index (the geometry's
   * vertex index is ordered by the raycast index: triangle t is `index[3t..3t+2]`).
   */
  trianglesIn(box: THREE.Box3): Float32Array {
    this.n = 0
    for (const mesh of this.meshes) {
      const geo = mesh.geometry
      const index = geo.index
      if (!index) continue
      const identity = isIdentity(mesh.matrixWorld)
      this.local.copy(box)
      if (!identity) this.local.applyMatrix4(this.inv.copy(mesh.matrixWorld).invert())
      const lb = this.local
      const ids = index.array
      const pos = geo.attributes.position as THREE.BufferAttribute
      ;(geo.boundsTree as MeshBVH).shapecast({
        intersectsBounds: (b) => b.intersectsBox(lb),
        intersectsRange: (offset, count) => {
          for (let t = offset; t < offset + count; t++) this.keep(pos, ids[3 * t], ids[3 * t + 1], ids[3 * t + 2], lb, identity ? null : mesh.matrixWorld)
          return false
        },
      })
    }
    return this.out.slice(0, this.n)
  }

  private out = new Float32Array(9 * 4096)
  private n = 0

  /** keep stores triangle (a, b, c) of `pos` if it touches `lb` (bounding boxes), in world space. */
  private keep(pos: THREE.BufferAttribute, a: number, b: number, c: number, lb: THREE.Box3, world: THREE.Matrix4 | null): void {
    const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a)
    const bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b)
    const cx = pos.getX(c), cy = pos.getY(c), cz = pos.getZ(c)
    if (Math.max(ax, bx, cx) < lb.min.x || Math.min(ax, bx, cx) > lb.max.x) return
    if (Math.max(ay, by, cy) < lb.min.y || Math.min(ay, by, cy) > lb.max.y) return
    if (Math.max(az, bz, cz) < lb.min.z || Math.min(az, bz, cz) > lb.max.z) return
    if (this.n + 9 > this.out.length) {
      const grown = new Float32Array(2 * this.out.length)
      grown.set(this.out)
      this.out = grown
    }
    const o = this.out
    const coords = [ax, ay, az, bx, by, bz, cx, cy, cz]
    for (let k = 0; k < 9; k += 3) {
      if (world) {
        this.v.set(coords[k], coords[k + 1], coords[k + 2]).applyMatrix4(world)
        o[this.n++] = this.v.x
        o[this.n++] = this.v.y
        o[this.n++] = this.v.z
      } else {
        o[this.n++] = coords[k]
        o[this.n++] = coords[k + 1]
        o[this.n++] = coords[k + 2]
      }
    }
  }
}

/** The view's families that stop a body: structure, decor (some floors are decor), see-through glass. */
const BODY_FAMILIES: ReadonlySet<string> = new Set(['structure', 'decor', 'seeThrough'])

/**
 * bodySurfaces: the meshes that stop a ragdoll: the floor's own (`ground`, the map's structure and
 * the placed layer), plus decor and see-through glass of the same models (some areas' floor is
 * decor, which the layers' floor does not read). Hidden nodes (`ombre*`) carry no family label and
 * stay out.
 */
export function bodySurfaces(ground: readonly THREE.Object3D[]): THREE.Mesh[] {
  const roots = new Set<THREE.Object3D>()
  for (const o of ground) {
    let r = o
    while (r.parent && !(r.parent instanceof THREE.Scene)) r = r.parent
    roots.add(r)
  }
  const out = new Set<THREE.Mesh>(ground.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh))
  for (const root of roots) {
    root.traverse((o) => {
      const family = surfaceFamily(o)
      if (o instanceof THREE.Mesh && family !== null && BODY_FAMILIES.has(family)) out.add(o)
    })
  }
  return [...out]
}

function isIdentity(m: THREE.Matrix4): boolean {
  const e = m.elements
  for (let i = 0; i < 16; i++) if (e[i] !== (i % 5 === 0 ? 1 : 0)) return false
  return true
}
