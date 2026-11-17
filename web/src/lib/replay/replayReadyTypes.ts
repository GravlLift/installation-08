// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * replayReadyTypes.ts — THE `*Ready` TYPES: the SHAPE of the replay document once past the
 * boundary, field by field, with the reason for each fill-in.
 *
 * WHY THIS FILE EXISTS: A MOVE, NOT A REWRITE. `replayNormalize.ts` crossed the 500-line
 * threshold (511) after the Assault layers arrived. The types leave it as-is,
 * without a line changed; `replayNormalize.ts` keeps THE FUNCTION — that is, the boundary
 * itself — and re-exports these types so its callers have nothing to change.
 *
 * THE BOUNDARY IS HERE FOR THE TYPE, OVER THERE FOR THE VALUE: this file says what rendering
 * has the RIGHT to read (no nullable array), `replayNormalize.ts` says how it is obtained.
 * The two are meant to be read together; the full doctrine is at the top of `replayNormalize.ts`.
 */
import type { ReplayContractIssue } from '@/lib/replay/replayDocumentSchema'
import type { ReplayFullRateFlightReady, ReplayFullRateReady } from '@/lib/replay/replayFullRate'
import { type ReplayScoreTimelineReady } from '@/lib/replay/scoreTimeline'
import type {
  ReplayDocument,
  ReplayFlagCarry,
  ReplayAmmoRead,
  ReplayGrenadeRead,
  ReplayObjectiveObjectLife,
  ReplayInventory,
  ReplayLoadout,
  ReplayPoint,
  ReplayProjectile,
  ReplayRosterEntry,
  ReplayShot,
  ReplaySurface,
  ReplayTrack,
  ReplayVehicleLabel,
  ReplayVehicleRide,
  ReplayVehicleTrack,
  ReplayWeaponPad,
  ReplayZoneState,
  ReplayIdentitySection,
} from '@/lib/api/types'

/** An oriented footprint vertex: Go's `[2]float32`. */
export type ReplayXY = [number, number]

/**
 * A shot past the boundary: `o` is filled in to 0. Absent from documents baked before
 * schema 116, and also from the JSON of a shot sitting right on its frame's boundary
 * (omitempty) — both read as "at the start of the frame".
 */
export type ReplayShotReady = Omit<ReplayShot, 'o'> & { o: number }

/** A projectile trajectory step: Go's `[3]float32`, i.e. [dt, x, y]. */
export type ReplayStep = [number, number, number]

/** Makes the `K` fields of `T` NON-NULLABLE (and present) — the contract's arrays. */
type Filled<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> }

/**
 * A track sample as RENDERING reads it: the contract's point, plus the CUT
 * (`cut`) the boundary places on the first ARRIVAL sample of a translocation
 * (`translocationCuts.ts`). A cut means "nothing between the previous point and this one": no
 * pawn glide, no trail segment. It differs from a gap (`g`) in that the player is
 * PRESENT and seen there — the pawn is therefore not faded.
 */
export type ReplayCutPoint = ReplayPoint & { cut?: true }

