// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * killFeedLogic.ts — THE FEED OF ELIMINATIONS ON THE REPLAY CLOCK.
 *
 * TWO CLOCKS, AND THAT IS THE WHOLE SUBJECT. The events served by the Match View are aligned
 * to the start of the GAMEPLAY (`correctMatchViewEventsT0`): adding `t0Ms` to them — the TRUE T0
 * of the match, taken from `match_registry.real_start_time` — reconstructs exactly the clock of the
 * film. The replay artifact, for its part, anchors its frame 0 to the FIRST POSITION PACKET of the
 * film, an instant that varies from 3.6 s to 39.8 s depending on the match (loading and
 * staging). So there remains ONE offset between the two, and only one.
 *
 * THIS OFFSET IS NOW PUBLISHED BY THE ARTIFACT (`originMs`, schema v4, read by the page's
 * single clock — `model/replayClock`): it is
 * the instant of frame 0 on the feed's clock, measured offline as the difference of
 * two packet headers of the same film (cf. Go `internal/games/halo_infinite/film/replay/origin.go`). The
 * nominal alignment is therefore a SUBTRACTION, `alignFeedByOrigin`:
 *
 *     replayMs = event_time_ms + t0Ms − originMs
 *
 * WHAT IT REPLACES, AND WHY. The previous path (`alignFeedToTracks`, 2026-08-14)
 * MEASURED this offset in the browser, by pairing kills to the life ends of their
 * victims: median +3,678 ms on 000d5950, +10,589 ms on 64e8adfa, +39,856 ms on
 * e94163af. The same values come out of the artifact within 20-70 ms — but the pairing
 * REQUIRES named victims, and there are none on the matches that `killer_victim_pairs`
 * does not cover (witness 606d9844: 35 kills, 0 named victim, no alignment possible).
 * The published origin, it, depends on no coverage.
 *
 * IT STAYS AS A FALLBACK, and only there: artifact predating schema v4, or origin that
 * the producer refused to establish (unreadable chunk, contradictory witness — it then
 * publishes nothing rather than a doubtful origin).
 *
 * THE FEED IS PERMANENT (user verdict 2026-08-13, aligned with the POC): it keeps EVERYTHING
 * since the start of the match, the most recent first, and scrolls to go back to the old
 * frags. No window, no remanence — the previous ephemeral made one lose the thread.
 *
 * DEATHS WITHOUT A KILLER (suicides, falls, departures) get their own NEUTRAL line
 * (product decision 2026-08-13): a closed life end that no kill claims is
 * a death the feed must tell — witness measurement 64e8adfa: 123 deaths on the scoreboard for
 * 121 kills, and exactly 2 orphan life ends. The pairing by victim guarantees
 * that a death already served by a kill line is NEVER doubled.
 *
 * WHAT THE CLIENT CANNOT DEDUCE FROM THESE DEATHS is WHAT the player died of:
 * that is read in the film, offline. The document publishes it (`doc.neutralDeaths`, schema
 * v5) and `attachDeathKinds` places it on the line, on the SAME clock as the rest of the feed.
 * A death whose type is not established keeps its neutral marker — never the icon of a
 * death that was not it.
 *
 * THE MEDALS come from the same highlight events (event_type `medal`), identity
 * resolved on the backend (locale-aware label/description + visual). A medal
 * attaches to the kill of the SAME actor at less than 500 ms — measurement on the witness: 42 of the 44
 * medals attach to it, the 2 remaining ones display alone rather than being forced
 * (same rule as the POC).
 *
 * No React: pure logic, tested (killFeedLogic.test.ts).
 */
import type { KillEvent } from '@/features/match-view/_momentum'
import type { MatchHighlightEvent } from '@/lib/api/types'

import { replayClock, type ReplayClock } from './replayClock'
import { frameToMs, msToFrames, trackWindow } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'

/**
 * Tolerance for attaching a medal to the kill of the same actor, in ms. Measured on
 * 000d5950: 42/44 at ≤ 500 ms, and NONE more attaches before 5,000 ms — the threshold
 * sits in a plateau, not on a slope.
 */
export const MEDAL_ATTACH_MS = 500

