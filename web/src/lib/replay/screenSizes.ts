// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * screenSizes.ts — THE SIZE MODEL OF THE 2D REPLAY: the map's scale when it is generous, a
 * SCALE FLOOR when it is not — and the proportions between families kept in both cases.
 *
 * ## The decision, and what it replaces (user, 2026-09-19 then 2026-09-20)
 *
 * THE ORIGINAL DEFECT (finding of 2026-09-19: "the vehicles are too small" — original French:
 * « les véhicules sont trop petits »). The vehicles were drawn at a CONSTANT size in screen
 * pixels: one world millimeter was worth `VEHICLE_PX_PER_MM` pixels, FOR EVERY MAP. A Ghost
 * therefore had the same screen size on a 54 m map and on a 273 m one — too big on the small
 * one, too small on the big one, and it was the big one the user was watching.
 *
 * THE MODEL CHOSEN ON 2026-09-20, and it is a SCREEN-SPACE model, not a "realistic" one: the
 * scale applied to world lengths is the MAXIMUM of two scales — the map's, and a FLOOR that
 * is the old framing enlarged by 20%.
 *
 *     scale_px_per_mm = max( map_scale_px_per_mm , PX_PAR_MM_MINIMUM_ECRAN )
 *     size_px         = softCeil( length_mm[family] × scale_px_per_mm )
 *
 * WHAT THIS SHAPE GUARANTEES, AND WHAT A PIXEL FLOOR DID NOT. The floor bears on the SCALE,
 * not on the size: every family crosses it TOGETHER, so they keep among themselves the exact
 * ratio of their world lengths AT EVERY SCALE. A floor expressed in pixels (this file's first
 * writing, replaced the same day) instead crushed fifteen out of eighteen families to the same
 * size on a big map.
 *
 * THREE PROPERTIES, each verified by a test:
 *
 *   NEVER SMALLER      on ANY map, no family drops below its pre-2026-09-20 size: the
 *   THAN BEFORE        effective scale is worth at least the old one × 1.2.
 *   BIG MAP =          where the map's scale is under the floor (any map wider than 65.9 m,
 *   OLD × 1.2          so all the big ones), the render is EXACTLY the old one enlarged by
 *                      20% — what the user asked for on 2026-09-19.
 *   SMALL MAP =        where the map's scale exceeds the floor, that one is used: the
 *   THE LARGER         vehicles are even bigger there, and at their real size.
 *
 * ## The pixels are LOGICAL, never physical
 *
 * This whole file is in CSS pixels. The device density (`k`, `devicePixelRatio`) is applied
 * AT THE DRAW, by the caller, exactly as for the markers' stroke widths — a screen at
 * `dpr = 2` therefore renders the SAME logical size with twice as many physical pixels. The
 * framing's scale (`scaleOf(view)`) is also in CSS pixels per meter: `view.width` is the
 * CONTAINER's width, not the physical canvas's.
 *
 * ## The families that have NO measured world length
 *
 * The model needs a world length; a family that has no measured one keeps its own, where it
 * lives, and does not pass through here:
 *
 *   pawn / biped         `replayMarkers.CORE_RADIUS` — no world length is published for a
 *                        player, and the pawn is in any case not a representation of one:
 *                        it is a MARKER. Its reference DOES NOT MOVE (user decision of
 *                        2026-09-19), and it is the unit of the old framing, hence of the
 *                        scale floor below.
 *   weapon pad           `weaponPadsLayer.PAD_DOT_PX` / `PAD_ICON_H_PX` — a pad is a spawn
 *                        point, not an object; the document publishes no dimension of it.
 *   flag / objective     `placementShapes` — shape glyphs, with no published dimension.
 *   equipment            same.
 *
 * THE TWO GLYPHS OF THE VEHICLES LAYER, THEM, FOLLOW THE SAME FACTOR (decision of 2026-09-20:
 * "same factor"): the diamond of an unresolved chassis and the turret pictogram have no proper
 * world length, but one gives them an EQUIVALENT one — the one that gives back their pre-
 * change size at the old scale. They therefore grow by 20% at the minimum, and follow the map
 * like the chassis, never shrinking relative to a neighboring vehicle.
 */
