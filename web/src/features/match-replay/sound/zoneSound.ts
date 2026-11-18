// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * zoneSound.ts — THE SOUNDS THAT COME FROM THE STATE OF THE ZONES, not from a player action.
 *
 * WHY A SEPARATE FILE. `objectiveSound.ts` joins on `doc.objectives`, that is on the
 * STATISTICS EVENTS of a named player ("so and so captured"). The three sounds here
 * come from no player: they come from THE STATE OF THE ZONE, published by `doc.zoneStates`
 * — the capture gauge, the owner, and the hill handoff. Different source, different
 * join key, different doctrine: different file.
 *
 * AND THAT WAS THE ONLY REASON THESE SOUNDS DID NOT PLAY. They were extracted from the
 * game and named since 2026-08-27; the engine, for its part, only read `doc.objectives`.
 * Nothing was missing on the Go side — the zone layer has been published since schema 18.
 *
 * ## The three rules, and where each one holds
 *
 * **CAPTURE IN PROGRESS.** The gauge only publishes ramps (monotone climbs), closed by a
 * return to zero when the film carries one — that is written in `ZoneState.Gauge` on the Go
 * side. A ramp says a capture is in progress; it does not say WHO is capturing. The side
 * is read at the arrival: if the ramp ends with an OWNER CHANGE, the captor is the new
 * owner. A ramp that falls back without changing the owner stays MUTE — that is exactly
 * the "contested" case, and we cannot yet name the one who failed.
 *
 * **SCORING TICK.** Product rule from the user (2026-08-27): "we could play them each second
 * according to the team, when the allied or enemy team holds all the zones". The trigger is
 * therefore DOMINATION — one side holds ALL the zones — RESTRICTED TO SIMULTANEOUS-ZONE
 * MODES: the sound is named `..._strongholds_scoring_tick_*` and the user made clear he was
 * talking about Strongholds. A single hill (KOTH) held continuously would make it sound the
 * whole match — the guard is therefore double: at least two zones, and no interval marked
 * `active` (the hill marker).
 *
 * THE INSTANT OF THE TICK, FOR ITS PART, COMES FROM THE GAME'S SCORE CLOCK SINCE LOT 5.8.6,
 * and it is no longer a synthetic cadence: `scoreTimeline.teams[].total` is the STAIRCASE of
 * a side's score (`{t: frame, v: cumulative}`), and a tick sounds at each STEP of that side
 * while it dominates. A scoring tick that does not land on a point is a tick that lied — the
 * game does not score every second, and the cadence depends on the variant. The synthetic
 * fallback stays for the documents the score layer does not cover (cf. `derivedCadence`).
 *
 * **NEW HILL.** Every start of an `active` interval EXCEPT THE FIRST: the sound is "before
 * the appearance of a NEW zone", not the opening of the match. It has no side — the hill
 * belongs to no one when it moves.
 *
 * **HILL SECURING** (2026-08-30). In King of the Hill the GUARD is what scores, once the
 * hill is taken (a capture of roughly one second). The trigger is therefore the `active`
 * interval HELD, not a gauge ramp: a hill's ramps do not sound. Detail and floor:
 * `ZONE_SECURING_MIN_MS`.
 *
 * ## Without an allied side, three of the four stay silent
 *
 * Same rule as everywhere in the sound chain: without an allied side (the film does not
 * locate the watched player), the replay does not guess a side. The capture in progress and
 * the ticks stay silent; the new hill still sounds, it asserts nothing.
 */
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { frameToMs, msToFrames } from '../../../lib/replay/replayLogic'
import { soundEvent, type ReplaySoundEvent } from './replaySoundVariants'
import { covers } from '../model/replaySpans'

/** The side of a zone state, as seen from the page — the same notion as in `objectiveSound.ts`. */
export type ZoneSide = 'ally' | 'enemy'

/**
 * ZONE_SOUND_STEMS — the files, by gesture and by side.
 *
 * PROVENANCE. Bank `1c609526` (the zone modes; its file name is not broken). Two gestures
 * carry a Wwise name broken by hashing (`..._strongholds_scoring_tick_team` and
 * `_enemy`), the other four are DESIGNATED BY EAR by the user — a designation counts as a
 * measurement for product use (RECETTE_SONS_ARMES §5).
 *
 * THE TWO PAIRS ARE COMPLETE, and that is new: until 2026-08-27 the enemy side of the
 * capture was MUTE for lack of a designated sound.
 */
