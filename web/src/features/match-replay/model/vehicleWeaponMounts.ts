// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * vehicleWeaponMounts.ts — WHERE A VEHICLE SHOT LEAVES FROM, NOT THE CENTER OF THE PIECE.
 *
 * USER REQUEST (2026-09-03): « si ça vient du passager, faut que le tir vienne du siège
 * passager qui a une tourelle » [if it comes from the passenger, the shot has to come from
 * the passenger seat that has a turret]. Before this file, `doc.shots` marked `v` (vehicle
 * slot) drew its spark at the CENTER of the vehicle (`ShotFxEntry.x/y` = vehicle position,
 * cf. `document.go`: "X, Y are the INTERPOLATED ORIGIN OF THE VEHICLE"). This file provides
 * the PHYSICAL ANCHOR of the vehicle weapon, in FRACTIONS OF THE SPRITE (frame with the nose
 * up, the same one as `vehiclesPaint.drawRotatedSprite`: origin at the center, `ax` from -0.5
 * (left edge) to +0.5 (right edge), `ay` from -0.5 (nose, top of the image) to +0.5 (rear,
 * bottom of the image)) — and the pure geometry that rotates it by the vehicle's heading.
 *
 * THE ANCHORS NO LONGER LIVE HERE (schema 69, replay feedback of 2026-09-23, lot M4a). The
 * `Shot.w` -> anchor table of this file was keyed by `weap` tags of the game module recopied
 * under the template `0x<tag>00000000` — the majority of which appeared in no film. It is
 * replaced by the TITLE REGISTRY (`config/titles/{slug}/mappings/vehicle_weapons.toml`, key =
 * tag OBSERVED, proof attached), published in the document and read by
 * `vehicleWeaponRegistry.ts`. Each weapon of the registry carries there its anchor, measured
 * on its vehicle's sprite (provenance in the entry's `proof`): a weapon without an anchor
 * would fire from the center of the sprite, where the driver's piece sits.
 *
 * WHAT THIS FILE KEEPS: the type of an anchor and the GEOMETRY that rotates it by the
 * vehicle's heading. CLASS: `fixed` = rigid with the nose, aims only where the vehicle points
 * (the pilot IS the aimer) — the anchor IS the muzzle; `turret` = aim steered INDEPENDENTLY
 * of the heading (rear cannon of the Warthog, cannon of the Scorpion, side post of the
 * Falcon) — the anchor is the PIVOT, and the muzzle is at `reach` (barrel length, fraction of
 * the sprite length) from the pivot in the direction of the MEASURED aim of its shooter;
 * without a read aim, the shot leaves the pivot in a round puff, never from an invented
 * direction.
 */
import { vehicleAimAngle, vehicleScreenAngle, vehicleSpriteScale } from './vehiclesLayer'
import type { XY } from '../../../lib/replay/replayLogic'

/** `fixed` = rigid with the nose, aims where the vehicle points. `turret` = independent aim, unknown. */
export type VehicleMountClass = 'fixed' | 'turret'

/** A mount anchor: aim class + position in fractions of the sprite (frame with the nose up). */
export interface VehicleWeaponMount {
  mountClass: VehicleMountClass
  /** Lateral: -0.5 (left edge of the sprite) .. +0.5 (right edge). */
  ax: number
  /** Longitudinal: -0.5 (nose) .. +0.5 (rear). */
  ay: number
  /**
   * Barrel length of a TURRET, as a fraction of the LENGTH of the sprite (its height, nose
   * up): the muzzle is at that distance from the pivot, along the shooter's aim. Absent = 0
   * (fixed weapon, whose anchor is already the muzzle).
   */
  reach?: number
}

// --- GEOMETRY: anchor -> screen point -----------------------------------------------------------

/** What the stroke knows of the sprite when placing an anchor (same fields as `vehiclesPaint`). */
export interface VehicleMountSpriteSize {
  naturalWidthPx: number
  naturalHeightPx: number
  mmPerPx: number
  /** Soft ceiling of the canvas (`vehicleCeilPx`): that of the drawn sprite. Absent = historical. */
  ceilPx?: number
}

/** The result: a SCREEN offset (pixels, density `k` already applied) and a direction. */
export interface VehicleShotPlacement {
  /** To add to the already-projected center of the vehicle (`project(world, view)`). */
  offset: XY
  /** Canvas angle of the discharge, or `null` (turret whose shooter has no read aim). */
  angle: number | null
}

/**
 * VehicleShotCaps — THE TWO HEADINGS OF A VEHICLE SHOT, and they do not serve the same
 * purpose.
 *
 * `chassisDeg` is the heading at which the SPRITE IS DRAWN (`vehicleChassisHeadingAt`): the
 * mount is an anchor in the LOCAL frame of the sprite, so it is that one, and only that one,
 * that places the spark.
 *
 * `shooterDeg` is the MEASURED aim of the one who fired (`vehicleShooterAimAt`, paired by
 * SLOT), or `null` when no reading is in effect. It serves only to ORIENT the discharge of
 * a TURRET — where the chassis says nothing, because the turret rotates independently of the
 * body. The two stay distinct on purpose: confusing placement and direction would take the
 * spark out of the chassis it is supposed to leave.
 */
