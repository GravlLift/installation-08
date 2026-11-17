// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * threatSensor.ts — THE THREAT SENSOR: its range, its PING, and what the ping reveals.
 *
 * THE NUMBERS ARE OFFICIAL, AND THEY ARE NOT MEASURED HERE. The film carries NO detection
 * range, no sweep cadence, no reveal duration — neither in the object's creation record nor
 * in its life. This file therefore takes them from the source published by the editor, quoted
 * verbatim (season 4 adjustments):
 *
 *   « Ping Frequency: 2.8 -> 1.8 secondes » · « Sensor Radius: 3.1wu -> 4.25wu »
 *   « Sensor Duration: 6.5 -> 15 secondes » · « Reveal Duration: 2.5 -> 0.75 secondes »
 *   -- Halo Waypoint, « Sandbox Overview Season 4 », article `/fr-fr/news/sandbox-overview-season-4`
 *
 * (The domain is not written here, and that is no oversight: the guard-rail I19
 * `waypointUrl.guard.test.ts` reserves this literal for `waypointUrl.ts`. The article path
 * is enough to find the source — do not paste the full URL back, the rest would break.)
 *
 * THE INTENTION THE SOURCE GIVES THESE VALUES lights the rendering: "create more
 * location-based marking, giving more permanence and coverage". It is a marking of PLACE,
 * not of person — hence the membership measured AT THE PING MOMENT (below).
 *
 * THE UNIT IS AN ASSUMPTION, AND IT IS WRITTEN. The replay positions are in world meters;
 * "wu" is the world unit of Slipspace, ASSUMED here to be worth 1 m. A 4.25 m radius
 * (8.5 m diameter) is plausible for an arena sensor; the other conversion sometimes cited
 * (3.048 m/wu) would give a 26 m diameter, implausible on a 50 m map. The day a range is
 * MEASURED in the film, it would replace the constant — and only it would.
 *
 * IT PINGS, IT DOES NOT BREATHE (correction of 2026-08-17). The first rendering made the disk
 * radius oscillate by ±6% around a range declared at 8 m: a slow breathing, which said
 * nothing about the game and gave the sensor a zone twice too wide. The in-game sensor
 * emits a wave every 1.8 s; it is that wave that is drawn, at the official range.
 *
 * A FUNCTION OF TIME, NOT A STATE ANIMATION (same rule as `explosionFx`): the playback moves
 * forward, back, jumps to the cursor. The same age always renders the same image, so a
 * rewind replays exactly what one had seen. Under `prefers-reduced-motion`, the wave does
 * not depart — the disk and its ring remain, and the reveal mark stops fading.
 *
 * WHAT THE PING REVEALS. At each ping, the ADVERSE lives of the placer that are within the
 * radius AT THE PING MOMENT carry a mark for 0.75 s. Three choices, all consequences of the
 * source:
 *  - MEMBERSHIP IS MEASURED AT THE PING, never at the current frame: the source speaks of
 *    "location-based marking", and 0.75 s of running are ~3 m at a Spartan's base speed,
 *    that is three quarters of the radius. Testing "now" would mark the entrants and
 *    unmark the exiters — exactly the reverse of what the sensor asserts.
 *  - THE MARK FOLLOWS THE LIFE: it is drawn at the CURRENT position, as the game's outline
 *    follows its target. A halo left three meters behind a moving point would read as a
 *    display defect.
 *  - IT DOES NOT OUTLIVE ITS TARGET: a life that ends during the window loses its mark on
 *    the very frame. Death already has its layer, the mark has nothing to add there.
 *
 * THE CAMP IS THE FILM'S TEAM (`campResolver`), NOT "ally / enemy". The allegiance flag is
 * relative to the player being watched: it would sort everyone into two camps, which is
 * wrong in four-camp BTB. What must be known here is whether TWO LIVES oppose each other.
 * Without a known camp — placer not measured (`owner < 0`), life whose team the film keeps
 * silent or gives none (free-for-all) — NO reveal: the ping is drawn anyway (it is
 * measured, itself), and nothing asserts an enmity of which one knows nothing.
 *
 * COST PER FRAME, MEASURED ON THE LOCAL CORPUS (27 artifacts, 2026-08-17). Only one carries
 * any: `000d5950`, 19 sensors, all with a measured placer — at most TWO active at the same
 * time, and at most two in a reveal window (average 0.055 per frame, 0.103 active). The
 * sweep therefore costs, at the worst of this corpus: 2 x 99 life-window tests (O(1)) then
 * 2 x 8 position interpolations (binary search) — negligible next to the 228 primitives of
 * ONE explosion. The corpus's wide bound (BTB: 256 lives, 28 simultaneous) would fit under
 * 8 x 256 tests even with eight active sensors.
 *
 * No React, no written color: pure geometry and arithmetic (the ink comes from the calling
 * layer, which takes it from the theme tokens).
 */
import type { ReplayEquipmentPlacement } from '@/lib/api/types'

