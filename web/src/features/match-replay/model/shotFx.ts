// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * shotFx.ts — WHAT IS KNOWN ABOUT A SHOT BEFORE DRAWING IT: where, when, what shape,
 * what tint, and in which direction the shooter WAS LOOKING.
 *
 * SHOTS FROM A VEHICLE (2026-09-03): `doc.shots[i].v` marks a shot fired from the vehicle of this
 * slot (same key as `VehicleTrack.slot`) — `x`/`y` then hold the INTERPOLATED POSITION OF THE
 * VEHICLE (center), not that of a shooter (the biped no longer replicates once boarded,
 * `document.go`). This module resolves HERE, once, what DEPENDS ONLY ON THE FILM (the
 * carrying vehicle and its heading at the instant of the shot, `vehicleChassisHeadingAt`) and the mount of the weapon
 * (`vehicleWeaponMountOf`, registry of the title published in the document, schema 69); what depends
 * on the LOADED SPRITE (its size, hence the
 * real on-screen offset) stays at the draw (`drawShotsLayer`), which alone knows `sizeOf` — same
 * precompute/canvas split as the rest of the file.
 *
 * THE MEASUREMENT THAT UNLOCKED THIS LAYER (2026-08-15). The render oriented a shot by the field
 * `h` of the SHOT EVENT: present on 90 shots out of 483 of the witness film (18.6%), 16.1%
 * on the 23 local artifacts. Hence the impression of no effect. Yet the LOOK heading
 * lives IN THE TRAJECTORIES TOO — it is what already feeds the « Aim » layer — and it
 * is known continuously. By re-reading it at the instant of the shot (same `heldReading`, same window
 * of hold as the cone), coverage goes to **483/483 on the witness (100%)** and
 * **99.1% on the corpus**; the median age of the reading is 0 ms, and 94.4% of the readings
 * have less than 200 ms.
 *
 * WHY THE GAZE ALONE, AND NOT THE `h` OF THE EVENT WHEN IT IS THERE. Because the two
 * say the same thing: on the 2,866 shots that carry BOTH, the median gap is
 * 0.3° and 84.4% are under 5°. A single rule is therefore better than two, and it is the one that
 * covers everything.
 *
 * MELEE DOES NOT ENTER: a hammer blow is not a shot, it has no muzzle flash
 * (rule established at lot 3.2, and the Csstat reference excludes melee explicitly). Measurement:
 * 0 shot events of family `melee` on the 17,904 of the corpus — the rule costs nothing,
 * but without it a film carrying one would display a false flash.
 *
 * No React, no canvas: pure logic, tested (shotFx.test.ts).
 */
import { fxTintOf, type FxTint } from '../layers/fxInk'
import { familyOf, type ShotFamily } from '../layers/shotEffects'
import { frameToMs, heldReading } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady, ReplayVehicleTrackReady } from '../../../lib/replay/replayNormalize'
import { vehicleChassisHeadingAt, vehicleShooterAimAt } from './vehiclesAim'
import { vehicleShotStyleOf, vehicleWeaponMountOf } from './vehicleWeaponRegistry'
import type { VehicleWeaponMount } from './vehicleWeaponMounts'
import { vehicleSpriteFamily } from './vehiclesLayer'
import { buildLivesBySlot, lifeOfSlotAt } from './livesPosition'
import { fireBurstShots } from './fireBursts'

/**
 * VehicleShotSource — WHAT IS NEEDED, IN ADDITION TO THE CENTER, TO PLACE THE EFFECT AT THE RIGHT MOUNT
 * (`vehicleWeaponMounts.vehicleShotPlacement`, called at the draw once the sprite is loaded).
 * `null` on `ShotFxEntry.vehicleShot` = shot on foot, OR vehicle shot whose weapon has no
 * known mount (`vehicleWeaponMountOf` returns `null`): the fallback then stays at the center of
 * the vehicle, exactly the behavior before this file.
 */
