// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * replayDocumentSchema.ts — THE REPLAY DOCUMENT'S CONTRACT, AT RUNTIME.
 *
 * WHY THIS FILE EXISTS (2026-09-13, lot 0.B; architecture §12, guardrail 3). The web types the
 * document from `api/openapi.yaml` — and those types NO LONGER EXIST at runtime. A field renamed
 * on the bake side, or whose type changes, therefore turns neither `tsc` red (the generated
 * contract would have followed) nor any test: it reaches production, and the render falls on
 * `undefined.map`. This is the hole this schema closes, at the transport boundary.
 *
 * # WHAT IT VALIDATES — THE ROOT, AND EXACTLY
 *
 * The root is a STRICT object: the contract's 72 keys, no more no less. Three failures come out
 * named:
 *
 *  - an absent REQUIRED key (`matchId`, `bounds`, `frameCount`, `schemaVersion`, `titleSlug`,
 *    `tracks`);
 *  - a key whose KIND changed (a layer become an object, a bound become a string);
 *  - an UNKNOWN key — that is, a RENAMED field (`shots` become `shotz`), or a producer ahead of
 *    the web's generated types.
 *
 * THE THIRD CASE IS THE REASON FOR STRICT MODE, and it cost a review (lot 0.B round 1, finding
 * C1): `z.object` STRIPS unknown keys and `.optional()` accepts absence — so a renamed layer
 * passed the contract in silence, the badge said "up to date", and the layer rendered empty.
 * Strict mode never blocks the render: the failure travels to the admin badge, the document is
 * served as-is (see `validateReplayDocument`).
 *
 * # WHAT IT DOES NOT VALIDATE, AND THIS IS WRITTEN HERE SO THAT NO ONE IS MISTAKEN
 *
 * It DOES NOT DESCEND into the layers' elements nor into the blocks: `z.custom<T>()` carries
 * the TYPE (so `tsc` sees the full shape) without re-validating every trajectory point. A field
 * renamed INSIDE a `Shot`, a `Track`, or `coverage` is therefore NOT caught here. The reason is
 * deliberate and its cost is measured: a real document carries hundreds of thousands of points,
 * and walking them one by one on every load would cost more than the JSON decode itself. The
 * DEEP shape has its own keeper, on the producer side: the reflected fingerprint of
 * `ReplayDocument` (`replay/document_shape_test.go`), which refuses a shape change without a
 * `SchemaVersion` bump.
 *
 * The LABEL TABLES (`weaponLabels`, `abilityLabels`, `vehicleLabels`, `killEffects`) are not
 * strict either, and cannot be: their keys ARE the data (a weapon identifier per entry). Only
 * the kind of their value is enforced there.
 *
 * # WHAT KEEPS THIS SCHEMA FROM DRIFTING FROM THE CONTRACT
 *
 * The element types are DERIVED from `ReplayDocument` (see `Elem` / `Valeur` below): there is
 * no type name to keep in phase. What is written by hand is the NAME of each key and its KIND —
 * and both are confronted with the generated contract by type assertions in
 * `replayDocumentSchema.test.ts`, which make `tsc -b` fail before any test.
 */
import { z } from 'zod'

import type { ReplayDocument } from '@/lib/api/types'

/** The type of an ELEMENT of the array carried by the contract's key `K`. */
type Elem<K extends keyof ReplayDocument> =
  NonNullable<ReplayDocument[K]> extends readonly (infer E)[] ? E : never

/** The type of a VALUE of the table carried by the contract's key `K`. */
type Valeur<K extends keyof ReplayDocument> =
  NonNullable<ReplayDocument[K]> extends Record<string, infer V> ? V : never

/**
 * An OPTIONAL and NULLABLE array: `E[] | null | undefined`. This is the shape of every Go slice
 * under `omitempty` — the document's twenty-odd layers.
 */
function calque<E>() {
  return z.array(z.custom<E>()).nullish()
}

/** An OPTIONAL object: present, it must be an object; absent, that is a legitimate silence. */
function bloc<T>() {
  return z.custom<T>((v) => typeof v === 'object' && v !== null).optional()
}

/** An OPTIONAL key -> value table (the label catalogs; see header). */
function table<V>() {
  return z.record(z.string(), z.custom<V>()).optional()
}