export const ZONE_SOUND_STEMS = {
  /** The gauge climbs: someone is in the process of taking the zone. Rendered in loop, 3 s. */
  capturing: {
    ally: 'objective_zone_capturing_team',
    enemy: 'objective_zone_capturing_enemy',
  },
  /** A side holds all the zones: one tick per second. Rendered short (1.2 s) and at -12 dBTP. */
  tick: {
    ally: 'objective_zone_tick_team',
    enemy: 'objective_zone_tick_enemy',
  },
  /**
   * The zone is CONTESTED. Definition given by the user on 2026-08-27, word for word:
   * "it is when you are going to take an enemy zone and an enemy enters the zone to contest
   * it". What the film shows of it: a GAUGE ramp that falls back WITHOUT the owner
   * changing — the capture was in progress, it was interrupted.
   *
   * NO SIDE, and that is not a gap: the game has only ONE contested sound
   * (`play_004_mod_mp_strongholds_contested`, with no `_team` / `_enemy` twin), exactly like
   * the flag return. It sounds the same for everyone.
   */
  contested: 'objective_zone_contested',
  /** The hill moves (King of the Hill). No side. */
  newZone: 'objective_zone_new',
  /**
   * THE HILL SECURING, in King of the Hill. Designated by ear by the user on 2026-08-30
   * (`93f632c0` allied, `dcf980a5` enemy — two gestures of identical shape and disjoint
   * media, the signature of a `_team`/`_enemy` couple).
   *
   * WHY THIS IS NOT `capturing`, AND WHY THE TWO DO NOT STEP ON EACH OTHER. In King of the
   * Hill the taking is a capture of roughly one second and it is the GUARD that scores. A
   * hill's gauge is published since schema 92, but `zoneSoundEvents` does NOT read a hill's
   * ramps (a zone whose intervals are `active`): `capturing` remains the Strongholds
   * capture, and securing is born of a held `active` interval, which only exists on a hill.
   *
   * THE SOUND IS SERVED LONG (5.5 s) AND PLAYED ONCE ONLY. That is a rule of the user, and
   * it comes from what he hears: "the sound is to be extended as long as the securing is in
   * progress; a loop would restart the beginning of the sound, which takes time to start up —
   * it is like a siren". The file therefore carries the GAME'S loop (a 1.3 s reading every
   * 1.8 s, `sLoopCount` = 0, `eTransitionMode` = 3) served over 5.5 s; the player, for its
   * part, never re-triggers it.
   *
   * TWO ASSUMED DEVIATIONS, written rather than hidden. (1) The 1.5 s action delay is
   * REMOVED: it is the game's loop entry, and served at the head of a one-shot it would only
   * add silence. (2) 5.5 s does not cover a 40 s guard; that is the ceiling of EVENT sounds
   * (`LONG_MAX_S` = 6 s in the assets guardrail), and holding it is better than letting a
   * match sound climb toward the fanfare ceiling. Extending it further would require raising
   * that ceiling — a product decision, not a delivery decision.
   */
  securing: {
    ally: 'objective_zone_securing_team',
    enemy: 'objective_zone_securing_enemy',
  },
} as const

/** Scoring tick period, in milliseconds — the second demanded by the user. */
export const ZONE_TICK_PERIOD_MS = 1000

/**
 * EVENT BUDGET PER INTERVAL, for the synthetic fallback only.
 *
 * IT WAS A HARD CEILING THAT TRUNCATED, AND THAT IS THE DEFECT LOT 5.8.6 FIXES: the loop
 * stopped at the 180th tick, so beyond three minutes of continuous domination the sound went
 * MUTE until the end of the interval — precisely when domination becomes the most useful
 * piece of information. The number stays, but it is no longer a truncation: it is the number
 * of events the interval is allowed to carry, and the CADENCE is derived from it
 * (`derivedCadence`). A domination of three minutes or less therefore keeps exactly its tick
 * per second; a longer one sees its ticks space out instead of stopping.
 *
 * THE REASON FOR THE BUDGET HAS NOT CHANGED: the player's voice ceiling (8) would swallow
 * the overruns, but the track would still carry their weight.
 */
