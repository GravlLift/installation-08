// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import type { ReplayWeaponPadReady } from '@/lib/replay/replayNormalize'
import { padRespawnAt, padStateAt } from '../model/weaponPadTime'

/**
 * navpointStateAt — a pad's state and its countdown, the pure time rule shared by the 2D pad
 * layer and the 3D pad navpoint markers (`padNavpointMarkers3d`). `state` is the pad's occupancy
 * (`padStateAt`); `seconds` is the countdown to the weapon's return when the pad is empty or the
 * film does not date it, else null (a full or uncertain pad shows no count).
 */
export function navpointStateAt(pad: ReplayWeaponPadReady, frame: number, frameMs: number) {
  const state = padStateAt(pad, frame)
  const next = state === 'empty' ? Math.min(...pad.presence.map((p) => p.t0).concat(pad.spawns).filter((t) => t > frame)) : Infinity
  const seconds = Number.isFinite(next) && frameMs > 0 ? (next - frame) * frameMs / 1000 : padRespawnAt(pad, frame, frameMs)?.seconds ?? null
  return { state, seconds }
}
