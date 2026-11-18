// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * stagedSound.ts — THE FIRST-PERSON SOUNDS OF A STAGED RELOAD (the Heatwave, Cindershot and Hydra),
 * WITH THE FIRST-PERSON RIG'S OWN TIMING.
 *
 * THE SOURCE: the sounds the weapon's first-person reload clips post that no other clip of its graph
 * posts (`reloads.json` `staged`, `internal/reloadsounds`): on the Heatwave two at frames 17 and 19
 * of `reload_enter` (the fins opening), one at frame 4 of each round, one at `chamber_1`. They come
 * from each sound's first-person event, what the camera's own player hears, so they play for the
 * followed player only, without a place (INFERRED: the game posts a first-person clip's sounds for its
 * own player; the others hear the third-person reload, `reloadSound.ts`).
 *
 * THE TIMING IS THE RIG'S (`phaseRechargement`, `firstPersonReload3d.ts`): the film's reload
 * messages are grouped into episodes; the enter clip plays from the episode's first message until the
 * next stage, each round clip from its stage, fitted to the time the film gives it (played faster when
 * the stage is shorter than the clip, never slower), the closing clip from the last stage when the
 * reload ends naturally. A sound plays at its frame of its clip, if the clip is still playing then.
 *
 * A RELOAD ENDS, as a vent does (`ventSound.ts`): the end of the life, the next episode, a shot after
 * it starts, a weapon change, a hand leaving the weapon. A take still sounding is cut there.
 */
import { frameToMs, msToFrames, trackWindow } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { currentLifeOf } from '../../../lib/replay/rosterLogic'
import { weaponInHand } from '../model/weaponInHand'
import { magazineAtReload } from '../model/reloadMagazine'
import { reloadReadings } from '../model/reloadStarts'
import { expectedDuration, reloadEpisodes, naturalEnd, type ReloadEpisode } from '../scene3d/firstPersonReload3d'
import { weaponTagOf, type ReloadClip, type StagedLibrary } from './reloadManifest'
import { factsBySlot, firstAt, trackIdentity, type SlotFacts } from './reloadSound'
import type { ReplaySoundEvent } from './replaySoundVariants'

/** stagedSoundEvents — the followed player's staged reloads, for the weapons the library has one for. */
export function stagedSoundEvents(doc: ReplayDocumentReady, library: StagedLibrary | undefined, followed: string | null): ReplaySoundEvent[] {
  if (!library || library.size === 0 || followed === null) return []
  const frameIntervalMs = doc.frameIntervalMs ?? 0
  if (frameIntervalMs <= 0) return []
  const fps = 1000 / frameIntervalMs
  const facts = factsBySlot(doc)
  const out: ReplaySoundEvent[] = []
  for (const [slot, r] of reloadReadings(doc)) {
    const f = facts.get(slot)
    if (!f || trackIdentity(doc, slot) !== followed) continue
    const framesOf = (ms: readonly number[]) => ms.map((t) => msToFrames(t, doc))
    const episodes = reloadEpisodes(framesOf(r.starts), framesOf(r.cuts), fps)
    for (let i = 0; i < episodes.length; i++) {
      out.push(...oneStaged(doc, library, slot, f, r.starts, episodes[i], episodes[i + 1] ?? null, fps))
    }
  }
  return out.sort((a, b) => a.ms - b.ms)
}

/** oneStaged — the sounds of one staged reload episode. */
function oneStaged(
  doc: ReplayDocumentReady,
  library: StagedLibrary,
  slot: number,
  f: SlotFacts,
  starts: readonly number[],
  ep: ReloadEpisode,
  next: ReloadEpisode | null,
  fps: number,
): ReplaySoundEvent[] {
  const stages = ep.stages
  const start = stages[0].t
  const held = weaponInHand(doc, slot, start)
  const tag = held ? weaponTagOf(held.id) : null
  const life = currentLifeOf(doc, slot, start)
  const clips = tag ? library.get(tag) : undefined
  if (!held || !life || !clips) return []
  const startMs = frameToMs(start, doc)
  const endMs = Math.min(
    frameToMs(trackWindow(life).end, doc),
    next ? frameToMs(next.stages[0].t, doc) : Infinity,
    firstAt(f.shots, startMs, false),
    firstAt(f.changes, startMs, false),
    f.hands.find((h) => h.ms > startMs && h.d !== held.weaponSlot)?.ms ?? Infinity,
  )
  // The rig's round clip: the empty one when the magazine was empty at the start (its `vide`).
  const round = magazineAtReload(doc, slot, startMs, starts) === 0 ? clips.roundEmpty : clips.round
  const roundS = round.durationMs / 1000
  const last = stages.length - 1
  const msOf = (i: number) => frameToMs(stages[i].t, doc)
  const cancelled = endMs < msOf(last) + Math.max(clips.closing.durationMs, round.durationMs)
  const out: ReplaySoundEvent[] = []
  // One clip from `fromMs`, played `rate` times faster, until `untilMs` (the next stage, or its end).
  const play = (clip: ReloadClip, fromMs: number, rate: number, untilMs: number) => {
    const stopMs = Math.min(untilMs, fromMs + clip.durationMs / rate)
    for (const s of clip.sounds) {
      const ms = fromMs + s.atMs / rate
      if (ms >= stopMs || ms >= endMs || s.stems.length === 0) continue
      const e: ReplaySoundEvent = { ms, stem: s.stems[0], gainDb: clip.gainDb }
      if (s.stems.length > 1) e.variants = s.stems
      if (cancelled) e.cutMs = endMs - ms
      out.push(e)
    }
  }
  play(clips.enter, startMs, 1, last > 0 ? msOf(1) : Infinity)
  for (let i = 1; i <= last; i++) {
    if (i === last && stages[i].cut) {
      if (naturalEnd(stages, { durationSeconds: roundS }, fps)) play(clips.closing, msOf(i), 1, Infinity)
      continue
    }
    // A round cut short by the episode's last message keeps the episode's pace (the rig's rule).
    const cutShort = i + 1 === last && stages[last].cut && !naturalEnd(stages, { durationSeconds: roundS }, fps)
    const roundDuration = i < last && !cutShort ? (stages[i + 1].t - stages[i].t) / fps : expectedDuration(stages, i, { durationSeconds: roundS }, fps)
    const rate = roundS > 0 && roundDuration > 0 ? Math.max(1, roundS / roundDuration) : 1
    play(round, msOf(i), rate, i < last ? msOf(i + 1) : Infinity)
  }
  return out
}
