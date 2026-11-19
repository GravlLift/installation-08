// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * hold3d.ts — THE PURE PART of holds (docs/design/hold.md, unit H1).
 *
 * A hold takes one player out of the film at script time `at`: from then on they stay where
 * they stood and play a chosen clip (emote or stance) for the camera, while the rest of the
 * scene follows the script's clock. Everything here is a pure function of script ms; nothing
 * accumulates from one frame to the next. Times are SCRIPT ms.
 */

export interface Hold {
  /** The player, by xuid. Must be a player of the match (checked by the scene, not here). */
  xuid: string
  /** Script ms at which the player leaves the film. */
  at: number
  /** A clip name the scene can resolve. */
  clip: string
  /** Loop the clip; false holds its last frame. */
  loop: boolean
  /** Crossfade from the film's animation to the clip, in ms. */
  blendMs: number
  /** The heading to turn to (game degrees); null keeps the heading at `at`. */
  heading: number | null
  /** How long the turn takes, in ms. */
  turnMs: number
  /** The pitch to ease to, in degrees; the film's pitch is the start. */
  pitch: number
  /** The weapon held at `at` stays in hand ('keep') or is removed ('hide'). */
  weapon: 'keep' | 'hide'
  /** Script ms at which the player rejoins the film (reverse blend of `blendMs`); null: stays held. */
  until: number | null
}

export const HOLD_MAX = 16
export const HOLD_CLIP_MAX_CHARS = 200
export const HOLD_BLEND_DEFAULT_MS = 250
export const HOLD_BLEND_MAX_MS = 2000
export const HOLD_TURN_DEFAULT_MS = 400
export const HOLD_TURN_MAX_MS = 5000

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * Validates a raw `holds` array (version 1) and returns a clean copy with only the known
 * fields, sorted by `at`, or a short English error naming the index. Unknown fields are
 * dropped (the same rule as camera keys).
 */
export function parseHolds(raw: unknown): { holds: Hold[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'holds must be an array' }
  if (raw.length > HOLD_MAX) {
    return { error: `holds has ${raw.length} entries; at most ${HOLD_MAX}` }
  }
  const holds: Hold[] = []
  const seen = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const rawH = raw[i]
    if (typeof rawH !== 'object' || rawH === null) return { error: `holds[${i}] is not an object` }
    const h = rawH as Record<string, unknown>
    if (typeof h.xuid !== 'string' || h.xuid.length === 0) {
      return { error: `holds[${i}].xuid must be a non-empty string` }
    }
    if (seen.has(h.xuid)) return { error: `holds[${i}].xuid: at most one hold per player` }
    if (!isFiniteNumber(h.at) || h.at < 0) return { error: `holds[${i}].at must be a finite number >= 0` }
    if (typeof h.clip !== 'string' || h.clip.length === 0 || h.clip.length > HOLD_CLIP_MAX_CHARS) {
      return { error: `holds[${i}].clip must be a non-empty string of at most ${HOLD_CLIP_MAX_CHARS} characters` }
    }
    let loop = false
    if (h.loop !== undefined) {
      if (typeof h.loop !== 'boolean') return { error: `holds[${i}].loop must be a boolean` }
      loop = h.loop
    }
    let blendMs = HOLD_BLEND_DEFAULT_MS
    if (h.blendMs !== undefined) {
      if (!isFiniteNumber(h.blendMs) || h.blendMs < 0 || h.blendMs > HOLD_BLEND_MAX_MS) {
        return { error: `holds[${i}].blendMs must be a finite number in [0, ${HOLD_BLEND_MAX_MS}]` }
      }
      blendMs = h.blendMs
    }
    let heading: number | null = null
    if (h.heading !== undefined && h.heading !== null) {
      if (!isFiniteNumber(h.heading)) return { error: `holds[${i}].heading must be a finite number or null` }
      heading = h.heading
    }
    let turnMs = HOLD_TURN_DEFAULT_MS
    if (h.turnMs !== undefined) {
      if (!isFiniteNumber(h.turnMs) || h.turnMs < 0 || h.turnMs > HOLD_TURN_MAX_MS) {
        return { error: `holds[${i}].turnMs must be a finite number in [0, ${HOLD_TURN_MAX_MS}]` }
      }
      turnMs = h.turnMs
    }
    let pitch = 0
    if (h.pitch !== undefined) {
      if (!isFiniteNumber(h.pitch) || h.pitch < -89 || h.pitch > 89) {
        return { error: `holds[${i}].pitch must be a finite number in [-89, 89]` }
      }
      pitch = h.pitch
    }
    let weapon: Hold['weapon'] = 'keep'
    if (h.weapon !== undefined) {
      if (h.weapon !== 'keep' && h.weapon !== 'hide') return { error: `holds[${i}].weapon must be 'keep' or 'hide'` }
      weapon = h.weapon
    }
    let until: number | null = null
    if (h.until !== undefined && h.until !== null) {
      if (!isFiniteNumber(h.until) || h.until <= h.at) {
        return { error: `holds[${i}].until must be a finite number > at` }
      }
      until = h.until
    }
    holds.push({ xuid: h.xuid, at: h.at, clip: h.clip, loop, blendMs, heading, turnMs, pitch, weapon, until })
    seen.add(h.xuid)
  }
  holds.sort((a, b) => a.at - b.at)
  return { holds }
}

