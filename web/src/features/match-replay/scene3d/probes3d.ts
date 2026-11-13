/**
 * probes3d.ts — LES SONDES D'ENVIRONNEMENT : où capturer la carte, et quelle sonde éclaire quelle
 * surface.
 *
 * Une capture unique éclairerait une salle fermée avec le ciel de la cour voisine. Les sondes se posent là où des joueurs se sont tenus (jamais dans un mur), réparties par
 * tirage du point le plus éloigné : la première au plus près du centre, chaque suivante au point
 * joué le plus loin des sondes déjà posées, jusqu'au plafond ou jusqu'à ce que tout point joué ait
 * une sonde à moins de `spacing`. Chaque surface de la carte prend la sonde la plus proche de sa
 * boîte (une dalle qui traverse plusieurs zones départage par son centre).
 */
import * as THREE from 'three'

/**
 * chooseProbes : au plus `max` points pris dans `points`, le premier au plus près de leur centre,
 * espacés d'au moins `spacing` (u). Déterministe : mêmes points, mêmes sondes.
 */
export function chooseProbes(points: readonly THREE.Vector3[], max: number, spacing: number): THREE.Vector3[] {
  if (points.length === 0 || max < 1) return []
  const mean = points.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(points.length)
  let first = points[0]
  for (const p of points) if (p.distanceToSquared(mean) < first.distanceToSquared(mean)) first = p
  const chosen = [first]
  // Distance de chaque point à la sonde la plus proche, tenue à jour à chaque pose.
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
 * nearestProbe : l'indice de la sonde qui éclaire une surface de boîte `box`. Distance à la boîte
 * d'abord (une sonde dedans ou contre elle vaut 0), puis au centre pour départager.
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
 * sunAngles : la direction du soleil publiée dans le maillage (axes Halo, vers le soleil) en azimut
 * et élévation de la scène (degrés, convention de `Lighting.setSun`) ; null si elle est absente ou
 * illisible. Les axes three sont (x, z, -y) des axes Halo.
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
