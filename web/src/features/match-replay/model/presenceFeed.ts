// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * presenceFeed — WHO HAS JOINED, WHO HAS LEFT. The API first, the film as fallback.
 *
 * TWO SOURCES, ONE HIERARCHY (user feedback 2026-09-02: « the API tells us precisely
 * when the player joined and when they left »):
 *
 *   API   the match's `PlayerParticipationInfo` — `joined_in_progress` / `left_in_progress`
 *         and their ABSOLUTE timestamps (`first_joined_time` / `last_leave_time`, RFC3339
 *         UTC, TZ bug of old matches fixed in the database on 2026-05-29). This is the
 *         PRECISE and AFFIRMATIVE source: the flags say the fact, not a deduction — a
 *         flag at `false` SILENCES this player, it is not an absence of data.
 *         The re-anchoring to the replay axis is THAT OF THE MEDIA (replayMediaLogic):
 *         replayMs = (absolute − header.start_time) − origin of the film — a single doctrine,
 *         carried by the clock of the page (`model/replayClock`).
 *
 *   FILM  the fallback, when the flags are missing (matches from before the columns, header
 *         absent): the life bounds. First life well after the start = entry;
 *         last life well before the end = « left the game » — the film does not distinguish
 *         a departure from a definitive elimination, the tooltip of the fallback carries the
 *         reservation. The margins (10 s / 20 s, >2x the median
 *         respawn measured at 8.0 s) exist ONLY on this path.
 *
 * ON THE FILM SIDE ONLY THE FIRST AND THE LAST LIFE SPEAK: a hole BETWEEN two lives
 * emits nothing (staying dead between two elimination rounds is normal). The API, it,
 * has no such problem — its flags are per match.
 */
import { stripBotSuffix } from '@/lib/players/displayName'

import type { ReplayFeedEntry } from './killFeedLogic'
import { replayClock, type ReplayClock } from './replayClock'
import { frameToMs, trackWindow } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import type { ReplayWindowBounds } from './replayWindow'
import { playerName, type ReplayPlayer } from '../../../lib/replay/rosterLogic'

/** FILM FALLBACK: first life starting beyond this = an arriver (wobble of the departure). */
export const PRESENCE_ARRIVE_MS = 10_000
/** FILM FALLBACK: last life ending earlier than this before the end = left the game (tooltip: departure or definitive elimination). */
export const PRESENCE_DEPART_MS = 20_000

/**
 * What the replay reads of the match view header: the ABSOLUTE origin of the match axis
 * (presence, siege relay), and — since 2026-09-06 — the MODE CATEGORY, which decides
 * the mold of the cards (`model/cardDensity.ts`, decision D1: compact if `BTB`). It is a
 * subset of `MatchViewHeader`: the page passes the whole header, the type names only
 * what is read.
 */
export interface PresenceHeader {
  start_time?: string | null
  mode_category?: string | null
}

/** A presence row of the feed: who, in which direction, and by which source. */
export interface PresenceEvent {
  kind: 'joined' | 'left'
  /**
   * THE BASE XUID when the join to the scoreboard succeeded, the key of the FILM otherwise
   * (`bot:<name>`, schema 36) — fixed on 2026-09-07 (review F3).
   *
   * WHY THIS IS NOT THE ROSTER KEY. Everything that pairs a presence row to
   * someone is keyed on the BASE xuid: the point of view (resolved against the scoreboard),
   * `identity`, `marks`, the teammate list. A BOT carries two identities — the
   * film key `bot:<name>` and the base xuid `bid(N.0)` — and this row carried the FIRST.
   * The shading of the timeline and the notches of the Teammates track therefore NEVER found a
   * bot: on the witness match, where the bot IS the substitute, its track had neither shadow nor door
   * while the feed, two centimeters to the right, was writing « joined ». The feed gains from
   * the same stroke its team color, which it served to the fallback ink.
   */
  xuid: string
  name: string
  bot: boolean
  /** `api` = participation flags (precise); `film` = derived from the life bounds. */
  source: 'api' | 'film'
}

/**
 * presenceEntries — the entry/exit rows, ready to be merged into the feed.
 *
 * Rendered as `ReplayFeedEntry` (kill/medal/death at null, `presence` set): the feed
 * sorts them and windows them exactly like the other rows, no second time axis.
 */
