// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * heroLights3d.ts — THE PURE PART of a camera script's hero lights (docs/design/camera-scripts.md,
 * "lights"): the `lights` field's types and validation, its defaults, and where each light of a
 * rig sits relative to the camera and the player. No scene, no three.js objects.
 *
 * A hero light is cinematography, not a game effect: an opt-in key / fill / rim set that follows
 * one player's body center while the script plays and lights only Spartans and their weapons
 * (`heroLightShader3d`), never the map. Each light is directional inside a short reach around the
 * player (`HERO_REACH_INNER` to `HERO_REACH_OUTER`), so a rig lights its player, their weapon, and
 * at most whoever stands right against them.
 *
 * Directions are in THREE coordinates (y up), from the player toward the light, and relative to
 * the camera's view of the player: azimuth 0 is the camera's own side, positive azimuth turns the
 * key toward the camera's right (screen right), elevation lifts it above the horizontal.
 */

export type Vec3 = [number, number, number]

/** One rig of a camera script's `lights`, as parsed (absent fields take `HERO_DEFAULTS`). */
export interface HeroLight {
  xuid: string
  /** Key light intensity, 0 to 10, in three.js directional-light units (the view's full sun is 3.2). */
  key?: number
  /** Fill light intensity, same unit. */
  fill?: number
  /** Rim light intensity, same unit. */
  rim?: number
  /** Key azimuth in degrees around the player, from the camera's side; positive toward screen right. */
  azimuth?: number
  /** Key elevation in degrees above the horizontal. */
  elevation?: number
  /** The rim's color: the player's team color, or white. */
  rimColor?: 'team' | 'white'
}

/** A rig with every field resolved. */
export type ResolvedHeroLight = Required<HeroLight>

export const HERO_LIGHTS_MAX = 8
export const HERO_INTENSITY_MAX = 10
export const HERO_AZIMUTH_MAX = 180
export const HERO_ELEVATION_MAX = 90

/** The defaults of an entry's optional fields. */
export const HERO_DEFAULTS: Omit<ResolvedHeroLight, 'xuid'> = {
  key: 2.5,
  fill: 0.8,
  rim: 3,
  azimuth: 40,
  elevation: 25,
  rimColor: 'white',
}

/**
 * The reach of a rig around its player's body center (world units, 1 u is about 3 m): full light
 * within `HERO_REACH_INNER`, none past `HERO_REACH_OUTER` (a Spartan stands about 0.7 u tall).
 */
export const HERO_REACH_INNER = 0.6
export const HERO_REACH_OUTER = 0.9

/** The notional distance of a rig's lights from the player (world units), for `heroRigOf`'s positions. */
export const HERO_LIGHT_DISTANCE = 2

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * parseHeroLights validates a raw `lights` array: at most `HERO_LIGHTS_MAX` entries, each with a
 * non-empty `xuid` (no two entries on the same player), intensities 0 to `HERO_INTENSITY_MAX`,
 * `azimuth` in [-180, 180], `elevation` in [-90, 90], `rimColor` 'team' or 'white'. Returns a
 * clean copy with only the known fields, or a short English reason naming the entry.
 */
export function parseHeroLights(raw: unknown): { lights: HeroLight[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'lights must be an array' }
  if (raw.length > HERO_LIGHTS_MAX) return { error: `lights has ${raw.length} entries; at most ${HERO_LIGHTS_MAX}` }
  const lights: HeroLight[] = []
  for (let i = 0; i < raw.length; i++) {
    const e = raw[i]
    if (typeof e !== 'object' || e === null) return { error: `lights[${i}] is not an object` }
    const r = e as Record<string, unknown>
    if (typeof r.xuid !== 'string' || r.xuid.length === 0) return { error: `lights[${i}].xuid must be a non-empty string` }
    const twin = lights.findIndex((l) => l.xuid === r.xuid)
    if (twin >= 0) return { error: `lights[${i}].xuid repeats lights[${twin}]: one rig per player` }
    const out: HeroLight = { xuid: r.xuid }
    for (const field of ['key', 'fill', 'rim'] as const) {
      const v = r[field]
      if (v === undefined) continue
      if (!isFiniteNumber(v) || v < 0 || v > HERO_INTENSITY_MAX) {
        return { error: `lights[${i}].${field} must be a finite number in [0, ${HERO_INTENSITY_MAX}]` }
      }
      out[field] = v
    }
    if (r.azimuth !== undefined) {
      if (!isFiniteNumber(r.azimuth) || Math.abs(r.azimuth) > HERO_AZIMUTH_MAX) {
        return { error: `lights[${i}].azimuth must be a finite number in [-${HERO_AZIMUTH_MAX}, ${HERO_AZIMUTH_MAX}]` }
      }
      out.azimuth = r.azimuth
    }
    if (r.elevation !== undefined) {
      if (!isFiniteNumber(r.elevation) || Math.abs(r.elevation) > HERO_ELEVATION_MAX) {
        return { error: `lights[${i}].elevation must be a finite number in [-${HERO_ELEVATION_MAX}, ${HERO_ELEVATION_MAX}]` }
      }
      out.elevation = r.elevation
    }
    if (r.rimColor !== undefined) {
      if (r.rimColor !== 'team' && r.rimColor !== 'white') return { error: `lights[${i}].rimColor must be 'team' or 'white'` }
      out.rimColor = r.rimColor
    }
    lights.push(out)
  }
  return { lights }
}

