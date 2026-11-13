/**
 * _utils.ts — standalone stand-in for LevelUp's chart-color helpers.
 *
 * Only what `features/match-view/teamSeriesColor.ts` needs: the `EChartsThemeColors`
 * shape (as a minimal structural type — this viewer never builds an ECharts option) and
 * `hexToRgba`, a pure color helper.
 */

export interface EChartsThemeColors {
  axisLabel: string
}

export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return hex
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16))
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