export interface VehicleShotCaps {
  chassisDeg: number
  shooterDeg: number | null
  /**
   * WHAT FIRED (lot 5.8.5): a VEHICLE weapon is rigid with the chassis, so its heading is a
   * legitimate fallback when the mount is missing; a PLAYER weapon fired from a seat is not
   * — it accepts only the measured aim of its shooter (rule of lot 5.2a.5, which survives).
   */
  weaponSource: 'vehicle' | 'player'
}

/**
 * vehicleShotPlacement — THE computation, and nothing else: anchor (fractions of the sprite)
 * + world heading + sprite size -> screen offset + direction. REUSES THE VEHICLES LAYER
 * PRIMITIVES, RECOPIES NO TRIGONOMETRY:
 *  - `vehicleScreenAngle` to rotate the LOCAL offset (sprite frame, nose up) EXACTLY as
 *    `drawRotatedSprite` rotates the image itself (same angle, same sense);
 *  - `vehicleSpriteScale` for the same physical->screen scaling as the sprite;
 *  - `vehicleAimAngle` for the direction of a `fixed` shot — THE SAME angle as the driver's
 *    cone (`drawVehicleAimCone`), not a recomputed variant: "vehicle heading = aimer" is an
 *    assumption already made elsewhere in this layer, not a new invention.
 *
 * LOCAL frame of the offset BEFORE rotation: `(ax * naturalWidthPx, ay * naturalHeightPx)`
 * — the same frame `drawRotatedSprite` uses to draw its image (`drawImage(img, -w/2, -h/2,
 * w, h)`), so an anchor at the nose (`ay = -0.5`) lands on the top edge of the sprite, NOT
 * the bottom.
 *
 * THE BARREL OF A TURRET: the pivot rotated by the CHASSIS heading (it belongs to the
 * sprite), then `reach × sprite length on screen` along the DIRECTION OF THE DISCHARGE (the
 * shooter's aim). Without a read aim, no direction: the shot stays at the pivot.
 */
export function vehicleShotPlacement(
  mount: VehicleWeaponMount | null,
  caps: VehicleShotCaps,
  size: VehicleMountSpriteSize,
  k: number,
  scalePxPerM: number,
): VehicleShotPlacement {
  // UNKNOWN MOUNT: no offset — the spark stays at the CENTER of the chassis, the only
  // position the document gives —, but it still gets its DIRECTION (cf. `vehicleMountAngle`).
  if (!mount) return { offset: { x: 0, y: 0 }, angle: vehicleNoMountAngle(caps) }
  const scale = vehicleSpriteScale(size.naturalHeightPx, size.mmPerPx, scalePxPerM, size.ceilPx) * k
  const localX = mount.ax * size.naturalWidthPx
  const localY = mount.ay * size.naturalHeightPx
  const screenAngle = vehicleScreenAngle(caps.chassisDeg)
  const cosA = Math.cos(screenAngle)
  const sinA = Math.sin(screenAngle)
  const angle = vehicleMountAngle(mount, caps)
  // THE MUZZLE OF AN AIMED TURRET: the barrel, of the measured length, in the direction of
  // the shot.
  const barrel = turretBarrelOffset(mount, angle, size.naturalHeightPx * scale)
  const offset: XY = {
    x: (localX * cosA - localY * sinA) * scale + barrel.x,
    y: (localX * sinA + localY * cosA) * scale + barrel.y,
  }
  return { offset, angle }
}

/**
 * turretBarrelOffset — the barrel of a TURRET on screen: `reach × sprite length` along the
 * direction of the discharge. Zero for a fixed weapon (its anchor is the muzzle) and for a
 * turret without a read aim (no direction, the shot stays at the pivot).
 */
function turretBarrelOffset(mount: VehicleWeaponMount, angle: number | null, spriteLengthPx: number): XY {
  if (mount.mountClass !== 'turret' || angle === null) return { x: 0, y: 0 }
  const length = (mount.reach ?? 0) * spriteLengthPx
  return { x: length * Math.cos(angle), y: length * Math.sin(angle) }
}

/**
 * vehicleMountAngle — THE DIRECTION OF A DISCHARGE, mount by mount. ONE SINGLE SOURCE for the
 * two callers (`vehicleShotPlacement` with the sprite, `vehicleShotOrigin` without): the rule
 * was written TWICE there, and that is exactly what would make it diverge again (CLAUDE.md
 * n° 6).
 *
 *   - `fixed`: the CHASSIS heading, unchanged — on these families the weapon does not rotate
 *     relative to the body, and since 5.2a.6 that heading IS already the driver's aim
 *     (measured drift 0.0 degree).
 *   - `turret`: the MEASURED aim of the shooter when it is in effect (lot 5.5), otherwise
 *     `null` — the previous fallback, the round puff, because a turret does not point where
 *     the nose points.
 */
