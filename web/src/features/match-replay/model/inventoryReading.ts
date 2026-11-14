/**
 * inventoryReading.ts — WHICH inventory reading the card displays, and what it says about it.
 *
 * WHY THIS FILE EXISTS (2026-08-25, batch 1 « empty reading »). The rule « the nearest
 * reading <= T » was no longer enough. The artifact publishes EMPTY readings — 17.4% of the
 * measured total — and, the most recent one winning, an empty reading ERASED the player's card for
 * ~20 s while a full reading preceded it. The fix is not « ignore empty
 * readings »: an empty reading SAYS something (schema 19 even says what, cf. `empty`). It is
 * « do not let an empty reading erase the last known state, and display the empty state BESIDE
 * it ». The two pieces of information coexist, neither replaces the other.
 *
 * Extracted from `rosterLogic.ts` (threshold for the size of the store): the canonical reading fallback
 * (`nearestReading`) stays there, this file only composes it.
 *
 * This whole file is PURE: no React, no canvas, therefore testable.
 */
import { catalogText, type CatalogLabel } from '../i18n/catalogLabel'
import type { REPLAY_TEXT, ReplayLocale } from '../i18n/i18n'
import { formatSeconds, frameToMs, trackWindow } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady, ReplayInventoryReady } from '../../../lib/replay/replayNormalize'
import { currentLifeOf, nearestReading } from '../../../lib/replay/rosterLogic'

/**
 * InventoryEmptyKind — WHY the reading covering this frame renders nothing.
 *
 * The two values come as-is from the artifact (`inventory[].empty`, schema 19):
 *   - 'dead'    : the THREAD OF DEATHS corroborates — the slot's carrier is dead within 8 s;
 *   - 'unknown' : the reading is empty and nothing explains it.
 * An unknown value from a future artifact is brought back to 'unknown': displaying « dead » on a
 * label one does not understand would be worse than saying « unavailable ».
 */
export type InventoryEmptyKind = 'dead' | 'unknown'

/**
 * InventoryEmptyState — the empty state covering the current frame, and the age of THIS reading.
 *
 * THE AGE IS THAT OF THE EMPTY READING, not that of the state displayed beside it: the two are not
 * dated at the same instant, and confusing them would make a twenty-second-old state pass for fresh.
 */
export interface InventoryEmptyState {
  kind: InventoryEmptyKind
  age: number
}

/** InventoryReading — the inventory of a slot and the AGE of this reading, in frames. */
export interface InventoryReading {
  state: ReplayInventoryReady
  age: number
  /**
   * Present = the reading covering the frame is EMPTY. `state` then carries the last
   * FULL reading of the same slot when one exists; failing that, the empty reading itself — and the
   * card has only one state to show, that one.
   */
  empty?: InventoryEmptyState
  /**
   * true = `state` is a FULL reading substituted for the empty reading covering the frame.
   *
   * THIS BOOLEAN EXISTS SO THE TOOLTIP DOES NOT LIE. Without it, the card said « the equipment
   * displayed is the last full reading, read X ago » including when NO full reading
   * existed before that instant — `state` was then the empty reading itself, and the X was
   * the age of THIS empty reading. Two situations, one sentence, one of them false.
   */
  substituted: boolean
}

/**
 * inventoryAt renders the inventory to display for a SLOT at `frame`.
 *
 * THE LOOKUP RUNS ON THE SLOT, NOT ON THE PLAYER, and that is what makes the fallback SAFE: a
 * slot is reattributed at each respawn, so a loadout can never cross a
 * death. Looking up by player would make an inventory outlive its carrier.
 *
 * BEFORE THE FIRST KEYFRAME OF A LIFE, the reading rendered is the nearest UPCOMING one of the
 * same slot — same fallback as loadoutAt, and same honesty: NEGATIVE age published as is,
 * faded on its absolute value, says « upcoming » in the tooltip. USER DECISION
 * (2026-08-12): it goes FURTHER than the POC, which refused the future reading for counters
 * (grenades, ammo) on the ground that they are volatile — the product call is that a
 * spawn loadout displayed with its « upcoming » age informs better than twenty seconds of
 * nothing. The fallback never crosses a death: a slot is a life.
 *
 * WHEN THIS READING IS EMPTY, it is not thrown away and it is not stopped on: the empty
 * state is rendered in `empty` AND the last FULL reading of the same slot in `state`. It is the only
 * way to say the two true things at once — « he was carrying this » and « he is dead ».
 *
 * BOUNDED TO THE SLOT'S CURRENT LIFE (fix of 2026-09-06, same defect and same remedy as
 * `loadoutAt`): without a covering life for this slot at this frame, `null` — never the inventory
 * of another life. `window.start` descends to `lastFullBefore`, which in turn bounds its
 * fallback on the last FULL reading.
 */
