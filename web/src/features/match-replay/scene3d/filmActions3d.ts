// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** Film actions converted onto the grid, and jump endings derived from the vertical trajectory. */
import { framesPerSecond, msToFrames } from '@/lib/replay/replayLogic'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import { magazineAtReload } from '../model/reloadMagazine'
import { reloadReadings } from '../model/reloadStarts'

import type { Span } from './clipSelect3d'
import { episodesRechargement, type EpisodeRechargement } from './firstPersonReload3d'
import type { Tracks3d } from './tracks3d'

export function actionsParSlot(doc: ReplayDocumentReady, kind: string): Map<number, number[]> {
  const out = new Map<number, number[]>()
  for (const a of doc.actions) {
    if (a.kind !== kind) continue
    const list = out.get(a.slot) ?? []
    list.push(msToFrames(a.ms, doc))
    out.set(a.slot, list)
  }
  for (const list of out.values()) list.sort((a, b) => a - b)
  return out
}

/**
 * rechargementsParSlot: each life's reload starts and reload cuts on the frame grid
 * (`reloadStarts`: a repeated instant starts no reload, it ends the one under way).
 */
export function rechargementsParSlot(doc: ReplayDocumentReady): { debuts: Map<number, number[]>; coupures: Map<number, number[]> } {
  const starts = new Map<number, number[]>()
  const cuts = new Map<number, number[]>()
  for (const [slot, r] of reloadReadings(doc)) {
    if (r.starts.length > 0) starts.set(slot, r.starts.map((ms) => msToFrames(ms, doc)))
    if (r.cuts.length > 0) cuts.set(slot, r.cuts.map((ms) => msToFrames(ms, doc)))
  }
  return { debuts: starts, coupures: cuts }
}

/**
 * episodesRechargementParSlot: each life's reload episodes (`episodesRechargement`) on the frame grid,
 * each marked with whether the in-hand magazine was empty at its start (`magazineAtReload`).
 */
export function episodesRechargementParSlot(doc: ReplayDocumentReady): Map<number, EpisodeRechargement[]> {
  const out = new Map<number, EpisodeRechargement[]>()
  const fps = framesPerSecond(doc)
  for (const [slot, r] of reloadReadings(doc)) {
    const byFrame = new Map(r.starts.map((ms) => [msToFrames(ms, doc), ms]))
    const isEmpty = (frame: number) => {
      const ms = byFrame.get(frame)
      const remaining = ms === undefined ? null : magazineAtReload(doc, slot, ms, r.starts)
      return remaining === null ? null : remaining === 0
    }
    const episodes = episodesRechargement([...byFrame.keys()], r.cuts.map((ms) => msToFrames(ms, doc)), fps, isEmpty)
    if (episodes.length > 0) out.set(slot, episodes)
  }
  return out
}

/** Duration of a vertical plateau that counts as a landing when no descent preceded it (peak excluded). */
const PLATEAU_WITHOUT_FALL_S = 0.2

/** Ends at vertical stabilization after movement, or after 1.5s with no landing observed. */
export function sautDepuisAction(doc: ReplayDocumentReady, tracks: Tracks3d, slot: number, start: number): Span {
  const climb = doc.stances.filter((s) => s.slot === slot && s.kind === 'clamber' && s.t0 >= start)
    .reduce((end, s) => Math.min(end, s.t0), Infinity)
  const limit = Math.min(start + msToFrames(1500, doc), climb)
  const track = doc.tracks.find((t) => t.slot === slot && t.xuid && (t.startFrame ?? t.points[0]?.t ?? Infinity) <= start && (t.endFrame ?? t.points.at(-1)?.t ?? -Infinity) >= start)
  const life = track?.xuid ? tracks.life(track.xuid, start) : null
  const ground = tracks.sampleSlot(slot, start)?.z
  if (!life || ground === undefined) return { t0: start, t1: limit - 1 }
  let movement = false
  let falling = false
  let stillCount = 0
  let previous = { t: start, z: ground }
  let plateauStart = start
  const fps = framesPerSecond(doc)
  for (const p of life.pts) {
    if (p.t <= start) continue
    if (p.t > limit) break
    if (p.g) return { t0: start, t1: previous.t - 1 }
    const speed = (p.z - previous.z) * fps / (p.t - previous.t)
    if (Math.abs(speed) > 0.1) {
      movement = true
      if (speed < 0) falling = true
      stillCount = 0
    } else if (movement) {
      if (stillCount++ === 0) plateauStart = previous.t
      // The jump's peak is also a plateau: with no descent seen, a held plateau is required.
      const held = falling ? stillCount >= 2 : p.t - plateauStart >= PLATEAU_WITHOUT_FALL_S * fps
      if (held) return { t0: start, t1: plateauStart - 1 }
    }
    previous = p
  }
  return { t0: start, t1: Math.min(limit, track?.endFrame ?? track?.points.at(-1)?.t ?? limit) - 1 }
}
