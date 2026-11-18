// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** The layers' heights, per Ekur's `layer_blending`, `heightblend` and `heightaccum_l1`. */
export function initialHeight(scale: number, control: number, mask: number): number {
  return Math.max(0, Math.min(4, scale * (control + mask - 1)))
}

type HeightSettings = { scale: number; rank: number; range: number; opacity: number; accumulation: number }
export function heightWeight(h: number, control: number, mask: number, p: HeightSettings): { weight: number; height: number } {
  const next = Math.max(0, Math.min(4, p.scale * (control + mask - 1) + (p.rank - 1) * mask))
  const threshold = Math.min(p.rank - 1, h - 0.5 * p.range)
  const x = Math.max(0, Math.min(1, (next - threshold) / Math.max(p.range, 0.0001)))
  return { weight: (p.opacity < 0 ? 1 - x : x) * p.opacity, height: h + p.accumulation * (Math.max(h, next) - h) }
}
