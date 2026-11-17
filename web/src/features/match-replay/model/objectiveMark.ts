// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * objectiveMark.ts — WHO CARRIES THE OBJECTIVE, at a given frame. Pure logic, no React.
 *
 * WHAT THE CARD WAS NOT SAYING. The map has long shown the carried flag, the Oddball skull
 * and the VIP crown — but on their MARKER, among the tracks. The column of
 * cards, it, said nothing: one read « who is alive », never « who holds the object that
 * decides the round ». This module answers that question, and that one alone; the dressing
 * (watermark, ink) lives in `ReplayObjectiveMark.tsx`, the tooltip sentence in
 * `playerCardFx.titleOf`.
 *
 * TWO REGIMES, BECAUSE THE DATA HAS TWO (user decision of 2026-08-29):
 *
 *  - a CARRY is a PERIOD attributed — `flagCarries[].spans[]` (schema 15),
 *    `skullCarries[]` (23), `vipCrown[]` (22) all carry an `xuid` and an interval. The
 *    mark lasts exactly the interval: it is a state, it is read as such.
 *  - an INSTANTANEOUS EVENT has NO attributed period. `zoneStates[].spans[]` publishes
 *    only the owner (a TEAM) and the gauge — no xuid; only the EVENTS
 *    `zone_captures` and `zone_secures` have an author. The mark is then an INSTANT held
 *    a few seconds, never a « is in the process of capturing »: deducing it from the position
 *    would assert what the film does not say (rule « a value not read is displayed as
 *    a gap »).
 *
 * THE BOMB HAS BOTH REGIMES since schema 30: the CARRY is an attributed period
 * (`bombCarries[]`, channel of the weapons held — until then « nothing attributes the CARRY of the
 * bomb » was true, and no longer is), and the EXPLOSION stays the instant `bomb_detonations`
 * (the mode point of Assault). The carry outranks, as everywhere: a marked carrier stays
 * marked during his whole carry, the explosion holds its mark a few seconds after the
 * gesture — same glyph, two moments of a same stake.
 *
 * KOTH IS READY AND AWAITS ITS SOURCE. The mode has NO attributed data today: the
 * statistic placements `hill` are not yet named — `NamedEvents` returns `nil`
 * for KOTH — and the hill periods of the document are, like the zones, at the level of
 * the team. The `hill` kind therefore exists here with its glyph, its ink, its
 * label and its test (it goes through the SAME periods resolver as the skull and the VIP, `markFromPeriods`),
 * but its source is empty: the day the KOTH decoding will publish occupations per player,
 * it is ONE line to add in `carrySourcesOf` — nothing else to write.
 *
 * ONE SINGLE INK FOR THE SIX (color-tokens rule): `extreme`, « rare and intense », the
 * top of an intensity ramp — and the only token of the palette that NO other card effect
 * uses (`legendary` is the over-shield, `success` the repair field,
 * `destructive` the sensor and the death, `info` the shield gauge). Carrying the objective is a
 * game state, not a camp: it is the GLYPH that says which of the six, not the color. The map,
 * for its part, keeps the TEAM ink on its glyphs — it must distinguish two flags on a same
 * background, when a card never has but one single carrier.
 */
import { filmClockTrusted } from '@/lib/replay/scoreTimeline'

import { msToFrames } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { covers } from './replaySpans'

/**
 * The six marks, named by the OBJECT carried, the place held or the gesture just done
 * — never by the mode: a same object is found from one mode to the other, and the card does not know
 * the mode.
 */
export type ObjectiveMarkKind = 'flag' | 'skull' | 'vip' | 'hill' | 'zone' | 'bomb'

/**
 * The states of `flagCarries[].spans[].state` that mean CARRIED. `carried_open` is the
 * flag carried « in the open » (the carrier is visible to all): it is a carry, with the
 * same consequence for who reads the card. `dropped` and `home` have no carrier — their
 * `xuid` is that of the LAST carrier, and taking it for a carry would stick the flag to a
 * player who no longer has it.
 */
const CARRIED_STATES = new Set(['carried', 'carried_open'])

/**
 * Hold of the BASE CAPTURE mark, in real time — an instant that must be seen without
 * settling in. 2.5 s: the time to read a name on a column of eight cards, well beyond
 * the capture wave of the flag (600 ms, `flagCaptureFx`) which, it, is painted ON the map at
 * the place the eye is already looking. Declared in milliseconds, never in frames: the cadence of
 * the film may change at the build without the reading changing (same rule as `useReplayTiming`).
 */
export const ZONE_MARK_HOLD_MS = 2_500

/**
 * The INSTANTANEOUS EVENTS attributed to a player, by kind of mark (cf.
 * objectiveevents/named.go). These are the only modes whose data publishes NO period:
 * the mark is an instant held a few seconds, never a state.
 *
 * `bomb_detonations` (Assault, since 2026-08-31): the mode point of an Assault round
 * is worth an EXPLOSION, and nothing else moves the score. The credited player is the one that
 * the engine credits; the film does not distinguish the arming from the detonation, and the card does
 * not assert it therefore.
 */