export type ReplayTrackReady = Omit<Filled<ReplayTrack, 'points'>, 'points' | 'fullRate'> & {
  points: ReplayCutPoint[]
  /** The life at the film's native rate, RE-READ (schema 109, `replayFullRate.ts`). Absent: older artifact. */
  fullRate?: ReplayFullRateReady
}
/** The coverage whose list of triggered fallbacks (schema 58) is filled in. */
export type ReplayCoverageReady = Filled<NonNullable<ReplayDocument['coverage']>, 'fallbacks'>
type ReplayLoadoutReady = Filled<ReplayLoadout, 'w' | 'k'>
export type ReplayInventoryReady = Filled<ReplayInventory, 'am' | 'g'>
export type ReplayGrenadeReadReady = Filled<ReplayGrenadeRead, 'g'>
export type ReplaySurfaceReady = Omit<ReplaySurface, 'poly'> & { poly: ReplayXY[] }
export type ReplayProjectileReady = Omit<ReplayProjectile, 'p'> & {
  p: ReplayStep[]
  /** The flight AT THE FILM'S RATE, RELUE (schema 127, `replayFullRate.ts`). Absent: older artifact. */
  fullRate?: ReplayFullRateFlightReady
  /** Where the projectile sits once it sticks (schema 128, `ReplayProjectileAttach`). Absent: it does not stick, or an older artifact. */
  attach?: ReplayProjectileAttach
}
/**
 * ReplayProjectileAttach — a projectile stuck to something (schema 128): from `fromFrame` until the
 * projectile's `detoT`, it sits on node `node` of the object of slot `parentSlot` (a player's biped slot,
 * or another object), at `pose`: its offset in that node's frame, Halo axes, world units. The node is the
 * render model's node index, the skin joint of the same rank in the Spartan GLB.
 */
export interface ReplayProjectileAttach {
  fromFrame: number
  parentSlot: number
  node: number
  pose: [number, number, number]
}
/**
 * ReplayRosterEntryReady — a roster entry whose PRESENCE is filled in (schema 69, batch
 * M2.4). Empty = the entry holds no seat at any frame, OR the artifact predates schema
 * 69 and publishes none at all — `seatLogic` tells the two apart at the document level
 * (`publishesPresences`), never entry by entry.
 */
export type ReplayRosterEntryReady = Filled<ReplayRosterEntry, 'presence'>
/**
 * ReplayWeaponPadReady — a pad whose TWO nested arrays are filled in.
 *
 * WHY ONE MORE TYPE WAS NEEDED. `_ExhaustiveList` only sees the document ROOT's nullable
 * arrays: it had indeed required `weaponPads`, and the boundary filled the top-level
 * array — but `spawns` and `presence`, also nullable, passed through unchanged. A pad
 * with no replicated spawn arrived at rendering with `spawns: null`, and `pad.spawns.map`
 * crashed at runtime. Same pattern as `tracks` and `structure` (2026-08-17 review
 * fix).
 *
 * `cycle` IS NOT FILLED IN, and that is not an oversight: it is not an array but a
 * measurement that may not exist (only 24 of 57 pads carry one). Filling it with an empty
 * object would invent a zero-second cycle — the absence is the data.
 */
export type ReplayWeaponPadReady = Filled<ReplayWeaponPad, 'spawns' | 'presence'>
/**
 * ReplayFlagCarryReady — a flag's life whose intervals are filled in.
 *
 * SAME PATTERN AS `weaponPads`: the top-level array and the NESTED array are both
 * nullable in the contract, and a flag arriving with `spans: null` would crash the
 * layer at runtime, not at compile time.
 */
export type ReplayFlagCarryReady = Omit<ReplayFlagCarry, 'spans'> & {
  spans: ReplayFlagSpanReady[]
}
/**
 * ReplayFlagSpanReady — a state interval whose RETURN GAUGE is filled in (schema 63).
 *
 * THIRD LEVEL, same pattern as `vehicles[].rides[].aim`: `returnProgress` is a nullable
 * array INSIDE a nested array. It is filled in EMPTY — an artifact predating 63, a state
 * that is not `dropped`, or an interval the film did not cover arrive without a gauge, and
 * the tooltip then shows no return line instead of crashing at runtime.
 */
export type ReplayFlagSpanReady = Filled<
  NonNullable<ReplayFlagCarry['spans']>[number],
  'returnProgress'
>
/**
 * ReplayObjectiveObjectReady — a free objective-object life, trajectory filled in.
 *
 * SAME PATTERN AS `flagCarries`: the top-level array and the NESTED array (`pts`) are both
 * nullable in the contract, and a life arriving with `pts: null` would crash the layer
 * at runtime, not at compile time.
 */