export function presenceEntries(
  players: readonly ReplayPlayer[],
  playWindow: ReplayWindowBounds | null,
  doc: ReplayDocumentReady,
  header?: PresenceHeader | null,
): ReplayFeedEntry[] {
  // THE SAME VERDICT AS THE REST OF THE PAGE (`model/replayClock`): without an established clock, an
  // entry row would be set at a time off by 3.6 to 50.8 s. The gameplay window
  // does not exist at all in this case either — the two doors say the same thing.
  const clock = replayClock(doc)
  if (!playWindow || !clock) return []
  const matchStartMs = parseInstant(header?.start_time)
  const out: ReplayFeedEntry[] = []
  for (const p of players) {
    const rawName = playerName(p)
    if (!rawName) continue
    // Suffix « [bot] » = killsource data marker (schema 36), removed before
    // entering the presence row (« joined » / « left »).
    const name = stripBotSuffix(rawName)
    // THE API PATH ASKS FOR NO LIFE: a substitute whose bridge could not name
    // the lives (bot of the witness match 1b2d9e08) still joined the game — the database dates it,
    // the row displays. Only the FILM FALLBACK demands lives: it has nothing else.
    const api = apiPresence(p, name, matchStartMs, clock, playWindow)
    if (api) {
      out.push(...api)
      continue
    }
    if (p.lives.length > 0) out.push(...filmPresence(p, name, playWindow, doc))
  }
  return out
}

/**
 * apiPresence — the PRECISE path. Returns `null` when participation is not decidable
 * (scoreboard row absent, flags NULL, or header without start time — without it
 * an absolute timestamp cannot be set on the axis): the film fallback then takes over.
 * Returns `[]` when the API SAYS that the player neither joined nor left in progress: silence
 * AFFIRMATIVE, the film has not to contradict it.
 */
function apiPresence(
  p: ReplayPlayer,
  name: string,
  matchStartMs: number | null,
  clock: ReplayClock,
  playWindow: ReplayWindowBounds,
): ReplayFeedEntry[] | null {
  const b = p.board
  if (!b || matchStartMs === null) return null
  if (b.joined_in_progress == null && b.left_in_progress == null) return null
  const out: ReplayFeedEntry[] = []
  const toReplayMs = (iso: string | null | undefined): number | null => {
    const abs = parseInstant(iso)
    return abs === null ? null : clock.filmMsOfMatchMs(abs - matchStartMs)
  }
  if (b.joined_in_progress) {
    const ms = toReplayMs(b.first_joined_time)
    // A true flag without a readable timestamp sets nothing: an entry at an
    // invented time would be worse than its absence.
    if (ms !== null) out.push(entry('joined', 'api', p, name, clamp(ms, playWindow)))
  }
  if (b.left_in_progress) {
    const ms = toReplayMs(b.last_leave_time)
    if (ms !== null) out.push(entry('left', 'api', p, name, clamp(ms, playWindow)))
  }
  return out
}

/** filmPresence — the FALLBACK: the life bounds, with their margins (cf. header). */
function filmPresence(
  p: ReplayPlayer,
  name: string,
  playWindow: ReplayWindowBounds,
  doc: ReplayDocumentReady,
): ReplayFeedEntry[] {
  const out: ReplayFeedEntry[] = []
  const first = trackWindow(p.lives[0])
  const last = trackWindow(p.lives[p.lives.length - 1])
  const firstMs = frameToMs(first.start, doc)
  const lastMs = frameToMs(last.end, doc)
  if (firstMs - playWindow.startMs > PRESENCE_ARRIVE_MS) {
    out.push(entry('joined', 'film', p, name, firstMs))
  }
  if (playWindow.endMs - lastMs > PRESENCE_DEPART_MS) {
    out.push(entry('left', 'film', p, name, lastMs))
  }
  return out
}

/** The API time, bounded to the gameplay window: an off-axis row would not be readable. */
function clamp(ms: number, w: ReplayWindowBounds): number {
  return Math.min(Math.max(ms, w.startMs), w.endMs)
}

function parseInstant(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

function entry(
  kind: PresenceEvent['kind'],
  source: PresenceEvent['source'],
  p: ReplayPlayer,
  name: string,
  replayMs: number,
): ReplayFeedEntry {
  // THE BASE XUID FIRST (2026-09-07, review F3): it is the key on which the
  // point of view, the marks and the teammates pair. The film key serves only for lack of a scoreboard
  // row — in which case nothing pairs anyway, and the feed names anyway.
  const xuid = p.board?.xuid ?? p.xuid
  return {
    key: `p-${kind}-${xuid}-${replayMs}`,
    replayMs,
    kill: null,
    medal: null,
    death: null,
    presence: { kind, xuid, name, bot: p.bot === true, source },
  }
}

/** Merges the feed and the presence rows, re-sorted on the common axis. */
export function mergeFeedWithPresence(
  feed: readonly ReplayFeedEntry[],
  presence: readonly ReplayFeedEntry[],
): ReplayFeedEntry[] {
  if (presence.length === 0) return [...feed]
  return [...feed, ...presence].sort((a, b) => a.replayMs - b.replayMs)
}
