// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * hudFonts.ts — the game's own HUD typefaces, from the player's install.
 *
 * The HUD build writes them next to the HUD icons (`internal/weaponicons/hudfonts.go`): the
 * game's `font` tags hold whole TrueType files. Normative Pro is the HUD's default face (the
 * kill feed and the medal feed screens name no font; inferred default, see
 * docs/design/hud-parity.md "Fonts"); the center scoreboard names Industry (weights 600 and
 * 400, confirmed from its screen). Each family falls back to the app's display face, so a set
 * built before the fonts were added still draws text.
 */

const HUD_FONT_ROOT = '/static/weapons-assets/halo_infinite/hud/'

/** The HUD's default text: kill feed, medals, weapon corner, place name. */
export const HUD_FONT_FAMILY = "'Normative Pro', Bahnschrift, 'Segoe UI', system-ui, sans-serif"
/** The score and clock of the bottom-center scoreboard. */
export const HUD_SCORE_FONT_FAMILY = "Industry, Bahnschrift, 'Segoe UI', system-ui, sans-serif"

/** The faces the build writes, as (family, file, weight, style). */
export const HUD_FONT_FACES: readonly { family: string; file: string; weight: string; style: 'normal' | 'italic' }[] = [
  { family: 'Normative Pro', file: 'NormativePro-Regular.ttf', weight: '400', style: 'normal' },
  { family: 'Normative Pro', file: 'NormativePro-Italic.ttf', weight: '400', style: 'italic' },
  { family: 'Normative Pro', file: 'NormativePro-Medium.ttf', weight: '500', style: 'normal' },
  { family: 'Normative Pro', file: 'NormativePro-MediumItalic.ttf', weight: '500', style: 'italic' },
  // 600 and 700 both map to Bold: the build carries no SemiBold face.
  { family: 'Normative Pro', file: 'NormativePro-Bold.ttf', weight: '600 700', style: 'normal' },
  { family: 'Normative Pro', file: 'NormativePro-BoldItalic.ttf', weight: '600 700', style: 'italic' },
  { family: 'Industry', file: 'Industry-Book.ttf', weight: '400', style: 'normal' },
  { family: 'Industry', file: 'Industry-Medium.ttf', weight: '500', style: 'normal' },
  { family: 'Industry', file: 'Industry-Demi.ttf', weight: '600', style: 'normal' },
  { family: 'Industry', file: 'Industry-Bold.ttf', weight: '700', style: 'normal' },
]

let loading: Promise<void> | null = null

/**
 * ensureHudFonts registers the faces with the document once and resolves when every one has
 * loaded or failed (a missing file leaves its fallback in place, never an error). Where the
 * FontFace API is absent (tests), it resolves at once.
 */
export function ensureHudFonts(): Promise<void> {
  if (loading) return loading
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined
  if (typeof FontFace === 'undefined' || !fonts) {
    loading = Promise.resolve()
    return loading
  }
  loading = Promise.all(HUD_FONT_FACES.map(async (face) => {
    const font = new FontFace(face.family, `url(${HUD_FONT_ROOT}${face.file}) format('truetype')`, { weight: face.weight, style: face.style })
    fonts.add(font)
    try {
      await font.load()
    } catch {
      // The set may predate the fonts: the family's fallback draws instead.
    }
  })).then(() => undefined)
  return loading
}