/**
 * A kill placed on the time axis of the replay.
 *
 * WITHOUT `ally`, AND THAT IS A LOCK (2026-10-06): the flag that the match view bakes into
 * `KillEvent` comes from the sheet; on the Replay page, the allegiance of an actor is read in the
 * FILM (`FilmAllegiance.ofXuid`). Removing it from the type makes a re-read of the flag impossible to
 * compile, instead of leaving it to the vigilance of a re-read.
 */
export interface ReplayKill extends Omit<KillEvent, 'ally'> {
  /** Instant of the kill on the REPLAY AXIS, in milliseconds from frame 0 of the document. */
  replayMs: number
  /** The medals won by the killer on this kill (±500 ms), in feed order. */
  medals: MedalEvent[]
}

/** A medal of the feed, identity resolved on the backend. */
export interface MedalEvent {
  /** Instant on the gameplay clock (event_time_ms). */
  tMs: number
  xuid: string
  gamertag: string
  /** Measured ENGLISH name (film). Always present — it is the key of the registry. */
  name: string
  /** Locale-aware label. Empty = unresolved: the raw name is displayed in full. */
  label: string
  description: string
  imageUrl: string
}

/**
 * collectMedalEvents extracts the usable `medal` events: an actor, an instant, a
 * name. A medal event without a name (raw_json unreadable on the backend) is set aside — there is
 * nothing to show from it, not even text.
 */
export function collectMedalEvents(
  events: MatchHighlightEvent[] | null | undefined,
): MedalEvent[] {
  const out: MedalEvent[] = []
  for (const e of events ?? []) {
    if ((e.event_type ?? '').toLowerCase() !== 'medal') continue
    if (!e.actor_xuid || e.event_time_ms == null || !e.medal_name) continue
    out.push({
      tMs: e.event_time_ms,
      xuid: e.actor_xuid,
      gamertag: e.actor_gamertag ?? '',
      name: e.medal_name,
      label: e.medal_label ?? '',
      description: e.medal_description ?? '',
      imageUrl: e.medal_image_url ?? '',
    })
  }
  return out
}

/**
 * A line of the feed: a kill (with its attached medals), OR a medal alone, OR
 * a neutral death — never two at once. The medal alone exists because forcing a
 * distant attachment would hook the medal to the wrong kill; the neutral death because
 * a death without a credited killer remains a death the feed must tell.
 */
export interface ReplayFeedEntry {
  /** Stable rendering key. */
  key: string
  /** Instant of the line on the replay axis. */
  replayMs: number
  kill: ReplayKill | null
  medal: MedalEvent | null
  death: ReplayDeath | null
  /**
   * ENTRY/EXIT line of the match, derived from the life bounds (cf. presenceFeed.ts,
   * 2026-09-02). Optional: only the lines merged by `mergeFeedWithPresence`
   * carry it — this file never produces any.
   */
  presence?: import('./presenceFeed').PresenceEvent | null
}

/**
 * toReplayKills aligns the kills to the RAW clock of the film and sorts them
 * chronologically. It is the last fallback, when no document is available — the
 * nominal path is `alignFeedByOrigin` (cf. header).
 *
 * `t0Ms` is 0 when the countdown is unknown: the T0 correction then did not take place
 * on the events side either, and adding nothing is exactly right.
 */
export function toReplayKills(kills: KillEvent[], t0Ms: number): ReplayKill[] {
  const offset = replayOffset(t0Ms)
  return kills
    .map((k) => ({ ...k, replayMs: k.tMs + offset, medals: [] as MedalEvent[] }))
    .sort((a, b) => a.replayMs - b.replayMs)
}

function replayOffset(t0Ms: number): number {
  return Number.isFinite(t0Ms) && t0Ms > 0 ? t0Ms : 0
}

/**
 * Pairing tolerance of a kill to a life end of its victim, in ms, AFTER
 * correcting the measured median offset. The true pairs cluster within ±150 ms of the
 * median (87/91 on 000d5950) and two lives of the same player are separated by at least one
 * respawn delay (~8 s measured): 2 s can neither miss a true pair nor
 * confuse two.
 */
export const KILL_MATCH_TOL_MS = 2_000

/**
 * Veto window of a neutral death line around a kill WITHOUT a named victim: as long
 * as the killer_victim_pairs coverage is partial, an unattributed kill can be
 * that of this death — a death that may already have its line is never doubled.
 */
export const NEUTRAL_DEATH_VETO_MS = 4_000

/**
 * Margin below the artifact's horizon beyond which a life end is a TRUE
 * death and not an end-of-match survivor (measurement 000d5950: the 3 lives of the survivors
 * close within the last 3 seconds of the document).
 */
