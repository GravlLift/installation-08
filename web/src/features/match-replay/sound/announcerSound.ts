// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * announcerSound.ts — THE ANNOUNCER: which voice calls the followed player hears, and when.
 *
 * THREE STEPS, ALL PURE:
 *  1. `announcerCalls` reads the match's events and keeps the calls the followed player would
 *     hear: their OWN medals (never another player's), the objective actions of either side
 *     with the variant that side has from where the followed player stands ("ours" or
 *     "theirs"), each round transition (heard by everyone), and the calls about the match itself
 *     (`announcerMatchCalls.ts`: mode name, time warnings, overtime, lost lead).
 *  2. `scheduleAnnouncer` makes the calls take turns on ONE line (rule below).
 *  3. `announcerSoundEvents` turns the cues into ordinary track events flagged `announcer`: the
 *     player plays them flat (no position, no voice ceiling), and the cursor, the pause, the
 *     speed mute and the film export treat them like every other track event. A seek never
 *     replays a burst of old calls because the cursor reseeds in silence on a jump.
 *
 * ONE LINE, NO OVERLAP. A call that comes while another plays WAITS; when the line frees, the
 * waiting call of the highest class goes first (ties: the oldest). A call that has waited more
 * than `ANNOUNCER_MAX_WAIT_MS` is DROPPED: it would describe a moment the replay has already
 * left. The class order is `ANNOUNCER_PRIORITY`: a round end first (it closes everything that
 * came before it, and every player hears it), then the match calls (the clock and the lead are
 * the whole lobby's), then objective calls (they change the match for a whole team), then medals
 * (they concern one player). The game's own queue rule is not in any
 * data this viewer has; this order and the wait bound are the documented choice.
 *
 * ONLY CALLS WITH A FILE ENTER THE QUEUE. A call whose line has no file in the current language
 * is removed before scheduling: a silent call must not delay or push out an audible one. The
 * lines are the bundled "round over" voice plus whatever `build-sounds` extracted from the user's
 * game (`announcerVoice.ts`); the end-of-match voice is played by the end bound
 * (`endMatchSound.ts`), not by this track, and never by both.
 *
 * A LINE WITH SEVERAL TAKES picks one from the call's own moment (`takeIndex`): the same match
 * sounds the same on every play and in every export.
 */
import type { ReplayLocale } from '../i18n/i18n'
import type { ReplayFeedEntry } from '../model/killFeedLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { objectiveActionClock, type ObjectiveSide } from './objectiveSound'
import { ROUND_OVER_SOUND_STEMS, roundOverTimes } from './roundOverSound'
import { soundEvent, type ReplaySoundEvent } from './replaySoundVariants'
import { announcerMatchCalls, type AnnouncerMatch } from './announcerMatchCalls'
import { combineVoices, tableVoice, type AnnouncerLines, type AnnouncerTake, type AnnouncerVoice } from './announcerVoice'

/** The call classes, HIGHEST PRIORITY FIRST (see the header). */
export const ANNOUNCER_PRIORITY = ['round', 'match', 'objective', 'medal'] as const
export type AnnouncerClass = (typeof ANNOUNCER_PRIORITY)[number]

/** How long a call may wait for the line before it is dropped, in ms. */
export const ANNOUNCER_MAX_WAIT_MS = 3_000

/** A call the game would make, at the moment of its event, before scheduling. */
export interface AnnouncerCall {
  ms: number
  key: string
  cls: AnnouncerClass
}

/** A scheduled call: the moment it starts, and the call it says. */
export interface AnnouncerCue {
  timeMs: number
  call: AnnouncerCall
}

/** The call key of a round end. */
export const ROUND_OVER_CALL = 'round_over'

/**
 * ANNOUNCER_LINES — the lines the bundled sound set carries, by call key then language.
 * Durations measured on the delivered files with `ffprobe` (2026-11-13). A call key absent from
 * this table is silent.
 */
export const ANNOUNCER_LINES: AnnouncerLines = {
  [ROUND_OVER_CALL]: {
    fr: { stem: ROUND_OVER_SOUND_STEMS.fr, durationMs: 1_756 },
    en: { stem: ROUND_OVER_SOUND_STEMS.en, durationMs: 1_713 },
  },
}

/** A medal on the replay axis, with its owner and its English name (the registry key). */
export interface FeedMedal {
  ms: number
  xuid: string
  name: string
}

/**
 * medalsOfFeed — every medal of the aligned feed, on the replay axis. A medal attached to a kill
 * keeps its own offset from that kill (up to `MEDAL_ATTACH_MS`), a lone medal keeps its line's
 * moment: both on the same clock as the kills.
 */
export function medalsOfFeed(entries: readonly ReplayFeedEntry[]): FeedMedal[] {
  const out: FeedMedal[] = []
  for (const e of entries) {
    if (e.kill) {
      for (const m of e.kill.medals) out.push({ ms: e.replayMs + m.tMs - e.kill.tMs, xuid: m.xuid, name: m.name })
    } else if (e.medal) {
      out.push({ ms: e.replayMs, xuid: e.medal.xuid, name: e.medal.name })
    }
  }
  return out
}

/** The call key of a medal: its English name, lowercased, `&` read "and", words joined by `_` ("Double Kill" -> `medal.double_kill`). */
export function medalCallKey(name: string): string {
  return `medal.${name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`
}

/**
 * The call key of an objective action, seen from the followed player's side. A zone capture in
 * King of the Hill is the hill's call (`hill_captures`), elsewhere a stronghold's.
 */
export function objectiveCallKey(stat: string, side: Exclude<ObjectiveSide, 'unknown'>, mode?: string | null): string {
  const hill = stat === 'zone_captures' && /king\s*of\s*the\s*hill|koth/i.test(mode ?? '')
  return `objective.${hill ? 'hill_captures' : stat}.${side === 'ally' ? 'ours' : 'theirs'}`
}

/** What the track builder passes beyond the document: the interface language, the followed player, the medals, the voice, the match. */
export interface AnnouncerTrackInput {
  locale: ReplayLocale
  followed: string | null
  medals: readonly FeedMedal[]
  /** The lines; absent = the bundled set only. */
  voice?: AnnouncerVoice
  /** The match context's mode, clock and overtime; absent = no match call. */
  match?: AnnouncerMatch
}

/** What the announcer reads from the match. */
export interface AnnouncerInput {
  doc: ReplayDocumentReady
  /** The followed player (the point of view); `null` = nobody followed, no medal call. */
  followed: string | null
  medals: readonly FeedMedal[]
  /** The side of an action's author, seen from the followed player; absent = no objective call. */
  sideOfXuid?: (xuid: string) => ObjectiveSide
  /** The followed player's team number; `null`/absent = no lead call. */
  allyTeam?: number | null
  voice?: AnnouncerVoice
  match?: AnnouncerMatch
}

/**
 * announcerCalls — the calls the followed player would hear, unscheduled.
 *
 * Objective actions are one statistic PER PLAYER: a zone flip credits each player present at the
 * same millisecond. The call is one, so the key (call, moment) is deduplicated, the same rule as
 * the objective sounds. An author whose side is unknown makes no call: the replay never guesses
 * whether a capture was "ours".
 */
export function announcerCalls(input: AnnouncerInput): AnnouncerCall[] {
  const { doc, followed, medals, sideOfXuid, match } = input
  const out: AnnouncerCall[] = roundOverTimes(doc).map((ms) => ({ ms, key: ROUND_OVER_CALL, cls: 'round' }))
  out.push(...announcerMatchCalls(doc, match, input.allyTeam ?? null))
  if (sideOfXuid) {
    const msOf = objectiveActionClock(doc)
    const seen = new Set<string>()
    for (const a of doc.objectives) {
      const side = sideOfXuid(a.xuid)
      if (side === 'unknown') continue
      const call: AnnouncerCall = { ms: msOf(a), key: objectiveCallKey(a.stat, side, match?.mode), cls: 'objective' }
      const id = `${call.key}|${call.ms}`
      if (seen.has(id)) continue
      seen.add(id)
      out.push(call)
    }
  }
  if (followed) {
    for (const m of medals) if (m.xuid === followed) out.push({ ms: m.ms, key: medalCallKey(m.name), cls: 'medal' })
  }
  return out
}

/** Higher class first, then the older call. */
function beats(a: AnnouncerCall, b: AnnouncerCall): number {
  return ANNOUNCER_PRIORITY.indexOf(a.cls) - ANNOUNCER_PRIORITY.indexOf(b.cls) || a.ms - b.ms
}

/**
 * scheduleAnnouncer — the calls on one line, in turn (rule in the header). `durationOf` gives a
 * call's line length, or `undefined` when the call has no file: such a call is removed first.
 */
export function scheduleAnnouncer(
  calls: readonly AnnouncerCall[],
  durationOf: (call: AnnouncerCall) => number | undefined,
  maxWaitMs: number = ANNOUNCER_MAX_WAIT_MS,
): AnnouncerCue[] {
  const arrivals = calls.filter((c) => durationOf(c) !== undefined).sort((a, b) => a.ms - b.ms)
  const out: AnnouncerCue[] = []
  let queue: AnnouncerCall[] = []
  let free = -Infinity
  let i = 0
  while (i < arrivals.length || queue.length > 0) {
    const now = queue.length > 0 ? free : Math.max(free, arrivals[i].ms)
    while (i < arrivals.length && arrivals[i].ms <= now) queue.push(arrivals[i++])
    queue = queue.filter((c) => now - c.ms <= maxWaitMs).sort(beats)
    const next = queue.shift()
    if (!next) continue
    out.push({ timeMs: now, call: next })
    free = now + (durationOf(next) ?? 0)
  }
  return out
}

/** The take a call plays among n: fixed by the call's moment, so a replay always sounds the same. */
export function takeIndex(ms: number, n: number): number {
  return n > 0 ? Math.abs(Math.floor(ms / 100)) % n : 0
}

/** The bundled lines as a voice. */
export const BUNDLED_VOICE: AnnouncerVoice = tableVoice(ANNOUNCER_LINES)

/** The voice of a track input: the locale's bundled lines first, then the extracted ones. */
export function announcerVoiceOf(voice: AnnouncerVoice | undefined): AnnouncerVoice {
  return voice ? combineVoices(BUNDLED_VOICE, voice) : BUNDLED_VOICE
}

/**
 * announcerSoundEvents — the scheduled calls as track events, in the interface language.
 * Without a language nothing sounds: a voice has one, and the replay does not guess it.
 */
export function announcerSoundEvents(input: AnnouncerInput, locale: ReplayLocale | undefined): ReplaySoundEvent[] {
  if (!locale) return []
  const voice = announcerVoiceOf(input.voice)
  const takeOf = (c: AnnouncerCall): AnnouncerTake | undefined => {
    const takes = voice.takes(c.key, locale)
    return takes[takeIndex(c.ms, takes.length)]
  }
  const out: ReplaySoundEvent[] = []
  for (const cue of scheduleAnnouncer(announcerCalls(input), (c) => takeOf(c)?.durationMs)) {
    const take = takeOf(cue.call)
    if (take) out.push({ ...soundEvent(cue.timeMs, take.stem), announcer: true })
  }
  return out
}

/** Every announcer stem in a language: the voice family of the export's separated tracks. */
export function announcerStems(locale: ReplayLocale, voice?: AnnouncerVoice): string[] {
  return [...announcerVoiceOf(voice).stems(locale)]
}