export type ReplayObjectiveObjectReady = Filled<ReplayObjectiveObjectLife, 'pts'>
/**
 * ReplayZoneStateReady — a zone's state whose intervals AND live gauge are filled in.
 *
 * SAME PATTERN AS `flagCarries` and `weaponPads`: the top-level array and the NESTED arrays
 * (`spans`, and `gauge` since schema 18) are all nullable in the contract, and a zone
 * arriving with `spans: null` would crash the layer at runtime, not at compile time.
 *
 * `gauge` FILLS IN EMPTY, and that is not inventing a value: for rendering, "schema <= 17
 * artifact" (the field does not exist), "series absent" (no ramp on this zone), and
 * "empty series" say the same thing — NO ARC. The static apex does not substitute for it: it
 * used to read as a gauge, and that is what schema 18 fixes (plan decision, batch C-ter).
 *
 * `gaugeRamps` (schema 64) FILLS IN EMPTY FOR THE SAME REASON, and the reading is the same one
 * level deeper: a ramp without `capturingTeam` is a ramp whose pusher the film does NOT
 * name (neutral, or no pusher channel elected on this zone) —, and rendering repaints it
 * neutral there, exactly as it does when the array is empty.
 */
export type ReplayZoneStateReady = Filled<ReplayZoneState, 'spans' | 'gauge' | 'gaugeRamps'>
/**
 * ReplayIdentityReady — THE IDENTITY REGISTRY whose three lists are filled in (schema 50).
 *
 * THE OBJECT, though, keeps the right to be ABSENT: an artifact predating schema 50 carries
 * none, and an empty object would read as "the registry was computed, it found nothing" — the
 * opposite of "nobody looked". Same regime as `scoreTimeline`.
 */
export type ReplayIdentityReady = Filled<
  ReplayIdentitySection,
  'players' | 'bipedSlots' | 'statborgSlots'
>
/**
 * ReplayVehicleTrackReady — a vehicle's life whose TWO nested arrays are filled in.
 *
 * SAME PATTERN AS `weaponPads`: `samples` (the trajectory) and `rides` (the occupancy
 * episodes) are nullable in the contract, and a vehicle arriving with `samples: null`
 * would crash the layer at runtime — not at compile time. `spawn` IS NOT filled in: it is
 * not an array but an optional object (absent when the creation record was not read), and an
 * empty object would invent a birth the film does not show.
 */
export type ReplayVehicleTrackReady = Omit<Filled<ReplayVehicleTrack, 'samples'>, 'rides'> & {
  rides: ReplayVehicleRideReady[]
  /** Life declared MAP SCENERY by the server (`doc.vehicleScenery.hidden`): never
   *  drawn. Absent = no scenery verdict for this life. */
  scenery?: boolean
}
/**
 * ReplayVehicleRideReady — an occupancy episode whose AIM SERIES is filled in (schema 39).
 *
 * THIRD FILL-IN LEVEL, and the document's first: `aim` is a nullable array nested
 * INSIDE a nested array. Filling it in here rather than letting it pass through keeps the
 * contract guard (`replayContract.test.ts`) at the same regime for the whole artifact — one
 * more nullable array, at any depth, must be filled in or justified, never forgotten.
 * The cost is negligible in practice: a handful of episodes per match, filled in once at load time.
 */
export type ReplayVehicleRideReady = Filled<ReplayVehicleRide, 'aim'>

/**
 * ReplayBombStatsReady — the Assault statistics block, its array filled in. The OBJECT stays
 * optional at the document level (see `ReplayDocumentReady.bombStats`); this type only says
 * this: if it is there, `players` is too, even if empty. `coverage`, though, is not an array and
 * does not get filled in — it is always written by the producer.
 */
export type ReplayBombStatsReady = Filled<NonNullable<ReplayDocument['bombStats']>, 'players'>

/** A continuous-fire burst, its silent passes filled in (schema 71). */
export type ReplayFireBurstReady = Omit<NonNullable<ReplayDocument['bursts']>[number], 'holes'> & {
  holes: NonNullable<NonNullable<ReplayDocument['bursts']>[number]['holes']>
}