/**
 * The world bounds. Validated FOR REAL (not by `z.custom`) because the whole render depends on
 * them: a missing or non-numeric bound makes a NaN-sized scene, that is a blank page with no
 * message. STRICT for the same reason as the root: a renamed bound is a missing bound, and the
 * silence is the worst of the two.
 */
const bornes = z.strictObject({
  maxX: z.number(),
  maxY: z.number(),
  maxZ: z.number().optional(),
  minX: z.number(),
  minY: z.number(),
  minZ: z.number().optional(),
})

/**
 * replayDocumentSchema — the root's 72 keys, in the generated contract's order.
 *
 * THE ORDER IS THE CONTRACT'S, and that is not a matter of vanity: it is what makes the
 * confrontation readable in review when the contract gains a key.
 *
 * STRICT: any key outside this list is a named failure (see header).
 */
export const replayDocumentSchema = z.strictObject({
  abilities: calque<Elem<'abilities'>>(),
  abilityCharges: calque<Elem<'abilityCharges'>>(),
  abilityImpulses: calque<Elem<'abilityImpulses'>>(),
  abilityLabels: table<Valeur<'abilityLabels'>>(),
  ammoReads: calque<Elem<'ammoReads'>>(),
  bombArmings: calque<Elem<'bombArmings'>>(),
  bombCarries: calque<Elem<'bombCarries'>>(),
  bombEvents: calque<Elem<'bombEvents'>>(),
  bombStats: bloc<NonNullable<ReplayDocument['bombStats']>>(),
  bursts: calque<Elem<'bursts'>>(),
  bounds: bornes,
  coverage: bloc<NonNullable<ReplayDocument['coverage']>>(),
  durationMs: z.number().optional(),
  equipmentChanges: calque<Elem<'equipmentChanges'>>(),
  equipmentEpisodes: calque<Elem<'equipmentEpisodes'>>(),
  equipmentPlacements: calque<Elem<'equipmentPlacements'>>(),
  flagCarries: calque<Elem<'flagCarries'>>(),
  flagReturnZone: bloc<NonNullable<ReplayDocument['flagReturnZone']>>(),
  frameCount: z.number(),
  frameIntervalMs: z.number().optional(),
  geometry: calque<Elem<'geometry'>>(),
  geometryBounds: bornes.optional(),
  grappleLines: calque<Elem<'grappleLines'>>(),
  grenadeLabels: calque<Elem<'grenadeLabels'>>(),
  grenadeReads: calque<Elem<'grenadeReads'>>(),
  grenades: calque<Elem<'grenades'>>(),
  groundWeapons: calque<Elem<'groundWeapons'>>(),
  identity: bloc<NonNullable<ReplayDocument['identity']>>(),
  inventory: calque<Elem<'inventory'>>(),
  killEffects: z.record(z.string(), z.string()).optional(),
  knockbacks: calque<Elem<'knockbacks'>>(),
  drawnWeapons: calque<Elem<'drawnWeapons'>>(),
  damages: calque<Elem<'damages'>>(),
  killCauses: calque<Elem<'killCauses'>>(),
  actions: calque<Elem<'actions'>>(),
  carriedEquipment: calque<Elem<'carriedEquipment'>>(),
  riftPoses: calque<Elem<'riftPoses'>>(),
  // `layers`: layer name -> revision of the layer that produced it (schema 62). SAME SHAPE as
  // `killEffects` — a flat string table — and the SAME REGIME as `coverage`: the object keeps
  // the right to be ABSENT (artifact predating 62), and an entry absent in a present object
  // means "this layer was not produced". It is never filled in.
  layers: z.record(z.string(), z.string()).optional(),
  loadouts: calque<Elem<'loadouts'>>(),
  mapObjectives: bloc<NonNullable<ReplayDocument['mapObjectives']>>(),
  mapWeaponPads: bloc<NonNullable<ReplayDocument['mapWeaponPads']>>(),
  matchId: z.string(),
  neutralDeaths: calque<Elem<'neutralDeaths'>>(),
  objectiveObjects: calque<Elem<'objectiveObjects'>>(),
  objectives: calque<Elem<'objectives'>>(),
  originMs: z.number().optional(),
  padPickups: calque<Elem<'padPickups'>>(),
  pickups: calque<Elem<'pickups'>>(),
  projectiles: calque<Elem<'projectiles'>>(),
  roster: calque<Elem<'roster'>>(),
  schemaVersion: z.number(),
  scoreTimeline: bloc<NonNullable<ReplayDocument['scoreTimeline']>>(),
  shots: calque<Elem<'shots'>>(),
  skullCarries: calque<Elem<'skullCarries'>>(),
  stances: calque<Elem<'stances'>>(),
  structure: calque<Elem<'structure'>>(),
  structureBounds: bornes.optional(),
  t0FilmMs: z.number().optional(),
  titleSlug: z.string(),
  // `tracks` is the ONLY array the contract declares REQUIRED (nullable, but present): without
  // trajectories there is no replay, and the bake already refuses a document that carries none
  // (`validateArtifact`, on the Go side).
  tracks: z.array(z.custom<Elem<'tracks'>>()).nullable(),
  translocations: calque<Elem<'translocations'>>(),
  vehicleCycles: calque<Elem<'vehicleCycles'>>(),
  vehicleLabels: table<Valeur<'vehicleLabels'>>(),
  // Map scenery verdict (lot M7), resolved at the request.
  vehicleScenery: bloc<NonNullable<ReplayDocument['vehicleScenery']>>(),
  // Register of the vehicle weapons used by the shots (schema 69), resolved at the request.
  vehicleWeapons: table<Valeur<'vehicleWeapons'>>(),
  vehicles: calque<Elem<'vehicles'>>(),
  vipCrown: calque<Elem<'vipCrown'>>(),
  weaponChanges: calque<Elem<'weaponChanges'>>(),
  weaponLabels: table<Valeur<'weaponLabels'>>(),
  weaponPads: calque<Elem<'weaponPads'>>(),
  weaponTiers: bloc<NonNullable<ReplayDocument['weaponTiers']>>(),
  zoneStates: calque<Elem<'zoneStates'>>(),
})

