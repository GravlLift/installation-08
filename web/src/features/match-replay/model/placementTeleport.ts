// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * placementTeleport — THE USAGES OF THE QUANTUM TRANSLOCATOR, read in the EVENT OF THE FILM.
 *
 * THIS FILE CHANGED FOUNDATION ON 2026-09-03, and that is the point to understand before
 * touching it. It carried until then TWO indirect readings, both abandoned:
 *
 *  - a SPATIAL HEURISTIC (`riftTeleports`) that looked, in the tracks, for a player moving
 *    more than 12 m in less than 3 frames. It yielded 4 detections out of 39 films,
 *    and above all: any distance threshold INVENTS a rule — a teleportation can be
 *    50 cm (measured: a jump of 3.24 m on `1b2d9e08`, invisible to all thresholds). Decision
 *    of the user of 2026-09-03 (« I do not want a choice or an arbitrary rule, I want
 *    reliable reading »): DELETED, with its tests and its imports (CLAUDE.md no. 7);
 *  - the `spent` of the equipment overlay (`spentTranslocations`), which dates the END of
 *    the equipment and not its usage: the measurement of the end modes gives up to 16.5 s of
 *    delay, and three `spent` of the corpus have no known usage. It subsists ONLY as
 *    dated fallback of the artifacts prior to schema 38 (cf. `spentTranslocations`).
 *
 * WHAT REPLACES THEM: `translocations[]` (schema 38). Each usage emits an event of type
 * 117 in the reel — precision 18/18, recall 8/8 on 5 films (report R1 §4) — and its payload
 * carries the TWO positions of the jump, read in the executable and validated to 0.00-0.26 m
 * (report R6 §1). No more derivation: the event IS the measurement.
 *
 * THE SEMANTICS IS A ROUND TRIP, and it governs everything the render asserts: the beacon
 * EXCHANGES its position with the player at each usage — the arrival of a jump is the start of
 * the previous one, to within 0.09 m on the measurement. After an exchange, the rift is therefore at the point of
 * DEPARTURE (`fx/fy`). Where it is located BEFORE the first exchange is readable from NO channel
 * (negative measured on three: R1 §1-3 and R6 §1.4): one therefore draws nothing before it — see
 * `riftStations.ts`, which carries this part.
 */
import { allTexts } from '@/lib/i18n/pickText'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import type { XY } from '../../../lib/replay/replayLogic'

/**
 * Rank of the quantum translocator in the film's ability palette — FAMILY A ONLY.
 * The rank is established on the server side (`internal/games/halo_infinite/film/grammar/translocateur_test.go`) and the
 * document confirms it: `abilityLabels` associates 11 to « quantum translocator ». It is the
 * FALLBACK of the documents without label table; everywhere else, `translocatorRanks` reads the
 * table — a family B film (ranks 19-22) would make this literal silent (bug of 2026-09-02:
 * the recognition was false everywhere outside family A, silently).
 */
const RANG_TRANSLOCATEUR = 11

/**
 * translocatorRanks — the palette ranks that NAME the translocator in THIS document.
 *
 * The `abilityLabels` table is the only rank→object correspondence the artifact publishes, and
 * it follows the palette family of the film (A: 11; B: a rank of 19-22) — reading it is therefore
 * the only path that covers both families without guessing. The recognition is done on the
 * ROOT of the word (`transloc`), present in the two published locales (« Translocateur
 * quantique » / « Quantum Translocator »): comparing a whole label would be broken at the
 * first rework of the translation. Without table, or without recognized rank: the family A fallback.
 *
 * IT IS NO LONGER USED TO RECOGNIZE A USAGE — the event 117 takes care of it — but to read the
 * EQUIPMENT overlay: the END of the equipment (`riftStations.ts`) and the fallback of the artifacts
 * prior to schema 38 (`spentTranslocations`) both pass through a rank there.
 */
export function translocatorRanks(
  labels: ReplayDocumentReady['abilityLabels'],
): ReadonlySet<number> {
  const ranks = new Set<number>()
  for (const [rank, label] of Object.entries(labels ?? {})) {
    const text = allTexts(label).join(' ').toLowerCase()
    if (text.includes('transloc')) ranks.add(Number(rank))
  }
  if (ranks.size === 0) ranks.add(RANG_TRANSLOCATEUR)
  return ranks
}

