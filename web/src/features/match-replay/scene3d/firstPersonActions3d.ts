// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { clipOfRig, type FirstPersonClip, type FirstPersonRig } from './firstPersonRig3d'
import { useAt, type UseShot } from './equipmentUse3d_logic'
import type { SprintInterval } from './firstPersonEvents3d'
import { firstAbove } from './recoilShots3d'
import { reloadPhase, type ReloadClips, type VentClips, type ReloadEpisode } from './firstPersonReload3d'

/**
 * WeaponSwitch: the swap of the held weapon at a frame, with the model key of the weapon that
 * leaves (`before`) and the one that arrives (`after`); null on the absent side.
 */
export interface WeaponSwitch {
  frame: number
  before: string | null
  after: string | null
}

export interface FirstPersonFrameEvents {
  /** The life's reload episodes (`reloadEpisodes`), sorted by their start. */
  reloads: readonly ReloadEpisode[]
  strikes: ArrayLike<number>
  shots: ArrayLike<number>
  grenades: ArrayLike<number>
  weaponSwitches: ArrayLike<WeaponSwitch>
  sprints: readonly SprintInterval[]
  slides: readonly SprintInterval[]
  crouches: readonly SprintInterval[]
  jumps: readonly SprintInterval[]
  climbs: readonly SprintInterval[]
  /** Uses that play a game clip (carried equipment, grapple, thruster), sorted by frame. */
  usages: readonly UseShot[]
  frame: number
  fps: number
  reloadValid: (since: number, frame: number) => boolean
}
export interface FirstPersonPose {
  base: FirstPersonClip | null
  baseTime: number
  baseWeight: number
  fire: FirstPersonClip | null
  fireTime: number
  fireWeight: number
}

export function newFirstPersonPose(): FirstPersonPose {
  return { base: null, baseTime: 0, baseWeight: 0, fire: null, fireTime: 0, fireWeight: 0 }
}

/** lastAtOrBefore: the last entry of `list` at or before `frame`, or -Infinity if none. */
function lastAtOrBefore(list: ArrayLike<number>, frame: number): number {
  const i = firstAbove(list, frame, true) - 1
  return i < 0 ? -Infinity : list[i]
}

interface RigClips {
  reload: ReloadClips
  strike: FirstPersonClip | null
  fire: FirstPersonClip | null
  grenade: FirstPersonClip | null
  switchReady: FirstPersonClip | null
  putAway: FirstPersonClip | null
  sprintEnter: FirstPersonClip | null
  sprintExit: FirstPersonClip | null
  sprint: FirstPersonClip | null
  sprintAir: FirstPersonClip | null
  crouch: FirstPersonClip | null
  jump: FirstPersonClip | null
  landSoft: FirstPersonClip | null
  landHard: FirstPersonClip | null
  climb: FirstPersonClip | null
  slideEnter: FirstPersonClip | null
  slideLoop: FirstPersonClip | null
  slideExit: FirstPersonClip | null
}

const clipsByRig = new WeakMap<FirstPersonRig, RigClips>()

/** ventClipsForRig: the rig's vent clips (`VentClips`), null when it lacks the enter or the loop. */
function ventClipsForRig(rig: FirstPersonRig): VentClips | null {
  const enter = clipOfRig(rig, 'vent_enter')
  const loop = clipOfRig(rig, 'vent_loop')
  return enter && loop ? { enter, loop, exit: clipOfRig(rig, 'vent_exit') } : null
}

function clipsForRig(rig: FirstPersonRig) {
  let clips = clipsByRig.get(rig)
  if (!clips) {
    clips = { reload: { full: clipOfRig(rig, 'reload_full'), empty: clipOfRig(rig, 'reload_empty'), enter: clipOfRig(rig, 'reload_enter'),
      loop: clipOfRig(rig, 'reload_continue_full'), loopEmpty: clipOfRig(rig, 'reload_continue_empty'),
      exit: clipOfRig(rig, 'reload_exit') ?? clipOfRig(rig, 'chamber_1'), vent: ventClipsForRig(rig) },
      strike: clipOfRig(rig, 'melee_strike_1'), fire: clipOfRig(rig, 'fire_1'),
      grenade: clipOfRig(rig, 'throw_grenade'), switchReady: clipOfRig(rig, 'ready'),
      putAway: clipOfRig(rig, 'put_away'), sprint: clipOfRig(rig, 'sprint_loop'),
      sprintEnter: clipOfRig(rig, 'sprint_enter'), sprintExit: clipOfRig(rig, 'sprint_exit'),
      sprintAir: clipOfRig(rig, 'sprint_loop_airborne'), crouch: clipOfRig(rig, 'crouch'),
      jump: clipOfRig(rig, 'jump'), landSoft: clipOfRig(rig, 'land_soft'),
      landHard: clipOfRig(rig, 'land_hard'), climb: clipOfRig(rig, 'clamber'),
      slideEnter: clipOfRig(rig, 'slide_enter'), slideLoop: clipOfRig(rig, 'slide_loop'), slideExit: clipOfRig(rig, 'slide_exit') }
    clipsByRig.set(rig, clips)
  }
  return clips
}