export const SURVIVOR_GRACE_MS = 3_000

/** A death WITHOUT a kill line (suicide, fall, departure), read from the film's tracks. */
export interface ReplayDeath {
  /** Instant of the life end on the replay clock — the same as the card flash. */
  replayMs: number
  xuid: string
  /**
   * The TYPE of death, when the document establishes it: `environment` (fall, out of bounds) or
   * `suicide` (the player killed himself with his own damage source). Empty = NOT ESTABLISHED, and the
   * line then keeps its neutral marker — never the icon of a death that was not it.
   */
  kind: string
  /** Pictogram of the type and tint mask. Empty at the same time as `kind`. */
  img: string
  tinted: boolean
}

/** The aligned feed: kills aligned, neutral deaths, offset applied. */
export interface AlignedFeed {
  kills: ReplayKill[]
  deaths: ReplayDeath[]
  /**
   * Offset subtracted from the feed's clock to bring it onto the replay axis, in ms:
   * the ORIGIN published by the artifact on the nominal path, the measured MEDIAN OFFSET
   * (`event_time_ms + t0Ms − life end`) on the fallback. Null when nothing is correctable —
   * no published origin, nor any (victim, life end) pair to measure.
   *
   * The lines that are not kills (medals alone) use it to stay on the
   * same clock as their neighbors.
   */
  offsetMs: number | null
}

/** A life end candidate to the pairing — internal to the alignment. */
interface LifeEnd {
  xuid: string
  endMs: number
  /** Closed BEFORE the document's horizon: a true death, not a survivor. */
  closed: boolean
  used: boolean
}

/**
 * alignFeed places the feed on the replay axis. It is the single ENTRY POINT of the alignment:
 * the page's clock when it is established, the statistical pairing otherwise.
 *
 * THE FEED IS THE ONLY SURFACE THAT MEASURES, and that is a NAMED exception in the clock
 * policy of the page (`model/replayClock`): it alone has a second source for
 * the origin — the pairing of the kills to the life ends of their victims — and this measurement
 * is corroborated (cf. the header of this file). The fallback is therefore not an old path one
 * forgot to remove: an artifact predating schema v4 has no origin, and the
 * producer REFUSES to publish one when it cannot establish it (cf. origin.go). In
 * these two cases, the measurement by pairing remains the least wrong — when the match has
 * named victims.
 */
export function alignFeed(
  kills: KillEvent[],
  t0Ms: number,
  doc: ReplayDocumentReady,
): AlignedFeed {
  const clock = replayClock(doc)
  const feed = clock
    ? alignFeedByOrigin(kills, t0Ms, doc, clock)
    : alignFeedToTracks(kills, t0Ms, doc)
  // THE TYPE OF DEATH IS PLACED HERE, once for both alignments: it depends on the
  // offset, and the offset is only known once the alignment is chosen. Placing it in
  // each of the two branches would make two copies that would diverge.
  attachDeathKinds(feed.deaths, doc, feed.offsetMs)
  return feed
}

/**
 * alignFeedByOrigin — THE NOMINAL PATH: a subtraction, not a pairing.
 *
 * `replayMs = event_time_ms + t0Ms − originMs`, applied to ALL the kills, whether they carry
 * a named victim or not. No coverage is required, no kill is left on
 * another clock than its neighbors.
 *
 * THE NEUTRAL DEATHS remain derived from the tracks, because nothing else carries them: a
 * closed life end that no kill claims is a death the feed must tell. Two
 * guards, identical to those of the fallback: a kill of the SAME victim at less than
 * `KILL_MATCH_TOL_MS` consumes the life end; a kill WITHOUT a named victim at less than
 * `NEUTRAL_DEATH_VETO_MS` vetoes it — as long as `killer_victim_pairs` is partial,
 * that kill can be that of this death, and a death already served is never doubled.
 */