/** The document as the schema describes it — confronted with the generated contract in its test. */
export type ReplayDocumentFromSchema = z.infer<typeof replayDocumentSchema>

/**
 * ReplayContractIssue — THE FAILURE, IN DATA AND NOT IN A SENTENCE.
 *
 * WHY THIS TYPE EXISTS (2026-09-13, review round 2, finding R2-2). This function used to return
 * a SENTENCE, and that sentence was French: in the English locale, the badge showed
 * `contract violated (cle(s) inconnue(s) : shotz)` — a FR fragment written outside `i18n.ts`,
 * inserted in the middle of an EN sentence. Repo rule no. 1 wants every interface string in FR
 * AND in EN, held by the parity typing; a sentence manufactured here cannot be.
 *
 * This module therefore returns what it KNOWS (which kind of failure, which key, which path) and
 * leaves it to the interface to SAY it (`REPLAY_TEXT[locale].contract*`, see
 * `ReplaySchemaBadge`).
 *
 * `detail` stays zod's text, in English and untranslated: it is a technical diagnostic meant for
 * an administrator ("expected number, received string"), not a product sentence. Translating it
 * would require rewriting the library's error table.
 */
export type ReplayContractIssue =
  | { kind: 'unknownKeys'; keys: string[] }
  | { kind: 'invalidField'; path: string; detail: string }
  | { kind: 'malformed' }

/**
 * validateReplayDocument returns `null` if the document honors the contract, otherwise the FIRST
 * failure, in data.
 *
 * IT NEVER THROWS, AND NEVER DISCARDS THE DOCUMENT. A violated contract is a signal for the
 * operator (the admin badge shows it), not a reason to refuse to display: the render already
 * degrades field by field, and a blank page would teach less than an incomplete replay.
 *
 * THE UNKNOWN KEY IS CARRIED APART: zod files it in `issue.keys` and not in the path, so a
 * failure built on the path alone would say "root" without ever saying WHAT — that is, without
 * giving the name of the renamed field, the only useful information in this case.
 */
export function validateReplayDocument(raw: unknown): ReplayContractIssue | null {
  const r = replayDocumentSchema.safeParse(raw)
  if (r.success) return null
  const premier = r.error.issues[0]
  if (!premier) return { kind: 'malformed' }
  if (premier.code === 'unrecognized_keys') {
    return { kind: 'unknownKeys', keys: [...premier.keys] }
  }
  const chemin = premier.path.join('.')
  return chemin
    ? { kind: 'invalidField', path: chemin, detail: premier.message }
    : { kind: 'malformed' }
}
