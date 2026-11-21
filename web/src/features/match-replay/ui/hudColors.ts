// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * hudColors.ts — THE HUD'S INKS FROM THE GAME. The HUD set serves `hud-colors.json` (Go
 * `weaponicons.HudColors`), read from the game's CUI color tables (`cure` b1241e79, the HUD's,
 * and fa443766, the navpoints'). Once it answers, the HUD's CSS tokens take its values; until
 * then, or with a set that predates it, they keep the values in `index.css`.
 */

const HUD_COLORS_URL = '/static/weapons-assets/halo_infinite/hud/hud-colors.json'

export interface HudColors {
  primary: string
  warning: string
  critical: string
  overshield: string
  power: string
  waypoint: string
}

const HEX = /^#[0-9a-f]{6}$/i

/** parseHudColors: the served colors, null when any is missing or malformed. */
export function parseHudColors(v: unknown): HudColors | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const keys: (keyof HudColors)[] = ['primary', 'warning', 'critical', 'overshield', 'power', 'waypoint']
  if (!keys.every((k) => typeof o[k] === 'string' && HEX.test(o[k] as string))) return null
  return o as unknown as HudColors
}

/** hudTokens: the CSS tokens the game's colors set. */
export function hudTokens(c: HudColors): Record<string, string> {
  return {
    // The HUD's main ink (the weapon corner, the pad navpoints, the HUD text).
    '--replay-hud-weapon': c.primary,
    '--replay-hud-weapon-mag': c.primary,
    '--replay-hud-on-dark': c.primary,
    '--replay-hud-shield-alert': c.critical,
    '--replay-hud-warning': c.warning,
    '--replay-hud-overshield': c.overshield,
    '--replay-hud-power': c.power,
    '--replay-hud-waypoint': c.waypoint,
  }
}

let pending: Promise<void> | null = null

/** ensureHudColors fetches the game's HUD colors once and sets the tokens on the document. */
export function ensureHudColors(): Promise<void> {
  if (pending) return pending
  pending = (async () => {
    try {
      const res = await fetch(HUD_COLORS_URL)
      if (!res.ok) return
      const colors = parseHudColors(await res.json())
      if (!colors) return
      const root = document.documentElement.style
      for (const [k, v] of Object.entries(hudTokens(colors))) root.setProperty(k, v)
    } catch {
      // A set without the colors keeps the stylesheet's values.
    }
  })()
  return pending
}
