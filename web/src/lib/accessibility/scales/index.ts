/**
 * scales/index.ts — standalone stand-in for LevelUp's color-scale helpers.
 *
 * Only `shiftLightness` (used by `layers/useReplayInks.ts` to lighten/darken a resolved
 * token color for ink variants) is needed here.
 */
export function shiftLightness(hex: string, deltaPercent: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return hex
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  const d = max - min
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const l2 = Math.min(1, Math.max(0, l + deltaPercent / 100))
  const c = (1 - Math.abs(2 * l2 - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m2 = l2 - c / 2
  let [r2, g2, b2] = [0, 0, 0]
  if (h < 60) [r2, g2, b2] = [c, x, 0]
  else if (h < 120) [r2, g2, b2] = [x, c, 0]
  else if (h < 180) [r2, g2, b2] = [0, c, x]
  else if (h < 240) [r2, g2, b2] = [0, x, c]
  else if (h < 300) [r2, g2, b2] = [x, 0, c]
  else [r2, g2, b2] = [c, 0, x]
  const toHex = (v: number) =>
    Math.round((v + m2) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(r2)}${toHex(g2)}${toHex(b2)}`
}