// THE PAWN, UNIT OF THE MODEL: its constants live here, under `lib/replay`, because the 2D
// replay and the Tactical tab depend on it equally (one feature does not import the other).
/**
 * Radius of the marker's core, and its growth per floor.
 *
 * EXPORTED: the vehicle size rule ("Mongoose ≈ 1.5-2 pawns long") and the tactical layer
 * anchor on the pawn and need THIS value so as not to redeclare it as a hard-coded literal.
 */
export const CORE_RADIUS = 3.4
/** Legibility outline: the map goes from light to dark, a colored point gets lost in it without it. */
export const OUTLINE_PAD = 1.0
/**
 * PION_VISIBLE_DIAMETER_PX — the diameter ACTUALLY SEEN of a pawn at ground level: the core
 * AND its outline. The outline is not an ornament, it is what makes the point legible on a
 * background that goes from light to dark — `markerEdge` already counts it as part of the
 * pawn.
 *
 * EXPORTED ON 2026-09-09, and the reason is a MEASURED defect. The vehicle size rule was
 * anchored on the CORE ALONE (6.80 px): the target "Mongoose = 1.75 pawn long" was therefore
 * computed against an anchor smaller than the visible pawn (8.80 px), and the Mongoose came
 * out 7.25 px wide — NARROWER than the pawn it is supposed to be 1.75 times the length of.
 * Hence the user feedback of 2026-09-09: "the Ghost is smaller than the player's pawn"
 * (original French: « le Ghost est plus petit que le pion du joueur »).
 */
export const PION_VISIBLE_DIAMETER_PX = (CORE_RADIUS + OUTLINE_PAD) * 2

/**
 * PION_SCREEN_PX — THE HISTORICAL UNIT OF THE FRAMING: the diameter ACTUALLY SEEN of a pawn
 * at ground level, outline included. The pawn does not change size (decision of 2026-09-19);
 * it remains the anchor by which the old scale, hence the floor, is defined.
 */
export const PION_SCREEN_PX = PION_VISIBLE_DIAMETER_PX

/**
 * MONGOOSE_REFERENCE_LENGTH_MM — the REAL length (nose-up) of the Mongoose sprite: 128 sprite
 * px × 10 mm/px. It is no longer a framing target, only the anchor by which the OLD scale
 * is reconstituted.
 */
const MONGOOSE_REFERENCE_LENGTH_MM = 1280

/**
 * MONGOOSE_TO_PION_RATIO_V1 — the framing target of BEFORE 2026-09-20: "a Mongoose is 1.75
 * pawn long", the middle of the 1.5-2 range originally requested. It no longer decides
 * anything; it is kept because the SCALE FLOOR is defined relative to it, and a floor whose
 * origin cannot be reconstituted is no longer verifiable.
 */
const MONGOOSE_TO_PAWN_RATIO_V1 = 1.75

/**
 * PX_PER_MM_FRAMING_V1 — THE OLD SCALE, in CSS pixels per world millimeter:
 * 0.01203125 px/mm. It is the former `VEHICLE_PX_PER_MM`, and it was applied whatever the
 * map.
 */
const PX_PER_MM_FRAMING_V1 = (PION_SCREEN_PX * MONGOOSE_TO_PAWN_RATIO_V1) / MONGOOSE_REFERENCE_LENGTH_MM

/**
 * VEHICLE_SCREEN_BUMP — THE +20% ASKED BY THE USER ON 2026-09-19, in a SINGLE literal.
 * It no longer applies to the sizes one by one: it applies to the FLOOR SCALE, which
 * propagates it to the eighteen families AND the two layer glyphs without any value being
 * recopied. A later revision of the framing changes THIS number, nothing else.
 */
export const VEHICLE_SCREEN_BUMP = 1.2

/**
 * PX_PAR_MM_MINIMUM_ECRAN — THE SCALE FLOOR: 0.0144375 px/mm, that is the old scale
 * enlarged by 20%. Under this floor, the map's scale no longer decides.
 *
 * THE SWITCHING SCALE IS WORTH 14.44 px/m, that is a scene 65.9 m wide in a 1 000 CSS px
 * container (margin 24). Measured on the baked documents: Flood Gulch (272.8 m, 3.49 px/m)
 * is far below — the floor is used there, and the render is exactly the old one +20%;
 * Snowbound (54.2 m, 17.56 px/m) is above — the map's scale is used there, and the vehicles
 * are bigger than the old +20%.
 */
