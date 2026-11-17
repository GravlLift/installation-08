// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * replayNormalize.ts — THE BOUNDARY of the replay document.
 *
 * WHY THIS FILE EXISTS. Since `ReplayDocument` comes from the generated contract and no
 * longer from a hand-written copy, its arrays are nullable: a nil Go slice
 * serializes to `null`, and the schema says so. That is the transport's truth, not
 * rendering's — for everything that draws, "no trace" and "the field is null" are the
 * same thing. Without a crossing point, this difference is paid in `?.` and `?? []` scattered
 * across every caller, and one is always missing.
 *
 * The document is therefore normalized ONCE, in the queryFn (see queries.ts), and the whole
 * `match-replay/` folder only handles `*Ready` types: no array is null there.
 *
 * WHAT NORMALIZATION ALSO FIXES — fixed lengths. Go writes
 * `Poly [][2]float32` and `P [][3]float32`: XY vertices and [dt, x, y] steps. JSON
 * Schema cannot express a fixed-length tuple, so the generated contract yields
 * `number[]`. The data itself IS a pair or a triple — it is the Go type that guarantees
 * it, not an assumption made here. Restoring it takes one assertion placed at this
 * single spot, rather than a cast per caller.
 *
 * THE `*Ready` TYPES — the normalized document's SHAPE, field by field — live in
 * `replayReadyTypes.ts` since 2026-09-05: a MOVE, without a line changed, to get back
 * under the 500-line threshold. This file keeps THE FUNCTION, and re-exports them.
 */
import { decodeFullRate, decodeFullRateFlight, type ReplayFullRateFlightRaw } from '@/lib/replay/replayFullRate'
import { normalizeScoreTimeline } from '@/lib/replay/scoreTimeline'
import { markTranslocationCuts } from '@/lib/replay/translocationCuts'
import type { ReplayDocument } from '@/lib/api/types'

import type { ReplayDocumentReady, ReplayProjectileAttach, ReplayStep, ReplayXY } from './replayReadyTypes'

/**
 * The grid step of a document that does not publish `frameIntervalMs`: the producer's own
 * (`DefaultFrameIntervalMS`, `libs/film/replay/build.go`).
 */
const DEFAULT_GRID_STEP_MS = 100

/**
 * THE `*Ready` TYPES ARE RE-EXPORTED HERE, and this is not a courtesy barrel: they live
 * in `replayReadyTypes.ts` since the 2026-09-05 split (the 500-line threshold), and the
 * boundary must stay ONE single module for its ~140 callers — moving a file is not
 * paid for by rewriting imports everywhere.
 */
export type {
  ReplayBombCarry,
  ReplayBombStatsReady,
  ReplayDocumentReady,
  ReplayFireBurstReady,
  ReplayFlagCarryReady,
  ReplayGrenadeReadReady,
  ReplayInventoryReady,
  ReplayObjectiveObjectReady,
  ReplayProjectileReady,
  ReplayRosterEntryReady,
  ReplaySkullCarry,
  ReplaySurfaceReady,
  ReplayTrackReady,
  ReplayVehicleRideReady,
  ReplayVehicleTrackReady,
  ReplayVipPeriod,
  ReplayWeaponPadReady,
  ReplayZoneStateReady,
} from './replayReadyTypes'

/**
 * normalizeReplayDocument fills in the missing arrays and restores coordinate arity.
 *
 * No value is invented: a null or absent array becomes empty, which is
 * exactly what the producer meant. Objects are only shallow-copied
 * — trajectory points, which make up the bulk of the document, are never duplicated.
 *
 * TWO QUESTIONS, TWO FIELDS, SINCE SCHEMA 62 — and this is what the comments below now
 * name both of. "WAS this layer PRODUCED?" is read in `layers[name]`:
 * entry present = the pass ran (under the named revision), entry absent = it did not
 * run (a closed mode guard, a scan that did not complete). "What did the reading COST?"
 * is read in `coverage.X`: what was seen, attached, lost. Before 62 the first question was
 * deduced from the second — a join between an absent array and a coverage block, which
 * required knowing the map of blocks (and `coverage.groundWeapons` measures `padPickups`,
 * `coverage.zones` measures `zoneStates`: the two naming schemes do not match).
 *
 * THE `layers` OBJECT ITSELF MAY BE ABSENT (artifact predating 62): it is `schemaVersion`
 * that decides, and `layerPresent` (features/match-replay/model) carries this reading in one place.
 */
