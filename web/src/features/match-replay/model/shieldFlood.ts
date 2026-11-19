// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * shieldFlood.ts — the team-colored flash that floods the first-person view when the shield breaks.
 *
 * CONFIRMED from the game's tags (probe `data/probe/shieldflood`, gitignored):
 * - The Spartan's model (`hlmt` 09ab2219, used by the player bipeds 4e24ec15, 83474c0c, ce809021,
 *   e2ec13f1, b2068ecf) has a "shield" damage section with one instant response, and the only
 *   effect referenced from the model is `effe` 85659616, whose screen effect is `sefc` 8c2ba62e.
 * - That screen effect has three layers, all flagged "first person" and "only affects attached
 *   object" (so only the player whose shield broke sees them, through their own eyes):
 *   - "flash": 0.35 s, exposure boost 2, color filter (1, 1, 1) overridden by the team color;
 *   - "grid": 0.5 s, color filter overridden by the team color, plus a shader material
 *     (`mat` 671782d8, not decoded);
 *   - "blur": 0.2 s, radial blur 0.21.
 * - Each layer's time falloff is a cubic over the layer's normalized age x (0..1), stored as four
 *   coefficients: flash and blur -0.32 x^3 + 1.64 x^2 - 2.32 x + 1, grid -0.5217 x^3 + 2.0435 x^2
 *   - 2.5217 x + 1 (both 1 at the start, 0 at the end).
 *
 * INFERRED (stated here, not in the data):
 * - The instant response is the shield's depletion, so the flash starts when our shield bar's
 *   `broken` state begins (the owner's frame of a break shows it).
 * - A layer at strength s multiplies the scene by lerp(white, team color, s); the two filtering
 *   layers multiply together.
 * - The exposure boost is in stops: the scene is brightened by 2^(2 s).
 * - The grid's shader and the radial blur are not drawn (the material is not decoded; the blur is
 *   0.2 s long and small).
 */

/** One time falloff: the layer's lifetime and its cubic's coefficients (x^3, x^2, x, 1). */
interface Falloff {
  lifetimeMs: number
  cubic: readonly [number, number, number, number]
}

const FLASH: Falloff = { lifetimeMs: 350, cubic: [-0.3200002, 1.64, -2.32, 1] }
const GRID: Falloff = { lifetimeMs: 500, cubic: [-0.5217388, 2.043478, -2.521739, 1] }
/** The flash layer's exposure boost, in stops (inferred unit). */
export const SHIELD_FLOOD_EXPOSURE_BOOST = 2
/** The flood's whole duration: the longest layer. */
export const SHIELD_FLOOD_MS = GRID.lifetimeMs

/** falloffAt: a layer's strength (0..1) `ageMs` after it started; 0 outside its lifetime. */
function falloffAt(layer: Falloff, ageMs: number): number {
  if (ageMs < 0 || ageMs >= layer.lifetimeMs) return 0
  const x = ageMs / layer.lifetimeMs
  const [a, b, c, d] = layer.cubic
  return Math.max(0, Math.min(1, ((a * x + b) * x + c) * x + d))
}

/** The flood at one moment: the two team-color filter strengths and the exposure multiplier. */
export interface ShieldFloodFrame {
  flash: number
  grid: number
  /** The brightness multiplier, 2^(boost x flash). */
  exposure: number
}

/** shieldFloodAt: the flood `ageMs` after the shield broke, or null when it is over. */
export function shieldFloodAt(ageMs: number): ShieldFloodFrame | null {
  const flash = falloffAt(FLASH, ageMs)
  const grid = falloffAt(GRID, ageMs)
  if (flash <= 0 && grid <= 0) return null
  return { flash, grid, exposure: 2 ** (SHIELD_FLOOD_EXPOSURE_BOOST * flash) }
}

/** hexRgb: a #rgb or #rrggbb color to [r, g, b] (0..255); white when it does not parse. */
export function hexRgb(hex: string): [number, number, number] {
  const h = hex.trim().replace(/^#/, '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  if (!/^[0-9a-f]{6}$/i.test(full)) return [255, 255, 255]
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
}

/**
 * shieldFloodTint: the color the scene is multiplied by, for a team color `rgb` (0..255): each
 * filtering layer is lerp(white, team, strength), and the layers multiply.
 */
export function shieldFloodTint(frame: ShieldFloodFrame, [r, g, b]: readonly [number, number, number]): [number, number, number] {
  const ch = (c: number) => {
    const t = c / 255
    return Math.round(255 * (1 + (t - 1) * frame.flash) * (1 + (t - 1) * frame.grid))
  }
  return [ch(r), ch(g), ch(b)]
}