export function alignFeedByOrigin(
  kills: KillEvent[],
  t0Ms: number,
  doc: ReplayDocumentReady,
  clock: ReplayClock,
): AlignedFeed {
  const offset = replayOffset(t0Ms)
  const aligned: ReplayKill[] = kills
    .map((k) => ({
      ...k,
      replayMs: clock.filmMsOfMatchMs(k.tMs + offset),
      medals: [] as MedalEvent[],
    }))
    .sort((a, b) => a.replayMs - b.replayMs)

  const ends = lifeEndsOf(doc)
  for (const k of aligned) {
    if (!k.victimXuid) continue
    let best: LifeEnd | null = null
    let bestScore = Number.POSITIVE_INFINITY
    for (const e of ends) {
      if (e.used || e.xuid !== k.victimXuid) continue
      const score = Math.abs(k.replayMs - e.endMs)
      if (score < bestScore) {
        bestScore = score
        best = e
      }
    }
    if (best && bestScore <= KILL_MATCH_TOL_MS) best.used = true
  }
  const unattributed = aligned.filter((k) => !k.victimXuid)
  const deaths: ReplayDeath[] = []
  for (const e of ends) {
    if (!e.closed || e.used) continue
    if (unattributed.some((k) => Math.abs(k.replayMs - e.endMs) <= NEUTRAL_DEATH_VETO_MS)) continue
    deaths.push(neutralDeath(e.endMs, e.xuid))
  }
  deaths.sort((a, b) => a.replayMs - b.replayMs)
  return { kills: aligned, deaths, offsetMs: clock.originMs }
}

/**
 * neutralDeath builds a neutral death line WITHOUT a type. The type is placed afterwards by
 * `attachDeathKinds`, once the feed's offset is known — it alone allows bringing
 * the document's clock (where the type is dated) close to the replay axis (where the line lives).
 */
function neutralDeath(replayMs: number, xuid: string): ReplayDeath {
  return { replayMs, xuid, kind: '', img: '', tinted: false }
}

/**
 * attachDeathKinds places on each neutral death the TYPE the document gives it — fall /
 * out of bounds, or its own damage source.
 *
 * WHAT THE CLIENT CANNOT DEDUCE, AND WHY THIS JOIN EXISTS. The feed already knows
 * WHO died and WHEN (a life end no kill claims). What it cannot
 * know is WHAT: that is read in the dead-state component of the film, offline. The
 * document therefore publishes these deaths with their type — and on ITS clock, the feed's.
 *
 * THE ALIGNMENT IS THE SAME AS FOR THE REST OF THE FEED, and it must be: `feedMs − offsetMs`,
 * exactly what the kills and the medals alone undergo. An entry placed on a
 * clock other than the line it decorates would never meet it.
 *
 * THE PAIRING IS CONSTRAINED ON BOTH SIDES: same xuid, and less than `KILL_MATCH_TOL_MS`
 * apart — the same tolerance as the pairing of a kill to the life end of its victim, and
 * for the same reason (two lives of the same player are separated by at least one respawn delay).
 * Each entry serves only ONCE. Nothing is placed without a pairing: a
 * line without a type keeps its neutral marker, NEVER the icon of a death that was not it.
 */
export function attachDeathKinds(
  deaths: ReplayDeath[],
  doc: ReplayDocumentReady,
  offsetMs: number | null,
): void {
  if (deaths.length === 0 || doc.neutralDeaths.length === 0) return
  const shift = offsetMs ?? 0
  const used = new Set<number>()
  for (const d of deaths) {
    let bestIdx = -1
    let bestScore = KILL_MATCH_TOL_MS + 1
    doc.neutralDeaths.forEach((n, i) => {
      if (used.has(i) || n.xuid !== d.xuid) return
      const score = Math.abs(d.replayMs - (n.feedMs - shift))
      if (score < bestScore) {
        bestScore = score
        bestIdx = i
      }
    })
    if (bestIdx < 0) continue
    used.add(bestIdx)
    const n = doc.neutralDeaths[bestIdx]
    d.kind = n.kind
    d.img = n.img ?? ''
    d.tinted = n.tinted ?? false
  }
}

/**
 * lifeEndsOf re-reads the life ends of the tracks and says which are CLOSED before
 * the document's horizon (a life closing in the last seconds is an end-of-match
 * survivor, not a death). Shared by the two alignments: the definition of a
 * life end must not depend on the path that reads it.
 */