/** resolveHeroLight: the entry with its absent fields at `HERO_DEFAULTS`. */
export function resolveHeroLight(l: HeroLight): ResolvedHeroLight {
  return { ...HERO_DEFAULTS, ...l }
}

/** A rig placed for one frame: unit directions from the player toward each light, and each light's notional position. */
export interface HeroRig {
  key: Vec3
  fill: Vec3
  rim: Vec3
  keyAt: Vec3
  fillAt: Vec3
  rimAt: Vec3
}

/** direction: the unit vector at `azimuthDeg` from `toward` (horizontal, unit) toward `right`, lifted by `elevationDeg`. */
function direction(toward: Vec3, right: Vec3, azimuthDeg: number, elevationDeg: number): Vec3 {
  const az = (azimuthDeg * Math.PI) / 180
  const el = (elevationDeg * Math.PI) / 180
  const c = Math.cos(el)
  return [
    c * (Math.cos(az) * toward[0] + Math.sin(az) * right[0]),
    Math.sin(el),
    c * (Math.cos(az) * toward[2] + Math.sin(az) * right[2]),
  ]
}

/**
 * heroRigOf places a rig for a player whose body center is `center`, seen by a camera at `camera`
 * (both THREE coordinates). The camera's side is the horizontal direction from the player to the
 * camera (a camera straight above falls back to +z); screen right is that side turned a quarter
 * turn clockwise seen from above. Key: `azimuth` from the camera's side toward screen right,
 * lifted by `elevation`. Fill: the key mirrored across the camera axis (`-azimuth`), at half the
 * elevation. Rim: behind the player, straight opposite the camera, lifted by `elevation`.
 */
export function heroRigOf(center: Vec3, camera: Vec3, azimuthDeg: number, elevationDeg: number): HeroRig {
  let tx = camera[0] - center[0]
  let tz = camera[2] - center[2]
  const len = Math.hypot(tx, tz)
  if (len < 1e-6) { tx = 0; tz = 1 } else { tx /= len; tz /= len }
  const toward: Vec3 = [tx, 0, tz]
  // Screen right = forward x up, with forward = -toward and up = +y: (tz, 0, -tx).
  const right: Vec3 = [tz, 0, -tx]
  const key = direction(toward, right, azimuthDeg, elevationDeg)
  const fill = direction(toward, right, -azimuthDeg, elevationDeg / 2)
  const rim = direction(toward, right, 180, elevationDeg)
  const at = (d: Vec3): Vec3 => [center[0] + d[0] * HERO_LIGHT_DISTANCE, center[1] + d[1] * HERO_LIGHT_DISTANCE, center[2] + d[2] * HERO_LIGHT_DISTANCE]
  return { key, fill, rim, keyAt: at(key), fillAt: at(fill), rimAt: at(rim) }
}

/** heroRimTint: a team color brought to a brightest channel of 1 (black or invalid gives white), so `rim` keeps its unit. */
export function heroRimTint(color: Vec3): Vec3 {
  const peak = Math.max(color[0], color[1], color[2])
  if (!(peak > 0) || !Number.isFinite(peak)) return [1, 1, 1]
  return [color[0] / peak, color[1] / peak, color[2] / peak]
}
