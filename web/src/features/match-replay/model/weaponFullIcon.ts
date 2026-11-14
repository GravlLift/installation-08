/**
 * weaponFullIcon.ts — THE FULL VERSION of a weapon icon, for the player cards.
 *
 * WHY THIS MODULE EXISTS. The replay document carries one thumbnail per weapon
 * (`weaponLabels[id].img`, baked into the artifact at build): it is the `contour`
 * atlas — the outline of the weapon, empty. The chosen mockup (option 2a of the 2026-08-27
 * handoff) draws the cards with the FULL version, the one of the game's kill feed: the
 * `silhouette` atlas, extracted from the same binary, indexed IDENTICALLY — `silhouette-XX`
 * is the same weapon as `contour-XX`, same `weap` tags (verified 40/40 by the guard-rail
 * `weaponFullIcon.guard.test.ts` on `jeu/index.json`). The swap is therefore a simple
 * stem substitution in the URL.
 *
 * IT RESOLVES ON THE CLIENT, AND THAT IS DELIBERATE: the URL is BAKED INTO THE ARTIFACT at
 * build time — serving the silhouette from the Go would only reach rebaked artifacts,
 * that is none of the ones already served, until the mass re-build has happened.
 *
 * THE MIRROR. The `contour` and `silhouette` atlases point LEFT; the game's kill feed
 * — and the mockup — point RIGHT. The swapped icon is therefore rendered flipped
 * (`scaleX(-1)`), and ONLY it: an off-atlas thumbnail (the two hand-drawn PNGs, the
 * concepts) keeps its URL and its orientation — flipping a finished drawing has no
 * basis in the game.
 *
 * THE MAP'S PEDESTALS GO THROUGH HERE SINCE 2026-08-28 (user feedback: « pour les armes il
 * faut utiliser les icônes comme pour les fiches de joueurs et le kill feed » [for weapons,
 * the icons used for the player cards and the kill feed must be used]). They kept the
 * `contour` by lot perimeter, and it was the wrong choice at their scale: an empty weapon
 * outline, at 8 px, on a grayscale map background already edged in black, does not stand
 * out. The FULL shape, it, holds. The mirror applies to them too — the same weapon cannot
 * point right on the card and left on the map —, but it is baked in the offscreen canvas
 * (`tintedIconCanvas`) and not set in CSS: a canvas has no `transform`.
 */
import type { CSSProperties } from 'react'

/** The two atlas stems, as `static/weapons-assets/{slug}/jeu/` names them. */
const CONTOUR_SEG = '/jeu/contour-'
const SILHOUETTE_SEG = '/jeu/silhouette-'

/** What the card needs to know: the URL to paint, and whether it is flipped. */
export interface FullWeaponIcon {
  url: string
  /** True = swapped atlas icon, to render mirrored (the orientation of the game's kill feed). */
  mirrored: boolean
}

/** The mirror style — a single writing, shared by the cells that set it. */
export const MIRROR_STYLE: CSSProperties = { transform: 'scaleX(-1)' }

/**
 * weaponFullIcon swaps a `contour` atlas URL for its `silhouette` (full version, to be
 * flipped). Any other URL — finished drawing, concept, other title — is rendered as is,
 * in its orientation.
 */
export function weaponFullIcon(url: string): FullWeaponIcon {
  if (url.includes(CONTOUR_SEG)) {
    return { url: url.replace(CONTOUR_SEG, SILHOUETTE_SEG), mirrored: true }
  }
  return { url, mirrored: false }
}