function lifeEndsOf(doc: ReplayDocumentReady): LifeEnd[] {
  const ends: LifeEnd[] = []
  let maxEndFrame = 0
  for (const tr of doc.tracks) {
    if (!tr.xuid || tr.points.length === 0) continue
    const endFrame = trackWindow(tr).end
    if (endFrame > maxEndFrame) maxEndFrame = endFrame
    ends.push({ xuid: tr.xuid, endMs: frameToMs(endFrame, doc), closed: false, used: false })
  }
  const horizonFrame = (doc.frameCount ?? 0) > 1 ? (doc.frameCount ?? 0) - 1 : maxEndFrame
  const graceMs = frameToMs(Math.max(0, horizonFrame - msToFrames(SURVIVOR_GRACE_MS, doc)), doc)
  for (const e of ends) e.closed = e.endMs < graceMs
  return ends
}

/**
 * alignFeedToTracks aligns the kills to the TRACKS reference — the one that dates
 * the flash of the cards — and derives the neutral deaths from it. It is the FALLBACK (cf. `alignFeed`):
 * it is used only when the artifact does not publish its origin.
 *
 * TWO PASSES, BOTH MEASURED:
 *  1. the median offset per match (ordered pairing kill↔life end per victim —
 *     the median resists the lives not published by the film);
 *  2. the nearest pairing once the offset is subtracted, each life end
 *     consumed ONCE. A paired kill is placed ON the life end of its victim
 *     (same instant as the flash); a non-pairable kill is corrected by the median offset;
 *     with no measurement at all (no named victim), the raw clock remains the least wrong.
 *
 * THE NEUTRAL DEATHS come only out of a document where the pairing took place: without
 * named victims, impossible to guarantee that a life end does not already have its line.
 */
export function alignFeedToTracks(
  kills: KillEvent[],
  t0Ms: number,
  doc: ReplayDocumentReady,
): AlignedFeed {
  const offset = replayOffset(t0Ms)
  const ends = lifeEndsOf(doc)

  // PASS 1 — the measurement: life ends and kills of the same victim, sorted, paired by
  // rank. The median of the gaps is the offset of the document (robust to the lives the
  // film did not publish: they shift ranks, not half of the pairs).
  const rawKills = kills.map((k) => ({ k, raw: k.tMs + offset }))
  const endsByXuid = new Map<string, number[]>()
  for (const e of ends) {
    const list = endsByXuid.get(e.xuid)
    if (list) list.push(e.endMs)
    else endsByXuid.set(e.xuid, [e.endMs])
  }
  const killsByVictim = new Map<string, number[]>()
  for (const { k, raw } of rawKills) {
    if (!k.victimXuid) continue
    const list = killsByVictim.get(k.victimXuid)
    if (list) list.push(raw)
    else killsByVictim.set(k.victimXuid, [raw])
  }
  const dts: number[] = []
  for (const [xuid, kts] of killsByVictim) {
    const es = (endsByXuid.get(xuid) ?? []).slice().sort((a, b) => a - b)
    kts.sort((a, b) => a - b)
    for (let i = 0; i < Math.min(kts.length, es.length); i++) dts.push(kts[i] - es[i])
  }
  dts.sort((a, b) => a - b)
  const offsetMs = dts.length > 0 ? dts[Math.floor(dts.length / 2)] : null

  // PASS 2 — the pairing: nearest once the offset is subtracted, in
  // chronological order, each life end served only once.
  const aligned: ReplayKill[] = []
  for (const { k, raw } of [...rawKills].sort((a, b) => a.raw - b.raw)) {
    let best: LifeEnd | null = null
    let bestScore = Number.POSITIVE_INFINITY
    if (k.victimXuid && offsetMs !== null) {
      for (const e of ends) {
        if (e.used || e.xuid !== k.victimXuid) continue
        const score = Math.abs(raw - e.endMs - offsetMs)
        if (score < bestScore) {
          bestScore = score
          best = e
        }
      }
    }
    if (best && bestScore <= KILL_MATCH_TOL_MS) {
      best.used = true
      aligned.push({ ...k, replayMs: best.endMs, medals: [] })
    } else {
      aligned.push({ ...k, replayMs: raw - (offsetMs ?? 0), medals: [] })
    }
  }
  aligned.sort((a, b) => a.replayMs - b.replayMs)

  // NEUTRAL DEATHS: the closed life ends no kill consumed — under the guard
  // of effective pairing, and under the veto of a kill without a victim in the neighborhood.
  const deaths: ReplayDeath[] = []
  if (offsetMs !== null) {
    const unattributed = aligned.filter((k) => !k.victimXuid)
    for (const e of ends) {
      if (!e.closed || e.used) continue
      const vetoed = unattributed.some((k) => Math.abs(k.replayMs - e.endMs) <= NEUTRAL_DEATH_VETO_MS)
      if (!vetoed) deaths.push(neutralDeath(e.endMs, e.xuid))
    }
    deaths.sort((a, b) => a.replayMs - b.replayMs)
  }
  return { kills: aligned, deaths, offsetMs }
}

