// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * aids3d.ts — THE 3D VIEW'S ANALYSIS AIDS: what the view can draw that the game does not show.
 * All off by default: the view looks like the game, the drawer turns them on.
 *
 * Types only: the drawer and its preferences read them without pulling three.js into the
 * page's bundle.
 */

export interface Aids3d {
  /** A shot's entire flight, from muzzle to wall, and the killer's line to his victim. */
  shotLines: boolean
  /** Death crosses on the ground and their "killer > victim · weapon" label in the scene. */
  deathMarkers: boolean
  /** The path traveled by grenades and shot projectiles. */
  projectilePaths: boolean
  /** An explosion's damage-radius sphere, one second after the blast. */
  blastRadius: boolean
  /** The grapple cable as a thick, light line, and its anchor point. */
  grappleLines: boolean
  /** The repulsor's push arrow, in its owner's color. */
  knockbackArrows: boolean
  /**
   * The shapes of off-wall poses, occluding screen, sensor and repair field (which the game
   * shows, and which stay on): tracker, translocator rifts, dropped objects.
   */
  placementShapes: boolean
  /** Every player's label at any distance; off, only in range (`nameTags3d`). */
  allNameTags: boolean
}

/** The drawer's order: shots and deaths, projectiles, equipment, players. */
export const AIDS3D_ORDER: readonly (keyof Aids3d)[] = [
  'shotLines',
  'deathMarkers',
  'projectilePaths',
  'blastRadius',
  'grappleLines',
  'knockbackArrows',
  'placementShapes',
  'allNameTags',
]

export const AIDS3D_DEFAULT: Aids3d = {
  shotLines: false,
  deathMarkers: false,
  projectilePaths: false,
  blastRadius: false,
  grappleLines: false,
  knockbackArrows: false,
  placementShapes: false,
  allNameTags: false,
}