/**
 * ReplayDocumentReady — the document as rendering has the right to read it: every
 * array is present, never null, and coordinates have regained their arity.
 */
export type ReplayDocumentReady = Omit<
  ReplayDocument,
  | 'abilities'
  | 'coverage'
  | 'abilityCharges'
  | 'abilityImpulses'
  | 'bombArmings'
  | 'bombCarries'
  | 'bombEvents'
  | 'bombStats'
  | 'bursts'
  | 'equipmentChanges'
  | 'equipmentEpisodes'
  | 'equipmentPlacements'
  | 'stances'
  | 'flagCarries'
  | 'geometry'
  | 'grappleLines'
  | 'groundWeapons'
  | 'grenadeLabels'
  | 'grenadeReads'
  | 'ammoReads'
  | 'grenades'
  | 'identity'
  | 'inventory'
  | 'knockbacks'
  | 'drawnWeapons'
  | 'damages'
  | 'killCauses'
  | 'actions'
  | 'carriedEquipment'
  | 'riftPoses'
  | 'loadouts'
  | 'neutralDeaths'
  | 'objectiveObjects'
  | 'objectives'
  | 'padPickups'
  | 'projectiles'
  | 'roster'
  | 'scoreTimeline'
  | 'shots'
  | 'skullCarries'
  | 'structure'
  | 'tracks'
  | 'translocations'
  | 'vehicles'
  | 'vehicleCycles'
  | 'vehicleLabels'
  | 'vipCrown'
  | 'pickups'
  | 'weaponChanges'
  | 'weaponPads'
  | 'zoneStates'