/**
 * buildFeedEntries assembles the feed: kills aligned by `alignFeed` when the document is
 * provided (published origin, pairing as fallback), neutral deaths as
 * proper lines, medals attached to the nearest kill of the same actor
 * (±MEDAL_ATTACH_MS, on the gameplay clock common to both sources), orphan
 * medals as lines alone. Sorted chronologically.
 *
 * Without a document (tests, historical calls): raw alignment `+t0Ms`, no neutral death.
 */
export function buildFeedEntries(
  kills: KillEvent[],
  medals: MedalEvent[],
  t0Ms: number,
  doc?: ReplayDocumentReady | null,
): ReplayFeedEntry[] {
  const alignedFeed: AlignedFeed =
    doc && doc.tracks.length > 0
      ? alignFeed(kills, t0Ms, doc)
      : { kills: toReplayKills(kills, t0Ms), deaths: [], offsetMs: null }
  const rk = alignedFeed.kills
  const offset = replayOffset(t0Ms)
  const alone: MedalEvent[] = []
  for (const m of medals) {
    let best: ReplayKill | null = null
    let bestDt = MEDAL_ATTACH_MS + 1
    for (const k of rk) {
      if (k.xuid !== m.xuid) continue
      const dt = Math.abs(k.tMs - m.tMs)
      if (dt < bestDt) {
        best = k
        bestDt = dt
      }
    }
    if (best && bestDt <= MEDAL_ATTACH_MS) best.medals.push(m)
    else alone.push(m)
  }
  const entries: ReplayFeedEntry[] = rk.map((k, i) => ({
    key: `k-${k.xuid}-${k.replayMs}-${i}`,
    replayMs: k.replayMs,
    kill: k,
    medal: null,
    death: null,
  }))
  alone.forEach((m, i) => {
    entries.push({
      key: `m-${m.xuid}-${m.tMs}-${i}`,
      // The medal alone follows the same offset correction as the kills: a line
      // of the feed does not live on another clock than its neighbors.
      replayMs: m.tMs + offset - (alignedFeed.offsetMs ?? 0),
      kill: null,
      medal: m,
      death: null,
    })
  })
  alignedFeed.deaths.forEach((d, i) => {
    entries.push({
      key: `d-${d.xuid}-${d.replayMs}-${i}`,
      replayMs: d.replayMs,
      kill: null,
      medal: null,
      death: d,
    })
  })
  return entries.sort((a, b) => a.replayMs - b.replayMs)
}

/**
 * killsOfFeed — THE KILLS OF THE FEED, ALREADY ALIGNED.
 *
 * WHY THIS EXTRACTION EXISTS (register 2026-09-05, J2). The alignment is assembled once
 * only, in the page (`buildFeedEntries`), and the route's comment writes it:
 * « THE ALIGNED FEED, ASSEMBLED HERE AND NOWHERE ELSE ». Two downstream consumers — the
 * death effects of the map and the sound track — were redoing it from the
 * RAW kills: four runs of the same alignment per load, and above all two paths
 * that would diverge on the day the canvas no longer receives exactly the same kills. They
 * now take their instants HERE, on the feed itself.
 *
 * The order is that of the feed, hence chronological: `buildFeedEntries` sorts on `replayMs`.
 */
export function killsOfFeed(entries: readonly ReplayFeedEntry[]): ReplayKill[] {
  const out: ReplayKill[] = []
  for (const e of entries) if (e.kill) out.push(e.kill)
  return out
}

/**
 * feedAt renders the lines already occurred at the instant `nowMs` of the replay, from the most recent
 * to the oldest — the COMPLETE feed, without a window: the past lines stay, the
 * scroll does the rest.
 *
 * `entries` MUST be sorted (output of `buildFeedEntries`): the cut stops at the first
 * element later than the current instant.
 */
export function feedAt(entries: ReplayFeedEntry[], nowMs: number): ReplayFeedEntry[] {
  const out: ReplayFeedEntry[] = []
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e.replayMs > nowMs) continue
    out.push(e)
  }
  return out
}
