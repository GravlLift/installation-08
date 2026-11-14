/**
 * shroud3d_logic.ts — THE SHROUD SCREEN'S BUBBLE AT A FRAME: where it stands, how big it is, and
 * whether it is up.
 *
 * WHERE AND WHEN come from the document, through the 2D placement rule (`model/spawnedObjects`
 * `effectPlacement`): the throw is a carried shroud screen's use (`carriedEquipment[].uses`), the
 * grenade's flight is `carriedEquipment[].tracked[]` (its rest at `land`, `x`, `y`, `z`), and the
 * BUBBLE is the separate object the film creates on impact, `tracked[].effect`: `effect.t0` is
 * its birth, `effect.t1` its deletion, `effect.x/y/z` its position. Without a read bubble the
 * placement stands at the grenade's rest for `SHROUD_DURATION_MS` (7.5 s, read in the film).
 *
 * THE RADIUS is game data: the bubble object the shroud projectile creates (bloc 0x26b5e988,
 * created by proj 0x97115737) has the physics model phmo 0x3cb5abaa (through hlmt 0x3cda97e5),
 * whose collision hull is centered on the object's origin: its vertices sit 1.76 u from the
 * center on each axis (median vertex distance 1.77 u, face planes 1.72 to 1.75 u). The bubble's
 * render model (mode 0x646070ea) is in neither the globals modules nor the Ekur export, so its
 * look is not read; the 2D's 6 u is a screen choice (`layers/placementShroud`), not this.
 *
 * THE OPENING AND CLOSING are ESTIMATES (`SHROUD_OPEN_MS`, `SHROUD_CLOSE_MS`): the film dates the
 * bubble's birth and deletion only. A function of the frame alone: seeking gives the same picture.
 */

/** The bubble's radius (u): the collision hull of its physics model (see the header). */
export const SHROUD_BUBBLE_RADIUS_U = 1.76

/** ESTIMATE: the bubble swells from nothing to its full radius over this time after its birth (ms). */
export const SHROUD_OPEN_MS = 300

/** ESTIMATE: the bubble shrinks to nothing over this time before its deletion (ms). */
export const SHROUD_CLOSE_MS = 300

/** The bubble at one frame: its radius (u) and its age since its birth (s, drives the surface's slow drift). */
export interface ShroudBubble {
  radius: number
  ageS: number
}

function ease(u: number): number {
  const x = u < 0 ? 0 : u > 1 ? 1 : u
  return x * x * (3 - 2 * x)
}

/**
 * shroudBubbleAt — the bubble born at frame `t0` and deleted after frame `end`, at `frame`, or
 * null outside [t0, end]. It swells after its birth and shrinks before its end; a window shorter
 * than both never exceeds the radius its middle reaches.
 */
export function shroudBubbleAt(t0: number, end: number, frame: number, frameMs: number): ShroudBubble | null {
  if (!(frameMs > 0) || !(end >= t0) || frame < t0 || frame > end) return null
  const sinceMs = (frame - t0) * frameMs
  const leftMs = (end - frame) * frameMs
  const k = Math.min(ease(sinceMs / SHROUD_OPEN_MS), ease(leftMs / SHROUD_CLOSE_MS))
  if (!(k > 0)) return null
  return { radius: SHROUD_BUBBLE_RADIUS_U * k, ageS: sinceMs / 1000 }
}
