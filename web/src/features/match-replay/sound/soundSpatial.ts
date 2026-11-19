// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * soundSpatial.ts — THE PLACE OF A SOUND IN SPACE: its level and its side for the one listening.
 *
 * Map coordinates, z upward: the side is read in the horizontal plane, the distance of a sound
 * that carries the game's falloff in 3D (when both ends have a height). The heading follows the
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

/** Where the sound comes from, in the map; `z` when the source has a height. */
export interface SoundSource {
  x: number
  y: number
  z?: number
}

/**
 * THE GAME'S DISTANCE FALLOFF of a sound: the dry volume curve of the Wwise attenuation its node
 * chain names, as the extraction writes it (`soundtags.Falloff`). Each point is (distance, value,
 * shape of the segment to the next point); the value is linear amplitude minus one (0 is 0 dB,
 * -1 silence: CONFIRMED, the stored values land on round dB figures that way). Beyond the last
 * point the curve holds its last value, silence on every curve the game ships for these sounds.
 */
export type SoundFalloff = ReadonlyArray<readonly [number, number, number]>

/**
 * Game distance units per world unit. INFERRED, not measured: the replay is in Halo world units
 * (1 u = 3.048 m) and the engine is taken to hand Wwise its positions unconverted. What argues
 * for it: the far layer of a sniper shot reaches 90 units (274 m in world units, a big team
 * map; 90 m would cut it off mid-map), and a foot step's 12-unit reach stays inside a room's
 * width in meters. Changing this one constant rescales every falloff.
 */
export const FALLOFF_UNITS_PER_WORLD_UNIT = 1

/**
 * The level under which a voice is not played: -80 dB, Wwise's default volume threshold (below
 * it a voice goes virtual). INFERRED as the game's: its project setting is not read.
 */
export const INAUDIBLE_LEVEL = 1e-4

/**
 * shapeOf — the eased position along a curve segment, for Wwise's curve shapes
 * (AkCurveInterpolation). Linear and constant are exact; the curved shapes are the usual forms
 * of their names, INFERRED (the game's segments are mostly linear, constant and sine).
 */
function shapeOf(interp: number, t: number): number {
  switch (interp) {
    case 0: return 1 - (1 - t) ** 3 // log3
    case 1: return Math.sin((t * Math.PI) / 2) // sine
    case 2: return 1 - (1 - t) ** 2 // log1
    case 3: return 0.5 + Math.asin(2 * t - 1) / Math.PI // inverted S-curve
    case 5: return (1 - Math.cos(Math.PI * t)) / 2 // S-curve
    case 6: return t * t // exp1
    case 7: return 1 - Math.cos((t * Math.PI) / 2) // reciprocal sine
    case 8: return t ** 3 // exp3
    case 9: return 0 // constant: the segment holds its first value
    default: return t // 4, linear
  }
}

/** falloffGain — the linear gain of a falloff at a distance in world units. */
export function falloffGain(curve: SoundFalloff, distance: number): number {
  if (curve.length === 0) return 1
  const d = distance * FALLOFF_UNITS_PER_WORLD_UNIT
  let v: number
  if (d <= curve[0][0]) {
    v = curve[0][1]
  } else if (d >= curve[curve.length - 1][0]) {
    v = curve[curve.length - 1][1]
  } else {
    let i = 0
    while (curve[i + 1][0] < d) i++
    const [x0, y0, interp] = curve[i]
    const [x1, y1] = curve[i + 1]
    const t = x1 > x0 ? (d - x0) / (x1 - x0) : 1
    v = y0 + (y1 - y0) * shapeOf(interp, t)
  }
  const gain = Math.min(Math.max(1 + v, 0), 1)
  return gain < INAUDIBLE_LEVEL ? 0 : gain
}

/** The placement of a voice: `gain` in ]0, 1], `pan` in [-1, 1], positive to the RIGHT. */
export interface SoundPlacement {
  gain: number
  pan: number
}

const CENTERED: SoundPlacement = { gain: 1, pan: 0 }

/**
 * spatialOf places a sound for a listener. `own`: the sound is that of the listener itself, it
 * sounds full and centered. Otherwise the level follows the sound's own falloff when it has one
 * (`falloffGain`, over the 3D distance when both ends have a height), and else decays inversely
 * with the horizontal distance beyond SPATIAL_FULL_RADIUS, without a floor. The side is the sine
 * of the horizontal bearing.
 */
export function spatialOf(listener: SoundListener, source: SoundSource, own: boolean, falloff?: SoundFalloff): SoundPlacement {
  if (own) return CENTERED
  const dx = source.x - listener.x
  const dy = source.y - listener.y
  const d = Math.hypot(dx, dy)
  let gain: number
  if (falloff) {
    const dz = source.z !== undefined && listener.z !== undefined ? source.z - listener.z : 0
    gain = falloffGain(falloff, Math.hypot(d, dz))
  } else {
    gain = d <= SPATIAL_FULL_RADIUS ? 1 : SPATIAL_FULL_RADIUS / d
  }
  if (d <= SPATIAL_CENTER_RADIUS) return { gain, pan: 0 }
  const h = (listener.heading * Math.PI) / 180
  const side = (dx * Math.sin(h) - dy * Math.cos(h)) / d
  return { gain, pan: side * SPATIAL_PAN_WIDTH }
}

/**
 * placeOf — the placement of a sound event for a listener. `undefined` without a place, or
 * without a listener for a sound with no falloff: the sound then plays as is, like before.
 * A sound that carries the game's falloff is a positional cue only: without a listener (the 2D
 * view) it is silent, never full and centered. Otherwise the sound is OTHERS: never the sound of
 * the listener itself, which would stay full and centered.
 */
export function placeOf(
  listener: SoundListener | null,
  event: Pick<ReplaySoundEvent, 'at' | 'falloff'>,
): SoundPlacement | undefined {
  if (!event.at) return undefined
  if (!listener) return event.falloff ? SILENT : undefined
  return spatialOf(listener, event.at, false, event.falloff)
}

const SILENT: SoundPlacement = { gain: 0, pan: 0 }
