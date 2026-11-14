/**
 * shroud3d_logic.ts — THE SHROUD SCREEN'S BUBBLE AT A FRAME: where it stands, how big it is,
 * whether it is up, and the constants of its surface read in its game material.
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
 * center on each axis (median vertex distance 1.77 u, face planes 1.72 to 1.75 u).
 *
 * THE SURFACE is read in the same hlmt's render model, mode 0x646070ea (in the installed game's
 * `ds` and `pc` globals modules), whose material mat 0xc3214bb8 (shader shdv 0x5137930f) binds a
 * HEXAGON MASK texture, bitm 0x215a8ad8 (1024 x 1024: red = the cell border, a line inset from
 * the cell edge; green = a glow rising to the cell center; blue = a per-cell value). Its colors
 * are the theme's diegetic inks (`layers/shroudInk.ts`, values and names in `index.css`).
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

/**
 * The hexagon texture's repeats over the model's UVs (u, v): its transform register in the
 * material (register 28, constants 4 and 2).
 */
export const SHROUD_HEX_TILING: readonly [number, number] = [4, 2]

/**
 * Hexagons per texture repeat (columns, rows), counted on bitm 0x215a8ad8: five pointy-top cells
 * across 1024 px (pitch 204.8 px), six rows down, odd rows shifted half a cell. With the tiling,
 * 20 cells around the bubble and 12 rows from pole to pole.
 */
export const SHROUD_HEX_CELLS: readonly [number, number] = [5, 6]

/**
 * The cell border in the texture's red channel, in cell pitches from the cell edge (measured on a
 * row through a cell center): dark for the first 0.01, bright up to 0.05, dark inside.
 */
export const SHROUD_HEX_BORDER: { readonly from: number; readonly to: number } = { from: 0.01, to: 0.05 }

/**
 * The material's fresnel: `fresnel_min` 0, `fresnel_max` 1, `fresnel_alpha_exponent` 1.5. The
 * rim weight is ((1 - |n.v|) remapped from [min, max] to [0, 1]) raised to the exponent.
 */
export const SHROUD_FRESNEL: { readonly min: number; readonly max: number; readonly exponent: number } = {
  min: 0,
  max: 1,
  exponent: 1.5,
}

/**
 * ESTIMATE, matched to the owner's in-game reference (2026-11-14): the outer face lets players
 * inside show through as faint silhouettes. The material's blend mode (12) is outside the enum
 * the app knows, so the data does not give this opacity. The inner face stays fully opaque: a
 * camera inside the bubble sees its wall, not the world.
 */
export const SHROUD_OUTER_OPACITY = 0.85

/** The bubble at one frame: its radius (u). */
export interface ShroudBubble {
  radius: number
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
  return { radius: SHROUD_BUBBLE_RADIUS_U * k }
}