const EVENT_STATS: Record<'zone' | 'bomb', ReadonlySet<string>> = {
  zone: new Set(['zone_captures', 'zone_secures']),
  bomb: new Set(['bomb_detonations']),
}

/** An attributed carry period: the common shape of the skull, the VIP and (tomorrow) the hill. */
interface CarryPeriod {
  xuid: string
  t0: number
  t1: number
}

/**
 * markFromPeriods — the PERIODS resolver, shared by all the carries with flat interval.
 *
 * Bounds INCLUDED at both ends, like `skullPresenceAt`: a period of a single frame
 * (capture and loss in the same step) must be seen, and that is the convention of the whole replay.
 */
function markFromPeriods(
  periods: readonly CarryPeriod[],
  xuid: string,
  frame: number,
): boolean {
  for (const p of periods) {
    if (p.xuid === xuid && covers(p, frame)) return true
  }
  return false
}

/**
 * The CARRY sources of the document, in the order in which they dispute the card. The order is
 * arbitrary in fact — no mode publishes two of these lists at once — but it is
 * FIXED, so that a malformed document always renders the same mark rather than one at random.
 */
function carrySourcesOf(
  doc: ReplayDocumentReady,
): readonly { kind: ObjectiveMarkKind; periods: readonly CarryPeriod[] }[] {
  return [
    { kind: 'skull', periods: doc.skullCarries },
    { kind: 'vip', periods: doc.vipCrown },
    // THE CARRIED BOMB (schema 30): the same resolver as the skull — the `bomb` kind serves
    // the EXPLOSION EVENT too (EVENT_STATS), and the carry outranks by construction:
    // the periods are read BEFORE the events in `objectiveMarkAt`.
    { kind: 'bomb', periods: doc.bombCarries },
    // KOTH: the source is still missing (cf. the header). A line `{ kind: 'hill', periods: ... }`
    // here, and the hill watermark lights up — everything else is already in place.
  ]
}

/**
 * flagCarriedBy says if THIS player holds a flag at this frame, whatever the camp of
 * the flag: on a card, the camp is already said by the column.
 */
function flagCarriedBy(doc: ReplayDocumentReady, xuid: string, frame: number): boolean {
  for (const carry of doc.flagCarries) {
    for (const sp of carry.spans) {
      if (sp.xuid !== xuid) continue
      if (!CARRIED_STATES.has(sp.state)) continue
      if (covers(sp, frame)) return true
    }
  }
  return false
}

/**
 * eventMarkedBy says if this player accomplished one of the events of the given kind in the window
 * that precedes this frame.
 *
 * THE CLOCK GUARD IS THE SAME AS THAT OF THE CAPTURE WAVE (`flagCaptureFx`): the
 * `objectives[]` are dated by the clock of the FILM then aligned on the grid of the document; without
 * resolved origin, the gap is unknown (measured from 3.6 s to 50.8 s) and the mark would light on
 * the wrong frame. Silent is better than false.
 */
function eventMarkedBy(
  doc: ReplayDocumentReady,
  xuid: string,
  frame: number,
  hold: number,
  stats: ReadonlySet<string>,
): boolean {
  if (!filmClockTrusted(doc)) return false
  for (const a of doc.objectives) {
    if (a.xuid !== xuid) continue
    if (!stats.has(a.stat)) continue
    const age = frame - a.t
    if (age >= 0 && age <= hold) return true
  }
  return false
}

/**
 * objectiveMarkAt — the objective mark of a player at a frame, or `null` if he carries
 * none.
 *
 * THE CARRY OUTRANKS THE EVENT: a flag carrier who just secured a base
 * keeps the flag on screen — it is the state that lasts that decides the round, the instant is
 * already past.
 *
 * THE CALLER CALLS IT ONLY FOR A LIVING CARD (same rule as the zones and the equipment):
 * a dead card carries only the death, and a dead one has dropped what he was holding.
 */
export function objectiveMarkAt(
  doc: ReplayDocumentReady,
  xuid: string,
  frame: number,
): ObjectiveMarkKind | null {
  if (flagCarriedBy(doc, xuid, frame)) return 'flag'
  for (const src of carrySourcesOf(doc)) {
    if (markFromPeriods(src.periods, xuid, frame)) return src.kind
  }
  const hold = Math.max(1, msToFrames(ZONE_MARK_HOLD_MS, doc))
  if (eventMarkedBy(doc, xuid, frame, hold, EVENT_STATS.zone)) return 'zone'
  if (eventMarkedBy(doc, xuid, frame, hold, EVENT_STATS.bomb)) return 'bomb'
  return null
}

/**
 * Exported FOR THE `hill` KIND AND ITS TEST, until the KOTH source exists: that is what
 * makes the hill a kind truly resolved by the same code as the others, and not a
 * dressing that would diverge before having served. On the arrival of the source, `carrySourcesOf` uses
 * it like the two others and this export loses its reason for being.
 */
export { markFromPeriods as objectiveMarkFromPeriods }
