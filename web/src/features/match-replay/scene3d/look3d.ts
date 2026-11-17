// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * look3d.ts — the 3D view's LIGHTING SETTINGS, as the drawer carries them.
 *
 * Types only: the drawer and its preferences read them without pulling three.js into the page's
 * bundle.
 */

export interface Look3d {
  /** Sun-cast shadows: the map and the players. */
  shadows: boolean
  /** Reflections and light bounced off the map (environment probes). */
  reflections: boolean
  /** Screen-space ambient occlusion: darkening of corners and crevices. */
  ambientOcclusion: boolean
  /** The game's own light: the map's baked irradiance probes and placed lamps. */
  gameLight: boolean
  /** Bloom: self-lit surfaces (lamps, light strips, energy blades) glow past their edges (`bloom3d`). */
  bloom: boolean
  /**
   * Glow animation: the self-lit surfaces move as the game animates them (a sign's scroll and
   * flicker, a neon's pulse, `glowAnimation3d`), on match time. Off, they stay still.
   */
  glowAnimation: boolean
}

export const LOOK3D_DEFAULT: Look3d = { shadows: true, reflections: true, ambientOcclusion: true, gameLight: true, bloom: true, glowAnimation: true }
