// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * shieldBloom.ts — THE SHIELD BAR'S BLOOM, from the shield screen's own bloom widget (`cusc`
 * 9299c419, component `uibloom`, type `uieffectbloom`; read 2026-11-19 from the gitignored dump).
 *
 * CONFIRMED from the dump: ambient 0.35, highlight 3 above a threshold of 0.3, three blur layers
 * weighted 0.5 (small), 0.35 (medium) and 0.2 (large), global intensity 0.8, which the screen's
 * "shield full" animation takes from 1.5 down to 0.8 over 2633 ms.
 *
 * INFERRED (the tag names the knobs, not the engine's math): what blooms is
 * `ambient * c + highlight * max(0, c - threshold)` per channel, capped at 1; the three layers are
 * Gaussian blurs of that, summed with their weights times the global intensity and added over the
 * bar; the blur sizes (SHIELD_BLOOM_BLUR, in the quad's 940-wide units, close to the game's
 * 2160-row reference pixels at our bar size) are not in the tag; the full-shield fall is linear.
 * The tint (`bloomtintcolor`) points at the named color `hud_wires`, not decoded, so the bloom
 * keeps the bar's own colors. The curve and the sum run in LINEAR light, as an engine blooms (the
 * live SVG filter's `linearRGB`): added in sRGB values the cyan bar went white, in linear its red
 * channel stays low and it stays cyan. The export adds its blurred layers in sRGB (a canvas
 * composites there), so its glow is a little whiter than the live one.
 */
import type { ShieldHudState } from './shieldHud'

export const SHIELD_BLOOM_AMBIENT = 0.35
export const SHIELD_BLOOM_HIGHLIGHT = 3
export const SHIELD_BLOOM_THRESHOLD = 0.3
/** The layer weights, small to large. */
export const SHIELD_BLOOM_LAYERS = [0.5, 0.35, 0.2] as const
/** The layers' blur standard deviations, small to large, in quad units (inferred). */
export const SHIELD_BLOOM_BLUR = [4, 12, 32] as const
export const SHIELD_BLOOM_INTENSITY = 0.8
export const SHIELD_BLOOM_FULL_PEAK = 1.5
export const SHIELD_BLOOM_FULL_MS = 2633

/** shieldBloomSource: how much of a channel value `c` (0..1) blooms. */
export function shieldBloomSource(c: number): number {
  return Math.min(1, SHIELD_BLOOM_AMBIENT * c + SHIELD_BLOOM_HIGHLIGHT * Math.max(0, c - SHIELD_BLOOM_THRESHOLD))
}

/** The source curve sampled at 0, 0.01, ... 1, for an SVG `feFunc*` table. */
export const SHIELD_BLOOM_TABLE = Array.from({ length: 101 }, (_, i) => +shieldBloomSource(i / 100).toFixed(4)).join(' ')

/** shieldBloomIntensity: the global intensity `ageMs` into `state` (the fall after a refill). */
export function shieldBloomIntensity(state: ShieldHudState, ageMs: number): number {
  if (state !== 'full' || ageMs < 0 || ageMs >= SHIELD_BLOOM_FULL_MS) return SHIELD_BLOOM_INTENSITY
  return SHIELD_BLOOM_FULL_PEAK + (SHIELD_BLOOM_INTENSITY - SHIELD_BLOOM_FULL_PEAK) * (ageMs / SHIELD_BLOOM_FULL_MS)
}
