// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** springArm3d.ts — third-person spring arm: the follow camera's pull-in and release past the map. */
import type { Vector3 } from 'three'

/** World units: 1 u = 3.048 m. */
const M_PER_U = 3.048
/** How far in front of a hit the camera rests: 0.2 m. */
export const ARM_CLEARANCE = 0.2 / M_PER_U
/** The camera never sits closer to the head than this: 0.3 m. */
export const ARM_MIN_DISTANCE = 0.3 / M_PER_U
/** The release back to full length once the line clears: ~95% of it in 0.3 s. */
export const ARM_EASE_OUT_TIME = 0.3

/**
 * springArmLength computes the arm length (head to camera) for this frame. `head` and `desired`
 * are the player's head and the desired camera position; `hitDistance` is the first hit of the
 * ray from the head toward `desired`, or null when the line clears; `prevLength` is the arm
 * length of the previous frame; `dt` is the elapsed seconds. A hit pulls in immediately; a clear
 * line eases back out over ARM_EASE_OUT_TIME.
 */
export function springArmLength(head: Vector3, desired: Vector3, hitDistance: number | null, prevLength: number, dt: number): number {
  const fullLength = head.distanceTo(desired)
  const target = hitDistance === null ? fullLength : Math.max(hitDistance - ARM_CLEARANCE, ARM_MIN_DISTANCE)
  if (target <= prevLength) return target
  // Exponential release, time constant ARM_EASE_OUT_TIME / 3: ~95% of the gap closes in 0.3 s.
  const step = 1 - Math.exp((-Math.max(0, dt) * 3) / ARM_EASE_OUT_TIME)
  return prevLength + (target - prevLength) * step
}