export interface VehicleShotSource {
  /**
   * The mount of the weapon on the chassis, or `null` when the registry of the document does not carry it
   * (weapon absent from the registry, or entry without mount), OR when the weapon is not a vehicle
   * weapon at all (`weaponSource: 'player'`).
   * `null` NO LONGER makes the source lost: the flash stays at the CENTER of the vehicle, but it keeps its
   * DIRECTION (cf. `vehicleShotPlacement`).
   */
  mount: VehicleWeaponMount | null
  /**
   * WHAT FIRED, AND IT IS THE KEY OF THE DIRECTION RULE (lot 5.8.5): a VEHICLE weapon is
   * solidary of the chassis (its heading is therefore a legitimate fallback), a PLAYER weapon fired from a
   * seat is NOT — the passenger aims where it wants, and lending it the heading of the vehicle would be an
   * invention (rule of lot 5.2a.5, which SURVIVES). The only direction it accepts is the AIM
   * MEASURED of its shooter.
   *
   * THE DISCRIMINATOR IS THE WEAPON REGISTRY, as for the sound: a weapon absent from
   * `weaponLabels` is a vehicle weapon.
   */
  weaponSource: 'vehicle' | 'player'
  /** Family of the carrying vehicle (key of `sizeOf`/`spriteOf`, cf. `VehicleStyle`). */
  family: string | undefined
  /**
   * WORLD heading of the vehicle at the instant of the shot — the one to which the CHASSIS IS DRAWN
   * (`vehicleChassisHeadingAt`), degrees, convention `Point.h`. It is the same as the sprite, and it
   * is not a detail: the weapon mount is an anchor in the LOCAL frame of the sprite, so a
   * flash placed at another heading would come out of the chassis it is supposed to leave.
   */
  headingDeg: number
  /**
   * AIM MEASURED of THE ONE WHO FIRED, world degrees, or `null` lacking a reading in force
   * (`vehicleShooterAimAt`, paired by SLOT — cf. its header for the negative of lot 5.5.1 that
   * makes this value necessary). It orients ONLY the mounts of class `tourelle`: the
   * chassis, for its part, keeps its own heading.
   */
  shooterHeadingDeg: number | null
}

/** A shot ready to draw: WORLD coordinates, the conversion to pixels depends on the framing. */
export interface ShotFxEntry {
  /** Frame of the shot on the grid of the replay (pose readings: gaze, weapon in hand, position). */
  frame: number
  /**
   * FRACTIONAL frame of the shot: `frame` + the intra-frame offset of the document (`o`, ms) reduced to the grid
   * step. It is this one that places the shot in the time of the scene (flight, flash, recoil, animation);
   * shots of the same frame are separated there at the order of the film.
   */
  time: number
  /** Location of the biped shooter (the 3D view re-reads there its height and the yaw of its aim). */
  slot: number
  x: number
  y: number
  /**
   * GAZE heading of the shooter at this instant, in world degrees. null = no reading in the
   * hold window: the flash will be a round puff, never an invented direction.
   */
  h: number | null
  fam: ShotFamily
  tint: FxTint
  /** Stable seed: two readings of the same instant give back the same shape. */
  seed: number
  /** Shot of a VEHICLE WEAPON; `null` for a shot on foot or a player weapon. */
  vehicleShot: VehicleShotSource | null
}

/**
 * buildShotFx precomputes the drawable shots of a document — positions, families, tints
 * and gazes resolved ONCE at load (pattern `buildKillFx`). During the reading, only
 * the passage world -> pixels remains.
 *
 * `aimHoldFrames` is the hold window of the gaze, in frames: the SAME one as that of the
 * aim cone, because it is the same reading. Beyond it, one no longer knows where the player
 * was looking, and an expired direction would affirm what one does not know.
 *
 * `seatedAtSlot`: the rule of the piece (`SlotIdentity.seatedAtSlot`). A shot fired by a player who no
 * longer holds a card at this instant — a raised bot — anchors on no piece: it is not
 * drawn. The shot stays in the film and in the counts; only the flash of the map goes out.
 */
