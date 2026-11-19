// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * probes3d.ts — THE ENVIRONMENT PROBES: where to capture the map, and which probe lights which
 * surface.
 *
 * A single capture would light a closed room with the neighboring courtyard's sky. Probes are
 * placed where players have stood (never inside a wall), spread out by farthest-point sampling:
 * the first closest to the center, each next one at the played point farthest from the probes
 * already placed, up to the cap or until every played point has a probe within `spacing`. Each
 * triangle of a map surface takes the probe closest to its center (`splitByProbe`): many of the
 * map's surfaces are one mesh across the whole map (Streets' road is 74 u wide), and a single probe
 * for the mesh lit a whole street with the reflection of a room in the middle of the map.
 */
import * as THREE from 'three'

/** A surface's share drawn with one probe's material (`Lighting.assignProbes`). */
export interface ProbePart {
  material: THREE.MeshStandardMaterial
  index: THREE.TypedArray
}

/**
 * The parts of the surfaces whose triangles are lit by more than one probe, set by the lighting
 * on every capture: the mesh itself keeps the material of its largest part, and the merged
 * draws (`batchLayered`) draw each part with its own material.
 */
export const probeParts = new WeakMap<THREE.Mesh, ProbePart[]>()

/**
 * splitByProbe: `mesh`'s triangles grouped by the probe closest to each triangle's center (world
 * axes), the largest share first. A mesh without an index, or whose triangles all take one probe,
 * is one share: its whole index (null without one), and the probe closest to its box.
 */
export function splitByProbe(mesh: THREE.Mesh, probes: readonly THREE.Vector3[]): { probe: number; index: THREE.TypedArray | null }[] {
  const index = mesh.geometry.index
  const position = mesh.geometry.getAttribute('position')
  if (!index || !position || probes.length < 2) {
    return [{ probe: nearestProbe(new THREE.Box3().setFromObject(mesh), probes), index: index?.array ?? null }]
  }
  mesh.updateWorldMatrix(true, false)
  const e = mesh.matrixWorld.elements
  const ids = index.array
  const triangles = Math.floor(ids.length / 3)
  const owner = new Uint8Array(triangles)
  const counts = new Array<number>(probes.length).fill(0)
  for (let t = 0; t < triangles; t++) {
    let x = 0
    let y = 0
    let z = 0
    for (let v = 0; v < 3; v++) {
      const i = ids[t * 3 + v]
      x += position.getX(i)
      y += position.getY(i)
      z += position.getZ(i)
    }
    x /= 3
    y /= 3
    z /= 3
    const wx = e[0] * x + e[4] * y + e[8] * z + e[12]
    const wy = e[1] * x + e[5] * y + e[9] * z + e[13]
    const wz = e[2] * x + e[6] * y + e[10] * z + e[14]
    let best = 0
    let bestD = Infinity
    for (let p = 0; p < probes.length; p++) {
      const dx = probes[p].x - wx
      const dy = probes[p].y - wy
      const dz = probes[p].z - wz
      const d = dx * dx + dy * dy + dz * dz
      if (d < bestD) {
        best = p
        bestD = d
      }
    }
    owner[t] = best
    counts[best]++
  }
  const used = counts.map((n, probe) => ({ probe, n })).filter((s) => s.n > 0)
  if (used.length === 1) return [{ probe: used[0].probe, index: ids }]
  used.sort((a, b) => b.n - a.n || a.probe - b.probe)
  const Ctor = ids.constructor as new (n: number) => THREE.TypedArray
  return used.map(({ probe, n }) => {
    const out = new Ctor(n * 3)
    let o = 0
    for (let t = 0; t < triangles; t++) {
      if (owner[t] !== probe) continue
      out[o++] = ids[t * 3]
      out[o++] = ids[t * 3 + 1]
      out[o++] = ids[t * 3 + 2]
    }
    return { probe, index: out }
  })
}

/**
 * chooseProbes: at most `max` points taken from `points`, the first closest to their center,
 * spaced at least `spacing` apart (u). Deterministic: same points, same probes.
 */
export function chooseProbes(points: readonly THREE.Vector3[], max: number, spacing: number): THREE.Vector3[] {
  if (points.length === 0 || max < 1) return []
  const mean = points.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(points.length)
  let first = points[0]
  for (const p of points) if (p.distanceToSquared(mean) < first.distanceToSquared(mean)) first = p
  const chosen = [first]
  // Each point's distance to its closest probe, kept up to date on every placement.
  const nearest = points.map((p) => p.distanceToSquared(first))
  while (chosen.length < max) {
    let far = 0
    for (let i = 1; i < points.length; i++) if (nearest[i] > nearest[far]) far = i
    if (nearest[far] < spacing * spacing) break
    const next = points[far]
    chosen.push(next)
    for (let i = 0; i < points.length; i++) nearest[i] = Math.min(nearest[i], points[i].distanceToSquared(next))
  }
  return chosen
}

/**
 * nearestProbe: the index of the probe that lights a surface with box `box`. Distance to the box
 * first (a probe inside or against it scores 0), then to the center as a tiebreaker.
 */
export function nearestProbe(box: THREE.Box3, probes: readonly THREE.Vector3[]): number {
  const center = box.getCenter(new THREE.Vector3())
  let best = 0
  let bestBox = Infinity
  let bestCenter = Infinity
  probes.forEach((p, i) => {
    const d = box.distanceToPoint(p)
    const c = center.distanceToSquared(p)
    if (d < bestBox || (d === bestBox && c < bestCenter)) {
      best = i
      bestBox = d
      bestCenter = c
    }
  })
  return best
}

/**
 * sunAngles: the sun direction published in the mesh (Halo axes, toward the sun) as the scene's
 * azimuth and elevation (degrees, `Lighting.setSun`'s convention); null if it is absent or
 * unreadable. three.js axes are Halo's axes as (x, z, -y).
 */
export function sunAngles(extras: unknown): { azimuth: number; elevation: number } | null {
  const dir = (extras as { levelupSun?: { dir?: unknown } } | null)?.levelupSun?.dir
  if (!Array.isArray(dir) || dir.length !== 3 || !dir.every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  const [hx, hy, hz] = dir as number[]
  const v = new THREE.Vector3(hx, hz, -hy)
  if (v.lengthSq() === 0 || v.y <= 0) return null
  v.normalize()
  return {
    azimuth: THREE.MathUtils.radToDeg(Math.atan2(-v.z, v.x)),
    elevation: THREE.MathUtils.radToDeg(Math.asin(v.y)),
  }
}