export const ZONE_TICK_BUDGET_PAR_INTERVALLE = 180

/**
 * The three shapes read, reduced to what this file needs (STRUCTURAL typing: it does not
 * have to know the complete DTO, and the test can therefore build a zone state in three
 * lines).
 */
interface SpanLike {
  t0: number
  t1: number
  owner?: number | null
  active?: boolean
}

interface GaugeLike {
  t: number
  v: number
}

interface RampLike {
  t0: number
  t1: number
  capturingTeam?: number | null
}

interface ZoneStateLike {
  spans: readonly SpanLike[]
  gauge?: readonly GaugeLike[] | null
  gaugeRamps?: readonly RampLike[] | null
}

/**
 * THE SCORE STAIRCASE OF A SIDE, reduced to what this file needs (same STRUCTURAL typing as
 * the three shapes above): the side's identifier and its cumulative series `{t: frame, v}`.
 */
interface ScoreStairsLike {
  teams?: readonly { teamId?: number; total?: readonly GaugeLike[] | null }[] | null
}

/**
 * zoneSoundEvents — the zone state sounds, laid on the replay's clock.
 *
 * `allyTeam` is the allied team identifier (the watched player's film team,
 * `FilmAllegiance.allyTeam`), or `null` when it is not resolved.
 */
export function zoneSoundEvents(
  doc: ReplayDocumentReady,
  allyTeam: number | null,
): ReplaySoundEvent[] {
  const zones: readonly ZoneStateLike[] = doc.zoneStates ?? []
  if (zones.length === 0) return []
  const out: ReplaySoundEvent[] = []
  const sideOf = (owner: number | null | undefined): ZoneSide | undefined => {
    if (allyTeam === null || owner === null || owner === undefined) return undefined
    return owner === allyTeam ? 'ally' : 'enemy'
  }

  for (const z of zones) {
    // A HILL DOES NOT SOUND ITS GAUGE: its grammar is securing (below).
    if (z.spans.some((s) => s.active)) continue
    for (const r of gaugeRamps(z.gauge ?? [])) {
      const arrival = ownerAfter(z.spans, r.end)
      if (arrival === undefined) {
        // THE RAMP CHANGED NOTHING: the capture was in progress and was interrupted. That
        // is CONTESTATION, and it sounds at the instant the gauge stops climbing — not at the
        // start of the ramp, where nothing was yet contested. No side: the game has only
        // one sound for it.
        out.push(soundEvent(frameToMs(r.end, doc), ZONE_SOUND_STEMS.contested))
        continue
      }
      // THE SIDE COMES FROM THE DOCUMENT WHEN IT MEASURES IT (schema 64), and from the
      // arrival owner otherwise. The difference is not cosmetic: `ownerAfter` returns
      // `null` when the interval that opens is NEUTRAL, and the sound then stayed completely
      // silent — a neutralized base sounded neither the capture nor the contested.
      const c = sideOf(rampSide(z.gaugeRamps, r.end) ?? arrival)
      if (!c) continue
      out.push(soundEvent(frameToMs(r.start, doc), ZONE_SOUND_STEMS.capturing[c]))
    }
  }
  out.push(...dominationTicks(zones, allyTeam, doc))
  out.push(...subsequentHills(zones, doc))
  out.push(...hillSecurings(zones, allyTeam, doc))
  return out.sort((a, b) => a.ms - b.ms)
}

/**
 * ZONE_SECURING_MIN_MS — below it, the interval is not a securing but a TRANSFER.
 *
 * The channel publishes the neutral as much as the held (50 neutral intervals for 50 held
 * on `01e1f945`), and a hill changes hands several times per period. Without a floor, each
 * passing of a foot into the hill would trigger an 11.5 s siren. The floor is calibrated on
 * the sound itself: its first reading lasts 1.3 s after a 1.5 s action delay, so below three
 * seconds one would launch a gesture the interval does not let settle.
 *
 * The guards that score, for their part, last 36.8 to 50.3 s (measurement over 11 periods of
 * 3 films, `PLAN_KOTH_GARDE_VIVANTE_2026-08-30.md` § 1.1): the floor does not touch them.
 */
export const ZONE_SECURING_MIN_MS = 3000