export function inventoryAt(
  doc: ReplayDocumentReady,
  slot: number,
  frame: number,
): InventoryReading | null {
  const life = currentLifeOf(doc, slot, frame)
  if (!life) return null
  const window = trackWindow(life)
  const read = nearestReading(doc.inventory ?? [], slot, frame, window)
  if (!read) return null
  if (!read.value.empty) return { state: read.value, age: read.age, substituted: false }
  // UPCOMING EMPTY READING (negative age): assert nothing. The death it reports has not
  // yet occurred at the current frame — the badge would say « Dead » on a living player, up to
  // ~11 s ahead as measured (8 lives out of 90 of the reference film, review of 2026-08-25). And the
  // fallback `lastFullBefore` would look before `read.t`, hence among FUTURE readings as
  // well: it would serve equipment not yet picked up. The reading is rendered as an ordinary
  // « upcoming » reading — same fallback as loadoutAt: the card draws nothing full from it, and
  // the row's tooltip already says « in X s ».
  if (read.age < 0) return { state: read.value, age: read.age, substituted: false }
  const empty: InventoryEmptyState = {
    kind: read.value.empty === 'dead' ? 'dead' : 'unknown',
    age: read.age,
  }
  // The last FULL reading strictly earlier than the empty reading, AND within the SAME life
  // (`window.start`): the slot is reattributed at each respawn, a reading earlier than
  // the start of this life belongs to ANOTHER one — never a valid fallback (fix P0-2).
  const full = lastFullBefore(doc.inventory ?? [], slot, read.value.t, window.start)
  if (!full) return { state: read.value, age: read.age, empty, substituted: false }
  return { state: full, age: frame - full.t, empty, substituted: true }
}

/**
 * lastFullBefore — the most recent CARRYING reading of a slot, strictly before `t` and not
 * before `lifeStart` (fix P0-2, 2026-09-06): before that bound, the reading belongs to
 * ANOTHER life of the same slot — never a valid fallback, even « full ».
 */
function lastFullBefore(
  samples: readonly ReplayInventoryReady[],
  slot: number,
  t: number,
  lifeStart: number,
): ReplayInventoryReady | null {
  let best: ReplayInventoryReady | null = null
  for (const s of samples) {
    if (s.slot !== slot || s.empty || s.t >= t || s.t < lifeStart) continue
    if (!best || s.t > best.t) best = s
  }
  return best
}

/**
 * inventoryEmptyHint — the tooltip of the empty state, in TWO halves that are not dated at the same
 * instant. It lives HERE and not in the component: it is a pure text composition, therefore
 * testable without rendering (same rule as the rest of this file).
 *
 * FIRST HALF: why the reading is empty, and the age of THIS reading (`empty.age`) — not
 * that of the equipment displayed beside it. A player dead two seconds ago whose equipment
 * is twenty is not the same as a player dead twenty seconds ago, and a single age
 * could not say both.
 *
 * SECOND HALF: what the screen shows beside it. It promises « the last full reading »
 * only when a full reading is ACTUALLY substituted (`InventoryReading.substituted`). Without
 * an earlier full reading, the card displays no equipment — the tooltip says so instead
 * of announcing a fallback that did not take place, with the age of the empty reading in place of an
 * equipment age.
 */
export function inventoryEmptyHint(
  t: (typeof REPLAY_TEXT)[ReplayLocale],
  read: InventoryReading,
  empty: InventoryEmptyState,
  doc: ReplayDocumentReady,
): string {
  const why = empty.kind === 'dead' ? t.inventoryDeadHint : t.inventoryEmptyHint
  const emptyAge = formatSeconds(frameToMs(Math.abs(empty.age), doc))
  if (!read.substituted) return `${why} ${emptyAge} · ${t.inventoryNoPriorHint}`
  const gearAge = formatSeconds(frameToMs(Math.abs(read.age), doc))
  return `${why} ${emptyAge} · ${t.inventoryFallbackHint} ${gearAge}`
}

