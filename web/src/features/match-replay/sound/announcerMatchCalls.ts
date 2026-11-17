// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * announcerMatchCalls.ts — THE CALLS ABOUT THE MATCH ITSELF: the mode's name at kickoff, the
 * remaining-time warnings, overtime, and the lost lead. Pure; `announcerCalls` merges them with
 * the medal, objective and round calls.
 *
 * THE CLOCK IS THE HUD'S. The remaining time is the regulation time minus the time since the
 * kickoff (`horlogeHud` over `displayClockMs`): a warning "N left" falls at kickoff + limit - N,
 * and overtime at kickoff + limit. Without a known limit or a play window, no time call: the
 * replay never guesses a clock.
 *
 * ROUND MODES HAVE NO TIME WARNING HERE. The regulation time the match context gives is the
 * variant's; a round mode's clock restarts each round, and the film does not say each round's
 * limit. Warning on the whole-match clock would call "one minute" at the wrong moment.
 *
 * THE WARNINGS ARE EXACTLY THE GAME'S: five minutes, two minutes, one minute, 30 seconds and
 * 10 seconds (the announcer's lines `5minutes` ... `10seconds`), each only when the limit is
 * longer than it.
 *
 * THE LOST LEAD is the game's only lead call (`lostlead`; no "gained the lead" line exists in the
 * announcer's dialogue): it plays when the lead passes from the followed player's team to
 * another, through ties included (`leaderStates`, the repository's one "who leads" reading).
 */
import { campCountOf, leaderStates, scoreTimelineOf } from '@/lib/replay/scoreTimeline'
import { frameToMs } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import type { AnnouncerCall } from './announcerSound'
import { roundOverTimes } from './roundOverSound'

/** The remaining-time warnings the game's announcer has, in seconds. */
export const TIME_WARNINGS_S = [300, 120, 60, 30, 10] as const

/** What the match context says of the match: its mode, its clock, whether it went to overtime. */
export interface AnnouncerMatch {
  /** The mode's display name ("Slayer", "King of the Hill"); `null` = unknown, no mode call. */
  mode: string | null
  timeLimitMs: number | null
  /** The gameplay window on the replay axis (`replayWindow`); `null` = not established. */
  playWindow: { startMs: number; endMs: number } | null
  overtime: boolean
}

/** The call key of a mode's name. */
export function modeCallKey(mode: string): string {
  return `mode.${mode.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`
}

/** The mode's name, at kickoff. */
function modeCall(match: AnnouncerMatch): AnnouncerCall[] {
  if (!match.mode || !modeCallKey(match.mode).slice('mode.'.length)) return []
  return [{ ms: match.playWindow?.startMs ?? 0, key: modeCallKey(match.mode), cls: 'match' }]
}

/** The remaining-time warnings and the overtime call (rules in the header). */
function clockCalls(doc: ReplayDocumentReady, match: AnnouncerMatch): AnnouncerCall[] {
  const { timeLimitMs, playWindow } = match
  if (timeLimitMs == null || timeLimitMs <= 0 || !playWindow || roundOverTimes(doc).length > 0) return []
  const out: AnnouncerCall[] = []
  for (const s of TIME_WARNINGS_S) {
    const ms = playWindow.startMs + timeLimitMs - s * 1000
    if (timeLimitMs > s * 1000 && ms <= playWindow.endMs) out.push({ ms, key: `time.${s}`, cls: 'match' })
  }
  const regulationEnd = playWindow.startMs + timeLimitMs
  if (match.overtime && regulationEnd <= playWindow.endMs) out.push({ ms: regulationEnd, key: 'overtime', cls: 'match' })
  return out
}

/** The moments the lead passes from the ally team to another (rule in the header). */
export function lostLeadCalls(doc: ReplayDocumentReady, allyTeam: number | null): AnnouncerCall[] {
  if (allyTeam == null) return []
  const out: AnnouncerCall[] = []
  let leader: number | null = null
  for (const state of leaderStates(scoreTimelineOf(doc), campCountOf(doc.roster))) {
    if (state.teamId == null) continue
    if (leader === allyTeam && state.teamId !== allyTeam) out.push({ ms: frameToMs(state.frame, doc), key: 'score.lost_lead', cls: 'match' })
    leader = state.teamId
  }
  return out
}

/** announcerMatchCalls — every call about the match itself. */
export function announcerMatchCalls(doc: ReplayDocumentReady, match: AnnouncerMatch | undefined, allyTeam: number | null): AnnouncerCall[] {
  const lead = lostLeadCalls(doc, allyTeam)
  if (!match) return lead
  return [...modeCall(match), ...clockCalls(doc, match), ...lead]
}
