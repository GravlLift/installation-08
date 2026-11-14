/**
 * themeInk.ts — READING A THEME VARIABLE for the replay canvas, and THE EXPORT THAT IS ALWAYS
 * PAINTED IN THE DARK THEME (decision D9 of the "video formats" plan, 2026-09-16).
 *
 * # THE NEED
 *
 * An exported clip must have the SAME look whatever the preference of whoever exports it: the
 * dark theme, the one for which the map and its inks were drawn. But flipping `data-theme`
 * on the page for the duration of the export would make the whole interface flicker.
 *
 * # WHY NOT SIMPLY READ AN ELEMENT CARRYING `data-theme="dark"`
 *
 * The theme variables are declared on `:root[data-theme='dark']` / `:root[data-theme='light']`
 * (cf. `styles/globals.css`): those selectors target ONLY the root. A lone element carrying
 * the attribute does not receive them — it inherits the values of the ACTIVE theme. We would
 * have to duplicate the whole dark block under another selector, that is, keep two definitions
 * of the theme.
 *
 * # WHAT IS DONE
 *
 * During an export (`isExportActive`), the value is read IN THE RULES of the stylesheet, with
 * the cascade the browser would apply in dark theme: the root's inline style (accessibility
 * palettes, `applyPalette`) wins, then `:root[data-theme=dark]`, then `:root`. A `var(--x)`
 * reference resolves the same way. The table is built once per export (key: the requested
 * layout), not at every read.
 *
 * Outside an export, nothing changes: `getComputedStyle` on the root, as before.
 */
import { exportLayoutRequested, isExportActive } from '../export/exportLayoutStore'

/** The theme in which the export is painted, whatever the page's is. */
export const EXPORT_THEME = 'dark'

interface ThemeTable {
  root: Map<string, string>
  themed: Map<string, string>
}

let cacheKey: object | null = null
let cache: ThemeTable | null = null

/** The selectors of a rule, normalized: without quotes or spaces. */
function selectorsOf(rule: CSSStyleRule): string[] {
  return rule.selectorText.split(',').map((s) => s.replace(/["'\s]/g, ''))
}

/** An `@media` rule whose condition does not hold would apply nothing: we do not read it. */
function mediaMatches(rule: CSSRule): boolean {
  const media = (rule as CSSMediaRule).media
  if (!media || typeof window.matchMedia !== 'function') return true
  return window.matchMedia(media.mediaText).matches
}

function collect(rules: CSSRuleList, table: ThemeTable): void {
  for (const rule of Array.from(rules)) {
    // THE STYLE RULES FIRST: a nested rule ALSO carries `cssRules`.
    if (!('selectorText' in rule)) {
      if ('cssRules' in rule && mediaMatches(rule)) collect((rule as CSSGroupingRule).cssRules, table)
      continue
    }
    const style = rule as CSSStyleRule
    const sels = selectorsOf(style)
    const target = sels.includes(`:root[data-theme=${EXPORT_THEME}]`)
      ? table.themed
      : sels.includes(':root')
        ? table.root
        : null
    if (!target) continue
    for (const name of Array.from(style.style)) {
      if (name.startsWith('--')) target.set(name, style.style.getPropertyValue(name).trim())
    }
  }
}

function themeTable(): ThemeTable {
  const key = exportLayoutRequested()
  if (cache && cacheKey === key) return cache
  const table: ThemeTable = { root: new Map(), themed: new Map() }
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      collect(sheet.cssRules, table)
    } catch {
      // Sheet from another origin: its rules are not readable, and the repository's theme does
      // not live there. Skip it.
    }
  }
  cacheKey = key
  cache = table
  return table
}

/** The value of a variable in the export theme, `var()` resolved; `''` if absent. */
function exportThemeValue(name: string, depth = 0): string {
  const inline = document.documentElement.style.getPropertyValue(name).trim()
  const t = themeTable()
  const raw = inline || t.themed.get(name) || t.root.get(name) || ''
  if (depth > 8) return raw
  return raw.replace(/var\((--[\w-]+)(?:\s*,\s*([^)]*))?\)/g, (_m, ref: string, fallback?: string) => {
    return exportThemeValue(ref, depth + 1) || (fallback ?? '').trim()
  })
}

/**
 * readThemeVar — the value of a theme variable for the canvas: the DARK theme's during an
 * export, the active theme's otherwise. Empty string on the server side or if the variable
 * is missing.
 */
export function readThemeVar(name: string): string {
  if (typeof document === 'undefined') return ''
  if (isExportActive()) return exportThemeValue(name)
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
