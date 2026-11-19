// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * soundSpatial.ts — THE PLACE OF A SOUND IN SPACE: its level and its side for the one listening.
 *
 * Map coordinates, z upward: only the horizontal plane counts. The heading follows the
 * convention of the document (`h` in degrees, 0 toward +X, 90 toward +Y), the one that
 * `aimDirThree` turns into a camera direction: the right of the listener is therefore (sin h,
 * -cos h).
 *
 * No Web Audio here: pure geometry, testable (soundSpatial.test.ts).
 */
import type { ReplaySoundEvent } from './replaySoundVariants'

/** Distance, in map units, up to which a sound keeps its full level. */
export const SPATIAL_FULL_RADIUS = 3
/**
 * Maximum stereo width: a sound fully to one side keeps about 40% of its level in the other
 * ear, like a head between two ears, never a muted channel.
 */
export const SPATIAL_PAN_WIDTH = 0.5
/** Distance below which a sound has no side. */
export const SPATIAL_CENTER_RADIUS = 0.5

/** Who listens: its position in the map and its heading in degrees. `z` (map height) is set by
 * the 3D camera; a listener without it is on the ground plane only (XY). */
export interface SoundListener {
  x: number
  y: number
  heading: number
  z?: number
}

/** Where the sound comes from, in the map. */
export interface SoundSource {
  x: number
  y: number
}

/** The placement of a voice: `gain` in ]0, 1], `pan` in [-1, 1], positive to the RIGHT. */
export interface SoundPlacement {
  gain: number
  pan: number
}

const CENTERED: SoundPlacement = { gain: 1, pan: 0 }

/**
 * spatialOf places a sound for a listener. `own`: the sound is that of the listener itself, it
 * sounds full and centered. Otherwise the level decays inversely with distance beyond
 * SPATIAL_FULL_RADIUS, without a floor, and the side is the sine of the bearing.
 */
export function spatialOf(listener: SoundListener, source: SoundSource, own: boolean): SoundPlacement {
  if (own) return CENTERED
  const dx = source.x - listener.x
  const dy = source.y - listener.y
  const d = Math.hypot(dx, dy)
  const gain = d <= SPATIAL_FULL_RADIUS ? 1 : SPATIAL_FULL_RADIUS / d
  if (d <= SPATIAL_CENTER_RADIUS) return { gain, pan: 0 }
  const h = (listener.heading * Math.PI) / 180
  const side = (dx * Math.sin(h) - dy * Math.cos(h)) / d
  return { gain, pan: side * SPATIAL_PAN_WIDTH }
}

/**
 * placeOf — the placement of a sound event for a listener. `undefined` without a listener or
 * without a place: the sound then plays as is, like before. Otherwise the sound is OTHERS:
 * never the sound of the listener itself, which would stay full and centered.
 */
export function placeOf(
  listener: SoundListener | null,
  event: Pick<ReplaySoundEvent, 'at'>,
): SoundPlacement | undefined {
  if (!listener || !event.at) return undefined
  return spatialOf(listener, event.at, false)
}
