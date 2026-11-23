// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import type { ReplayWeaponPadReady } from '@/lib/replay/replayNormalize'
import { padRespawnAt, padStateAt } from '../model/weaponPadTime'

/**
 * navpointStateAt — a pad's state and its countdown, the pure time rule of the 3D pad navpoint
 * markers (`padNavpointMarkers3d`). `state` is the pad's occupancy (`padStateAt`); `seconds` is
 * the countdown to the weapon's return when the pad is empty or the film does not date it, else
 * null (a full or uncertain pad shows no count).
 */
export function navpointStateAt(pad: ReplayWeaponPadReady, frame: number, frameMs: number) {
  const state = padStateAt(pad, frame)
  const next = state === 'empty' ? Math.min(...pad.presence.map((p) => p.t0).concat(pad.spawns).filter((t) => t > frame)) : Infinity
  const seconds = Number.isFinite(next) && frameMs > 0 ? (next - frame) * frameMs / 1000 : padRespawnAt(pad, frame, frameMs)?.seconds ?? null
  return { state, seconds }
}

/**
 * navpointCountdownText — the countdown under a power weapon's hex while it is not up yet, as the
 * game writes it: minutes and two-digit seconds, rounded up ("0:28" with 27.4 s left; Jordan's
 * Vacancy capture of 2026-11-22). Empty without a count.
 */
export function navpointCountdownText(seconds: number | null): string {
  if (seconds == null || !(seconds > 0)) return ''
  const s = Math.ceil(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The aim cone inside which a power weapon's navpoint writes its name and distance (degrees from
 * the view axis; the reticle is the screen's center). Outside it the navpoint shows the hex and,
 * while the weapon is not up, the countdown only (Jordan, 2026-11-22). Measured on the Vacancy
 * capture (1920 px, horizontal FOV 108): the text starts fading between 188 and 208 px from the
 * reticle, 15.0 to 16.6 degrees; not read from the game's data.
 */
export const NAV_FOCUS_DEGREES = 15

/** The fade of the name and distance as they come and go, seconds (about 5 frames at 30 fps in the capture). */
export const NAV_FOCUS_FADE_S = 0.17

/** aimDegrees — the angle (degrees) between the view direction `forward` and the direction `to` the item. */
export function aimDegrees(forward: readonly [number, number, number], to: readonly [number, number, number]): number {
  const lf = Math.hypot(...forward)
  const lt = Math.hypot(...to)
  if (lf < 1e-9 || lt < 1e-9) return 0
  const c = (forward[0] * to[0] + forward[1] * to[1] + forward[2] * to[2]) / (lf * lt)
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI
}