export function buildShotFx(
  doc: ReplayDocumentReady,
  aimHoldFrames: number,
  seatedAtSlot?: (slot: number, ownerFrame: number, frame: number) => boolean,
): ShotFxEntry[] {
  // THE BLOWS OF THE FULL-AUTO FIRE (schema 71) enter as shots: same flash, same mount, same
  // gaze — they differ only by their source, simulated at the cadence of the tag (`fireBursts.ts`).
  const tirs = [...doc.shots, ...fireBurstShots(doc)]
  if (tirs.length === 0) return []
  // ONE TRACK = ONE LIFE, and the biped slot is re-allocated at each respawn: one
  // therefore groups by slot, then keeps the life THAT COVERS the instant of the shot. Taking the
  // first one that comes would read the gaze of another life of the same player.
  const bySlot = buildLivesBySlot(doc.tracks)
  const out: ShotFxEntry[] = []
  for (const s of tirs) {
    if (seatedAtSlot && !seatedAtSlot(s.slot, s.t, s.t)) continue
    const label = s.w ? doc.weaponLabels?.[s.w] : undefined
    // TWO JOINS, IN THIS ORDER — the SAME one as that of the sound (`shotSoundStem`): the registry
    // of PLAYER weapons first, then the VEHICLE WEAPON REGISTRY of the document (schema 69,
    // which replaces the client table of lot 5.8.2). Without the second, 68% of the vehicle shots of
    // `4f77afc1` fell on the family `plain` and the tint `neutral` — a pale gray halo
    // centered on a sprite, which is not read as a shot.
    const style = label ? null : vehicleShotStyleOf(doc, s.w)
    const fam = familyOf(label?.fx ?? style?.fx)
    if (fam === 'melee') continue
    const track = lifeOfSlotAt(bySlot, s.slot, s.t)
    const read = track ? heldReading(track.points, s.t, (p) => p.h, aimHoldFrames) : null
    out.push({
      frame: s.t,
      time: s.t + (s.o ?? 0) / frameToMs(1, doc),
      slot: s.slot,
      x: s.x,
      y: s.y,
      h: read ? read.value : null,
      fam,
      tint: fxTintOf(label?.tint ?? style?.tint),
      seed: s.t + s.slot,
      vehicleShot: vehicleShotSourceOf(doc, s, s.t),
    })
  }
  return out
}

/**
 * vehicleShotSourceOf — RESOLVES ONCE what the render will need to know about a shot from
 * a vehicle: the carrying vehicle (by `v`, SAME key as `VehicleTrack.slot`), the mount of
 * the weapon (by `w`) when it is documented, and the heading of the vehicle at the instant `t`.
 *
 * # WHY AN UNKNOWN MOUNT NO LONGER MAKES THE SOURCE LOST (2026-09-20)
 *
 * THE MEASURED DEFAULT, and it alone explains the user observation of 2026-09-19 (« still
 * no shot effects for the vehicles »). The GAZE heading of a shot comes from the trajectory
 * of the BIPED (`heldReading` below) — yet a BOARDED biped NO LONGER REPLICATES. Measurement of
 * 2026-09-20 on four baked documents: on the shots that carry `v`, the gaze heading is
 * readable for **1 out of 241** (`4f77afc1`), 3 out of 241 (`5676a9ba`), 0 out of 47 (`c259789d`) and
 * 0 out of 15 (`8a485699`). Without heading, `drawMuzzleFlash` falls on the ROUND PUFF — without
 * direction, centered on the chassis, and in the tint `neutral` (68% of these shots carry a
 * weapon absent from `weaponLabels`, therefore without family nor tint). A pale gray halo centered on the
 * sprite is not read as a shot: it is what the user was not seeing.
 *
 * WHAT THE FILM GIVES, FOR ITS PART, FOR 100% OF THESE SHOTS: THE HEADING OF THE VEHICLE. Keeping the source even
 * without mount therefore gives back a direction to the flash, and `vehicleShotPlacement` translates it.
 *
 * THE GUARD IS THE WEAPON REGISTRY, and it is the SAME discriminator as the sound
 * (`shotSoundStem`: « their identifiers are ABSENT from `weaponLabels` »).
 *
 * # A PLAYER WEAPON FIRED FROM A SEAT KEEPS THE SOURCE SINCE LOT 5.8.5, AND FOR ITS AIM
 *
 * THE NEGATIVE THAT WAS SETTING IT ASIDE HAS FALLEN, and it is lot 5.5.2 that made it fall. 5.2a.5 was
 * leaving them on their own GAZE heading — the rule was correct (the passenger aims where it wants) but
 * this heading comes from the trajectory of the BIPED, which no longer replicates once boarded: it is
 * readable for **1 shot out of 241** (`4f77afc1`). Measurement of the population: **76 shots out of 241**
 * (D2 of lot 5.5).
 *
 * WHAT 5.5.2 ESTABLISHED: the aim of the EPISODE OF THE SHOOTER, paired by SLOT, is ITS OWN
 * GAZE — not that of another. The objection that was freezing this case (« passing off a measurement of another
 * as an approximation of oneself ») therefore does not apply there, and the user ruled it on
 * 2026-09-21: « for a NON-driver occupant, the orientation of their passenger weapon is their
 * AIM, their regular gaze like on foot ».
 *
 * THE RULE OF 5.2a.5 SURVIVES ENTIRE: this weapon NEVER takes the heading of the chassis. Without reading
 * of aim in force, the source is not even created — the shot then falls back to its own
 * gaze, exactly as before this lot (`h`), and on the round puff as a fallback.
 */