> & {
  abilities: NonNullable<ReplayDocument['abilities']>
  /**
   * THE COVERAGE, whose list of FALLBACKS is filled in (schema 58).
   *
   * THE OBJECT KEEPS THE RIGHT TO BE ABSENT (same regime as `identity` and `scoreTimeline`): an
   * artifact without coverage is not an artifact whose coverage would be empty. Its `fallbacks`
   * array, though, is filled in — a document that owes NOTHING to a fallback and a document
   * nobody counted the fallbacks for then read the same on the rendering side, which is correct:
   * the distinction lives in the schema version, not in the layer.
   */
  coverage?: ReplayCoverageReady
  /**
   * THE ABILITY IMPULSES (schema 38): a FLAT entry per gesture — (t, slot, family) —
   * the MEASURED use of the thruster, dated by the `tag == 1` body of the i57/i59 film
   * components (the same one whose tag 3 carries the grapple) and ATTRIBUTED by the ability
   * rank read in the SAME LIFE and earlier. No speed threshold, no heuristic.
   *
   * THIS LAYER DOES NOT COVER EVERY EQUIPMENT: only the families the title declares
   * MEASURED enter it (today the thruster, and only it — the repulsor is NOT in this
   * channel, measured negative). `coverage.abilityImpulses.otherFamily` counts what is
   * discarded. Empty = artifact predating schema 38, film without a thruster, or an
   * unclassified palette — `coverage.abilityImpulses` tells the three apart.
   */
  abilityImpulses: NonNullable<ReplayDocument['abilityImpulses']>
  /**
   * THE REMAINING EQUIPMENT CHARGES (enriched schema 38, batch P5): a FLAT entry per
   * reading — (t, slot, family, charges) — the whole-charge counter transmitted ON
   * CHANGE by the i56 film component (high quartet of the 7-bit value, report R11)
   * and ATTRIBUTED by the ability rank of the SAME LIFE. These are READINGS, never a
   * derived usage count (one drop can be worth several uses), and nothing is transmitted
   * on pickup: the first reading is what remains AFTER the first use.
   *
   * THIS LAYER DOES NOT COVER EVERY EQUIPMENT: only the families the title declares
   * MEASURED enter it (the grapple and the thruster — the repulsor never arms i56,
   * measured negative). `coverage.abilityCharges` carries the full funnel. Empty = artifact
   * predating this batch, film without an armed reading, or an unclassified palette —
   * `coverage.abilityCharges` tells the three apart.
   */
  abilityCharges: NonNullable<ReplayDocument['abilityCharges']>
  /**
   * THE ASSAULT BOMB ARMING (schema 29): the start of the hold, the armed instant and the
   * fuse (fuseMs) — the countdown is drawn over [t, t + fuseMs] with no other data.
   * Empty = artifact predating schema 29, mode not covered (never One Bomb), or film
   * withheld by local confrontation — `coverage.bombArmings` tells the silences apart.
   */
  bombArmings: NonNullable<ReplayDocument['bombArmings']>
  /**
   * THE ASSAULT BOMB CARRY PERIODS (schema 30): a flat entry per period
   * (xuid, t0, t1, closed), the `skullCarries` pattern applied to the held-weapon channel. Empty =
   * artifact predating schema 30, or film outside the bomb family — `coverage.bombCarries`
   * tells the two apart. The carried bomb sits at its carrier's position; ON THE GROUND, rendering
   * derives it from the periods + tracks (the dropper's last point — no measured channel on the Go side).
   */
  bombCarries: NonNullable<ReplayDocument['bombCarries']>
  /**
   * THE DATED BOMB FACTS (schema 39): armings and explosions on the film's clock,
   * each with the RULE that named its actor (`actorSource`) when the join succeeded —
   * `carry_drop` (an observed gesture) or `carry_active` (an observed presence), two
   * levels of evidentiary strength a reader must not confuse. A fact WITHOUT an actor is still
   * published. Empty = artifact predating schema 39, or film outside the bomb family.
   */
  bombEvents: NonNullable<ReplayDocument['bombEvents']>
  /**
   * THE FIVE ASSAULT OBJECTIVE STATISTICS (schema 39) — the only block in the document that
   * is NOT a rendering layer: the match card serves them from the database, not from
   * the artifact. It travels here because they are computed at BAKE time (their four
   * sources only live at full fidelity at that instant), and the sync hook
   * persists them from the stored artifact.
   * THE OBJECT KEEPS THE RIGHT TO BE ABSENT (like `scoreTimeline`): absent = film outside the
   * bomb family, and an empty block would read as "read, found nothing" — not the same thing.
   * Its array, though, is filled in.
   */
  bombStats?: ReplayBombStatsReady
  /**
   * EQUIPMENT PICKUPS AND CONSUMPTIONS (schema 26): what HAPPENS to a player,
   * where `abilities` says what they CARRY. Dated to the millisecond then projected onto the
   * frame axis — this is the FINE-GRAINED source that refines `abilityAt` between two keyframes.
   * Empty = artifact predating schema 26, or film that carries none.
   */
  equipmentChanges: NonNullable<ReplayDocument['equipmentChanges']>
  equipmentEpisodes: NonNullable<ReplayDocument['equipmentEpisodes']>
  equipmentPlacements: NonNullable<ReplayDocument['equipmentPlacements']>
  /**
   * THE SPARTAN'S MOVEMENT STATES (schema 66): an interval per (life, kind) on the
   * frame axis — `crouch`, `slide`, `clamber` (all READ from a component), `sprint`
   * (the active-ability flag of `i57`), and `jumpDerived` (DERIVED from the integral of
   * `i1`'s vertical speed and recognized by its height, 0.85 m +/- 10%). Empty = artifact
   * predating schema 65, or film where no published life carries a transition;
   * `coverage.stances` tells the two apart, and `coverage.stances.jumpsDerived` counts jumps
   * separately.
   */
  stances: NonNullable<ReplayDocument['stances']>
  flagCarries: ReplayFlagCarryReady[]
  /**
   * INDIVIDUAL GROUND WEAPONS (schema 27): one entry per object that MOVED, with its
   * resting position and its OBSERVED display bounds. Empty = artifact predating schema
   * 26, or film where no weapon falls — `coverage.groundWeaponItems` tells the two apart.
   * PAD weapons stay in the `weaponPads` layer: publishing them here too would create two
   * truths for the same object.
   */
  groundWeapons: NonNullable<ReplayDocument['groundWeapons']>
  /**
   * WEAPON PICKUPS AND DROPS (schema 25): who, when, which weapon. Dated to the
   * millisecond — this is the FINE-GRAINED source that refines `loadoutAt` between two keyframes.
   * Empty = artifact predating schema 25, or film that carries none.
   */
  weaponChanges: NonNullable<ReplayDocument['weaponChanges']>
  /**
   * NATIVE PICKUPS (schema 30): the reel's `biped_pickup` event, dated to the
   * millisecond, ATTRIBUTED to its picker and carrying the object's catalog identifier.
   * It does not replace `weaponChanges` — that one qualifies (pickup, drop, swap) and knows
   * the weapon slot; this one sees pickups the other misses and names the picker.
   * Empty = artifact predating schema 30, or film that carries none
   * (`coverage.pickups` tells the two apart).
   */
  pickups: NonNullable<ReplayDocument['pickups']>
  /**
   * FREE OBJECTIVE OBJECTS (schema 21): where the Oddball skull sits when NOBODY
   * carries it. Empty = artifact predating schema 21, mode without a carried object, or film
   * that carries none — `coverage.objectiveObjects` tells the three apart.
   */
  objectiveObjects: ReplayObjectiveObjectReady[]
  geometry: NonNullable<ReplayDocument['geometry']>
  grappleLines: NonNullable<ReplayDocument['grappleLines']>
  grenadeLabels: NonNullable<ReplayDocument['grenadeLabels']>
  /**
   * THE CARRIED-GRENADES AXIS (schema 20), fed by TWO channels: keyframes
   * (~20 s) and delta packets (transmitted ON CHANGE). Each reading carries its `src`.
   * Empty = artifact predating schema 20, or film that does not transmit it: the card then
   * falls back to `inventory`, exactly as before.
   */
  grenadeReads: ReplayGrenadeReadReady[]
  /** Ammo readings per weapon slot (keyframes and deltas), sorted by instant. */
  ammoReads: ReplayAmmoRead[]
  grenades: NonNullable<ReplayDocument['grenades']>
  inventory: ReplayInventoryReady[]
  loadouts: ReplayLoadoutReady[]
  neutralDeaths: NonNullable<ReplayDocument['neutralDeaths']>
  objectives: NonNullable<ReplayDocument['objectives']>
  padPickups: NonNullable<ReplayDocument['padPickups']>
  projectiles: ReplayProjectileReady[]
  roster: ReplayRosterEntryReady[]
  /**
   * THE SCORE LAYER STAYS OPTIONAL, and that is the only honest way to write it: an
   * artifact from a schema earlier than 12 carries NONE, and an empty object would read as
   * "the film was read, there was no score". Absent means "nobody looked"; the
   * arrays it contains, though, are filled in — "no points" is a measurement, and reads on
   * the same grid as the tracks.
   */
  scoreTimeline?: ReplayScoreTimelineReady
  /**
   * THE IDENTITY REGISTRY (schema 50): what each name the document serves rests on.
   * Absent = artifact predating schema 50 — the client can then say nothing about
   * provenance, which is not the same thing as an empty registry.
   */
  identity?: ReplayIdentityReady
  shots: ReplayShotReady[]
  /**
   * CONTINUOUS-FIRE BURSTS (schema 71, batch M4b): the held trigger read from the
   * control view, placed on the firing weapon (`w`, `v` for a vehicle) with its tag's rate
   * (`rate`, and `rate0`/`ramp` for a weapon that ramps up its rate of fire). The client places
   * the hits on it (`model/fireBursts.ts`); the `holes` — filled in empty — are passes the
   * reading did not reach: silent. Empty = artifact predating schema 71, or film without a
   * read continuous fire — `coverage.continuousFire` tells the two apart.
   */
  bursts: ReplayFireBurstReady[]
  structure: ReplaySurfaceReady[]
  tracks: ReplayTrackReady[]
  /**
   * TRANSLOCATOR TELEPORTS (schema 38): a FLAT entry per jump — (t, slot)
   * and the ROUND TRIP (`fx/fy/fz` -> `tx/ty/tz`), both read from the film's type-117
   * EVENT — never a spatial threshold, never the `spent` flag (up to 16.5 s of measured
   * delay), never a track discontinuity. The six coordinates travel TOGETHER: present
   * together, or absent as a block (charge not read) — `coverage.translocations.positioned`
   * says how many jumps carry them. Empty = artifact predating schema 38, or film without a
   * translocator — `coverage.translocations` tells the two apart.
   */
  translocations: NonNullable<ReplayDocument['translocations']>
  /**
   * REPULSOR KNOCKBACKS (schema 94): a flat entry per player pushed — (t, slot), the author
   * `by` and the imposed velocity (`vx/vy/vz`, travel together), read from the film's message
   * pair. Empty = artifact predating schema 94, or film without a push —
   * `coverage.knockbacks` tells the two apart.
   */
  knockbacks: NonNullable<ReplayDocument['knockbacks']>
  /**
   * PLAYER ACTIONS (schema 107): the desired weapon slot on each change
   * (`drawnWeapons`), damage taken (`damages`) and each kill's cause (`killCauses`).
   * Empty = artifact predating schema 107, or nothing read — `coverage.playerActions` tells them apart.
   */
  drawnWeapons: NonNullable<ReplayDocument['drawnWeapons']>
  damages: NonNullable<ReplayDocument['damages']>
  killCauses: NonNullable<ReplayDocument['killCauses']>
  /**
   * PLAYER GESTURES (schema 108): reload, throw start, melee hit.
   * Empty = artifact predating schema 108, or nothing read — coverage.playerActions tells them apart.
   */
  actions: NonNullable<ReplayDocument['actions']>
  /**
   * CARRIED EQUIPMENT (schema 95): per carried object (carrier, rank, pickup, end), the energy read and the
   * uses remaining (game rule, once the family's cost is established), activations, and the
   * spawned objects it tracks (`tracked`: spawn, read removal — the repair field). Empty =
   * artifact predating schema 95 — `coverage.carriedEquipment` tells them apart.
   */
  carriedEquipment: Array<
    Omit<NonNullable<ReplayDocument['carriedEquipment']>[number], 'energy' | 'uses' | 'tracked'> & {
      energy: NonNullable<NonNullable<ReplayDocument['carriedEquipment']>[number]['energy']>
      uses: NonNullable<NonNullable<ReplayDocument['carriedEquipment']>[number]['uses']>
      tracked: NonNullable<NonNullable<ReplayDocument['carriedEquipment']>[number]['tracked']>
    }
  >
  /**
   * RIFT POSES (schema 95): the instant the carried translocator's energy drops to zero, its
   * activation, and the position (arrival of the next swap that follows) when it is read.
   */
  riftPoses: NonNullable<ReplayDocument['riftPoses']>
  /**
   * EACH VEHICLE'S LIFE for the match (schema 39): where it is born, its trajectory, its
   * occupancy episodes, up to which frame to display it. `end` is always `unknown` — never a
   * destruction (see `ReplayVehicleTrack`). Empty = artifact predating schema 39, or film without
   * a vehicle — `coverage.vehicles` tells the two apart. `vehicleLabels` (not filled in: it is a
   * table, not an array) names the families used and points to their sprite.
   */
  vehicles: ReplayVehicleTrackReady[]
  /**
   * THE RESPAWN CYCLE per vehicle spawn LOCATION (schema 63): median,
   * deciles, measured gaps, counted misses — the same shape and the same judge as `PadCycle`.
   * Only ESTABLISHED locations appear in it, so an EMPTY array does not mean "no
   * vehicle": `coverage.vehicles.cycleLocations` / `cycleGaps` / `cycleMissing` say which
   * silence it is. FLAT list, no nested array to fill in.
   */
  vehicleCycles: NonNullable<ReplayDocument['vehicleCycles']>
  /**
   * THE TABLE OF CHASSIS FAMILIES used by the document: sprite, tint, and — since
   * batch 1.9.9 — the NATURE of a family that is NOT a vehicle (`kind`) with its bilingual
   * label. Not filled in (it is a table, not an array): absent when no life resolves a
   * family.
   *
   * IT IS RE-DECLARED HERE, and this is the same process as `ReplayVehicleTrack.tEnd`: the
   * generated type (`generated.ts`) does not yet carry `kind`/`en`/`fr`, the schema number only
   * going up once, when the wave of batches touching the document merges. `ReplayVehicleLabel`
   * adds them by hand, tolerantly; without this line, the layer would read the generated
   * shape and never see the nature.
   */
  vehicleLabels?: Record<string, ReplayVehicleLabel>
  weaponPads: ReplayWeaponPadReady[]
  zoneStates: ReplayZoneStateReady[]
  /**
   * VIP CROWN CARRY PERIODS (schema 22): one entry per period, named by the
   * VIP's xuid. Empty = artifact predating schema 22, or film the caller did not recognize as
   * VIP — `coverage.vipCrown` tells the two apart. No nested array: the period is flat.
   */
  vipCrown: NonNullable<ReplayDocument['vipCrown']>
  /**
   * ODDBALL SKULL CARRY PERIODS (schema 23): one entry per period, named by the
   * carrier's xuid. Empty = artifact predating schema 23, or film the caller did not recognize as
   * Oddball — `coverage.skullCarries` tells the two apart. No nested array: the period is
   * flat. The FREE skull (`objectiveObjects`) remains the POSITION layer; this one is the CARRIER.
   */
  skullCarries: NonNullable<ReplayDocument['skullCarries']>
  /**
   * THE PRODUCER'S CURRENT VERSION (batch A, 2026-09-11): distinct from `schemaVersion`
   * (the one of the READ ARTIFACT, see `ReplayDocument.schemaVersion`). It does NOT come from the
   * body — `domain/replaydoc` on the Go side carries no version number (see its `doc.go`) — but
   * from the `X-Replay-Latest-Schema-Version` response header, placed here at the transport
   * boundary (`lib/replay/queries.ts`). Absent on a response whose header is missing (old
   * cache, a proxy that strips it): the admin badge then falls back to the read version alone.
   */
  latestSchemaVersion?: number
  /**
   * THE FIRST CONTRACT VIOLATION, if there is one (batch 0.B, 2026-09-13): set by
   * `validateReplayDocument` at the transport boundary (`lib/replay/queries.ts`), on the
   * document BEFORE normalization. Absent = the document respects the contract.
   *
   * IT CHANGES NO RENDERING, and that is deliberate: the replay already degrades
   * field by field, and a blank page would teach less than an incomplete replay. Its only
   * reader is the admin schema-version badge, which names it.
   */
  contractIssue?: ReplayContractIssue
}

/** ReplayVipPeriod — ONE crown carry period, as rendering reads it (flat). */
export type ReplayVipPeriod = NonNullable<ReplayDocument['vipCrown']>[number]

/** ReplaySkullCarry — ONE skull carry period, as rendering reads it (flat). */
export type ReplaySkullCarry = NonNullable<ReplayDocument['skullCarries']>[number]

/** ReplayBombCarry — ONE bomb carry period, as rendering reads it (flat). */
export type ReplayBombCarry = NonNullable<ReplayDocument['bombCarries']>[number]
