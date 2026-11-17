// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * scrubMarks — the selected player's events on the scrub bar, as the game's theater shows
 * them: his kills, his deaths and his medals, each a mark that seeks to just before it.
 *
 * STACKING: each kind has its own lane, so no kind can hide another. Medals sit in a lane
 * above the track, kills on the track, deaths in a lane below it.
 *
 * SPACING: within a lane, marks closer than `MIN_MARK_SPACING_PX` on screen merge into one
 * group (greedy, measured from the group's first mark, so a group never spans more than that
 * spacing). A group seeks to its first event and its tooltip lists every event in it.
 *
 * Pure: no React, no DOM. Times are on the replay axis (ms from frame 0), like the kill list.
 */
import { formatClock } from '../lib/replay/replayLogic'
import type { ReplayKill } from '../features/match-replay/model/killFeedLogic'
import { clampUnit } from './scrubMath'

/** Seconds a mark seeks BEFORE its event, so the viewer sees it happen. */
export const MARK_LEAD_SECONDS = 2
/** The smallest on-screen gap, in px, between two marks of one lane before they group. */
export const MIN_MARK_SPACING_PX = 8
/** Within this many seconds after a mark's lead point, "previous" skips that mark (so it can
 *  step back past the one just jumped to while the replay plays on). */
export const PREVIOUS_MARK_SLACK_SECONDS = 1

export type MarkKind = 'kill' | 'death' | 'medal'

export interface PlayerEvent {
  kind: MarkKind
  /** Replay-axis instant, ms. */
  ms: number
  /** What it is, without the clock: "Kill: X (BR75)", "Death: by Y", "Double Kill". */
  label: string
}

/** A medal on the replay axis (`medalsOfFeed`). */
export interface ScrubMedal {
  ms: number
  xuid: string
  name: string
}

/** The selected player's kills, deaths and medals, in time order; none without a player. */
export function playerEvents(
  xuid: string | null,
  kills: readonly ReplayKill[],
  medals: readonly ScrubMedal[],
  nameOf: (xuid: string, fallback?: string) => string,
): PlayerEvent[] {
  if (!xuid) return []
  const out: PlayerEvent[] = []
  for (const k of kills) {
    if (k.victimXuid === xuid) {
      out.push({ kind: 'death', ms: k.replayMs, label: k.xuid && k.xuid !== xuid ? `Death: by ${nameOf(k.xuid)}` : 'Death' })
    } else if (k.xuid === xuid) {
      const victim = k.victimXuid || k.victimGamertag ? nameOf(k.victimXuid, k.victimGamertag) : ''
      const weapon = k.weaponLabel ? ` (${k.weaponLabel})` : ''
      out.push({ kind: 'kill', ms: k.replayMs, label: victim ? `Kill: ${victim}${weapon}` : `Kill${weapon}` })
    }
  }
  for (const m of medals) if (m.xuid === xuid) out.push({ kind: 'medal', ms: m.ms, label: m.name })
  return out.sort((a, b) => a.ms - b.ms)
}

/** The frame an event's mark seeks to: `MARK_LEAD_SECONDS` before it, inside the document. */
export function leadFrame(ms: number, fps: number, frameCount: number): number {
  const last = Math.max(0, frameCount - 1)
  return Math.min(last, Math.max(0, Math.round((ms / 1000 - MARK_LEAD_SECONDS) * fps)))
}

/** One mark on the bar: one event, or several close ones of the same kind. */
export interface ScrubMark {
  key: string
  kind: MarkKind
  /** Bar position of the group's first event, in [0, 1]. */
  fraction: number
  /** The frame a click seeks to (the first event's lead frame). */
  frame: number
  events: PlayerEvent[]
  /** Tooltip: one "label clock" line per event. */
  title: string
}

function titleOf(events: readonly PlayerEvent[]): string {
  return events.map((e) => `${e.label} ${formatClock(e.ms)}`).join('\n')
}

/** Groups each lane's events into marks under the spacing rule (see the header). */
export function groupMarks(
  events: readonly PlayerEvent[],
  timing: { fps: number; frameCount: number },
  widthPx: number,
): ScrubMark[] {
  const last = Math.max(1, timing.frameCount - 1)
  const fractionOf = (ms: number) => clampUnit((ms * timing.fps) / 1000 / last)
  const marks: ScrubMark[] = []
  for (const kind of ['medal', 'kill', 'death'] as const) {
    let group: PlayerEvent[] = []
    const flush = () => {
      if (group.length === 0) return
      const first = group[0]
      marks.push({ key: `${kind}-${first.ms}`, kind, fraction: fractionOf(first.ms), frame: leadFrame(first.ms, timing.fps, timing.frameCount), events: group, title: titleOf(group) })
      group = []
    }
    for (const e of events) {
      if (e.kind !== kind) continue
      if (group.length > 0 && (fractionOf(e.ms) - fractionOf(group[0].ms)) * widthPx >= MIN_MARK_SPACING_PX) flush()
      group.push(e)
    }
    flush()
  }
  return marks
}

/** The lead frame of the next event after `frame`, or null when none is left. */
export function nextEventFrame(events: readonly PlayerEvent[], frame: number, fps: number, frameCount: number): number | null {
  for (const e of events) {
    const target = leadFrame(e.ms, fps, frameCount)
    if (target > frame) return target
  }
  return null
}

/** The lead frame of the previous event before `frame` (see `PREVIOUS_MARK_SLACK_SECONDS`), or null. */
export function previousEventFrame(events: readonly PlayerEvent[], frame: number, fps: number, frameCount: number): number | null {
  const before = frame - PREVIOUS_MARK_SLACK_SECONDS * fps
  let found: number | null = null
  for (const e of events) {
    const target = leadFrame(e.ms, fps, frameCount)
    if (target < before) found = target
  }
  return found
}