export const PX_PAR_MM_MINIMUM_ECRAN = PX_PER_MM_FRAMING_V1 * VEHICLE_SCREEN_BUMP

/**
 * VEHICLE_SOFT_CEIL_PX — the SOFT ceiling, UNCHANGED (7 pawns, 61.60 px): beyond it, the
 * growth slows down as a square root instead of stopping flat — a very long vehicle stays
 * visibly bigger than a smaller one, but stops dominating the screen.
 *
 * IT DOES NOT BREAK THE INVARIANT "never smaller than before", and that is verifiable: the
 * compression is MONOTONICALLY increasing, so a bigger input always comes out bigger.
 * Measurement on Flood Gulch: the Pelican goes from 70.17 to 71.62 px, the Phantom from
 * 69.87 to 71.32.
 */
export const VEHICLE_SOFT_CEIL_PX = 7 * PION_SCREEN_PX

/**
 * VEHICLE_CEIL_CANVAS_RATIO — THE FRACTION OF THE CANVAS that a vehicle does not exceed
 * (v8 checks, 2026-10-21: "maximum vehicle size on a small screen"). The scale floor
 * enlarges the vehicles by 20% FOR EVERY CANVAS: on a phone, a 56 px Scorpion then weighs
 * more than a sixth of the width. The soft ceiling therefore follows the canvas when it is
 * small:
 *
 *     ceiling = min( VEHICLE_SOFT_CEIL_PX , 0.12 × canvas short side )   (never under 4 pawns)
 *
 * NO EFFECT ON A BIG SCREEN: the 61.6 px ceiling stays the ceiling as long as the canvas's
 * short side is at least 514 px (0.12 × 514 = 61.7). Below, only the longest vehicles are
 * compressed (same square-root compression as the soft ceiling); the short ones, for their
 * part, do not move, and the order of the sizes is kept.
 */
export const VEHICLE_CEIL_CANVAS_RATIO = 0.12

/** Floor of the canvas ceiling: four pawns — a tiny canvas does not reduce a vehicle to a point. */
export const VEHICLE_CEIL_MIN_PX = 4 * PION_SCREEN_PX

/**
 * vehicleCeilPx — the soft ceiling of a vehicle for a canvas whose SHORT SIDE is
 * `canvasMinSidePx` (CSS pixels). A canvas not yet measured (≤ 0, NaN) returns the
 * historical ceiling: one does not reduce anything on a measurement one does not have.
 */
export function vehicleCeilPx(canvasMinSidePx: number): number {
  if (!(canvasMinSidePx > 0)) return VEHICLE_SOFT_CEIL_PX
  return Math.min(
    VEHICLE_SOFT_CEIL_PX,
    Math.max(VEHICLE_CEIL_MIN_PX, VEHICLE_CEIL_CANVAS_RATIO * canvasMinSidePx),
  )
}

/**
 * VEHICLE_UNKNOWN_HALF_MM — the EQUIVALENT WORLD LENGTH of the half-diagonal of the diamond
 * of an UNRESOLVED chassis: the one that, at the OLD scale, gives back exactly its 3.40
 * historical px (a pawn's core). It is therefore worth 282.6 mm, and the diamond grows by
 * 20% at the minimum like everything else — 3.40 -> 4.08 px on a big map.
 *
 * WHY AN EQUIVALENCE RATHER THAN A MEASUREMENT: the diamond is precisely what one draws when
 * the chassis's family is UNKNOWN, hence when no world length exists. It says "an object is
 * there, one does not know which one", and a glyph of ignorance must not weigh as much as a
 * named vehicle — hence an equivalence calibrated on what it was worth, never on a chassis.
 */
const VEHICLE_UNKNOWN_HALF_MM = CORE_RADIUS / PX_PER_MM_FRAMING_V1