/** The player's heading and pitch in the film at the hold's start (the scene reads them at the document time of `at`). */
export interface HoldStart {
  h: number
  p: number
}

/** The held player's pose at script ms `sMs`, or null before `at` and after a full rejoin blend-out. */
export interface HoldState {
  /** sMs - at: how long the hold has run. */
  sinceMs: number
  /** sinceMs in seconds, the clip's playback time (the sampler loops or clamps by `hold.loop`). */
  clipTimeS: number
  /** The hold's share against the film's own animation, 0 to 1. */
  weight: number
  /** The heading to draw, in [0, 360). */
  heading: number
  /** The pitch to draw, in degrees. */
  pitch: number
}

/** The smoothstep clamped to [0, 1]: 0 at 0, 1/2 at the midpoint, 1 at 1. */
function ease01(u: number): number {
  const x = u < 0 ? 0 : u > 1 ? 1 : u
  return x * x * (3 - 2 * x)
}

/** `a` toward `b` by `u` the SHORT way around (across 359/0), normalized to [0, 360). */
function lerpHeading(a: number, b: number, u: number): number {
  const delta = ((b - a + 540) % 360) - 180
  const v = a + delta * u
  return ((v % 360) + 360) % 360
}

/**
 * The held pose at script ms `sMs`. Null before `at`, and null once a rejoin has fully blended
 * out (`sMs >= until + blendMs`).
 *
 * weight: the hold's share against the film's own animation, smoothstepping 0 to 1 over
 * `blendMs` from `at` (blendMs 0: an instant switch); when `until` is set it eases back from
 * its value at `until` to 0 over `blendMs`, and the scene blends the film's animation back in
 * by the same weight.
 *
 * heading: from `start.h` toward `hold.heading ?? start.h` over `turnMs` with smoothstep, the
 * short way around (across 359/0). After `until` it stays at the hold heading; the film's own
 * heading comes back through `weight` (the scene blends the two by weight).
 *
 * pitch: from `start.p` to `hold.pitch` over `blendMs` with smoothstep; it stays there after
 * `until` the same way.
 */
export function holdStateAt(hold: Hold, sMs: number, start: HoldStart): HoldState | null {
  if (sMs < hold.at) return null
  if (hold.until !== null && sMs >= hold.until + hold.blendMs) return null

  const sinceMs = sMs - hold.at
  const clipTimeS = sinceMs / 1000

  // The weight at a script time `s` in [at, until]: the crossfade in.
  const weightIn = (s: number): number =>
    hold.blendMs === 0 ? 1 : ease01((s - hold.at) / hold.blendMs)

  let weight = weightIn(sMs)
  if (hold.until !== null && sMs >= hold.until) {
    // Ease back from the weight at `until` to 0 over `blendMs`.
    const out = hold.blendMs === 0 ? 1 : ease01((sMs - hold.until) / hold.blendMs)
    weight = weightIn(hold.until) * (1 - out)
  }

  const target = hold.heading ?? start.h
  // After `until` the heading stays at the hold heading; before it, it turns over `turnMs`.
  const u = hold.until !== null && sMs >= hold.until ? 1 : hold.turnMs === 0 ? 1 : ease01(sinceMs / hold.turnMs)
  const heading = lerpHeading(start.h, target, u)

  const pitch =
    start.p + (hold.pitch - start.p) * (hold.blendMs === 0 ? 1 : ease01(sinceMs / hold.blendMs))

  return { sinceMs, clipTimeS, weight, heading, pitch }
}

/** The holds with a non-null state window at `sMs` (a helper for the scene), by xuid. */
export function activeHolds(holds: readonly Hold[], sMs: number): Map<string, Hold> {
  const out = new Map<string, Hold>()
  for (const h of holds) {
    if (sMs >= h.at && (h.until === null || sMs < h.until + h.blendMs)) out.set(h.xuid, h)
  }
  return out
}