export function normalizeReplayDocument(raw: ReplayDocument): ReplayDocumentReady {
  const sceneryLives = new Set((raw.vehicleScenery?.hidden ?? []).map((h) => vehicleLifeKey(h.slot, h.gen)))
  return {
    ...raw,
    // The ABILITY reading layer (schema 6). It replaces `Inventory.a`, removed the
    // same day: that one carried `rank - 16` (the keyframe channel only sees 16..23),
    // this layer carries the FULL rank, and each reading says which channel it came
    // through. Absent = no reading, the card shows the inventory without a named ability.
    abilities: raw.abilities ?? [],
    // THE ASSAULT BOMB ARMING (schema 29): hold, armed instant, fuse. Absent =
    // artifact predating this, mode not covered, or layer withheld by local confrontation —
    // `layers[bombArmings]` / `coverage.bombArmings` tell the silences apart. No nested
    // array: the entry is flat.
    bombArmings: raw.bombArmings ?? [],
    // ASSAULT BOMB CARRY PERIODS (schema 30): a flat entry per period
    // (xuid, t0, t1, closed), the `skullCarries` pattern on the held-weapon channel.
    // Absent = artifact predating this, or film outside the bomb family — `layers[bombCarries]` /
    // `coverage.bombCarries` tell the two apart.
    bombCarries: raw.bombCarries ?? [],
    // THE DATED BOMB FACTS (schema 39): armings and explosions. Absent = artifact
    // predating this, or film outside the bomb family.
    bombEvents: raw.bombEvents ?? [],
    // THE FIVE ASSAULT STATISTICS (schema 39). The OBJECT keeps the right to be absent — an
    // empty block would read as "read, found nothing" —, but its array is filled in.
    bombStats: raw.bombStats == null ? undefined : { ...raw.bombStats, players: raw.bombStats.players ?? [] },
    // EQUIPMENT PICKUPS AND CONSUMPTIONS (schema 26): the FINE-GRAINED dating source
    // for what a player carries. `abilities` remains the READING (what they carry, sampled);
    // this is the EVENT (what happens to them, dated). Absent = artifact predating this, or
    // film that carries none — `layers[equipmentChanges]` / `coverage.equipmentChanges` tell the two apart.
    equipmentChanges: raw.equipmentChanges ?? [],
    // WEAPON PICKUPS AND DROPS (schema 25): same relation to `loadouts` as above —
    // the keyframe reading says the STATE, these events date the CHANGE. Absent = artifact
    // predating this, or film that carries none (`layers[weaponChanges]` / `coverage.weaponChanges`
    // tell the two apart).
    weaponChanges: raw.weaponChanges ?? [],
    // NATIVE PICKUPS (schema 30): the event the reel writes itself, where
    // `weaponChanges` infers from a component change. Absent = artifact predating this, or film
    // that carries none (`layers[pickups]` / `coverage.pickups` tell the two apart).
    pickups: raw.pickups ?? [],
    // INDIVIDUAL GROUND WEAPONS (schema 27): one entry per object that moved, bounded by
    // OBSERVATION. Absent = artifact predating this, or film where no weapon falls —
    // `layers[groundWeapons]` / `coverage.groundWeaponItems` tell the two apart. No nested
    // array: the object is flat.
    groundWeapons: raw.groundWeapons ?? [],
    // Equipment ACTIVE-STATE episodes (schema 7): camouflage and overshield,
    // dated per life — the only two families whose state is MEASURED. Absent = no
    // published life carries one: cards stay sober, never a guessed effect.
    equipmentEpisodes: raw.equipmentEpisodes ?? [],
    // Equipment PLACEMENTS (schema 9): wall, sensor, and the world objects that
    // share the archetype — the latter published under the `other` family, with their
    // tag identifier and no name. Absent = the film carries none, OR its replication
    // block width was not decided: `layers[equipmentPlacements]` /
    // `coverage.placements.calibrated` tell the two apart, and that is why they are published.
    equipmentPlacements: raw.equipmentPlacements ?? [],
    // MOVEMENT STATES (schema 66): an interval per (life, kind) — `crouch`, `slide`,
    // `clamber`, `sprint` (READ) and `jumpDerived` (DERIVED from vertical speed). Absent = artifact
    // predating schema 65, OR film where no published life carries a transition:
    // `coverage.stances.scanned` and `.absent` tell the two apart, and that is why they
    // are published. One MORE kind appearing would be new data, not a label
    // to guess.
    stances: raw.stances ?? [],
    // CTF flags' life (schema 14): one entry per object, a sequence of state
    // intervals. Absent = the film is not recognized as CTF, or nobody read it for this
    // layer — `layers[flagCarries]` / `coverage.flagCarries` tell the two apart, and that is why
    // they are published.
    //
    // THE NESTED ARRAY IS ALSO FILLED IN (`spans`), as for `weaponPads` and `tracks`: the
    // contract declares it nullable, and a flag arriving with `spans: null` would crash
    // the layer at runtime — not at compile time.
    flagCarries: (raw.flagCarries ?? []).map((f) => ({
      ...f,
      spans: (f.spans ?? []).map((sp) => ({ ...sp, returnProgress: sp.returnProgress ?? [] })),
    })),
    // VIP CROWN CARRY PERIODS (schema 22): a flat entry per period
    // (xuid, t0, t1, closed), no nested array. Absent = artifact predating this, or film
    // not recognized as VIP — `layers[vipCrown]` / `coverage.vipCrown` tell the two apart, and that is
    // why they exist.
    vipCrown: raw.vipCrown ?? [],
    // ODDBALL SKULL CARRY PERIODS (schema 23): a flat entry per period
    // (xuid, t0, t1, closed), no nested array. Absent = artifact predating this, or film not
    // recognized as Oddball — `layers[skullCarries]` / `coverage.skullCarries` tell the two apart.
    skullCarries: raw.skullCarries ?? [],
    // TRANSLOCATOR TELEPORTS (schema 38): a flat entry per jump — (t, slot)
    // and the round trip, dated and positioned by the film's EVENT. Absent = artifact predating
    // schema 38, or film without a translocator — `layers[translocations]` /
    // `coverage.translocations` tell the two apart.
    translocations: raw.translocations ?? [],
    // REPULSOR KNOCKBACKS (schema 94): absent = artifact predating this, or film without a push —
    // `layers[knockbacks]` / `coverage.knockbacks` tell the two apart.
    knockbacks: raw.knockbacks ?? [],
    // PLAYER ACTIONS (schema 107): absent = artifact predating this, or nothing read —
    // `coverage.playerActions` tells them apart.
    drawnWeapons: raw.drawnWeapons ?? [],
    damages: raw.damages ?? [],
    killCauses: raw.killCauses ?? [],
    // PLAYER GESTURES (schema 108), same rule. Since schema 111 each action carries `ms`
    // (the millisecond instant since the grid's origin) and the jump read from the command
    // (`jump`) joins them; an older artifact only has the frame, and `ms` there is the start of the
    // frame: frame precision, not a reading.
    actions: (raw.actions ?? []).map((a) =>
      a.ms === undefined ? { ...a, ms: a.t * (raw.frameIntervalMs ?? DEFAULT_GRID_STEP_MS) } : a,
    ),
    // CARRIED EQUIPMENT (schema 95): its two nested arrays are also filled in.
    carriedEquipment: (raw.carriedEquipment ?? []).map((c) => ({
      ...c,
      energy: c.energy ?? [],
      uses: c.uses ?? [],
      tracked: c.tracked ?? [],
    })),
    // RIFT POSES (schema 95): absent = artifact predating this, or film without a placed translocator.
    riftPoses: raw.riftPoses ?? [],
    // ABILITY IMPULSES (schema 38): a flat entry per gesture (t, slot, family),
    // the thruster's MEASURED use. Absent = artifact predating schema 38, film without a
    // thruster, or an unclassified palette — `layers[abilityImpulses]` /
    // `coverage.abilityImpulses` tell the three apart.
    abilityImpulses: raw.abilityImpulses ?? [],
    // REMAINING EQUIPMENT CHARGES (enriched schema 38, batch P5): a flat entry per
    // reading (t, slot, family, charges) — never a derived usage count. Absent =
    // artifact predating this, film without an armed reading, or an unclassified palette —
    // `layers[abilityCharges]` / `coverage.abilityCharges` tell the three apart.
    abilityCharges: raw.abilityCharges ?? [],
    // FREE OBJECTIVE OBJECTS (schema 21): one entry per object LIFE outside of carry.
    // Absent = artifact predating this, mode without a carried object, or film that carries
    // none — `layers[objectiveObjects]` / `coverage.objectiveObjects` tell the three apart, and that is
    // why they are published.
    // The NESTED array (`pts`) is also filled in, same reason as `spans` above.
    objectiveObjects: (raw.objectiveObjects ?? []).map((o) => ({ ...o, pts: o.pts ?? [] })),
    geometry: raw.geometry ?? [],
    // Grapple PULLS (schema 8): a measured window [t0, t1] per life + anchor
    // point in world coordinates. Absent = no pull read on this film: nothing
    // is drawn, never a guessed line.
    grappleLines: raw.grappleLines ?? [],
    grenadeLabels: raw.grenadeLabels ?? [],
    // `g` is filled in as everywhere else: the contract declares it nullable, and a reading
    // arriving with `g: null` would crash the grenade box at runtime.
    grenadeReads: (raw.grenadeReads ?? []).map((gr) => ({ ...gr, g: gr.g ?? [] })),
    ammoReads: raw.ammoReads ?? [],
    grenades: raw.grenades ?? [],
    // THE IDENTITY REGISTRY (schema 50): its three lists are filled in, the OBJECT keeps the
    // right to be absent. An artifact predating schema 50 carries none, and an empty object
    // would read as "the registry was computed, it found nothing" — the opposite of "nobody
    // looked". Same regime as `scoreTimeline`.
    // THE document's FALLBACK SHARE (schema 58): `coverage.fallbacks` lists the decoder's
    // fallbacks that triggered during baking. Filled in like the other arrays;
    // the `coverage` OBJECT, though, keeps the right to be absent (same regime as `identity`).
    coverage: raw.coverage ? { ...raw.coverage, fallbacks: raw.coverage.fallbacks ?? [] } : undefined,
    identity: raw.identity
      ? {
          ...raw.identity,
          players: raw.identity.players ?? [],
          bipedSlots: raw.identity.bipedSlots ?? [],
          statborgSlots: raw.identity.statborgSlots ?? [],
        }
      : undefined,
    // PER-LAYER REVISIONS (schema 62): `layers` carries, for each produced layer, the
    // revision of the stage that decoded it. SAME REGIME as `coverage` and `identity`: the OBJECT
    // keeps the right to be ABSENT (artifact predating schema 62), and it is NEVER filled in —
    // an empty object would read as "the table was computed, no layer produced", which is false.
    // An ABSENT entry in a present object is an answer: this layer was not produced.
    layers: raw.layers,
    inventory: (raw.inventory ?? []).map((inv) => ({ ...inv, am: inv.am ?? [], g: inv.g ?? [] })),
    // `k` (schema 69): each weapon's slot for a spawn loadout. Filled in like
    // `w`; a keyframe reading carries none (`k` empty = reading NOT located, see loadoutAt).
    loadouts: (raw.loadouts ?? []).map((lo) => ({ ...lo, w: lo.w ?? [], k: lo.k ?? [] })),
    // The TYPE of unclaimed deaths (fall, out of bounds, own weapon):
    // the feed infers these lines from its tracks, this table only says WHAT the player
    // died of. Absent = none established, the feed keeps its neutral marker.
    neutralDeaths: raw.neutralDeaths ?? [],
    // The objective-actions layer crosses the boundary like the other arrays;
    // it feeds the canvas PULSES (objectivesLayer.buildObjectivePulses, batch 4.4).
    objectives: raw.objectives ?? [],
    // Completed PAD occupancies (schema 11): the pad emptied somewhere within
    // [tLow, tHigh]. Absent = no pad emptied on this film — or the film carries
    // none (`layers[padPickups]` / `coverage.groundWeapons` tell the two apart, and that is why
    // they are published).
    padPickups: raw.padPickups ?? [],
    // `mapObjectives` (the mode's STATIC objectives, served at request time) passes through
    // `...raw`: it is an optional object, not an array — its normalization lives at
    // the layer's entry point (normalizeMapObjectives), like that of callouts.
    // `as` on arity alone: the content is the contract's, only the tuple's fixed length,
    // which JSON Schema cannot express, is reasserted (see header).
    // `z` (schema 126) is the height of each point of `p`: kept only when it matches `p` point for
    // point. An older artifact has none, and the 3D viewer falls back to an interpolated height.
    projectiles: (raw.projectiles ?? []).map((pr) => {
      const p = (pr.p ?? []) as ReplayStep[]
      // `fullRate` (schema 127) is the flight at the film's rate, differential integer columns:
      // re-read it here, once, the way `tracks[].fullRate` is. Absent on artifacts before 127.
      const rawFullRate = (pr as { fullRate?: ReplayFullRateFlightRaw }).fullRate
      return {
        ...pr,
        p,
        z: pr.z && pr.z.length === p.length ? pr.z : undefined,
        ...(rawFullRate && raw.frameIntervalMs ? { fullRate: decodeFullRateFlight(rawFullRate, raw.frameIntervalMs) } : {}),
        // `attach` (schema 128): kept only whole; an older artifact has none.
        attach: attachOf((pr as { attach?: unknown }).attach),
      }
    }),
    // EACH OCCUPANT'S PRESENCE (schema 69): the intervals during which they HOLD their
    // seat. Filled in EMPTY when it is missing — an artifact predating schema 69 publishes
    // none, and `seatLogic.publishesPresences` reads that at the DOCUMENT level to fall back
    // to the lives' envelope (a dated fallback); never an invented interval here.
    roster: (raw.roster ?? []).map((e) => ({ ...e, presence: e.presence ?? [] })),
    // SCORE OVER TIME (schema 12): four tiers of nullable arrays filled in at
    // once (see normalizeScoreTimeline). The OBJECT, though, keeps the right to be absent.
    scoreTimeline: normalizeScoreTimeline(raw.scoreTimeline),
    // `o` (schema 116) is filled in to 0 as everywhere: absent from documents baked before
    // schema 116, and also from the JSON of a shot sitting right on its frame's boundary.
    shots: (raw.shots ?? []).map((s) => ({ ...s, o: s.o ?? 0 })),
    // CONTINUOUS-FIRE BURSTS (schema 71): the array AND its silent passes filled in.
    bursts: (raw.bursts ?? []).map((b) => ({ ...b, holes: b.holes ?? [] })),
    structure: (raw.structure ?? []).map((s) => ({ ...s, poly: (s.poly ?? []) as ReplayXY[] })),
    // TRANSLOCATIONS CUT THE TRACK (aj14-b): the arrival sample carries `cut`, which
    // `positionAt` / `trailAt` read as a break — neither a pawn glide nor a trail line.
    // THE FULL RATE (schema 109) is re-read here, once: differential columns -> frames and degrees.
    tracks: markTranslocationCuts(
      (raw.tracks ?? []).map(({ fullRate, ...t }) => ({
        ...t,
        points: t.points ?? [],
        // A document carrying it also carries `frameIntervalMs` (both date from schema 109 or later).
        ...(fullRate && raw.frameIntervalMs ? { fullRate: decodeFullRate(fullRate, raw.frameIntervalMs) } : {}),
      })),
      raw.translocations ?? [],
    ),
    // EACH VEHICLE'S LIFE (schema 29). Absent = artifact predating this, or film without a vehicle
    // (`layers[vehicles]` / `coverage.vehicles` tell the two apart). BOTH NESTED
    // ARRAYS ARE ALSO FILLED IN
    // (`samples`, `rides`), same pattern as `tracks` and `weaponPads`: `spawn`, though, IS NOT an
    // array and stays as-is (absent = creation record not read, never an invented object).
    // `vehicleCycles` (schema 63): a FLAT LIST of locations, no nested array.
    vehicleCycles: raw.vehicleCycles ?? [],
    vehicles: (raw.vehicles ?? []).map((v) => ({
      ...v,
      // MAP SCENERY: the server names scenery lives (`vehicleScenery.hidden` — placed
      // outside the playable zone, or held in the air with no occupant); the life carries it, so
      // the layer only has one predicate to read (`vehicleIsScenery`). Absent = no scenery verdict.
      ...(sceneryLives.has(vehicleLifeKey(v.slot, v.gen)) ? { scenery: true } : {}),
      samples: v.samples ?? [],
      // AN OCCUPANT'S AIM SERIES (schema 31) FILLS IN AT THE THIRD LEVEL: it is a
      // nullable array inside a nested array, and the contract guard requires them all filled in
      // or justified. Empty = artifact predating schema 31, or episode without a reading — the cone
      // then falls back to the chassis heading (`vehiclesAim.vehicleOccupantAimAt`).
      rides: (v.rides ?? []).map((r) => ({ ...r, aim: r.aim ?? [] })),
    })),
    // The match's WEAPON PADS (schema 11). Absent = the film carries none: nothing is
    // drawn, never a guessed pad. MATCH data, not map data — the weapon that appears
    // on a pad changes from match to match, the position does not.
    //
    // BOTH NESTED ARRAYS ARE ALSO FILLED IN (`spawns`, `presence`), as for `tracks`
    // and `structure`: the contract declares them nullable, and a pad arriving with
    // `spawns: null` would crash the layer at runtime — not at compile time.
    weaponPads: (raw.weaponPads ?? []).map((pad) => ({
      ...pad,
      spawns: pad.spawns ?? [],
      presence: pad.presence ?? [],
    })),
    // ZONE STATE (schema 16): one entry per matched zone, a sequence of ownership
    // intervals. Absent = the mode has no zone, or matching attached nothing —
    // `layers[zoneStates]` / `coverage.zones` tell the two apart, and that is why they are published.
    //
    // THE NESTED ARRAYS ARE ALSO FILLED IN (`spans`, and `gauge` — the schema-18 live
    // gauge), as for `flagCarries` and `weaponPads`. An absent gauge (schema <= 17, or
    // a zone without a ramp) becomes EMPTY: no arc, never the static apex in its place.
    zoneStates: (raw.zoneStates ?? []).map((z) => ({
      ...z,
      spans: z.spans ?? [],
      gauge: z.gauge ?? [],
      gaugeRamps: z.gaugeRamps ?? [],
    })),
  }
}

/** A vehicle LIFE's key: `(slot, gen)`, a life's only key (see `VehicleTrack`). */
function vehicleLifeKey(slot: number, gen: number): string {
  return `${slot}/${gen}`
}

/** attachOf: a projectile's published attach (schema 128) when every field is there, undefined otherwise. */
function attachOf(raw: unknown): ReplayProjectileAttach | undefined {
  const a = raw as Partial<ReplayProjectileAttach> | undefined
  if (!a || !Number.isFinite(a.fromFrame) || !Number.isFinite(a.parentSlot) || !Number.isFinite(a.node)) return undefined
  if (!Array.isArray(a.pose) || a.pose.length !== 3 || !a.pose.every(Number.isFinite)) return undefined
  return { fromFrame: a.fromFrame as number, parentSlot: a.parentSlot as number, node: a.node as number, pose: [a.pose[0], a.pose[1], a.pose[2]] }
}