import { isAliveAt, positionAt } from '../../../lib/replay/replayLogic'
import type { ReplayTrackReady } from '../../../lib/replay/replayNormalize'

/**
 * Sensor radius, in world meters. OFFICIAL VALUE ("Sensor Radius: 4.25wu"), under the unit
 * assumption written in the header: 1 wu = 1 m.
 */
export const SENSOR_RADIUS_M = 4.25

/** Ping period, in milliseconds. OFFICIAL VALUE ("Ping Frequency: 1.8 secondes"). */
export const SENSOR_PING_MS = 1_800

/**
 * Duration of the "revealed" mark, in milliseconds. OFFICIAL VALUE ("Reveal Duration:
 * 0.75 secondes"): it is SHORT, and that is the point of the season 4 adjustment — the
 * reveal no longer follows its target for long, it is the sensor that lasts and covers a
 * place.
 */
export const SENSOR_REVEAL_MS = 750

/**
 * Official lifetime of the sensor, in milliseconds ("Sensor Duration: 15 secondes").
 *
 * IT IS THE FALLBACK OF THE WINDOW, NOT ITS CONTRACT. A sensor whose deletion the film
 * writes (situated spawned object, `endRead`, cf. `spawnedObjects.ts`) is drawn until that
 * read end, which can exceed 15 s; this duration only holds for a placement without a read
 * end (`placementWindow.ts`). It bounds neither the number of pings nor the reveal: the ping
 * is periodic at any age (`sensorPing`).
 */
export const SENSOR_DURATION_MS = 15_000

/**
 * Run of a ping's wave, in milliseconds: the time it takes to reach the radius.
 *
 * THIS IS NOT A MEASUREMENT and the source says nothing of it: it is a RHYTHM choice.
 * 400 ms on a period of 1,800 let the wave read as a strike (it occupies less than a quarter
 * of the cycle) then return the disk to rest — a wave that would fill the period would give
 * a sensor that swells continuously, i.e. the breathing that was just removed.
 */
export const SENSOR_SWEEP_MS = 400

/** Disk fill: very low — it is a zone, it must mask nothing. */
export const SENSOR_FILL_ALPHA = 0.1
/** Fixed ring at the radius: the border of the zone, present between two pings. */
export const SENSOR_RING_ALPHA = 0.55
export const SENSOR_RING_WIDTH = 1.25
/** Starting opacity of the ping wave: it snaps, then fades away as it opens. */
export const SENSOR_PING_ALPHA = 0.9
/** Thickness of the wave: sharper than the fixed ring, it is the event. */
export const SENSOR_PING_WIDTH = 2

/**
 * Radius of the "revealed" mark around the life, in SCREEN pixels.
 *
 * 12 px PINS IT OUT OF REACH OF THE OTHER RINGS of the player marker: its core goes up to
 * 4.8 px, its edging to 5.8, the identity ring to ~7.4 and the level rings to 6.5 and 9.3
 * (cf. replayMarkers.ts). It is also distinguished from them by COLOR — the level rings are
 * in the theme's ink, the mark carries the tint of the placer's team.
 */
export const REVEAL_RADIUS_PX = 12
/** Halo fill: low, it lights the player without erasing the map under him. */
export const REVEAL_FILL_ALPHA = 0.18
/** Edging opacity at the ping; it decays until the mark dies out. */
export const REVEAL_ALPHA = 0.8
export const REVEAL_WIDTH = 1.5

/** What the sensor needs to know about the current instant. */
export interface SensorTime {
  /** Current frame (fractional during playback). */
  frame: number
  /** REAL duration of one frame, in ms (`frameToMs(1, doc)`), never a frame counter. */
  frameMs: number
}

/** The film's lives, and the camp of each — everything the reveal needs to read. */
export interface SensorScene {
  /** All the lives: the sweep filters on the life window itself. */
  lives: readonly ReplayTrackReady[]
  /**
   * Camp of the life occupying a slot AT A FRAME (its team of the FILM); null = unknown
   * camp, therefore never an enemy. The frame is needed because a biped slot is re-allocated
   * between rounds: the placer is read at the instant of its PLACEMENT, the target at the
   * instant of the PING.
   */
  campOfSlot: (slot: number, frame: number) => number | null
}

/** The current ping's wave: where it is in its run, and how much opacity it has left. */
export interface SensorPingWave {
  /** Radius reached, as a FRACTION of the sensor radius — in [0, 1[. */
  reach: number
  /** Stroke opacity, decreasing: the wave fades away as it opens. */
  alpha: number
}

/** A life REVEALED by a ping, at the current frame. */
export interface SensorReveal {
  /** Slot of the revealed life. */
  slot: number
  /** Its WORLD position at the CURRENT frame: the mark follows the player (cf. header). */
  x: number
  y: number
  /** Slot of the PLACER: the mark carries HIS team color — it is his camp that sees. */
  owner: number
  /**
   * Frame of the sensor's PLACEMENT (`s.t0`): it is the frame at which to resolve the
   * placer's color — the slot `owner` may belong to another player at the current frame
   * (following round), and the placer, himself, was alive when he placed it.
   */
  ownerFrame: number
  /** Time elapsed since the ping that revealed it, in ms — in [0, SENSOR_REVEAL_MS]. */
  sinceMs: number
}

