// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * nameTags3d.ts — A PLAYER'S NAME TAG according to its distance to the camera.
 *
 * As in the game, a player is only named within range: fully up to `NAME_TAG_FULL_U`, then the
 * tag fades out until it vanishes at `NAME_TAG_RANGE_U` (no jump at the boundary). The followed
 * player keeps theirs at any distance, and the analysis aid `aids3d.allNameTags` shows every
 * tag at any distance.
 *
 * Range chosen for an arena (Recharge's players travel about 35 u out of 37 u): 14 u (~43 m)
 * covers a mid-range exchange without naming the whole map from an overview.
 */
import type * as THREE from 'three'
import type { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'

import { TAG_HEIGHT } from './body3d'

/** Up to this distance from the camera (u), the tag is fully opaque. */
export const NAME_TAG_FULL_U = 10
/** Beyond this distance (u), no more tag. */
export const NAME_TAG_RANGE_U = 14

/**
 * nameTagOpacity — the tag's opacity at `distance` (u) from the camera: 1 within full range,
 * a smooth fade (S-curve) down to 0 at the limit, 0 beyond; 1 everywhere when `always`.
 */
export function nameTagOpacity(distance: number, always: boolean): number {
  if (always || distance <= NAME_TAG_FULL_U) return 1
  if (!(distance < NAME_TAG_RANGE_U)) return 0
  const t = (NAME_TAG_RANGE_U - distance) / (NAME_TAG_RANGE_U - NAME_TAG_FULL_U)
  return t * t * (3 - 2 * t)
}

/**
 * placeTag — places the tag above feet position `feet` and sets its visibility; returns the
 * applied opacity (the export paints it, the screen carries it in the style). `eye`: the
 * camera's position, null when the tag doesn't show (yourself in first person).
 */
export function placeTag(tag: CSS2DObject, feet: THREE.Vector3, eye: THREE.Vector3 | null, always: boolean): number {
  tag.position.set(feet.x, feet.y + TAG_HEIGHT, feet.z)
  // To the hundredth: a tag that would read "0" is hidden, not left transparent.
  const opacity = eye ? Math.round(nameTagOpacity(tag.position.distanceTo(eye), always) * 100) / 100 : 0
  tag.visible = opacity > 0
  // An empty value defers to the pill's style opacity: no write while it doesn't change.
  const css = opacity >= 1 ? '' : String(opacity)
  if (tag.element.style.opacity !== css) tag.element.style.opacity = css
  return opacity
}