/**
 * GrenadeSelection — the EQUIPPED type, the one that will go on the next throw, with its
 * PROVENANCE. The three shapes are never confused:
 *   - { rank, read: true }  : READ in the film (i47 selector of the keyframe);
 *   - { rank, read: false } : DEDUCED — only one type carried, so it is that one;
 *   - 'indeterminate'       : several types carried and selector not read — the screen must say
 *     so (« sel. ? »), not choose;
 *   - null                  : nothing to designate (counters not read, or no type carried).
 */
export type GrenadeSelection = { rank: number; read: boolean } | 'indeterminate' | null

/**
 * GrenadeReading — the grenades carried that cover the frame, and the AGE of this reading.
 *
 * `src` says through which channel it arrived: 'kf' (keyframe, ~20 s) or 'delta' (delta
 * packet, sent ON CHANGE). The card does not display it; it serves diagnostics and the
 * tests — a channel that would go silent would be seen nowhere else.
 */
export interface GrenadeReading {
  g: number[]
  gs?: number
  age: number
  src: string
}

/**
 * grenadeReadingAt — THE grenade reading to display for this slot at this frame.
 *
 * WHY A SEPARATE AXIS, AND WHY THE CARD PREFERS IT (schema 20, batch 4.4 of the delta tracking).
 * The inventory is read at keyframes, that is every ~20 s; in between, the card displayed
 * the last known reading, median age 10.00 s. The DELTA packets transmit the same
 * counters ON CHANGE — a pickup, a throw — hence exactly where the state moves.
 * `doc.grenadeReads` carries the TWO channels on the same quantity; the most recent one wins, and
 * the median age falls to 8.09 s (measurement on 70 films, 28 comparable).
 *
 * THE TWO CHANNELS ARE NOT TIED-BROKEN WHEN THEY DIVERGE: it is not known which one would be wrong.
 * What the measurement says is that they diverge little — 714 agreements out of 729 comparable pairs,
 * that is 97.94%.
 *
 * RETURN TO NULL = the artifact does not carry this axis (predating schema 20) or the film does
 * transmit nothing of it. The caller then falls back on `inventory`, exactly as before: an old
 * artifact continues to display, it is just less fresh.
 *
 * BOUNDED TO THE SLOT'S CURRENT LIFE (fix P0-2, 2026-09-06, same defect and same remedy
 * as `loadoutAt`): without a covering life, `null` — never the grenades of another life.
 */
export function grenadeReadingAt(
  doc: ReplayDocumentReady,
  slot: number,
  frame: number,
): GrenadeReading | null {
  const life = currentLifeOf(doc, slot, frame)
  if (!life) return null
  const read = nearestReading(doc.grenadeReads ?? [], slot, frame, trackWindow(life))
  if (!read) return null
  return {
    g: read.value.g,
    gs: read.value.gs ?? undefined,
    age: read.age,
    src: read.value.src,
  }
}

/**
 * GrenadeBox — WHAT THE GRENADE BOX DISPLAYS, and the AGE of the reading carrying it.
 *
 * THE AGE IS THAT OF THE RETAINED READING, never that of the inventory: that is the whole reason
 * for the type to exist. The box fades and explains itself on ITS age, exactly like the capacity cell,
 * whose reading does not land on the keyframes of the inventory either.
 */
export interface GrenadeBox {
  g: readonly number[]
  gs?: number
  age: number
}

/**
 * grenadeBoxAt composes the TWO sources of the grenade box — the `grenadeReads` axis
 * (schema 20) and the inventory reading — and decides which one is displayed.
 *
 * AN UPCOMING READING NEVER OUTRANKS PAST INFORMATION. It is the SAME doctrine as the
 * « UPCOMING empty reading » above (inventoryAt), and here it was born of the same measured defect:
 * `nearestReading` falls back on the nearest UPCOMING reading when none precedes
 * the frame, and the box preferred that reading without looking at the sign of its age. Result
 * observed at slot 554 of the reference film: a plasma displayed ~60 s BEFORE its first
 * measurement, at full opacity, under a tooltip « read X ago ». The box asserted the future in the
 * past.
 *
 * THE RULE, THEREFORE:
 *   - grenadeRead of age >= 0: it wins — that is the gain of the batch (median age 10.00 s -> 8.09 s),
 *     the axis carrying both channels (keyframe and delta) on the same quantity;
 *   - upcoming grenadeRead and PAST inventory reading carrying counters: the past
 *     counters win, with the age of THEIR reading;
 *   - upcoming grenadeRead and NOTHING past: the upcoming reading is displayed, but ACCEPTED as such — its
 *     negative age travels as is, and the tooltip says « in X s », as the row does.
 *     An upcoming display disguised as past would be worse than an empty box;
 *   - no axis (artifact predating schema 20): the inventory reading, as is.
 *
 * EMPTY `g` = COUNTERS NOT READ, not « no grenade » (cf. `grenadesCarriedFrom`): an
 * inventory reading without counters is therefore not a past piece of information about grenades,
 * and cannot tie-break anything.
 */
