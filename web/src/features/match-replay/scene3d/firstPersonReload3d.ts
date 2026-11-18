// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * firstPersonReload3d.ts: WHICH FIRST-PERSON RELOAD CLIP PLAYS AT A FRAME, from the film's own
 * reload messages.
 *
 * STAGED RELOADS (measured 2026-11-15 on match 05dfe4e9, the only stored match with these weapons). The
 * Heatwave, Cindershot and Hydra graphs carry no `reload_full`: they carry `reload_enter`, one
 * `reload_continue_*` clip (one round) and `chamber_1` (the only rigs that do: 4 of 4 staged graphs, the
 * Sentinel Beam included, against 0 of the 22 magazine graphs). The film writes such a reload as one
 * message, then one or two messages (about 16 ms apart) at each round put in, then a repeated message at the
 * instant the last round is in. Heatwave: 0, 684/700, 1051/1068, 1418/1435, ... 2519/2519 ms; the gaps are
 * the clips' own lengths (enter 0.70 s, one round 0.37 s), Cindershot the same (0.63 s, 0.53 s). So the
 * count of stages IS the count of rounds the player loaded, and a nearly empty weapon takes longer. The
 * Hydra's stages come every 0.42 s, half its 0.83 s round clip: a stage's clip is fitted to the time the
 * film gives it.
 *
 * Messages are grouped into an EPISODE: groups of messages less than STAGE_GAP_S apart, starting at a
 * reload start (`reloadStarts`). A magazine weapon plays its one clip from the episode's start, so the
 * extra messages of an episode no longer restart it.
 */
import type { FirstPersonClip } from './firstPersonRig3d'

/** One stage of a reload: its first message, and whether it holds only repeated messages (`cut`). */
export interface ReloadStage {
  t: number
  cut: boolean
}

/** A reload episode of one life: its stages, the first one the reload start, in frames. */
export interface ReloadEpisode {
  stages: readonly ReloadStage[]
  /** The magazine was empty when the reload started (`magazineAtReload`); null when the film does not say. */
  empty: boolean | null
}

/** Messages within this many seconds of a stage's first message belong to that stage (measured: 16 to 34 ms). */
const PAIR_WINDOW_S = 0.1
/** A gap longer than this ends an episode (measured stages: 0.37 to 0.70 s apart). */
const STAGE_GAP_S = 1

/**
 * reloadEpisodes groups a life's reload starts and cuts (frames, sorted) into episodes. An episode
 * begins at a start; a cut more than STAGE_GAP_S after the last stage belongs to no episode.
 */
export function reloadEpisodes(
  starts: readonly number[],
  cuts: readonly number[],
  fps: number,
  isEmpty: (start: number) => boolean | null = () => null,
): ReloadEpisode[] {
  const messages = [...starts.map((t) => ({ t, cut: false })), ...cuts.map((t) => ({ t, cut: true }))]
    .sort((a, b) => a.t - b.t)
  const out: ReloadEpisode[] = []
  let stages: ReloadStage[] | null = null
  for (const m of messages) {
    const last = stages?.at(-1)
    if (stages && last && m.t - last.t <= PAIR_WINDOW_S * fps) {
      last.cut &&= m.cut
      continue
    }
    if (stages && last && m.t - last.t <= STAGE_GAP_S * fps) {
      stages.push({ t: m.t, cut: m.cut })
      continue
    }
    stages = null
    if (m.cut) continue
    stages = [{ t: m.t, cut: false }]
    out.push({ stages, empty: isEmpty(m.t) })
  }
  return out
}

/** The rig's reload clips: one clip, or a staged sequence. */
export interface ReloadClips {
  full: FirstPersonClip | null
  empty: FirstPersonClip | null
  enter: FirstPersonClip | null
  loop: FirstPersonClip | null
  loopEmpty: FirstPersonClip | null
  exit: FirstPersonClip | null
  /** The rig's vent clips (`vent_enter`, `vent_loop`, `vent_exit`), for a heat weapon with no reload clip. */
  vent?: VentClips | null
}

/**
 * The vent of a heat weapon. The Ravager, Plasma Pistol, Pulse Carbine and Stalker Rifle rigs carry no
 * reload clip but `vent_enter`, `vent_loop` and `vent_exit` (read from the first-person library,
 * 2026-11-15): their reload input vents the heat, and the film writes that as the same `weapon_reload`
 * message (match 05dfe4e9, TasteThePainbow's Ravager: two messages at 7:56.8 and 7:57.4, no shot after).
 */
export interface VentClips {
  enter: FirstPersonClip
  loop: FirstPersonClip
  exit: FirstPersonClip | null
}

/** The reload clip at a frame: its time, its weight, and the frame from which the reload must still be valid. */
export interface ReloadPhase {
  clip: FirstPersonClip
  time: number
  /** null: the caller's usual fades apply (a one-clip reload). */
  weight: number | null
  since: number
}

/** The fade at the very start and the very end of a reload, in seconds. */
const FADE_S = 0.1
/** A last stage cut before this share of the expected round time was interrupted: no closing clip. */
const NATURAL_END_SHARE = 0.75

/** The time `t` held inside the clip (a stage longer than its clip holds the last pose). */
function clampToClip(clip: FirstPersonClip, t: number): number {
  return Math.min(Math.max(0, t), clip.durationSeconds * 0.999)
}

/** The last episode that started at or before `frame`. */
function episodeAt(episodes: readonly ReloadEpisode[], frame: number): ReloadEpisode | null {
  let lo = 0
  let hi = episodes.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (episodes[mid].stages[0].t <= frame) lo = mid + 1
    else hi = mid
  }
  return lo > 0 ? episodes[lo - 1] : null
}