/**
 * sensorPingAgeMs — time elapsed since the LAST ping, at the given age.
 *
 * The first ping departs at age zero: the sensor sweeps as soon as it touches the ground. A
 * negative age (the placement does not exist yet) returns zero rather than an inverted
 * phase — but the layer never calls it outside the window [t0, t1].
 */
export function sensorPingAgeMs(ageMs: number): number {
  if (!(ageMs > 0)) return 0
  return ageMs % SENSOR_PING_MS
}

/**
 * sensorPing — the current ping's wave, or null when it has finished its run: between two
 * pings, the sensor shows nothing but its disk and its ring.
 *
 * The opening follows an easeOutCubic — the wave leaves the center fast then settles at the
 * edge, the shockwave pattern of the explosion (`explosionFx.drawWave`), for the same
 * reason: that is how an impulse reads. Under reduced motion, no wave.
 */
export function sensorPing(ageMs: number, reducedMotion: boolean): SensorPingWave | null {
  if (reducedMotion) return null
  const since = sensorPingAgeMs(ageMs)
  if (since >= SENSOR_SWEEP_MS) return null
  const pr = since / SENSOR_SWEEP_MS
  return { reach: 1 - Math.pow(1 - pr, 3), alpha: (1 - pr) * SENSOR_PING_ALPHA }
}

/**
 * revealAlpha — the opacity of the mark at its age: sharp at the ping, extinguished at
 * 0.75 s.
 *
 * Under reduced motion it DOES NOT FADE: the mark remains information ("this enemy has
 * been detected"), and a fixed opacity keeps it without making it pulse.
 */
export function revealAlpha(sinceMs: number, reducedMotion: boolean): number {
  if (reducedMotion) return REVEAL_ALPHA
  const pr = Math.min(1, Math.max(0, sinceMs / SENSOR_REVEAL_MS))
  return REVEAL_ALPHA * (1 - pr)
}

/**
 * sensorReveals — the lives revealed by the ACTIVE sensors at this frame.
 *
 * `sensors` is the list of `sensor` family placements already kept by the render table and
 * active at the frame (it is the layer that builds it, it already loops over it): this
 * function decides neither the rendering of a family nor the window of a placement, it
 * decides the reveal. Everything else — camp, range, instant of measurement — is written
 * in the file header.
 */
export function sensorReveals(
  sensors: readonly ReplayEquipmentPlacement[],
  scene: SensorScene,
  time: SensorTime,
): SensorReveal[] {
  const r2 = SENSOR_RADIUS_M * SENSOR_RADIUS_M
  const bySlot = new Map<number, SensorReveal>()
  for (const s of sensors) {
    // WITHOUT A MEASURED PLACER, NO REVEAL: the sensor's camp is ignored, so no one is
    // "enemy" to it. The ping, itself, keeps being drawn.
    if (s.owner < 0) continue
    // THE PLACER IS READ AT THE INSTANT OF THE PLACEMENT (`s.t0`): he was then alive on
    // that slot, and it is HIS camp that sees. At the current frame the slot could already
    // be free or belong to someone else.
    const side = scene.campOfSlot(s.owner, s.t0)
    if (side === null) continue
    const sinceMs = sensorPingAgeMs((time.frame - s.t0) * time.frameMs)
    if (sinceMs > SENSOR_REVEAL_MS) continue
    // The frame of the PING, from which membership is measured. Fractional: `positionAt`
    // interpolates, and a ping does not fall on a whole frame.
    const pingFrame = time.frameMs > 0 ? time.frame - sinceMs / time.frameMs : time.frame
    for (const life of scene.lives) {
      // The two window tests first: O(1) each, and they rule out 99 lives down to 8
      // before any binary search of position (cf. the cost in the header).
      if (!isAliveAt(life, pingFrame)) continue
      if (!isAliveAt(life, time.frame)) continue
      // The TARGET is read at the instant of the PING, where it is alive (check above): it
      // is the camp of the life occupying that slot then, never that of another round.
      const other = scene.campOfSlot(life.slot, pingFrame)
      if (other === null || other === side) continue
      const atPing = positionAt(life.points, pingFrame)
      if (!atPing) continue
      const dx = atPing.x - s.x
      const dy = atPing.y - s.y
      if (dx * dx + dy * dy > r2) continue
      const now = positionAt(life.points, time.frame)
      if (!now) continue
      // TWO SENSORS CAN SEE THE SAME LIFE: one mark only, the FRESHEST. Two overlaid
      // halos would double the opacity without saying anything more.
      const held = bySlot.get(life.slot)
      if (held && held.sinceMs <= sinceMs) continue
      bySlot.set(life.slot, { slot: life.slot, x: now.x, y: now.y, owner: s.owner, ownerFrame: s.t0, sinceMs })
    }
  }
  return [...bySlot.values()]
}
