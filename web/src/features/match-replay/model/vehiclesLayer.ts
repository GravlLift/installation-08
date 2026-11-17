// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * vehiclesLayer.ts — THE VEHICLES on the replay map (schema 39): the geometry and the
 * rules, without a line of canvas.
 *
 * ON THE SCHEMA NUMBER. The vehicles work was written announcing "schema 29", then 30,
 * then 31, across its lots. NONE of these artifacts existed: the layer was delivered as
 * a single unit and the document went from 38 to 39. These numbers were corrected
 * everywhere on 2026-09-05 (adversarial branch review) — a reader looking for a schema
 * 30 artifact to understand a degradation would find nothing, and conclude it was a bug.
 *
 * WHAT THIS LAYER ASSERTS. An entry of `doc.vehicles` is THE LIFE OF A VEHICLE: where it
 * is born, its sampled trajectory with its heading, its occupation episodes (who is
 * aboard and when), and until which frame to display it. The end is a CENSUS BOUND —
 * `end` is TODAY always `unknown` on the document side, and in that case the sprite
 * clears SHARPLY at `t1max`, without any destruction effect.
 *
 * SINCE 2026-09-03 (schema 39, IN ADVANCE OF PHASE — cf. `ReplayVehicleTrack` in
 * `lib/api/types.ts`), THIS IS NO LONGER THE ONLY REGIME: when `end` publishes
 * `"destroyed"` with `tEnd` (`vehicleDestructionFrame`), the end becomes a PROOF
 * instead of a bound — the sprite stops at `tEnd` (which then takes authority over
 * `t1max`, cf. `vehicleVisibleAt`) and `vehiclesPaint.ts` anchors there the explosion
 * requested by the user ("the destruction and a UI effect are also needed"). NO current
 * artifact carries this regime — until the Go measures the destruction, this text
 * changes NOTHING on what is displayed.
 *
 * SIX PURE RESPONSIBILITIES, TESTABLE WITHOUT CANVAS: the REJECTION OF SCENERY
 * (`vehicleIsDecor`, `vehicleIsScenery` — the map scenery declared by the server —,
 * `vehicleIsHidden`, `vehicleCanEmbark`), the ORIENTATION (`vehicleHeadingAt`,
 * `vehicleScreenAngle`, `vehicleAimAngle`), the SIZE (`vehicleSpriteScale`, anchored on
 * the piece), the OCCUPATION (`vehicleActiveRides`, `vehicleDriverAt`, `vehicleColorAt`),
 * the EMBARKED PREDICATE (`buildEmbarkedPredicate`, consumed by
 * `replayMarkers.drawTracksLayer` to remove the piece of an occupant) and the
 * DESTRUCTION (`vehicleDestructionFrame`, `vehicleExplosionKindOf`). THE CANVAS STROKE
 * IS NEXT DOOR (`vehiclesPaint.ts`, extracted 2026-09-02 when the driver's cone made
 * this file cross the repo's size threshold): it only assembles these six answers image
 * by image.
 *
 * A SEVENTH IS NEXT DOOR TOO (`vehiclesAim.ts`, extracted 2026-09-03 for the same size
 * reason): THE MEASURED AIM OF EVERY OCCUPANT (schema 39, `vehicleOccupantAimAt`). It
 * rests on `vehicleAimAngle`/`vehicleHeadingAt` of this file — the chassis heading is
 * no longer the direction of the cone, it is only its FALLBACK.
 *
 * WHAT THIS LAYER REFUSES TO DRAW — THE UNPLAYABLE FAMILIES (user verdict of
 * 2026-09-02, after real viewing, amended 2026-09-24: the Falcon was removed). See
 * `FAMILLES_NON_JOUABLES`: they are SCENERY entities, not vehicles of the game, and
 * they must NEITHER draw, NOR name anyone, NOR make a piece disappear.
 *
 * ORIENTATION — THE SCREEN GAP CONSTANT (GATE C6). The samples carry a WORLD heading
 * (`VehicleSample.h`, `Point.h` convention: 0° = +X, 90° = +Y, `atan2(y,x)` sense), but
 * the sprites are drawn NOSE UP — that is nose toward the -Y LOCAL axis of the image,
 * never toward +X like the directional shapes of the shots layer (`muzzleFlash.ts`,
 * which only needs to flip the sign: `-h`). A "nose up" sprite therefore needs ONE
 * QUARTER TURN MORE than that inversion: the screen projection flips the world Y axis,
 * so the screen heading to ORIENT A NOSE-UP IMAGE is `(90° - h)`, converted to radians
 * for `ctx.rotate`. Verified by `vehiclesLayer.test.ts` on the four cardinal points
 * (east/north/west/south) and CROSS-CHECKED on real data (artifact `0d76e8f1`:
 * published heading 272.7° vs 273.2° recomputed on the movement, gap 0.5°). The
 * VISUAL proof in game remains gate D1 (user).
 *
 * SIZE — FRAMING DECISION OF THE PLAN (2026-09-02, user): proportional to the world
 * BETWEEN vehicles (sprite length in pixels × mm/px of the manifest), in FIXED SCREEN
 * pixels with respect to zoom (like the pieces), anchored on the Mongoose (≈ 1.5-2
 * pieces long). THE MANIFEST (`index.json`, served by lot A) GUARANTEES TODAY THE
 * SCALE OF THE WARTHOG/MONGOOSE FAMILIES ONLY — the other 12 carry the same value
 * awaiting a measured re-render (explicit note of the task of this lot): the rule
 * reads the manifest as is, and WILL BECOME RIGHT FOR EACH FAMILY when ITS value is,
 * without a code change here.
 */
import type { ReplayVehicleRide } from '@/lib/api/types'

import { screenLengthPx, spriteWorldLengthMm } from '@/lib/replay/screenSizes'
import { lastIndexAt, positionAt, type XY } from '../../../lib/replay/replayLogic'
import type { ReplayVehicleTrackReady } from '../../../lib/replay/replayNormalize'
import { covers } from './replaySpans'
import { headingTowardNext } from './headingInterp'

// --- REJECTED FAMILIES ------------------------------------------------------------------------

/**
 * FAMILLES_NON_JOUABLES — the families this layer IGNORES ENTIRELY.
 *
 * SOURCE: user verdict of 2026-09-02 after real viewing of the replay ("on Behemoth,
 * falcons appear while the game had none of them"), cross-checked on artifact
 * `0d76e8f1` — the chassis `0x0000254b` is indeed the Falcon model, but it is carried by
 * SCENERY entities: average speed 0.3-0.8 m/s over their whole life (one covered
 * strictly no distance), alive from the beginning to the end of the film. The Pelican,
 * the Phantom and the Skiff are NOT drivable in Halo Infinite multiplayer: an entity
 * carrying their model is a staging element, never a vehicle of the game.
 *
 * THE FALCON LEFT IT ON 2026-09-24 (user decision: "the Pelicans are always scenery;
 * the Falcon depends"). It is drivable in multiplayer, with its gunners: its family no
 * longer refuses its occupants, and it draws like any drivable vehicle (same output on
 * the Go side, `vehicleFamillesNonPilotables`). What now holds the FALSE episodes of
 * 2026-09-02 is the server, by two general guards: the boarding of a reported gunner is
 * seen near the carrier, and an episode ends at the birth of the next life of the same
 * player (`film/replay/vehicle_turrets_boarding.go`, `vehicle_rides_next_life.go`).
 *
 * THE SCENERY OF THE FALCON IS DECIDED BY THE SERVER (`vehicleIsScenery`, 2026-10-02).
 * The Falcons of Behemoth in Super Fiesta born at the south bounds climb alone by
 * 2.2 m and remain in hovering flight, never occupied: the general rule "held in the
 * air empty" masks them. Those of the north bounds, set on the ground, remain drawn
 * (in the park, 9 lives are driven on them).
 *
 * THIS IS NOT A CORRECTION OF THE DOCUMENT. The server is right to publish these
 * lives: it catalogs what the film contains (archetype ti=40), and the chassis IS
 * that of a Falcon. It is the DISPLAY that must stay silent — hence a set kept here,
 * on the layer side, and not a Go filter.
 *
 * THREE CONSEQUENCES, ALL NECESSARY:
 *  1. NO DRAWING — no sprite, no fallback marker: scenery does not show itself like a
 *     vehicle (that was the initial complaint).
 *  2. NO NAME — occupant names are written only on real vehicles.
 *  3. NO PARTICIPATION IN THE EMBARKED PREDICATE — and that was the gravest damage:
 *     the "position gap" binder lent ONE of these props THREE occupation episodes
 *     (slot 771 of the cited artifact, a Falcon), which HID the piece of the players
 *     passing by. A false embarking erases a very real player from the map; the
 *     refusal must therefore carry here first.
 */
export const FAMILLES_NON_JOUABLES: ReadonlySet<string> = new Set([
  'pelican',
  'phantom',
  'skiff',
])

/**
 * vehicleIsDecor — true when the family is refused by `FAMILLES_NON_JOUABLES`. An
 * EMPTY family (unresolved chassis) is NOT scenery: it is not known what it is, and
 * the neutral diamond keeps saying it.
 */
export function vehicleIsDecor(family: string | undefined): boolean {
  return family !== undefined && FAMILLES_NON_JOUABLES.has(family)
}

/**
 * vehicleIsScenery — true when the SERVER declared the life MAP SCENERY VEHICLE
 * (`doc.vehicleScenery.hidden`, set on request — lot M7 of the replay feedback,
 * 2026-09-24; folded on each life into `track.scenery` by `normalizeReplayDocument`).
 *
 * THE RULE LIVES ON THE GO SIDE (`internal/service/replay_vehicle_scenery_rule.go`;
 * the form published in `film/replay/vehicle_scenery.go`), NO LONGER HERE. It left
 * this file by its own removal criterion (lot L1.3: "when the producer publishes the
 * map scenery itself, this predicate reads that marker and its conditions disappear
 * from here"), because the user decision of 2026-09-24 adds to it a condition the
 * client cannot read: the life must be SET by the map (a single sample, at its birth
 * on frame 0, alive until the end of the film, no occupant) AND OUTSIDE THE PLAYABLE
 * ZONE — the walkable matter of the published map floor, in plan, and the ground
 * trodden by the match (the lowest altitude where a player stayed), in height. On
 * Behemoth, Mongoose set in the play area that no one touches therefore remain drawn.
 *
 * The film replicates the PLACEMENT of the scenery before the origin of the match
 * (7 to 117 records, probe C2); the publication keeps only one sample of it, reduced
 * to the birth: that is what the rule reads.
 *
 * A SECOND RULE, ALSO ON THE GO SIDE (2026-10-02,
 * `replay_vehicle_scenery_aloft.go`): a life that no one occupies and that never
 * comes down to the height of its birth but only stays at least 1.2 m above it,
 * without moving more than 8 m from it, is held in the air by the map — that is the
 * Falcon of the south bounds of Behemoth in Super Fiesta (reason
 * `aloft_unoccupied`).
 *
 * Verdict absent (no scenery life, document served without this layer): nothing is
 * masked. A map without a known zone masks nothing by placement; the server counts
 * that fallback (`vehicleScenery.zoneUnknown`); the client never guesses it.
 */
export function vehicleIsScenery(track: ReplayVehicleTrackReady): boolean {
  return track.scenery === true
}

/**
 * vehicleIsHidden — the life does not show itself: unplayable family
 * (`vehicleIsDecor`) OR map scenery vehicle (`vehicleIsScenery`). The only predicate
 * of the DRAWING and of the availability of the layer; embarking re-takes it through
 * `vehicleCanEmbark`.
 */
export function vehicleIsHidden(track: ReplayVehicleTrackReady): boolean {
  return vehicleIsDecor(track.family) || vehicleIsScenery(track) || vehicleIsMountedPart(track)
}

/**
 * VEHICLE_PART_TURRET — the only value of `track.part` (schema 69, on the Go side:
 * `VehiclePartTurret`, `film/replay/vehicle_turrets.go`). Named for the same reason as
 * `VEHICLE_END_DESTROYED`.
 */
export const VEHICLE_PART_TURRET = 'turret'

/**
 * vehicleIsMountedPart — true when the life is a MOUNTED PART (turret of the Warthog,
 * the Falcon, the Wraith, cannon of the Scorpion): an object the film creates
 * separately but that does not move on its own — it has no position sample, and
 * drawing it would leave it at its BIRTH while its vehicle rolls (median 44.7 m in
 * the park, feedback of 2026-09-23). USER DECISION Q12: the gunner is drawn ON the
 * carrier vehicle, without a separate turret marker. The server already reported its
 * occupants and placed its shots on the carrier (`carrier`): the part no longer
 * draws, embarks no one, and does not count in the availability of the layer.
 */
export function vehicleIsMountedPart(track: ReplayVehicleTrackReady): boolean {
  return track.part === VEHICLE_PART_TURRET
}

/**
 * vehicleSpriteFamily — the family from which the SPRITE is drawn: the VARIANT when
 * the document names it (schema 69: `rockethog` by its turret, `gungoose` by its
 * weapon), the family otherwise. The family, for its part, keeps everything else
 * (engine, explosion, weapon class) — a variant is not another vehicle.
 */
export function vehicleSpriteFamily(track: Pick<ReplayVehicleTrackReady, 'family' | 'variant'>): string | undefined {
  return track.variant || track.family
}

// --- MAP ELEMENTS (schema 1.9.9 — IN ADVANCE OF PHASE, cf. ReplayVehicleLabel) ------------

/**
 * VEHICLE_KIND_MAP_ELEMENT — THE ONLY value of `vehicleLabels[family].kind` this
 * layer handles, and it means: **this is not a vehicle of the game, it is an object
 * of the map**. Named rather than sown as a literal, same reason as
 * `VEHICLE_END_DESTROYED`.
 *
 * IT IS NOT CONFUSED WITH `FAMILLES_NON_JOUABLES`, AND THE DIFFERENCE IS THE POINT OF
 * THE LOT. The scenery (Pelican, Phantom, Skiff) does NOT draw: that was the user
 * complaint of 2026-09-02, scripted transports that passed for vehicles of the game.
 * A map element, FOR ITS PART, DRAWS — user decision of 2026-09-14: "these are
 * elements of the map". What it does not do is carry an occupant or pass for an
 * unresolved chassis.
 */
export const VEHICLE_KIND_MAP_ELEMENT = 'map_element'

/**
 * VehicleMapElementGlyph — THE PICTOGRAM of a map element. One family, one shape:
 * the drawing must say WHAT the object is, not just "something is there" (that is
 * all the neutral diamond said, and that is what the user saw as a missing image).
 */
export type VehicleMapElementGlyph = 'turret'

/**
 * VEHICLE_MAP_ELEMENT_RENDER — THE TABLE BY FAMILY, the only entry point of the
 * rendering of map elements. Same conventions as `PLACEMENT_RENDER`
 * (equipmentPlacementsLayer.ts): the keys are the STABLE identifiers published by
 * the document (`family`), never labels.
 *
 * AN ABSENT FAMILY HAS NO DECIDED SHAPE: the layer then falls back on the neutral
 * marker, which stays honest ("an object is there, it is not known which one"). What
 * is forbidden is the neutral marker on a family the title HAS qualified and this
 * table names.
 */
export const VEHICLE_MAP_ELEMENT_RENDER: Readonly<Record<string, VehicleMapElementGlyph>> = {
  // THE BANISHED AUTOMATIC TURRET (chassis `0x038df01a`): nine immobile instances on
  // `bfecd02b`, one per entry of the play zone, alive the whole match. The user wants
  // to see them ("these are elements of the map") and owns no asset for them: the
  // pictogram holds the place until the day one is provided, and that day only the
  // assets table changes (`static/vehicles-assets/{slug}/replay/index.json` +
  // `sprite = true` in `replay_labels.toml`) — not a line here.
  tourelle_auto_bannie: 'turret',
  // THE FIXED TURRET (chassis `0x3a8060e2`, replay feedback lot M6.2, 2026-09-24):
  // the gatling / mortar turrets of Takamanohara, which the players OCCUPY. Same
  // pictogram for lack of an asset; its nature (`fixed_turret`) leaves it embark
  // its occupant.
  tourelle_fixe: 'turret',
}

/**
 * VEHICLE_KIND_FIXED_TURRET — the published nature of a FIXED TURRET set by the map
 * and OCCUPIED by a player (on the Go side:
 * `mappings.VehicleFamilyKindFixedTurret`, lot M6.2 of 2026-09-24). It DRAWS like a
 * map element (the pictogram of its family), but it EMBARKS: it is the gunning
 * station of a player, not an inert object.
 */
export const VEHICLE_KIND_FIXED_TURRET = 'fixed_turret'

/**
 * VEHICLE_GLYPH_KINDS — the published natures that draw by the pictogram of their
 * family (`VEHICLE_MAP_ELEMENT_RENDER`) when no asset is served. Embarking, for its
 * part, stays decided by the `map_element` nature alone (`vehicleCanEmbark`).
 */
const VEHICLE_GLYPH_KINDS: ReadonlySet<string> = new Set([
  VEHICLE_KIND_MAP_ELEMENT,
  VEHICLE_KIND_FIXED_TURRET,
])

/**
 * vehicleMapElementGlyph — the pictogram to draw for this family, or `null`.
 *
 * TWO CONDITIONS, BOTH NECESSARY: the DOCUMENT must say the family is a map element
 * (`kind`, set by the server from the title manifest) AND this table must know it a
 * shape. The document alone is not enough — it cannot draw; the table alone neither —
 * it would assert a nature the server did not publish.
 */
export function vehicleMapElementGlyph(
  family: string | undefined,
  kind: string | undefined,
): VehicleMapElementGlyph | null {
  if (family === undefined || kind === undefined || !VEHICLE_GLYPH_KINDS.has(kind)) return null
  return VEHICLE_MAP_ELEMENT_RENDER[family] ?? null
}

/**
 * VehiclePaintInks — the two "no occupant" inks the tint rule discriminates.
 * `neutral` is that of a vehicle without a resolved occupant; `mapElement` that of
 * a map object (gray "no camp"). Both are resolved by the caller (color-tokens rule).
 */
export interface VehiclePaintInks {
  neutral: string
  mapElement: string
}

/** vehicleIsMapElement — does the published nature say "map object, unplayable"? */
export function vehicleIsMapElement(kind: string | undefined): boolean {
  return kind === VEHICLE_KIND_MAP_ELEMENT
}

/**
 * vehiclePaintColor — THE INK OF A VEHICLE AT `frame`, the single rule of this layer.
 *
 * A MAP ELEMENT (nature `map_element`, unplayable) is painted with the gray ink
 * `inks.mapElement`, without condition: it has no camp, and the neutral blue of the
 * ally would make it pass for an allied gunning station. EVERY OTHER vehicle takes
 * the color of its occupant (`vehicleColorAt`) and, failing that, `inks.neutral` —
 * the fixed turret, playable, included.
 */
export function vehiclePaintColor(
  track: ReplayVehicleTrackReady,
  frame: number,
  kind: string | undefined,
  ink: VehicleInk,
  inks: VehiclePaintInks,
): string {
  if (vehicleIsMapElement(kind)) return inks.mapElement
  return vehicleColorAt(track, frame, ink) ?? inks.neutral
}

// --- DESTRUCTION (schema 39 — IN ADVANCE OF PHASE, cf. ReplayVehicleTrack in types.ts) --------

/**
 * VEHICLE_END_DESTROYED — THE ONLY value of `track.end` this layer treats as a proof of
 * destruction. Named rather than sown as a literal (same reason as
 * `FAMILLES_NON_JOUABLES`): a single place to change if the Go picks another word.
 * Every OTHER value — `"unknown"` today, systematically — is read as "end not
 * affirmed": nothing draws.
 */
export const VEHICLE_END_DESTROYED = 'destroyed'

/**
 * vehicleDestructionFrame — the frame index of the destruction, or `null` when it is
 * NOT established. TWO CONDITIONS, BOTH NECESSARY (explicit request of the lot): `end`
 * must equal `VEHICLE_END_DESTROYED` AND `tEnd` must be published. A document asserting
 * one without the other (partial Go measurement) triggers nothing rather than guessing
 * a frame — the same caution as `vehiclePositionAt` refusing to invent a position.
 *
 * AS LONG AS THE GO PUBLISHES ONLY `end: "unknown"` (the current state of EVERY
 * existing artifact), this function returns `null` ALWAYS: zero visible change, and
 * that is the expected behavior of this lot — it makes the layer READY, it does not
 * invent the measurement.
 */
export function vehicleDestructionFrame(track: ReplayVehicleTrackReady): number | null {
  if (track.end !== VEHICLE_END_DESTROYED) return null
  return track.tEnd ?? null
}

/**
 * VehicleExplosionKind — THE TWO STAGINGS REQUESTED BY THE USER, word for word:
 * "plasma explosion and 'normal' explosion for the human vehicles".
 */
export type VehicleExplosionKind = 'plasma' | 'normal'

/**
 * VEHICLE_PLASMA_FAMILIES — FACTION -> EFFECT TABLE (named and commented, as requested):
 * the Banished chassis (the Covenant of Halo Infinite multiplayer), energy-based,
 * receive the PLASMA, RED explosion (`plasma_hot`, cf. `drawVehicleDestructionFx`) —
 * Ghost, Banshee, Wraith, Chopper, Shade, no exception: the faction decides the color,
 * not the chassis. The Banished without rendering (Phantom, Skiff:
 * `FAMILLES_NON_JOUABLES`) never explode on screen. The Shade (mounted Covenant
 * turret, immobile — cf. `VEHICLE_DEFAULT_HEADING_DEG`) stays a Covenant energy even
 * without ever moving, it therefore enters here and not in the human table below.
 *
 * EVERY OTHER FAMILY — including EMPTY (unresolved chassis) or unknown to this layer —
 * RECEIVES THE NORMAL FALLBACK (`vehicleExplosionKindOf`): that is a NEUTRAL and
 * documented choice, never a default Covenant assertion. The human list
 * (`VEHICLE_HUMAN_FAMILIES`) is therefore not consulted by the code — it exists ONLY
 * to document the coverage of the user request and serves as fixture to the tests
 * (vehiclesLayer.test.ts / vehiclesPaint.test.ts).
 */
export const VEHICLE_PLASMA_FAMILIES: ReadonlySet<string> = new Set([
  'ghost',
  'banshee',
  'wraith',
  'chopper',
  'shade',
])

/**
 * VEHICLE_HUMAN_FAMILIES — THE UNSC/HUMAN CHASSIS explicitly cited by the user request:
 * they receive the NORMAL explosion, but through the FALLBACK ("any family that is not
 * in `VEHICLE_PLASMA_FAMILIES`"), not through a second table consulted at rendering —
 * two active tables could have diverged (a family absent from both, for example a
 * future chassis) without any test seeing it.
 */
export const VEHICLE_HUMAN_FAMILIES: ReadonlySet<string> = new Set([
  'warthog',
  'rockethog',
  'warthog_gauss',
  'razorback',
  'mongoose',
  'gungoose',
  'scorpion',
  'wasp',
  'tourelle_montee',
])

/**
 * FAMILLES_ARME_FIXE — THE CHASSIS WHOSE WEAPON IS RIGID WITH THE BODY, and whose nose
 * therefore follows what the DRIVER aims.
 *
 * THE DECISION IS THE USER'S (2026-09-20): « le châssis s'oriente là où l'ARME pointe »
 * [the chassis orients where the WEAPON points]. It settles a problem the
 * measurement closed in the other direction — lot 5.2-B REFUTED the film's proper
 * orientation: the candidate component of `ti=40` (`i2`) is a UP vector, not a
 * forward one (medians of 54 to 105 degrees against the velocity). The chassis
 * heading will therefore not come from the film; it comes from the only MEASURED
 * direction the vehicle carries of its own, the aim of its driver (`rides[].aim`,
 * schema 31 — accuracy 0.2 to 0.5 degrees against the published reference, coverage
 * 35 attested episodes out of 35).
 *
 * WHY THESE TEN FAMILIES, AND NOT THE OTHERS. On a Ghost, a Banshee, a Wraith, a Wasp,
 * a Chopper, a Shade, a mounted or fixed turret, the weapon DOES NOT ROTATE relative
 * to the body: aiming is turning the vehicle, so the aim IS the front of the chassis.
 * The Mongoose and the Gungoose have no driver weapon but their front follows the
 * driver the same way.
 *
 * EVERY OTHER FAMILY IS TURRET, AND RECEIVES THE FALLBACK — that is the velocity, as
 * before: Warthog (and its Gauss and rockethog variants), Razorback, Scorpion,
 * Falcon, Pelican, Phantom, Skiff. On these chassis the shooter is not the pilot and
 * the weapon rotates on its own: lending the aim to the body would make it pivot at
 * every turret sweep.
 *
 * A SINGLE ACTIVE TABLE, and it is the same doctrine as `VEHICLE_PLASMA_FAMILIES`:
 * the turret list is WRITTEN above but is not consulted by the code — two active
 * tables could diverge (a family absent from both, for example a future chassis)
 * without any test seeing it. A family unknown to this layer therefore receives the
 * velocity, the neutral fallback.
 */
export const FAMILLES_ARME_FIXE: ReadonlySet<string> = new Set([
  'ghost',
  'banshee',
  'wraith',
  'wasp',
  'chopper',
  'shade',
  'tourelle_montee',
  // The FIXED TURRET of Takamanohara (lot M6.2, 2026-09-24): aiming is turning the turret.
  'tourelle_fixe',
  'mongoose',
  'gungoose',
])

/**
 * vehicleExplosionKindOf — THE FACTION OF THE DETONATION. `undefined`/`''` (unresolved
 * chassis) and every family absent from `VEHICLE_PLASMA_FAMILIES` (including a future
 * family, unknown to this layer) receive `'normal'` — the neutral fallback documented
 * above.
 */
export function vehicleExplosionKindOf(family: string | undefined): VehicleExplosionKind {
  return family !== undefined && VEHICLE_PLASMA_FAMILIES.has(family) ? 'plasma' : 'normal'
}

/**
 * vehicleCanEmbark — can a vehicle life make DISAPPEAR the piece of a player?
 *
 * TWO REFUSALS, FOR THE SAME REASON: a removed piece is a player no longer displayed,
 * and that is only justified if the vehicle carrying it is, for its part, displayed
 * and certain. The scenery is refused (cf. `FAMILLES_NON_JOUABLES`), and the
 * UNRESOLVED CHASSIS too: an occupation episode placed on an unknown family can point
 * to anything — including another prop — and the price of the error (a player erased)
 * is heavier than that of the abstention (one piece too many while driving).
 */
export function vehicleCanEmbark(track: ReplayVehicleTrackReady, kind?: string): boolean {
  if (track.family === undefined || track.family === '' || vehicleIsHidden(track)) return false
  // A THIRD REFUSAL SINCE 2026-09-16 (lot 1.9.9), for the SAME reason as the two
  // others: a MAP ELEMENT carries no one. The server already attributes it no episode
  // (`vehicleFamillesNonPilotables`, on the Go side); the guard is here TOO because
  // the price of the error is a real player erased from the map — exactly what the
  // three false episodes of the Falcon prop of `0d76e8f1` produced (2026-09-02, when
  // the Falcon was still refused by its family), and no single lock is left on that
  // path.
  return kind !== VEHICLE_KIND_MAP_ELEMENT
}

// --- ORIENTATION ----------------------------------------------------------------------------

/**
 * VEHICLE_DEFAULT_HEADING_DEG — the WORLD heading of a vehicle of which NO sample
 * carries a heading: neither dead (the Shade turret and the mounted turret never
 * translate — framing decision "TURRETS"), nor not-yet-mobile. Chosen at 90° (world
 * +Y) precisely because `vehicleScreenAngle(90) === 0`: NO additional rotation is
 * applied, and the sprite stays NOSE TOWARD THE TOP OF THE SCREEN as it is drawn —
 * exactly the rule requested.
 */
export const VEHICLE_DEFAULT_HEADING_DEG = 90

/**
 * vehicleHeadingAt — the WORLD heading of the vehicle at `frame`, in degrees, SAME
 * convention as `Point.h`.
 *
 * THREE REGIMES, IN THE ORDER OF THE FRAMING DECISION:
 *  1. IN MOVEMENT / STOPPED — the last sample known AT LATEST at `frame` that carries
 *     a heading (`h !== undefined`): the server already writes in it the direction of
 *     the velocity in movement, and REPORTS that same heading on the immobile samples
 *     that follow (cf. `VehicleSample.H`) — looking BACKWARD from `frame` therefore
 *     covers both at once. BETWEEN two samples, the heading TURNS toward the next one
 *     by the shortest angular path (`headingTowardNext`, v8 controls of 2026-10-21:
 *     held at the last sample, it made the sprite pivot in 100 ms jerks while its
 *     position slid); never across a replication silence, never over more than one
 *     second.
 *  2. BEFORE THE FIRST MOVEMENT — no BACKWARD sample carries a heading (the vehicle is
 *     still berthed): the heading of the FIRST mobile sample AHEAD, so that the
 *     vehicle is already oriented in the direction it is going to take rather than
 *     pivoting abruptly on the first movement.
 *  3. NEVER MOBILE — no sample, anywhere, carries a heading (vehicle never driven, or
 *     turret that does not translate): `VEHICLE_DEFAULT_HEADING_DEG`, nose upward.
 */
export function vehicleHeadingAt(track: ReplayVehicleTrackReady, frame: number): number {
  const samples = track.samples
  if (samples.length === 0) return VEHICLE_DEFAULT_HEADING_DEG
  const idx = lastIndexAt(samples, frame)
  for (let i = idx; i >= 0; i--) {
    if (samples[i].h !== undefined) return headingTowardNext(samples, i, frame)
  }
  for (let i = Math.max(idx + 1, 0); i < samples.length; i++) {
    const h = samples[i].h
    if (h !== undefined) return h
  }
  return VEHICLE_DEFAULT_HEADING_DEG
}

/**
 * vehicleScreenAngle — THE SCREEN GAP CONSTANT (gate C6): converts a WORLD heading to
 * CANVAS radians for a sprite drawn NOSE UP. See the file header for the full
 * derivation; the result fits in one line: `(90° − heading) → radians`.
 */
export function vehicleScreenAngle(headingDeg: number): number {
  return ((90 - headingDeg) * Math.PI) / 180
}

/**
 * vehicleAimAngle — THE SAME HEADING, but for the AIM CONE, and it is NOT the same
 * angle.
 *
 * `vehicleScreenAngle` orients an IMAGE drawn nose-up: it carries the quarter turn
 * that catches up with the sprite convention. The cone, for its part, is a shape
 * traced at the bare angle — like the cone of the pieces (`replayAimCone`: "world ->
 * canvas, the Y axis is inverted, so the angle is too"), it only needs the sign
 * inversion. Confusing the two would make the cone point 90° off the nose of the
 * vehicle: hence two named functions, and no shared constant.
 */
export function vehicleAimAngle(headingDeg: number): number {
  return (-headingDeg * Math.PI) / 180
}

// --- POSITION AND DISPLAY WINDOW ---------------------------------------------------------

/**
 * vehicleVisibleAt — `t1max` is a PROOF OF ABSENCE (cf. `document_vehicles.go`):
 * crossing it would assert a presence the film refutes. Framing decision: "SHARP
 * disappearance" — no fading between `t1`/`t1max` (unlike the ground weapons): the
 * vehicle is full up to `t1max` inclusive, nothing after.
 *
 * `tEnd` TAKES AUTHORITY OVER `t1max` WHEN THE DESTRUCTION IS ESTABLISHED (schema 39,
 * cf. `vehicleDestructionFrame`): the user request of the lot ("the destruction and a
 * UI effect are also needed") wants the SPRITE to stop at the exact moment of the
 * destruction, not at the last proof of presence of the census — the explosion
 * (`vehiclesPaint.ts`) then takes over at the SAME frame, on ITS OWN window,
 * independently of this visibility. As long as the document publishes only
 * `end: "unknown"` (today, always), `vehicleDestructionFrame` returns `null` and this
 * fallback on `t1max` is therefore EXACTLY the current behavior — zero visible
 * change.
 */
export function vehicleVisibleAt(track: ReplayVehicleTrackReady, frame: number): boolean {
  const lastFrame = vehicleDestructionFrame(track) ?? track.t1max
  return frame >= track.t0 && frame <= lastFrame
}

/**
 * vehiclePositionAt — the WORLD position at `frame`, or `null` (nothing to draw).
 *
 * `positionAt` (replayLogic.ts) already holds the interpolation between samples and
 * the holding of the last known position once the last sample is passed — THE SAME
 * logic as for a player trajectory, reused as is (`VehicleSample` has the same
 * subset of fields as `Point`). INCLUDING THE GAP (schema 69, lot M1 of the replay
 * feedback): a sample carrying `g > 0` follows a replication silence, and the
 * vehicle is HELD at its last position across it — it does not move during a
 * silence (fallback F-2 on the Go side). Before, an immobile Mongoose "went off on
 * its own" for 70 s toward a distant sample. It returns `null` BEFORE the first
 * sample: that is when the SPAWN answers (the birth, the only thing known as long
 * as no one has driven the vehicle). Neither: the creation record was not read AND
 * no sample exists — nothing draws, rather than inventing a position.
 */
export function vehiclePositionAt(track: ReplayVehicleTrackReady, frame: number): XY | null {
  const fromSamples = track.samples.length > 0 ? positionAt(track.samples, frame) : null
  if (fromSamples) return fromSamples
  return track.spawn ? { x: track.spawn.x, y: track.spawn.y } : null
}

// --- SIZE (real size if the scale allows it, screen minimum otherwise) --------------------
//
// THE MODEL AND ITS CONSTANTS LIVE IN `lib/replay/screenSizes.ts` — a single file for
// all the families drawn on the map, with the user decision of 2026-09-19, its
// measurements and the inventory of the families that have no world length. What
// follows only applies it to the vehicles, the only family whose world length IS
// measured.

/**
 * vehicleScreenLengthPx — the screen length (CSS pixels, before density `k`) of a
 * vehicle at the current framing scale.
 *
 * `naturalHeightPx` is the NATIVE height of the loaded sprite (nose-up: the height IS
 * the length axis of the vehicle); `mmPerPx` comes from the manifest (`index.json`)
 * for ITS family; the two together give the WORLD length. `scalePxPerM` is the
 * framing scale (`scaleOf(view)`).
 *
 * WHAT CHANGED ON 2026-09-20: this length now depends on the MAP SCALE, FLOORED at
 * the old framing +20% (`PX_PAR_MM_MINIMUM_ECRAN`). It was constant — the same on
 * screen on a 54 m map and on a 273 m one —, which made the vehicle too small on the
 * large ones (user feedback of 2026-09-19) and out of proportion on the small ones.
 * The floor applies to the SCALE, not to the size: the eighteen families cross it
 * TOGETHER and therefore stay proportional at any scale. Detail and measurements:
 * `lib/replay/screenSizes.ts`.
 *
 * `ceilPx`: the soft ceiling of the CANVAS (`vehicleCeilPx`, v8 controls of
 * 2026-10-21) — absent, the historical ceiling. The same ceiling must serve the
 * sprite, its explosion and the anchor of the weapons, otherwise a shot would leave
 * a sprite that does not have the size it assumes.
 */
export function vehicleScreenLengthPx(
  naturalHeightPx: number,
  mmPerPx: number,
  scalePxPerM: number,
  ceilPx?: number,
): number {
  if (naturalHeightPx <= 0 || mmPerPx <= 0) return 0
  return screenLengthPx(spriteWorldLengthMm(naturalHeightPx, mmPerPx), scalePxPerM, ceilPx)
}

/**
 * vehicleSpriteScale — the multiplicative factor to give to `drawRotatedSprite`
 * (before density `k`, which the caller applies in addition) so that the sprite
 * reaches `vehicleScreenLengthPx` on its height axis, aspect ratio preserved.
 */
export function vehicleSpriteScale(
  naturalHeightPx: number,
  mmPerPx: number,
  scalePxPerM: number,
  ceilPx?: number,
): number {
  if (naturalHeightPx <= 0) return 0
  return vehicleScreenLengthPx(naturalHeightPx, mmPerPx, scalePxPerM, ceilPx) / naturalHeightPx
}

// --- OCCUPATION -------------------------------------------------------------------------------

/**
 * vehicleActiveRides — the occupation episodes that cover `frame`, SORTED driver
 * first (seat 0) then ascending seats (framing decision C7). A NOT-READ seat (`seat`
 * absent) goes last, tied among themselves in the order of the document — never
 * before a known seat, whose place is, for its part, affirmed.
 */
export function vehicleActiveRides(
  track: ReplayVehicleTrackReady,
  frame: number,
): ReplayVehicleRide[] {
  return track.rides
    .filter((r) => covers(r, frame))
    .sort((a, b) => (a.seat ?? Number.POSITIVE_INFINITY) - (b.seat ?? Number.POSITIVE_INFINITY))
}

/**
 * vehicleDriverAt — THE DRIVER'S EPISODE at `frame` (seat 0), or `null`.
 *
 * ONLY SEAT 0 COUNTS, and a NOT-READ seat does not do: it is the driver, and only
 * the driver, whose CHASSIS HEADING approximates the direction of the gaze (user
 * decision of the work: « à l'arrêt on assume qu'il regarde devant lui ; en mouvement,
 * la direction du déplacement » [when stopped one assumes he is looking in front of
 * him; in motion, the direction of travel]).
 *
 * IT IS NO LONGER THE GATE OF THE CONE SINCE SCHEMA 31 (`vehicleOccupantAimAt`):
 * every occupant now carries THEIR OWN measured aim, including the gunner and the
 * passenger. This function remains the access to the driver for everything that
 * concerns HIM (vehicle tint, order of the names).
 */
export function vehicleDriverAt(
  track: ReplayVehicleTrackReady,
  frame: number,
): ReplayVehicleRide | null {
  return vehicleActiveRides(track, frame).find((r) => r.seat === 0) ?? null
}

/**
 * VehicleInk — THE TWO SOURCES OF THE COLOR OF AN OCCUPANT, in their priority order.
 *
 * `colorOfXuid` READS WHAT THE DOCUMENT AFFIRMS: the occupation episode carries
 * the xuid of its occupant, and that is what its server contract promises (« c'est
 * lui qui donne sa couleur au véhicule » [it is he who gives his color to the
 * vehicle], `document_vehicles.go`). `colorOfSlot` is the slot->player BRIDGE,
 * which answers "who occupies this slot on this image" — silent during the episode
 * when the biped trace has not been joined to a player. The bridge therefore stays
 * the FALLBACK, exactly as for the name.
 */
export interface VehicleInk {
  colorOfXuid: (xuid: string) => string | null
  colorOfSlot: (slot: number, frame: number) => string | null
}

/**
 * vehicleRideColor — the color of ONE occupant: the document's xuid first, the
 * bridge next.
 */
export function vehicleRideColor(
  ride: ReplayVehicleRide,
  frame: number,
  ink: VehicleInk,
): string | null {
  const byXuid = ride.xuid ? ink.colorOfXuid(ride.xuid) : null
  return byXuid ?? ink.colorOfSlot(ride.slot, frame)
}

/**
 * vehicleColorAt — the tint of the vehicle at `frame` (framing decision C7): the
 * color of the DRIVER (seat 0) when he is active and his identity resolved; IN THE
 * ABSENCE OF THAT, that of ANY active occupant whose identity is known; otherwise
 * `null` (neutral — the caller lays its theme ink there, this file knows no token,
 * cf. the color-tokens rule).
 */
export function vehicleColorAt(
  track: ReplayVehicleTrackReady,
  frame: number,
  ink: VehicleInk,
): string | null {
  const active = vehicleActiveRides(track, frame)
  const driver = active.find((r) => r.seat === 0)
  if (driver) {
    const c = vehicleRideColor(driver, frame, ink)
    if (c) return c
  }
  for (const r of active) {
    const c = vehicleRideColor(r, frame, ink)
    if (c) return c
  }
  return null
}

/**
 * buildEmbarkedPredicate — THE PREDICATE "EMBARKED AT T" (C7, user's explicit
 * reminder: MULTI-PASSENGERS). Groups ALL the occupation episodes of ALL the
 * vehicles of the document by biped slot ONCE, then answers in O(occupations of
 * this slot) — a few units per player over a whole match, never a sweep of all
 * vehicles per image.
 *
 * INDEPENDENT EXITS BY CONSTRUCTION: each `VehicleRide` carries ITS OWN `[t0,t1]`,
 * so two occupants of the SAME vehicle (driver + passengers, Warthog 3 seats,
 * Razorback 4...) each take their piece back at THEIR own exit frame, without
 * depending on one another — that is the very meaning of "several SIMULTANEOUS
 * episodes", not a property to recode here.
 *
 * ONLY THE LIVES THAT PASS `vehicleCanEmbark` ENTER (2026-09-02): neither
 * decoration nor unresolved chassis. An episode laid on one or the other would
 * erase a very real player from the map, without showing anything in their place
 * — that is exactly what the three false episodes of the Falcon prop of the
 * artifact `0d76e8f1` produced (2026-09-02; the Falcon is no longer refused since
 * 2026-09-24, it is the server's guards that hold these false episodes).
 */
export function buildEmbarkedPredicate(
  tracks: readonly ReplayVehicleTrackReady[],
  /** NATURE of a family (`vehicleLabels[family].kind`): a map element does not embark. */
  kindOf?: (family: string) => string | undefined,
): (slot: number, frame: number) => boolean {
  const bySlot = new Map<number, ReplayVehicleRide[]>()
  for (const track of tracks) {
    if (!vehicleCanEmbark(track, track.family ? kindOf?.(track.family) : undefined)) continue
    for (const ride of track.rides) {
      const list = bySlot.get(ride.slot)
      if (list) list.push(ride)
      else bySlot.set(ride.slot, [ride])
    }
  }
  return (slot, frame) => {
    const list = bySlot.get(slot)
    if (!list) return false
    return list.some((r) => covers(r, frame))
  }
}