/**
 * reloadPhase: the reload clip of `episodes` at `frame`, or null. `shot`: the last shot at or before
 * the frame (a shot after the reload starts ends it; after its last stage, ends the closing clip). `since`:
 * the last weapon change (a reload before it belongs to the weapon put away). The caller still checks that
 * the reload is valid from `ReloadPhase.since` to the frame (no death, swap or cut in between).
 */
export function reloadPhase(
  clips: ReloadClips,
  episodes: readonly ReloadEpisode[],
  frame: number,
  fps: number,
  shot: number,
  since: number,
): ReloadPhase | null {
  const ep = episodeAt(episodes, frame)
  if (!ep || fps <= 0) return null
  const start = ep.stages[0].t
  if (start < since) return null
  if (!clips.full && !clips.empty && !clips.enter && clips.vent) return ventPhase(clips.vent, ep, frame, fps, shot)
  const loop = ep.empty ? clips.loopEmpty ?? clips.loop : clips.loop ?? clips.loopEmpty
  if (!clips.enter || !loop || loop.durationSeconds <= 0) {
    const clip = (ep.empty ? clips.empty ?? clips.full : clips.full ?? clips.empty) ?? clips.enter
    const time = (frame - start) / fps
    if (!clip || shot > start || time >= clip.durationSeconds) return null
    return { clip, time, weight: null, since: start }
  }
  return stagedPhase(clips.enter, loop, clips.exit, ep.stages, frame, fps, shot)
}

/**
 * A vent: the enter clip from the episode's first message, the loop held until the later of the
 * episode's last message and one full loop (the game's own clip lengths, from its animation tags), then
 * the exit clip. A shot after the vent starts ends it.
 */
function ventPhase(vent: VentClips, ep: ReloadEpisode, frame: number, fps: number, shot: number): ReloadPhase | null {
  const start = ep.stages[0].t
  if (shot > start) return null
  const t = (frame - start) / fps
  const enter = vent.enter.durationSeconds
  if (t < enter) return { clip: vent.enter, time: clampToClip(vent.enter, t), weight: Math.min(1, t / FADE_S), since: start }
  const loopEnd = Math.max((ep.stages[ep.stages.length - 1].t - start) / fps, enter + vent.loop.durationSeconds)
  if (t < loopEnd) {
    const d = vent.loop.durationSeconds
    return { clip: vent.loop, time: d > 0 ? clampToClip(vent.loop, (t - enter) % d) : 0, weight: 1, since: start }
  }
  const exit = vent.exit
  const u = t - loopEnd
  if (!exit || u >= exit.durationSeconds) return null
  return { clip: exit, time: clampToClip(exit, u), weight: Math.min(1, (exit.durationSeconds - u) / FADE_S), since: start }
}

/** A staged reload: the enter clip, one round clip per stage fitted to the stage, then the closing clip. */
function stagedPhase(
  enter: FirstPersonClip,
  loop: FirstPersonClip,
  exit: FirstPersonClip | null,
  stages: readonly ReloadStage[],
  frame: number,
  fps: number,
  shot: number,
): ReloadPhase | null {
  const start = stages[0].t
  // A shot during the reload ends it; a shot after its last stage ends the closing clip.
  if (shot > start) return null
  let i = 0
  while (i + 1 < stages.length && stages[i + 1].t <= frame) i++
  const last = stages.length - 1
  const stage = stages[i]
  const next = i < last ? stages[i + 1].t : null
  const sinceStage = (frame - stage.t) / fps
  if (i === 0) {
    if (next === null && sinceStage >= enter.durationSeconds) return null
    const endFade = next === null ? (enter.durationSeconds - sinceStage) / FADE_S : 1
    return { clip: enter, time: clampToClip(enter, sinceStage), weight: Math.min(1, sinceStage / FADE_S, endFade), since: start }
  }
  if (i === last && stage.cut) {
    if (!exit || !naturalEnd(stages, loop, fps) || sinceStage >= exit.durationSeconds) return null
    return { clip: exit, time: sinceStage, weight: Math.min(1, (exit.durationSeconds - sinceStage) / FADE_S), since: stage.t }
  }
  // A round cut short by the episode's last message keeps the episode's pace: only a stage the film
  // completes is fitted to its time.
  const wasCut = i + 1 === last && stages[last].cut && !naturalEnd(stages, loop, fps)
  const duration = next !== null && !wasCut ? (next - stage.t) / fps : expectedDuration(stages, i, loop, fps)
  const rate = Math.max(1, loop.durationSeconds / duration)
  const time = sinceStage * rate
  if (next === null && time >= loop.durationSeconds) return null
  const endFade = next === null ? (loop.durationSeconds - time) / rate / FADE_S : 1
  return { clip: loop, time: clampToClip(loop, time), weight: Math.min(1, endFade), since: stage.t }
}

/** The time one round takes in this episode: the previous round's, else the round clip's (the staged reload sounds read it too). */
export function expectedDuration(stages: readonly ReloadStage[], i: number, loop: Pick<FirstPersonClip, 'durationSeconds'>, fps: number): number {
  return i >= 2 ? (stages[i].t - stages[i - 1].t) / fps : loop.durationSeconds
}

/**
 * naturalEnd: the last stage (repeated messages) closes the reload rather than cutting it: at least one
 * round went in, and the last round lasted most of the expected round time (a cut 0.13 s into a 0.53 s
 * round is an interruption).
 */
export function naturalEnd(stages: readonly ReloadStage[], loop: Pick<FirstPersonClip, 'durationSeconds'>, fps: number): boolean {
  const n = stages.length - 1
  if (n < 2) return false
  const last = (stages[n].t - stages[n - 1].t) / fps
  return last >= NATURAL_END_SHARE * Math.min(loop.durationSeconds, expectedDuration(stages, n - 1, loop, fps))
}