function vehicleShotSourceOf(
  doc: ReplayDocumentReady,
  shot: { v?: number; w?: string; slot: number },
  t: number,
): VehicleShotSource | null {
  if (shot.v === undefined) return null
  const track = doc.vehicles.find((v) => v.slot === shot.v)
  if (!track) return null
  const mount = vehicleWeaponMountOf(doc, shot.w)
  // VEHICLE WEAPON = absent from the player weapon registry (cf. the header of this function).
  const vehicleWeapon = shot.w !== undefined && doc.weaponLabels?.[shot.w] === undefined
  // THE SLOT OF THE SHOOTER, NOT THEIR SEAT (lot 5.5): it is the only key that designates the occupant who
  // fired, and it holds for the passenger gunner of the Warthog as for the driver gunner
  // of the Scorpion — as for the passenger who fires their own weapon.
  const shooterAim =
    vehicleShooterAimAt(track, shot.slot, t) ?? aimOnMountedGun(doc, track, shot.slot, t)
  // A PLAYER WEAPON ENTERS ONLY IF ITS AIM IS READ: without it, the source would bring nothing
  // and the shot would lose its own gaze (`h`), which is sometimes readable.
  if (!mount && !vehicleWeapon && shooterAim === null) return null
  return {
    mount,
    weaponSource: vehicleWeapon ? 'vehicle' : 'player',
    // THE SPRITE DRAWN, variant included (schema 69): it is on ITS dimensions that the anchor is read.
    family: vehicleSpriteFamily(track),
    headingDeg: vehicleChassisHeadingAt(track, t),
    shooterHeadingDeg: shooterAim,
  }
}

/**
 * viseeSurUnePiecePortee — THE AIM OF THE SHOOTER WHEN THEIR EPISODE STAYED ON A MOUNTED GUN of
 * the vehicle that carries the shot (schema 69, adverse review of lot M4a, F1).
 *
 * The server places a turret shot on the CARRIER (`v` = the chassis) as soon as the gun has a
 * `carrier`, but it only moves the episode of the gunner onto that carrier if it can: an
 * episode outside the window of the carrier, an occupant already aboard, or a fallback episode whose
 * boarding is not seen near the carrier (2026-09-24) leaves it on the gun. Searching the aim on the sole carrier lost it then — measurement
 * of 2026-09-24: 174 shots out of 276 lost their aim read, and the mount `turret` fell back on
 * the round puff. The gun belongs to the carrier by `carrier {slot, gen}`: its episode IS
 * the episode of the shooter, paired by SLOT as everywhere else.
 */
function aimOnMountedGun(
  doc: ReplayDocumentReady,
  carrier: ReplayVehicleTrackReady,
  shooterSlot: number,
  t: number,
): number | null {
  for (const gun of doc.vehicles) {
    if (gun.carrier?.slot !== carrier.slot || gun.carrier.gen !== carrier.gen) continue
    const aim = vehicleShooterAimAt(gun, shooterSlot, t)
    if (aim !== null) return aim
  }
  return null
}