/** The index of the first weapon change past `v` (the list is sorted by frame). */
function firstChangeAfter(switches: ArrayLike<WeaponSwitch>, v: number): number {
  let lo = 0
  let hi = switches.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (switches[mid].frame <= v) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * The film reports the held weapon at the frame where the model in hand changes: so the outgoing
 * weapon's holster plays before this frame, and the incoming one's draw starts from it. Positive:
 * the whole sequence shifts later.
 */
export const WEAPON_SWITCH_OFFSET = 0
/** The fade between the two phases of the held weapon change, in seconds. */
const WEAPON_CHANGE_FADE = 0.1

/**
 * WeaponSwitchPhase: the phase of the held weapon change at this frame, for the posed rig (the
 * one for the weapon held at this frame: the one that leaves before the change, or the one that
 * arrives after). `time` runs from 0 to the clip's duration; `weight`: fades in at the start of
 * the holster, fades out at the end of the draw.
 */
export interface WeaponSwitchPhase {
  phase: 'holster' | 'ready'
  time: number
  weight: number
}

/** The outgoing weapon's draw isn't finished: the previous change drew it too recently. */
function drawTooRecent(
  change: WeaponSwitch,
  index: number,
  switches: ArrayLike<WeaponSwitch>,
  fps: number,
  readyDuration: number,
): boolean {
  if (readyDuration <= 0) return false
  for (let j = index - 1; j >= 0; j--) {
    const previous = switches[j]
    if (previous.after !== change.before) continue
    return (change.frame - previous.frame) / fps < readyDuration
  }
  return false
}

/**
 * weaponSwitchPhase: the phase of the held weapon change at this frame, for the posed rig: the
 * outgoing weapon's holster (its `put_away` clip, whose duration ends at the change's frame),
 * then from that frame, the incoming one's draw (its `ready` clip). No holster without a
 * `put_away` clip, without an outgoing weapon, or when the outgoing weapon's draw hasn't finished
 * (previous change too recent); nothing outside the two windows.
 */
export function weaponSwitchPhase(
  rig: FirstPersonRig,
  switches: ArrayLike<WeaponSwitch>,
  frame: number,
  fps: number,
  offset: number = WEAPON_SWITCH_OFFSET,
): WeaponSwitchPhase | null {
  if (fps <= 0) return null
  const i = firstChangeAfter(switches, frame - offset * fps) - 1
  const next = i + 1 < switches.length ? switches[i + 1] : null
  if (next && next.before !== null) {
    const clips = clipsForRig(rig)
    const putAway = clips.putAway
    const start = (frame - next.frame) / fps - offset + (putAway?.durationSeconds ?? 0)
    if (putAway && putAway.durationSeconds > 0 && start >= 0 && start < putAway.durationSeconds) {
      if (!drawTooRecent(next, i + 1, switches, fps, clips.switchReady?.durationSeconds ?? 0)) {
        // The game's holster is very short: its fade-in never takes more than a quarter of it.
        return { phase: 'holster', time: start, weight: Math.min(1, start / Math.min(WEAPON_CHANGE_FADE, putAway.durationSeconds / 4)) }
      }
    }
  }
  if (i >= 0) {
    const change = switches[i]
    const time = (frame - change.frame) / fps - offset
    const ready = clipsForRig(rig).switchReady
    if (ready && ready.durationSeconds > 0 && time >= 0 && time < ready.durationSeconds) {
      // The draw starts from the weapon offscreen: full weight from its first frame, fading out only at the end.
      return { phase: 'ready', time, weight: Math.min(1, (ready.durationSeconds - time) / WEAPON_CHANGE_FADE) }
    }
  }
  return null
}

/** Slide: entry (if there is a clip) at the start of the interval, loop until the end of the
 *  interval, exit (if there is a clip) after the interval, for its own duration. Weight 1 at
 *  phase boundaries; a 0.15 s fade only right at the start with no entry, and right at the end
 *  with no exit. */
function slidePhase(clips: RigClips, slide: SprintInterval | undefined, frame: number, fps: number): { clip: FirstPersonClip; time: number; weight: number } | null {
  const loop = clips.slideLoop
  if (!slide || !loop || loop.durationSeconds <= 0 || frame < slide.t0) return null
  const startTime = (frame - slide.t0) / fps
  const enter = clips.slideEnter
  if (enter && startTime < enter.durationSeconds) return { clip: enter, time: startTime, weight: 1 }
  if (frame <= slide.t1) {
    const exit = clips.slideExit
    const weight = Math.min(enter ? 1 : startTime / 0.15, enter || exit ? 1 : (slide.t1 - frame) / fps / 0.15)
    return { clip: loop, time: (startTime - (enter?.durationSeconds ?? 0)) % loop.durationSeconds, weight }
  }
  const exit = clips.slideExit
  const exitTime = (frame - slide.t1) / fps
  if (exit && exitTime < exit.durationSeconds) return { clip: exit, time: exitTime, weight: Math.min(1, (exit.durationSeconds - exitTime) / 0.15) }
  return null
}

type Movement = { clip: FirstPersonClip; time: number; weight: number }

/** A fall longer than one second uses the hard landing. */
const HARD_LANDING_FALL_DURATION = 1

function loopMotion(clip: FirstPersonClip | null, interval: SprintInterval | undefined, e: FirstPersonFrameEvents): Movement | null {
  if (!clip || !interval || e.frame > interval.t1 || clip.durationSeconds <= 0) return null
  const time = (e.frame - interval.t0) / e.fps
  return { clip, time: clip.frameCount <= 2 ? 0 : time % clip.durationSeconds,
    weight: Math.min(1, time / 0.15, (interval.t1 - e.frame) / e.fps / 0.15) }
}

function once(clip: FirstPersonClip | null, time: number): Movement | null {
  if (!clip || time < 0 || time >= clip.durationSeconds) return null
  return { clip, time, weight: Math.min(1, time / 0.1, (clip.durationSeconds - time) / 0.1) }
}

/** The phases depend only on the sprint's bounds and the current frame. */
function sprintPhase(clips: RigClips, sprint: SprintInterval | undefined, e: FirstPersonFrameEvents, inAir: boolean): Movement | null {
  const loop = inAir ? clips.sprintAir ?? clips.sprint : clips.sprint
  if (!sprint || (!clips.sprintEnter && !clips.sprintExit)) return loopMotion(loop, sprint, e)
  const start = (e.frame - sprint.t0) / e.fps
  const end = (sprint.t1 + 1 - sprint.t0) / e.fps
  const enter = clips.sprintEnter, exit = clips.sprintExit
  const short = !!enter && !!exit && end < enter.durationSeconds
  if (start < end && enter && start < enter.durationSeconds) {
    return { clip: enter, time: start, weight: Math.min(1, start / 0.15, short ? (end - start) / 0.15 : 1) }
  }
  const sinceEnd = (e.frame - (sprint.t1 + 1)) / e.fps
  if (sinceEnd >= 0 && exit && sinceEnd < exit.durationSeconds) {
    const time = sinceEnd
    return { clip: exit, time, weight: Math.min(1, short ? time / 0.15 : 1, (exit.durationSeconds - time) / 0.15) }
  }
  if (!loop || loop.durationSeconds <= 0 || start >= end) return null
  const time = loop.frameCount <= 2 ? 0 : Math.max(0, start - (enter?.durationSeconds ?? 0)) % loop.durationSeconds
  const weight = Math.min(1, enter ? 1 : start / 0.15, exit ? 1 : Math.max(0, (sprint.t1 - e.frame) / e.fps / 0.15))
  return { clip: loop, time, weight }
}
function movement(clips: RigClips, e: FirstPersonFrameEvents): Movement | null {
  const slide = e.slides.findLast((s) => s.t0 <= e.frame)
  const jump = e.jumps.findLast((s) => s.t0 <= e.frame)
  const climb = e.climbs.findLast((s) => s.t0 <= e.frame)
  const crouch = e.crouches.findLast((s) => s.t0 <= e.frame)
  const sprint = e.sprints.findLast((s) => s.t0 <= e.frame)
  let choice = slide && e.frame <= slide.t1 ? null : loopMotion(clips.crouch, crouch, e)
  const inAir = jump && e.frame <= jump.t1
  choice = sprintPhase(clips, sprint, e, !!inAir) ?? choice
  choice = slidePhase(clips, slide, e.frame, e.fps) ?? choice
  if (jump) {
    const sinceJump = (e.frame - jump.t0) / e.fps
    const sinceLand = (e.frame - (jump.t1 + 1)) / e.fps
    const landing = (jump.t1 + 1 - jump.t0) / e.fps > HARD_LANDING_FALL_DURATION ? clips.landHard : clips.landSoft
    choice = once(clips.jump, sinceJump) ?? choice
    choice = once(landing, sinceLand) ?? choice
  }
  if (climb && e.frame <= climb.t1) choice = once(clips.climb, (e.frame - climb.t0) / e.fps) ?? choice
  return choice
}

export function firstPersonPose(rig: FirstPersonRig, e: FirstPersonFrameEvents, pose: FirstPersonPose): FirstPersonPose {
  pose.base = null
  pose.baseWeight = 0
  pose.baseTime = 0
  pose.fire = null
  pose.fireTime = 0
  pose.fireWeight = 0
  if (e.fps <= 0) return pose
  // A shot or reload from before the last weapon change belongs to the holstered weapon:
  // it doesn't play on the rig of the one that's arriving.
  const switchRank = firstChangeAfter(e.weaponSwitches, e.frame) - 1
  const since = switchRank >= 0 ? e.weaponSwitches[switchRank].frame : -Infinity
  const lastShot = lastAtOrBefore(e.shots, e.frame)
  const strike = lastAtOrBefore(e.strikes, e.frame)
  const shot = lastShot < since ? -Infinity : lastShot
  const clips = clipsForRig(rig)
  const grenade = lastAtOrBefore(e.grenades, e.frame + 0.25 * e.fps)
  const fireTime = (e.frame - shot) / e.fps
  const moving = fireTime >= 0.3 ? movement(clips, e) : null
  if (moving) {
    pose.base = moving.clip
    pose.baseTime = moving.time
    pose.baseWeight = moving.weight
  }
  const phase = weaponSwitchPhase(rig, e.weaponSwitches, e.frame, e.fps)
  if (phase) {
    const clip = phase.phase === 'ready' ? clips.switchReady : clips.putAway
    if (clip && phase.time < clip.durationSeconds) {
      pose.base = clip
      pose.baseTime = phase.time
      pose.baseWeight = phase.weight
    }
  }
  const grenadeTime = (e.frame - grenade) / e.fps + 0.25
  if (clips.grenade && grenadeTime < clips.grenade.durationSeconds) {
    pose.base = clips.grenade
    pose.baseTime = grenadeTime
  }
  const strikeClip = clips.strike
  const strikeTime = (e.frame - strike) / e.fps
  // A staged reload weighs its own phases (full weight where one stage hands over to the next).
  let reloadWeight: number | null = null
  const reload = reloadPhase(clips.reload, e.reloads, e.frame, e.fps, shot, since)
  if (reload && e.reloadValid(reload.since, e.frame)) {
    pose.base = reload.clip
    pose.baseTime = reload.time
    reloadWeight = reload.weight
  }
  // Using a piece of equipment, firing the grapple, or the thruster all cut the reload; a melee strike cuts them too.
  const usage = useAt(e.usages, e.frame)
  const usageClip = usage ? clipOfRig(rig, usage.action) : null
  const usageTime = usage ? (e.frame - usage.frame) / e.fps : Infinity
  if (usageClip && usageTime < usageClip.durationSeconds) {
    pose.base = usageClip
    pose.baseTime = usageTime
    reloadWeight = null
  }
  if (strikeClip && strikeTime < strikeClip.durationSeconds) {
    pose.base = strikeClip
    pose.baseTime = strikeTime
    reloadWeight = null
  }
  // The weight of a weapon change is computed by the phase (holster's fade-in, draw's fades).
  if (reloadWeight !== null) {
    pose.baseWeight = reloadWeight
  } else if (pose.base && pose.base !== clips.switchReady && pose.base !== clips.putAway && pose.base !== moving?.clip) {
    // A melee strike starts at full weight: its hit lands in the clip's first tenth of a second,
    // which a fade-in would erase.
    const enterWeight = pose.base === strikeClip ? 1 : pose.baseTime / 0.1
    pose.baseWeight = Math.min(1, enterWeight, (pose.base.durationSeconds - pose.baseTime) / 0.1)
  }
  const fireClip = clips.fire
  // A melee strike given after the last shot cuts its animation: it would hide the strike.
  const fireCut = pose.base === strikeClip && strikeClip !== null && strike >= shot
  if (fireClip && fireTime < fireClip.durationSeconds && !fireCut) {
    pose.fire = fireClip
    pose.fireTime = fireTime
    pose.fireWeight = 1
  }
  return pose
}