/**
 * hillSecurings — the guard siren, once per possession interval of the ACTIVE hill.
 *
 * The trigger is `ZoneSpan.active` + `owner`: it is the only channel that speaks in King of
 * the Hill (its gauge, published since schema 92, does not sound). A neutral interval
 * (`owner` null) does not sound — no one is securing. Without a resolved allied side,
 * everything stays silent: same rule as everywhere else in this chain, the replay does not
 * guess a side.
 */
function hillSecurings(
  zones: readonly ZoneStateLike[],
  allyTeam: number | null,
  doc: ReplayDocumentReady,
): ReplaySoundEvent[] {
  if (allyTeam === null) return []
  const minFrames = msToFrames(ZONE_SECURING_MIN_MS, doc)
  const out: ReplaySoundEvent[] = []
  for (const z of zones) {
    for (const s of z.spans) {
      if (!s.active) continue
      if (s.owner === null || s.owner === undefined) continue
      if (s.t1 - s.t0 < minFrames) continue
      const c: ZoneSide = s.owner === allyTeam ? 'ally' : 'enemy'
      out.push(soundEvent(frameToMs(s.t0, doc), ZONE_SOUND_STEMS.securing[c]))
    }
  }
  return out
}

/**
 * gaugeRamps cuts the series into monotone climbs. A value that does not increase closes
 * the ramp in progress — that is the return to zero the Go publishes at the end of a ramp,
 * or simply the next point of another ramp.
 *
 * A ramp of a single point is not one: the gesture sought is a capture that LASTS.
 *
 * THE RAMP STARTS AT THE FIRST NON-ZERO POINT, AND THAT IS THE CORRECTION OF 2026-09-20.
 * The Go closes each ramp with a point at ZERO (`appendGaugeReset`,
 * `zone_states_gauge.go`), and that zero is also the first point of the NEXT increasing
 * series. Since the gauge is published thinned (one point per variation >= 0.02 or per
 * second of ramp, NOTHING outside a ramp), there is then no more point until the real
 * push: taking that zero for the start is announcing "a capture starts" at the instant the
 * PREVIOUS one just completed.
 *
 * MEASUREMENT, 2026-09-20, over the 8 zone documents of the cache (241 ramps): median
 * advance of the sound 17.6 s, maximum 173.1 s, 207 ramps out of 241 sounded more than 2 s
 * too early. Witness `396cfc92`, zone A: the published ramp runs from 73 600 to 103 900 ms,
 * the first non-zero point is at 97 000 ms — 23.4 s of advance, and 73 600 ms is exactly the
 * instant the enemy side had just finished ITS capture.
 *
 * THE SERIES BEING STRICTLY INCREASING, at most ONE point can be worth zero: the first. The
 * correction is therefore local and never moves the summit — `contested`, which sounds at
 * the END of the ramp, keeps its instant and only sees the gesture correctly bounded.
 */
