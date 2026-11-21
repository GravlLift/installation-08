// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import type { ReplayWeaponPadReady } from '@/lib/replay/replayNormalize'
import { padRespawnAt, padStateAt } from '../model/weaponPadTime'

export function navpointStateAt(pad: ReplayWeaponPadReady, frame: number, frameMs: number) {
  const state = padStateAt(pad, frame)
  const next = state === 'empty' ? Math.min(...pad.presence.map((p) => p.t0).concat(pad.spawns).filter((t) => t > frame)) : Infinity
  const seconds = Number.isFinite(next) && frameMs > 0 ? (next - frame) * frameMs / 1000 : padRespawnAt(pad, frame, frameMs)?.seconds ?? null
  return { state, seconds }
}

export function projectNavpoint(point: THREE.Vector3, camera: THREE.Camera, width: number, height: number) {
  if (!(width > 0 && height > 0) || ![point.x, point.y, point.z].every(Number.isFinite)) return null
  const view = point.clone().applyMatrix4(camera.matrixWorldInverse)
  if (view.z >= 0) return null
  const p = point.clone().project(camera)
  if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || Math.abs(p.z) > 1) return null
  return { x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2 }
}