export function grenadeBoxAt(
  doc: ReplayDocumentReady,
  slot: number,
  frame: number,
  inv: InventoryReading | null,
): GrenadeBox | null {
  const fromInv: GrenadeBox | null = inv
    ? { g: inv.state.g ?? [], gs: inv.state.gs ?? undefined, age: inv.age }
    : null
  const gren = grenadeReadingAt(doc, slot, frame)
  if (!gren) return fromInv
  const box: GrenadeBox = { g: gren.g, gs: gren.gs, age: gren.age }
  if (gren.age >= 0) return box
  const past = fromInv && fromInv.age >= 0 && fromInv.g.length > 0 ? fromInv : null
  return past ?? box
}

/**
 * grenadeBoxHint — the tooltip of the box: what it shows, then WHEN it was read.
 *
 * IT LIVES HERE, like the rest of the text compositions of this file: a tooltip built
 * in the component is only tested through a render. A negative age is an UPCOMING
 * reading and is said as such — same honesty as `abilityAgeTitle` and as the row.
 */
export function grenadeBoxHint(
  t: (typeof REPLAY_TEXT)[ReplayLocale],
  box: GrenadeBox,
  carried: readonly { name: string; count: number }[],
  doc: ReplayDocumentReady,
): string {
  const ms = formatSeconds(frameToMs(Math.abs(box.age), doc))
  const when = box.age < 0 ? `${t.grenadeAhead} ${ms}` : `${t.grenadeAge} ${ms}`
  if (carried.length === 0) return when
  return `${carried.map((g) => `${g.name} ×${g.count}`).join(' · ')} · ${when}`
}

/**
 * grenadesCarriedFrom renders the grenade types CARRIED, with their name and their counter, from
 * the RAW COUNTERS — wherever they come from (`grenadeReads` axis or inventory).
 *
 * THE ZERO COUNTERS ARE SET ASIDE FROM THE DISPLAY but not from the reading: the published
 * array is complete, and a zero in it means « that type, none in reserve ». Showing four types three
 * of which at zero would drown the one that counts. An EMPTY array, for its part, says « counters NOT READ ».
 *
 * Without a name table, the RANK is displayed as is: that is what the document says, and it is true.
 * Inventing a name would be worse (cf. catalogLabel.ts).
 */
export function grenadesCarriedFrom(
  counts: readonly number[],
  labels: CatalogLabel[] | undefined,
  locale: ReplayLocale,
): { rank: number; name: string; count: number }[] {
  const out: { rank: number; name: string; count: number }[] = []
  counts.forEach((count, rank) => {
    if (count <= 0) return
    out.push({ rank, name: catalogText(labels?.[rank], locale) ?? `rank ${rank}`, count })
  })
  return out
}

/**
 * selectedGrenadeFrom designates the EQUIPPED type from the RAW COUNTERS and the read selector.
 *
 * THE READING OUTRANKS THE DEDUCTION: the film's selector (`gs`) is published under a
 * consistency guard (mask == counters, unanimity) — when it is there, it is it.
 *
 * The rule does not change from one channel to the other: a read selection consistent with the
 * counters wins; a single type carried is DEDUCED; several types with no read selection remain
 * indeterminate — one does not guess which one will go.
 */
export function selectedGrenadeFrom(
  counts: readonly number[],
  gs: number | undefined,
): GrenadeSelection {
  const carried = counts.map((c, r) => ({ c, r })).filter((x) => x.c > 0)
  if (carried.length === 0) return null
  if (gs !== undefined && carried.some((x) => x.r === gs)) return { rank: gs, read: true }
  if (carried.length === 1) return { rank: carried[0].r, read: false }
  return 'indeterminate'
}