/**
 * VEHICLE_TURRET_HALF_MM — same equivalence for the half-side of the turret pictogram: the
 * one that gives back its 6.60 historical px (0.75 pawn) at the old scale, that is 548.5 mm.
 * 6.60 -> 7.92 px on a big map.
 *
 * A TURRET MUST READ AS A TERRAIN OBJECT, not as a player's pawn: it stays noticeably bigger
 * than the diamond of an unknown chassis, without reaching the size of a driven chassis —
 * and this ratio is now held AT EVERY SCALE, since the three follow the same one.
 */
const VEHICLE_TURRET_HALF_MM = (PION_SCREEN_PX * 0.75) / PX_PER_MM_FRAMING_V1

/**
 * VEHICLE_EDGE_FALLBACK_MM — the equivalent world length of the half-gauge that a vehicle
 * whose sprite or manifest is NOT YET LOADED lends to its label: the one that gives back its
 * 4.40 historical px (a half-pawn) at the old scale. 4.40 -> 5.28 px on a big map.
 */
const VEHICLE_EDGE_FALLBACK_MM = (PION_SCREEN_PX / 2) / PX_PER_MM_FRAMING_V1

/**
 * screenScalePxPerMm — THE EFFECTIVE SCALE of the layer: the map's, or the floor, the larger
 * of the two.
 *
 * `scalePxPerM` is the framing's scale (`scaleOf(view)`, CSS pixels per meter). A degenerate
 * framing — canvas not yet measured — returns the floor, never zero: an object whose position
 * is known is drawn, even before the scene is framed.
 */
export function screenScalePxPerMm(scalePxPerM: number): number {
  const mapScale = scalePxPerM > 0 ? scalePxPerM / 1000 : 0
  return Math.max(mapScale, PX_PAR_MM_MINIMUM_ECRAN)
}

/**
 * screenLengthPx — THE MODEL, in one function: a world length (millimeters) rendered at the
 * effective scale, soft ceiling applied. `ceilPx`: the ceiling (default `VEHICLE_SOFT_CEIL_PX`);
 * the vehicles pass it the one of their canvas (`vehicleCeilPx`).
 */
export function screenLengthPx(
  worldLengthMm: number,
  scalePxPerM: number,
  ceilPx: number = VEHICLE_SOFT_CEIL_PX,
): number {
  if (worldLengthMm <= 0) return 0
  const raw = worldLengthMm * screenScalePxPerMm(scalePxPerM)
  return raw <= ceilPx ? raw : ceilPx + Math.sqrt(raw - ceilPx)
}

/**
 * spriteWorldLengthMm — the WORLD length of a vehicle sprite, in millimeters, read in the
 * sprite × manifest PAIR: the native height of the PNG (nose up, so the height IS the length
 * axis) × the world millimeters per sprite pixel that the manifest declares for ITS family
 * (`static/vehicles-assets/halo_infinite/replay/index.json`, eighteen families with the
 * "valid" status, measured 2026-09-02 — Mongoose 1 280 mm, Warthog 2 220, Scorpion 3 880,
 * Pelican 11 220).
 *
 * THIS IS THE ONLY MEASURED WORLD LENGTH OF THE LAYER (see the header): the two glyphs have
 * only an EQUIVALENT one, and the replay's other families have none.
 */
export function spriteWorldLengthMm(naturalHeightPx: number, mmPerPx: number): number {
  if (naturalHeightPx <= 0 || mmPerPx <= 0) return 0
  return naturalHeightPx * mmPerPx
}

/** vehicleUnknownHalfPx — the half-diagonal of the diamond of an unresolved chassis, to scale. */
export function vehicleUnknownHalfPx(scalePxPerM: number): number {
  return screenLengthPx(VEHICLE_UNKNOWN_HALF_MM, scalePxPerM)
}

/** vehicleTurretHalfPx — the half-side of the turret pictogram, to scale. */
export function vehicleTurretHalfPx(scalePxPerM: number): number {
  return screenLengthPx(VEHICLE_TURRET_HALF_MM, scalePxPerM)
}

/** vehicleEdgeFallbackPx — the half-gauge of a vehicle whose sprite is not loaded. */
export function vehicleEdgeFallbackPx(scalePxPerM: number): number {
  return screenLengthPx(VEHICLE_EDGE_FALLBACK_MM, scalePxPerM)
}
