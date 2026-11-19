// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * scoreBarBand.ts — the look of a score bar's body: a dim team color over its whole length with a
 * brighter band through its middle, as the game's score bar item screen (`cusc 21a7dab4`) draws it
 * from bitmap 8bec9da9 (256x64, pixels inline; probe output gitignored under data/probe/emblems).
 *
 * MEASURED in the bitmap: its alpha is 0 outside rows 12 to 51 (the bar's body), 217 in the body
 * and 255 in rows 27 to 36, with hard edges and the same profile in every column. So the band
 * spans 15/40 to 25/40 of the body's height.
 *
 * MEASURED on the owner's two reference frames (the screen's tint, overlay and blend modes are not
 * decoded far enough to derive them): the body reads about 0.3 x the team color and the band about
 * 0.58 x, over light and dark backgrounds alike (the bar is opaque). The body share stays the
 * 0.28 the bar already used.
 */

/** The body's color: this share of the team color, the rest black. */
export const SCORE_BAR_BODY_SHARE = 0.28
/** The band's color: this share of the team color, the rest black. */
export const SCORE_BAR_BAND_SHARE = 0.58
/** The band's top and bottom, as shares of the bar's height from its top (bitmap rows 27..36 of 12..51). */
export const SCORE_BAR_BAND_TOP = 15 / 40
export const SCORE_BAR_BAND_BOTTOM = 25 / 40