/**
 * A moment of translocation reduced to what the CARD consumes: which life, which frame.
 * `TeleportLink` is its SITUATED version (the link on the map needs both ends);
 * a translocation whose payload was not read has only that pair.
 */
export interface TranslocationMoment {
  slot: number
  frame: number
  /**
   * True for the POSE of the rift (and not a pass through it): the gesture that places it, dated by
   * `riftPoses`. The card carries the same glint, but does not say « pass » of a gesture that is not one.
   */
  pose?: true
}

/** A MEASURED round trip: the life, the frame, the point left and the point reached. */
export interface TeleportLink extends TranslocationMoment {
  /** Position left — that is where the beacon is found after the exchange. */
  from: XY
  /** Position reached by the player. */
  to: XY
}

/** A teleportation of the document, as the overlay publishes it. */
type Translocation = ReplayDocumentReady['translocations'][number]

/**
 * planarJump — the two ends of the jump of a translocation, or `null` when the payload was
 * not read.
 *
 * THE SIX COORDINATES ARE JOINTLY BOUND by contract (armed together or not at all,
 * cf. `document_translocations.go`); the plane consumes only four of them, and one checks
 * all four rather than trusting the solidarity — `0` is a legitimate
 * value, `undefined` is not, and a `?? 0` would draw a jump to the origin of the world.
 */
function planarJump(t: Translocation): { from: XY; to: XY } | null {
  const { fx, fy, tx, ty } = t
  if (fx === undefined || fy === undefined || tx === undefined || ty === undefined) return null
  return { from: { x: fx, y: fy }, to: { x: tx, y: ty } }
}

/**
 * translocationMoments — the INSTANT of each published usage, with or without position.
 *
 * That is the source of the card glint: a translocation without readable round trip stays a
 * MEASURED usage (the event attests it), only its geometry is missing.
 */
export function translocationMoments(
  translocations: readonly Translocation[],
): TranslocationMoment[] {
  return translocations.map((t) => ({ slot: t.slot, frame: t.t }))
}

/**
 * translocationLinks — the SITUATED round trips, in the order of the frames.
 *
 * A translocation without positions produces NONE: one dates the gesture on the card, one draws
 * no link on the map. `coverage.translocations.positioned` says how many of them carry one.
 */
export function translocationLinks(
  translocations: readonly Translocation[],
): TeleportLink[] {
  const out: TeleportLink[] = []
  for (const t of translocations) {
    const jump = planarJump(t)
    if (!jump) continue
    out.push({ slot: t.slot, frame: t.t, ...jump })
  }
  out.sort((a, b) => a.frame - b.frame)
  return out
}

/**
 * hasTranslocationLayer — HAS THIS DOCUMENT BEEN READ FOR THE TELEPORTATION OVERLAY?
 *
 * TWO PROOFS, AND THE FIRST IS THE ONLY ONE THAT COVERS THE SILENCE. The coverage is set
 * UNCONDITIONALLY by the schema 38 builder (`build.go`:
 * `doc.Coverage.Translocations = &trCov`, including at zero event): its presence separates
 * exactly « the overlay ran, it found nothing » from « the artifact is prior to
 * schema 38 ». A published teleportation is the other proof — a prior artifact cannot
 * carry one — and it serves as a net if a producer served the overlay without its coverage.
 */
export function hasTranslocationLayer(doc: ReplayDocumentReady): boolean {
  return doc.coverage?.translocations !== undefined || doc.translocations.length > 0
}

/**
 * identityIsUnknown — is the PREVIOUS rank announced by this emission out of use?
 *
 * `gap > 0` = n emissions are STILL missing just before it, after recovery (schema 38,
 * decision D3). `from` is then neither true nor false: it is UNKNOWN, and every consumer must
 * treat it as such. The measured case is the `spent` of JGtm on `1b2d9e08`, which carries
 * `from = 4` (the grapnel) because its PICKING UP of the translocator was missed: a single
 * lost emission blinds the filter.
 *
 * SINGLE HEARTH OF THE RULE (CLAUDE.md no. 6): `spentTranslocations` and `riftStations` read it
 * here, never each its own. An artifact prior to schema 38 does not publish `gap` — the
 * door is then open, which is exactly the previous behavior.
 */
export function identityIsUnknown(
  change: ReplayDocumentReady['equipmentChanges'][number],
): boolean {
  return (change.gap ?? 0) > 0
}