function gaugeRamps(g: readonly GaugeLike[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  let i = 0
  while (i < g.length) {
    let j = i
    while (j + 1 < g.length && g[j + 1].v > g[j].v) j++
    if (j > i) out.push({ start: g[g[i].v === 0 ? i + 1 : i].t, end: g[j].t })
    i = j + 1
  }
  return out
}

/**
 * rampSide returns the side that the DOCUMENT measures for the ramp whose summit lands at
 * `end` (schema 64), or `undefined` when it measures none: aborted ramp, mute channel, or
 * artifact prior to the schema.
 *
 * THE JOIN IS MADE BY THE SUMMIT, not by the start: the published bounds are those of
 * `findZoneRamps` on the Go side, whose `t0` is the return to zero that closes the PREVIOUS
 * ramp (that is exactly the defect `gaugeRamps` corrects here). The summit, for its part,
 * is the same on both sides — it is the last point published of the ramp.
 */
function rampSide(
  ramps: readonly RampLike[] | null | undefined,
  end: number,
): number | undefined {
  for (const r of ramps ?? []) {
    if (r.t1 === end) return r.capturingTeam ?? undefined
  }
  return undefined
}

/**
 * ownerAfter returns the owner of the interval that STARTS at the closest point after the
 * end of a ramp — that is, the one the capture installed. Returns `undefined` when no
 * interval opens there: the ramp changed nothing, and the replay stays silent.
 */
function ownerAfter(spans: readonly SpanLike[], end: number): number | null | undefined {
  for (const s of spans) {
    if (s.t0 >= end && s.t0 <= end + TOLERANCE_FRAMES) return s.owner ?? null
  }
  return undefined
}

/**
 * TOLERANCE_FRAMES — the allowed gap between the end of a ramp and the opening of the
 * interval it produces. The gauge is THINNED at publication (one point per variation
 * >= 0.02 or per second), so its last point precedes the handoff by a few frames.
 */
const TOLERANCE_FRAMES = 20

/**
 * dominationTicks returns one tick per second as long as a side holds ALL the zones.
 *
 * THE GUARD IS DOUBLE, and each of its two halves has its reason: at least two zones (a
 * single zone is not a domination), and no `active` interval (that marker only lives in
 * King of the Hill, where a held hill would sound the whole match).
 */
function dominationTicks(
  zones: readonly ZoneStateLike[],
  allyTeam: number | null,
  doc: ReplayDocumentReady,
): ReplaySoundEvent[] {
  if (allyTeam === null || zones.length < 2) return []
  if (zones.some((z) => z.spans.some((s) => s.active))) return []
  const out: ReplaySoundEvent[] = []
  for (const iv of zoneDominationIntervals(zones)) {
    const stem = iv.owner === allyTeam ? ZONE_SOUND_STEMS.tick.ally : ZONE_SOUND_STEMS.tick.enemy
    const start = frameToMs(iv.t0, doc)
    const end = frameToMs(iv.t1, doc)
    // THE GAME'S CLOCK FIRST, THE SYNTHETIC CADENCE AS FALLBACK: same doctrine as everywhere
    // in this chain (a measurement outranks a deduction). `null` = the score layer does not
    // cover this side; an EMPTY array, for its part, is an answer — this side scored no point
    // while it dominated, and inventing ticks would contradict it.
    const mesures = pointInstants(doc.scoreTimeline, iv.owner, start, end, doc)
    for (const ms of mesures ?? derivedCadence(start, end)) out.push(soundEvent(ms, stem))
  }
  return out
}

/**
 * pointInstants — THE INSTANTS AT WHICH THIS SIDE SCORED, in the given window, or `null`
 * when the score layer does not cover it.
 *
 * `scoreTimeline.teams[].total` is a CUMULATIVE STAIRCASE: a STEP (`v` strictly greater
 * than the previous) is a point scored, and its `t` is a FRAME — the same grid as the rest
 * of the document (cf. `scoreAtFrame`). The FIRST point of the series is a step only if it
 * is non-zero: a series that starts at zero describes the initial state, not a point.
 *
 * THE WINDOW IS THE DOMINATION'S, bounds included: a point scored while a side holds all
 * the zones IS the tick the user describes. A point scored outside domination (a zone
 * capture, a frag depending on the variant) is not one.
 */
function pointInstants(
  timeline: ScoreStairsLike | undefined,
  owner: number,
  startMs: number,
  endMs: number,
  doc: ReplayDocumentReady,
): number[] | null {
  const serie = (timeline?.teams ?? []).find((t) => t.teamId === owner)?.total
  if (!serie || serie.length === 0) return null
  const out: number[] = []
  let precedent = 0
  for (const marche of serie) {
    const monte = marche.v > precedent
    precedent = marche.v
    if (!monte) continue
    const ms = frameToMs(marche.t, doc)
    if (ms >= startMs && ms <= endMs) out.push(ms)
  }
  return out
}

/**
 * derivedCadence — THE SYNTHETIC FALLBACK, when no score clock covers the side.
 *
 * THE PERIOD FOLLOWS THE DURATION, AND THAT IS THE WHOLE CORRECTION OF LOT 5.8.6: the event
 * budget no longer TRUNCATES the end of the interval, it stretches its cadence. Under three
 * minutes, the period is exactly the second demanded by the user (the floor) and the render
 * is UNCHANGED; beyond, the ticks space out instead of stopping.
 */
function derivedCadence(startMs: number, endMs: number): number[] {
  const duree = Math.max(0, endMs - startMs)
  const periode = Math.max(ZONE_TICK_PERIOD_MS, duree / ZONE_TICK_BUDGET_PAR_INTERVALLE)
  const out: number[] = []
  for (let ms = startMs; ms <= endMs; ms += periode) out.push(ms)
  return out
}

/**
 * zoneDominationIntervals returns the time slices in which ALL the zones have the same
 * non-null owner. The sweep is made over the BOUNDS of the intervals of all the zones — the
 * only grid where the state can change.
 *
 * EXPORTED FOR THE MEASUREMENT INSTRUMENT of lot 5.8.6 (`zoneTics.measure.test.ts`), and
 * that is deliberate: the only other way to measure the reach of the tick ceiling would have
 * been to recopy this sweep in the instrument, so to have a second version that drifts
 * without anything seeing it (lesson "test DDLs recopied"). No other production caller.
 */
export function zoneDominationIntervals(
  zones: readonly ZoneStateLike[],
): { t0: number; t1: number; owner: number }[] {
  const bornes = new Set<number>()
  for (const z of zones) for (const s of z.spans) bornes.add(s.t0)
  const grille = [...bornes].sort((a, b) => a - b)
  const out: { t0: number; t1: number; owner: number }[] = []
  for (const t of grille) {
    const owner = commonOwner(zones, t)
    if (owner === null) continue
    const dernier = out[out.length - 1]
    const fin = endOfDomination(zones, t, owner)
    if (dernier && dernier.owner === owner && t <= dernier.t1) {
      dernier.t1 = Math.max(dernier.t1, fin)
      continue
    }
    out.push({ t0: t, t1: fin, owner })
  }
  return out
}

/** commonOwner returns the side that holds ALL the zones at this frame, or `null`. */
function commonOwner(zones: readonly ZoneStateLike[], t: number): number | null {
  let owner: number | null = null
  for (const z of zones) {
    const s = z.spans.find((x) => covers(x, t))
    if (!s || s.owner === null || s.owner === undefined) return null
    if (owner === null) owner = s.owner
    else if (owner !== s.owner) return null
  }
  return owner
}

/** endOfDomination returns the last frame at which the side still holds all the zones. */
function endOfDomination(zones: readonly ZoneStateLike[], t: number, owner: number): number {
  let fin = Number.MAX_SAFE_INTEGER
  for (const z of zones) {
    const s = z.spans.find((x) => covers(x, t))
    if (!s || s.owner !== owner) return t
    fin = Math.min(fin, s.t1)
  }
  return fin
}

/**
 * subsequentHills returns one sound per MOVEMENT of the hill: every start of a hill PERIOD
 * except the first of the match.
 *
 * A PERIOD IS NOT AN INTERVAL, AND THAT IS THE CORRECTION OF 2026-09-20. The Go cuts a
 * hill period into SEVERAL contiguous `active` intervals, one per owner change — and it
 * even fills the holes of the channel with an `active` interval without a side
 * (`hillSpansOf`, `zone_states_hill_owners.go`). Sounding every interval made "new hill"
 * be heard at each HAND CHANGE of the same hill, several times per period, while the sound
 * announces a MOVEMENT.
 *
 * THE PERIOD IS REBUILT BY CONTIGUITY, ZONE BY ZONE: `hillSpansOf` sets `cursor = t1 + 1`
 * between two sub-intervals of the same period, so two `active` intervals of the SAME zone
 * that touch (`t0 === previous.t1 + 1`) belong to the same hill. A jump, or an interval of
 * ANOTHER zone, opens a period — that is, a movement.
 */
function subsequentHills(
  zones: readonly ZoneStateLike[],
  doc: ReplayDocumentReady,
): ReplaySoundEvent[] {
  const debuts: number[] = []
  for (const z of zones) debuts.push(...periodStarts(z.spans))
  debuts.sort((a, b) => a - b)
  return debuts
    .slice(1)
    .map((t) => soundEvent(frameToMs(t, doc), ZONE_SOUND_STEMS.newZone))
}

/**
 * periodStarts returns the start of each hill PERIOD of ONE zone: the `active` intervals
 * fused by contiguity (cf. `subsequentHills`).
 */
function periodStarts(spans: readonly SpanLike[]): number[] {
  const actifs = spans.filter((s) => s.active).sort((a, b) => a.t0 - b.t0)
  const out: number[] = []
  let finPrecedente: number | null = null
  for (const s of actifs) {
    if (finPrecedente === null || s.t0 !== finPrecedente + 1) out.push(s.t0)
    finPrecedente = s.t1
  }
  return out
}