function vehicleMountAngle(mount: VehicleWeaponMount, caps: VehicleShotCaps): number | null {
  if (mount.mountClass !== 'turret') return vehicleAimAngle(caps.chassisDeg)
  return caps.shooterDeg === null ? null : vehicleAimAngle(caps.shooterDeg)
}

/**
 * vehicleNoMountAngle — THE DIRECTION WHEN NO MOUNT IS DOCUMENTED, and it depends on
 * WHAT FIRED (lot 5.8.5).
 *
 *   - VEHICLE WEAPON (the Shade, whose `weap` tag is missing): the CHASSIS heading, unchanged
 *     since 5.2a.5 — the weapon is rigid with the body, it is the only direction the film
 *     gives it.
 *   - PLAYER WEAPON fired from a seat: the MEASURED aim of its shooter, and NOTHING else. The
 *     chassis heading would be an invention for it (rule of lot 5.2a.5, which survives
 *     intact); without a reading, the source is not even created
 *     (`shotFx.vehicleShotSourceOf`), so this `null` only happens on a direct call.
 */
function vehicleNoMountAngle(caps: VehicleShotCaps): number | null {
  if (caps.weaponSource === 'vehicle') return vehicleAimAngle(caps.chassisDeg)
  return caps.shooterDeg === null ? null : vehicleAimAngle(caps.shooterDeg)
}

/**
 * vehicleShotOrigin — THE POINT AND DIRECTION OF A SPARK, vehicle firing included
 * (2026-09-03). Placed HERE (not in `replayDraw.ts`, already at the repo's size ceiling,
 * CLAUDE.md n°5): the fallback/mount composition belongs to the same file as the geometry
 * it calls.
 *
 * FALLBACK BY DEFAULT (`vehicleShot === null`, the vast majority of shots): the already
 * projected center, the direction of the GAZE re-read in the trajectory (`h`, cf.
 * shotFx.ts) — unchanged. That is where a PLAYER weapon fired from a seat whose aim is not
 * read still lands (5.8.5).
 *
 * VEHICLE SHOT WITH KNOWN MOUNT: the user request of 2026-09-03, word for word — « si ça
 * vient du passager, faut que le tir vienne du siège passager qui a une tourelle » [if it
 * comes from the passenger, the shot has to come from the passenger seat that has a turret]
 * — rather than from the center of the vehicle (cf. `document.go`: the shot's `x`/`y` are
 * the INTERPOLATED ORIGIN OF THE VEHICLE). `vehicleShotPlacement` does the computation; this
 * function only adds the fallback WITHOUT a known sprite size (loading not yet settled,
 * unknown family): the center, but with the RIGHT direction as soon as the mount class is
 * known (`turret` -> none, `fixed` -> the heading) — never an invented offset without the
 * real size that justifies it.
 */
export function vehicleShotOrigin(args: {
  h: number | null
  vehicleShot: {
    mount: VehicleWeaponMount | null
    /** What fired (lot 5.8.5) — cf. `VehicleShotCaps.weaponSource`. */
    weaponSource: 'vehicle' | 'player'
    family: string | undefined
    headingDeg: number
    /** MEASURED aim of the shooter (lot 5.5), `null` if no reading in effect. */
    shooterHeadingDeg: number | null
  } | null
  center: XY
  sizeOf: ((family: string) => VehicleMountSpriteSize | null) | undefined
  k: number
  /** The framing scale (CSS pixels per meter): the mount follows the sprite size. */
  scalePxPerM: number
  /** Soft ceiling of the canvas (`vehicleCeilPx`): the mount follows the sprite as drawn. */
  ceilPx?: number
}): { origin: XY; angle: number | null } {
  const { h, vehicleShot, center, sizeOf, k } = args
  if (!vehicleShot) return { origin: center, angle: h === null ? null : (-h * Math.PI) / 180 }
  const { mount, weaponSource, family, headingDeg, shooterHeadingDeg } = vehicleShot
  const caps: VehicleShotCaps = { chassisDeg: headingDeg, shooterDeg: shooterHeadingDeg, weaponSource }
  const size = family ? sizeOf?.(family) : null
  // THE DIRECTION WITHOUT THE SPRITE: same rule as with it (`vehicleMountAngle`), only the
  // OFFSET is missing — it requires the real size and is not invented. An UNKNOWN mount
  // (2026-09-20) takes the vehicle's heading; a TURRET takes its shooter's aim (lot 5.5) or
  // nothing.
  if (!size) {
    return {
      origin: center,
      angle: mount ? vehicleMountAngle(mount, caps) : vehicleNoMountAngle(caps),
    }
  }
  const sized = args.ceilPx === undefined ? size : { ...size, ceilPx: args.ceilPx }
  const { offset, angle } = vehicleShotPlacement(mount, caps, sized, k, args.scalePxPerM)
  return { origin: { x: center.x + offset.x, y: center.y + offset.y }, angle }
}
