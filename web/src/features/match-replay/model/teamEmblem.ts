// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * teamEmblem.ts — the team emblems at the outer ends of the score bars.
 *
 * WHAT THE GAME DRAWS: the score bar item (cusc 21a7dab4) binds `prop_sprite_frame` to the
 * team's `teamindex` and draws the emblem untinted (tint blend alpha 0) at opacity 0.7,
 * 62x62 units beside a meter about 40 units tall. The emblem is therefore about 1.55 x the
 * bar's height, and its near edge sits about 0.27 x the bar's height beyond the bar's end.
 *
 * THE SET: the HUD set ships `TeamEmblem0.png` .. `TeamEmblem8.png` (64x64, a white glyph on
 * transparent alpha) in the same folder as `ShieldQuad.png`. INFERRED: `N` is the score
 * reading's `teamId` — the eagle (0) and the cobra (1) match team ids 0 and 1 — and the
 * emblems sit at the OUTER ends of the two bars (left bar's left end, right bar's right end),
 * as the game shows the eagle at the far left and the cobra at the far right.
 */

/** The emblem's height in multiples of the bar's height (the game's 62 units over about 40). */
export const TEAM_EMBLEM_HEIGHT_SHARE = 1.55
/** The gap between the emblem's near edge and the bar's outer end, in multiples of the bar's height. */
export const TEAM_EMBLEM_GAP_SHARE = 0.27

/**
 * teamEmblemUrl — the game's team emblem of `teamId` (`TeamEmblem<N>.png`, served by the app
 * from the HUD set), or `null` when the id has no emblem (not an integer in 0..8).
 */
export function teamEmblemUrl(teamId: number | null | undefined): string | null {
  if (teamId == null || !Number.isInteger(teamId) || teamId < 0 || teamId > 8) return null
  return `/static/weapons-assets/halo_infinite/hud/TeamEmblem${teamId}.png`
}
