// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * probes3d.ts — THE ENVIRONMENT PROBES: where to capture the map, and which probe lights which
 * surface.
 *
 * A single capture would light a closed room with the neighboring courtyard's sky. Probes are
 * placed where players have stood (never inside a wall), spread out by farthest-point sampling:
 * the first closest to the center, each next one at the played point farthest from the probes
 * already placed, up to the cap or until every played point has a probe within `spacing`. Each
 * map surface takes the probe closest to its box (a slab crossing several zones is settled by its
 * center).
 */
import * as THREE from 'three'

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