/**
 * spentTranslocations — FALLBACK OF THE ARTIFACTS PRIOR TO SCHEMA 38, and nothing else.
 *
 * DATED KILL-SWITCH (model `platform/duckdb/shared_reader_legacy.go`):
 *   - switch of the default: 2026-09-03 — since schema 38, the glint comes from
 *     `translocations[]` (the EVENT), and this function is no longer called on a
 *     artifact that carries this overlay (cf. `teleportMoments`);
 *   - target removal: 2026-12-01;
 *   - measurable criterion: no more artifact served without `coverage.translocations`
 *     (`hasTranslocationLayer` true everywhere), i.e. complete re-baking of the fleet.
 *
 * WHAT IT IS WORTH, SAID WITHOUT VARNISH. The `spent` dates the END of the equipment, not the usage: up to
 * 16.5 s of delay measured, and three `spent` of the corpus have no known usage. It remains
 * nonetheless the ONLY dated signal of an old artifact — removing it would extinguish the glint on
 * the whole fleet in production until the re-baking has taken place.
 *
 * IT REFRAINS ON AN UNKNOWN IDENTITY (`identityIsUnknown`): a glint ASSERTS a gesture,
 * and one does not assert on a `from` that the counter witness says out of use.
 */
export function spentTranslocations(
  changes: ReplayDocumentReady['equipmentChanges'],
  ranks: ReadonlySet<number>,
): TranslocationMoment[] {
  const out: TranslocationMoment[] = []
  for (const c of changes) {
    if (c.kind !== 'spent' || identityIsUnknown(c)) continue
    if (ranks.has(c.from)) out.push({ slot: c.slot, frame: c.t })
  }
  return out
}

/**
 * riftPoseMoments — the INSTANT of each POSE of the rift (schema 95: the energy of the translocator
 * carried falls to zero). A gesture distinct from the pass: the card lights at the pose, not only at
 * the first teleportation that follows it.
 */
export function riftPoseMoments(doc: ReplayDocumentReady): TranslocationMoment[] {
  return doc.riftPoses.map((p) => ({ slot: p.slot, frame: p.t, pose: true }))
}

/**
 * teleportMoments — THE INSTANTS that the card makes shimmer, by the best channel
 * available for THIS document: the passes through the rift, then the poses of the rift.
 *
 * ONE CHANNEL AT A TIME FOR THE PASSES, AND IT IS THE RULE: mixing the event and the
 * `spent` would make the same usage shimmer twice (one at the true instant, the other up to
 * 16.5 s later). The published overlay wins as soon as it exists, the fallback serves only where it
 * does not exist. The POSES are another gesture, dated by its own overlay: they are added to it.
 */
export function teleportMoments(doc: ReplayDocumentReady): TranslocationMoment[] {
  const passages = hasTranslocationLayer(doc)
    ? translocationMoments(doc.translocations)
    : spentTranslocations(doc.equipmentChanges, translocatorRanks(doc.abilityLabels))
  return [...passages, ...riftPoseMoments(doc)]
}

/**
 * lastTeleportAge — the age (in frames) of the most RECENT pass of a SLOT at this frame,
 * or -1 if it has none that has happened.
 *
 * The search is on the slot — a life — like every reading report: a pass cannot
 * survive its carrier, so a dead card will never carry its glint. A
 * FUTURE PASS does not count: the glint dates an event that has happened, never announced.
 */
export function lastTeleportAge(
  teleports: readonly TranslocationMoment[],
  slot: number,
  frame: number,
): number {
  return lastTeleport(teleports, slot, frame)?.age ?? -1
}

/**
 * lastTeleport — the most RECENT moment of a slot at this frame: its age in frames, and whether
 * it is the pose of the rift (`pose`) or a pass. `null` if nothing has happened. At equal age,
 * the pass outranks the pose (that is the gesture that teleports).
 */
export function lastTeleport(
  teleports: readonly TranslocationMoment[],
  slot: number,
  frame: number,
): { age: number; pose: boolean } | null {
  let best: { age: number; pose: boolean } | null = null
  for (const t of teleports) {
    if (t.slot !== slot || t.frame > frame) continue
    const age = frame - t.frame
    const pose = t.pose === true
    if (best === null || age < best.age || (age === best.age && best.pose && !pose)) best = { age, pose }
  }
  return best
}
