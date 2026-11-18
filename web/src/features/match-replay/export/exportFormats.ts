// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * exportFormats.ts — THE VIDEO EXPORT'S OUTPUT FORMATS, and the geometry that follows from them.
 *
 * # WHY A CLOSED CATALOG (plan "standard video formats", 2026-09-16, D2)
 *
 * The export used to encode the canvas AS DISPLAYED: the window's width, the height the
 * screen offers, all multiplied by the pixel density. Two exports of the same match therefore
 * came out with different dimensions AND different proportions depending on the machine —
 * unusable for editing or sharing. The file now depends on only one choice: 1920x1080
 * (default) or 1280x720, both 16:9.
 *
 * # THE LAYOUT IS THE SAME FOR BOTH FORMATS
 *
 * The map and the overlays are laid out in a LOGICAL frame of 960x540 CSS px
 * (`EXPORT_LAYOUT`), and that frame is then rendered at the density that gives the requested
 * format: x2 for 1080p, x4/3 for 720p. Intended consequence: a 720p clip shows EXACTLY the same
 * composition as a 1080p clip — same framing, same relative sizes of text and pawns.
 *
 * 540 tall is not arbitrary: it is the middle of the canvas's on-screen height range
 * (360 to 720, cf. `useReplayView`), so labels and pawns drawn in CSS px keep at export the
 * weight they have on screen. And at x2, it is the net measured render of 2026-08-28 (H.264's
 * chroma subsampling: the doubled canvas loses nothing) — the measurement had been done at
 * 480 x2, the target is now 540 x2.
 *
 * # WHY 720p IS RENDERED DIRECTLY, WITHOUT A DOWNSCALED 1080p RENDER
 *
 * Decision written by reasoning, NOT MEASURED in a browser (to verify at the visual gate).
 *
 * The sharpness loss measured on 2026-08-28 comes from 4:2:0 chroma subsampling: the encoder
 * keeps one color sample per 2x2 pixels of the image IT ENCODES. This loss is therefore a
 * property of the OUTPUT grid (1280x720), not of the path by which it was filled.
 * Rendering at 1920x1080 then downscaling adds no color pixel to the file: the downscale
 * averages the fine details BEFORE the encoder (an added luminance blur), and the encoder then
 * subsamples the same grid regardless. The direct render at x4/3, instead, rasterizes lines and
 * text at their final size with the canvas's analytic antialiasing — the equivalent of an
 * area-average downscale, without the resampling blur and with font hinting at the right size.
 *
 * It also avoids two costs with no benefit: a full frame-by-frame copy into an offscreen
 * canvas, and relying on `VideoEncoder`'s IMPLICIT rescaling (a frame larger than the
 * configuration), which the WebCodecs spec does not guarantee across browsers. What stays lost
 * at 720p — the half color pixel on a one-CSS-px line rendered at 1.33 px — is the price of the
 * chosen format, and that is why 1080p is the default.
 */

/** The PERSISTED identifiers (cf. `replayPreferences.ts`): never rename them. */
export type ExportFormatId = '1080p' | '720p'

export interface ExportFormat {
  id: ExportFormatId
  /** FILE dimensions, in pixels. Even, exact 16:9. */
  width: number
  height: number
}

/** The catalog, in the order the dialog offers it. */
export const EXPORT_FORMATS: readonly ExportFormat[] = [
  { id: '1080p', width: 1920, height: 1080 },
  { id: '720p', width: 1280, height: 720 },
]

export const EXPORT_FORMAT_IDS: readonly ExportFormatId[] = EXPORT_FORMATS.map((f) => f.id)

/** An export's format when nothing is chosen, or when the stored choice is invalid (D4). */
export const DEFAULT_EXPORT_FORMAT_ID: ExportFormatId = '1080p'

/** The export's LOGICAL layout frame, in CSS px (cf. the header). */
export const EXPORT_LAYOUT = { width: 960, height: 540 } as const

/**
 * THE CLIP'S FRAMING (decision D6, 2026-09-16), when the map is zoomed on screen:
 * - `whole` (default): the whole map, rendered at 1x — the user's zoom is NOT changed, it is
 *   simply ignored for the duration of the export;
 * - `current`: the screen's zoom level and center, widened to the 16:9 frame.
 * Contextual, so NEVER remembered: a zoom is a moment's gesture, not a habit.
 */
export type ExportFraming = 'whole' | 'current'

/** An export's framing when nothing is chosen. */
export const DEFAULT_EXPORT_FRAMING: ExportFraming = 'whole'

/**
 * An export's geometry: the logical frame the map lays out in, the density it is rendered at
 * (`width * pixelRatio` and `height * pixelRatio` give the format), and the map's framing
 * inside that frame.
 */
export interface ExportLayout {
  format: ExportFormat
  width: number
  height: number
  pixelRatio: number
  framing: ExportFraming
}

/** exportFormatOf — the format of an identifier; unknown, absent or invalid -> the default. */
export function exportFormatOf(id: string | null | undefined): ExportFormat {
  return (
    EXPORT_FORMATS.find((f) => f.id === id) ??
    (EXPORT_FORMATS.find((f) => f.id === DEFAULT_EXPORT_FORMAT_ID) as ExportFormat)
  )
}

/**
 * exportLayoutFor — the logical frame and the density of a format.
 *
 * INDEPENDENT OF `devicePixelRatio` BY CONSTRUCTION: it reads nothing from the screen. That is
 * what makes two different machines output the same file.
 */
export function exportLayoutFor(
  format: ExportFormat,
  framing: ExportFraming = DEFAULT_EXPORT_FRAMING,
): ExportLayout {
  return {
    format,
    framing,
    width: EXPORT_LAYOUT.width,
    height: EXPORT_LAYOUT.height,
    pixelRatio: format.height / EXPORT_LAYOUT.height,
  }
}
