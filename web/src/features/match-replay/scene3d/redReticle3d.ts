import * as THREE from 'three'
import type { FilmAllegiance } from '@/lib/replay/filmAllegiance'
import { BODY_CENTER, BODY_RADIUS, CROUCH_DROP } from './body3d'
import { toThree, type Tracks3d } from './tracks3d'

// shortcut: one placeholder range in Halo world units, replace with extracted per-weapon reticle ranges.
export const RED_RETICLE_RANGE = 10

export interface ReticleTarget {
  feet: THREE.Vector3
  crouch: boolean
  enemy: boolean
}

/** The box follows the dimensions of the fallback body capsule in body3d.ts. */
export function redReticleTarget(ray: THREE.Ray, targets: readonly ReticleTarget[], range: number): number | null {
  const box = new THREE.Box3()
  const hit = new THREE.Vector3()
  let nearest = Infinity
  let enemy = false
  for (const target of targets) {
    const { feet, crouch } = target
    box.min.set(feet.x - BODY_RADIUS, feet.y, feet.z - BODY_RADIUS)
    box.max.set(feet.x + BODY_RADIUS, feet.y + 2 * BODY_CENTER - (crouch ? CROUCH_DROP : 0), feet.z + BODY_RADIUS)
    if (!ray.intersectBox(box, hit)) continue
    const distance = ray.origin.distanceTo(hit)
    if (distance < nearest) { nearest = distance; enemy = target.enemy }
  }
  return enemy && nearest <= range ? nearest : null
}

export function readRedReticle(options: {
  tracks: Tracks3d | null; frame: number; xuid: string | null; camera: THREE.Camera; drop: number
  allegiance: Pick<FilmAllegiance, 'ofXuid'>; surfaces: THREE.Mesh[]; raycaster: THREE.Raycaster
  riderAt: (xuid: string, frame: number) => THREE.Vector3 | null
}): boolean {
  const { tracks, frame, xuid, camera, drop, allegiance, surfaces, raycaster, riderAt } = options
  if (!tracks || !xuid || !tracks.sample(xuid, frame)) return false
  const targets: ReticleTarget[] = []
  for (const player of tracks.players) {
    if (player.xuid === xuid) continue
    const state = tracks.sample(player.xuid, frame)
    const rider = riderAt(player.xuid, frame)
    if (!state && !rider) continue
    const [x, y, z] = state ? toThree(state.x, state.y, state.z) : [0, 0, 0]
    targets.push({ feet: rider ?? new THREE.Vector3(x, y - drop, z), crouch: state?.crouch ?? false, enemy: allegiance.ofXuid(player.xuid) === false })
  }
  const direction = camera.getWorldDirection(new THREE.Vector3())
  const distance = redReticleTarget(new THREE.Ray(camera.position, direction), targets, RED_RETICLE_RANGE)
  if (distance === null) return false
  raycaster.firstHitOnly = true
  raycaster.far = distance
  raycaster.set(camera.position, direction)
  return raycaster.intersectObjects(surfaces, false).length === 0
}
