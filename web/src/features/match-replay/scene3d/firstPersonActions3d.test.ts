// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'
import {
  WEAPON_SWITCH_OFFSET,
  newFirstPersonPose,
  weaponSwitchPhase,
  firstPersonPose,
  type WeaponSwitch,
  type FirstPersonFrameEvents,
} from './firstPersonActions3d'
import type { FirstPersonRig } from './firstPersonRig3d'
import type { ReloadEpisode } from './firstPersonReload3d'

function rigWith(...names: string[]): FirstPersonRig {
  return { file: '', bones: 0, triangles: 0, bytes: 0, missingActions: [],
    clips: names.map((name) => ({ name, action: name, variant: 0, type: 'base', overlay: false, frameCount: 30, frameRate: 30, durationSeconds: 1 })),
    actions: names.map((name) => ({ action: name, variant: 0, clip: name })) }
}
const rig = rigWith('reload_full', 'reload_empty', 'reload_enter', 'melee_strike_1', 'fire_1')
/** A one-message reload episode starting at frame `t`. */
const ep = (t: number, empty: boolean | null = null): ReloadEpisode => ({ stages: [{ t, cut: false }], empty })
function events(): FirstPersonFrameEvents {
  return { reloads: [ep(10)], strikes: [], shots: [], grenades: [], weaponSwitches: [], sprints: [], slides: [], crouches: [], jumps: [], climbs: [], usages: [], frame: 12, fps: 10, reloadValid: () => true }
}
function change(frame: number, before: string | null = 'a', after: string | null = 'b'): WeaponSwitch {
  return { frame, before, after }
}
const read = (r: FirstPersonRig, e: FirstPersonFrameEvents) => firstPersonPose(r, e, newFirstPersonPose())

describe('first-person actions', () => {
  it('plays the reload then ends it', () => {
    const e = events()
    expect(read(rig, e).base?.action).toBe('reload_full')
    expect(read(rig, e).baseTime).toBeCloseTo(0.2)
    e.frame = 20
    expect(read(rig, e).base).toBeNull()
  })
  it('cancels the reload after a weapon change or a shot', () => {
    const e = events()
    e.reloadValid = () => false
    expect(read(rig, e).base).toBeNull()
    e.reloadValid = () => true
    e.shots = [11]
    expect(read(rig, e).base).toBeNull()
  })
  it('plays the repulsor use clip from its activation frame, over the reload, under a melee strike', () => {
    const r = rigWith('reload_full', 'melee_strike_1', 'knockback:equipment_activate')
    const e = events(); e.usages = [{ frame: 11, action: 'knockback:equipment_activate' }]
    let pose = read(r, e)
    expect(pose.base?.action).toBe('knockback:equipment_activate')
    expect(pose.baseTime).toBeCloseTo(0.1)
    e.frame = 10.5
    expect(read(r, e).base?.action).toBe('reload_full')
    e.frame = 21.5
    expect(read(r, e).base).toBeNull()
    e.frame = 12; e.strikes = [11.5]
    pose = read(r, e)
    expect(pose.base?.action).toBe('melee_strike_1')
  })
  it('plays nothing for a use whose clip the rig lacks (library built before the clip existed)', () => {
    const e = events(); e.reloads = []; e.usages = [{ frame: 11, action: 'knockback:equipment_activate' }]
    expect(read(rig, e).base).toBeNull()
  })
  it('gives priority to the melee strike', () => {
    const e = events(); e.strikes = [11]
    expect(read(rig, e).base?.action).toBe('melee_strike_1')
  })
  it('the melee strike starts at full weight and cuts the shot that precedes it', () => {
    const e = events(); e.reloads = []; e.shots = [10]; e.strikes = [11.5]
    const pose = read(rig, e)
    expect(pose.base?.action).toBe('melee_strike_1')
    expect(pose.baseWeight).toBe(1)
    expect(pose.fire).toBeNull()
  })
  it('a shot given after the melee strike plays back on top of it', () => {
    const e = events(); e.reloads = []; e.strikes = [10]; e.shots = [11]
    const pose = read(rig, e)
    expect(pose.base?.action).toBe('melee_strike_1')
    expect(pose.fire?.action).toBe('fire_1')
  })
  it('restarts the shot animation at the latest event', () => {
    const e = events(); e.shots = [10, 11]
    expect(read(rig, e).fireTime).toBeCloseTo(0.1)
    e.frame = 10.5
    expect(read(rig, e).fireTime).toBeCloseTo(0.05)
  })
  it('picks full, then empty, then enter', () => {
    const e = events()
    for (const [names, expected] of [
      [['reload_full', 'reload_empty', 'reload_enter'], 'reload_full'],
      [['reload_empty', 'reload_enter'], 'reload_empty'], [['reload_enter'], 'reload_enter'],
    ] as const) expect(read(rigWith(...names), e).base?.action).toBe(expected)
  })
  it('gives the same pose when seeking backward', () => {
    const e = events(); const pose = newFirstPersonPose()
    const before = { ...firstPersonPose(rig, e, pose) }
    e.frame = 25; firstPersonPose(rig, e, pose)
    e.frame = 12
    expect(firstPersonPose(rig, e, pose)).toEqual(before)
  })
  it('ignores missing actions', () => {
    const e = events(); e.strikes = [11]; e.shots = [11]
    expect(read(rigWith(), e)).toEqual(newFirstPersonPose())
  })
  it('plays grenade and weapon change at their expected instants, in both directions', () => {
    const r = rigWith('throw_grenade', 'ready')
    const e = events(); e.reloads = []; e.grenades = [20]; e.weaponSwitches = [change(10)]
    e.frame = 12
    const before = read(r, e)
    expect(before.base?.action).toBe('ready'); expect(before.baseTime).toBeCloseTo(0.2)
    e.frame = 20
    expect(read(r, e).base?.action).toBe('throw_grenade'); expect(read(r, e).baseTime).toBeCloseTo(0.25)
    e.frame = 30; expect(read(r, e).base).toBeNull()
    e.frame = 12; expect(read(r, e)).toEqual(before)
    e.frame = 7; expect(read(r, e).base).toBeNull()
    e.frame = 20; expect(read(rigWith(), e).base).toBeNull()
  })

  describe('held weapon change: holster then draw', () => {
    // Rig for the outgoing weapon (A): 1 s holster; rig for the incoming one (B): 1 s draw.
    const rigA = rigWith('put_away', 'ready', 'fire_1', 'throw_grenade', 'reload_full', 'melee_strike_1')
    const rigB = rigWith('ready', 'fire_1')
    const eChange = () => { const e = events(); e.reloads = []; e.weaponSwitches = [change(100)]; return e }
    it('plays the outgoing weapon holster before the change, the draw after', () => {
      const e = eChange()
      e.frame = 89.99; expect(read(rigA, e).base).toBeNull()
      e.frame = 90; expect(read(rigA, e).base?.action).toBe('put_away'); expect(read(rigA, e).baseTime).toBe(0)
      e.frame = 95; expect(read(rigA, e).base?.action).toBe('put_away'); expect(read(rigA, e).baseTime).toBeCloseTo(0.5)
      e.frame = 100; expect(read(rigB, e).base?.action).toBe('ready'); expect(read(rigB, e).baseTime).toBe(0)
      e.frame = 105; expect(read(rigB, e).base?.action).toBe('ready'); expect(read(rigB, e).baseTime).toBeCloseTo(0.5)
      e.frame = 110; expect(read(rigB, e).base).toBeNull()
      // Seeking backward gives back the same frame.
      e.frame = 95; const before = read(rigA, e)
      e.frame = 105; read(rigB, e); e.frame = 95
      expect(read(rigA, e)).toEqual(before)
    })
    it('fades the holster in at the start and the draw out at its end', () => {
      const e = eChange()
      e.frame = 90; expect(read(rigA, e).baseWeight).toBe(0)
      e.frame = 90.5; expect(read(rigA, e).baseWeight).toBeCloseTo(0.5)
      e.frame = 95; expect(read(rigA, e).baseWeight).toBe(1)
      e.frame = 99.95; expect(read(rigA, e).baseWeight).toBe(1)
      e.frame = 100; expect(read(rigB, e).baseWeight).toBe(1)
      e.frame = 100.5; expect(read(rigB, e).baseWeight).toBe(1)
      e.frame = 101; expect(read(rigB, e).baseWeight).toBe(1)
      e.frame = 101.95; expect(read(rigB, e).baseWeight).toBe(1)
      e.frame = 109.5; expect(read(rigB, e).baseWeight).toBeCloseTo(0.5)
    })
    it('keeps the shot animation over the holster', () => {
      const e = eChange(); e.frame = 95; e.shots = [95]
      const pose = read(rigA, e)
      expect(pose.base?.action).toBe('put_away')
      expect(pose.fire?.action).toBe('fire_1'); expect(pose.fireTime).toBe(0); expect(pose.fireWeight).toBe(1)
    })
    it('keeps other actions\' priority during the holster', () => {
      const e = eChange(); e.frame = 95
      e.strikes = [94]; expect(read(rigA, e).base?.action).toBe('melee_strike_1')
      e.strikes = []; e.reloads = [ep(94)]; expect(read(rigA, e).base?.action).toBe('reload_full')
      e.reloads = []; e.grenades = [95]; expect(read(rigA, e).base?.action).toBe('throw_grenade')
      e.grenades = []; expect(read(rigA, e).base?.action).toBe('put_away')
    })
    it('does not holster without an outgoing weapon or without a clip, and plays nothing without a ready clip', () => {
      const eSpawn = eChange(); eSpawn.weaponSwitches = [change(100, null, 'b')]; eSpawn.frame = 95
      expect(read(rigA, eSpawn).base).toBeNull()
      const eNoClip = eChange(); eNoClip.frame = 95
      expect(read(rigWith('ready'), eNoClip).base).toBeNull()
      const eB = eChange(); eB.frame = 95
      expect(read(rigA, eB).base?.action).toBe('put_away')
      eB.frame = 100.5
      expect(read(rigWith('fire_1'), eB).base).toBeNull()
    })
    it('does not holster if the outgoing weapon\'s draw has not finished', () => {
      const eRecent = eChange(); eRecent.weaponSwitches = [change(99, 'c', 'a'), change(100, 'a', 'b')]; eRecent.frame = 99.5
      expect(read(rigA, eRecent).base?.action).toBe('ready')
      const eDone = eChange(); eDone.weaponSwitches = [change(90, 'c', 'a'), change(100, 'a', 'b')]; eDone.frame = 99.5
      expect(read(rigA, eDone).base?.action).toBe('put_away')
      const eOther = eChange(); eOther.weaponSwitches = [change(99, 'c', 'd'), change(100, 'a', 'b')]; eOther.frame = 99.5
      expect(read(rigA, eOther).base?.action).toBe('put_away')
    })
    it('shifts both phases of the change by their offset', () => {
      const r = rigWith('put_away', 'ready')
      const weaponSwitches = [change(100)]
      expect(weaponSwitchPhase(r, weaponSwitches, 95, 10)?.phase).toBe('holster')
      expect(weaponSwitchPhase(r, weaponSwitches, 91, 10, 0.2)).toBeNull()
      const shiftedHolster = weaponSwitchPhase(r, weaponSwitches, 95, 10, 0.2)
      expect(shiftedHolster?.phase).toBe('holster'); expect(shiftedHolster?.time).toBeCloseTo(0.3); expect(shiftedHolster?.weight).toBe(1)
      const shiftedReady = weaponSwitchPhase(r, weaponSwitches, 105, 10, 0.2)
      expect(shiftedReady?.phase).toBe('ready'); expect(shiftedReady?.time).toBeCloseTo(0.3); expect(shiftedReady?.weight).toBe(1)
      const lateHolster = weaponSwitchPhase(r, weaponSwitches, 100.5, 10, 0.2)
      expect(lateHolster?.phase).toBe('holster'); expect(lateHolster?.time).toBeCloseTo(0.85); expect(lateHolster?.weight).toBe(1)
      expect(weaponSwitchPhase(r, weaponSwitches, 102, 10, 0.2)).toEqual({ phase: 'ready', time: 0, weight: 1 })
      expect(weaponSwitchPhase(r, weaponSwitches, 100.5, 10)).toEqual({ phase: 'ready', time: 0.05, weight: 1 })
      expect(weaponSwitchPhase(r, weaponSwitches, 95, 10, WEAPON_SWITCH_OFFSET)).toEqual({ phase: 'holster', time: 0.5, weight: 1 })
    })
    it('does not play a shot or reload of the holstered weapon on the incoming one', () => {
      const e = eChange(); e.shots = [99]; e.reloads = [ep(98)]; e.frame = 103
      const pose = read(rigB, e)
      expect(pose.base?.action).toBe('ready'); expect(pose.baseWeight).toBe(1); expect(pose.fire).toBeNull()
      e.shots = [99, 102]
      expect(read(rigB, e).fire?.action).toBe('fire_1')
    })
    it('stays a pure function of the frame', () => {
      const e = eChange(); const pose = newFirstPersonPose()
      e.frame = 95; const before = { ...firstPersonPose(rigA, e, pose) }
      e.frame = 120; firstPersonPose(rigB, e, pose)
      e.frame = 95; expect(firstPersonPose(rigA, e, pose)).toEqual(before)
    })
  })
  it('loops the sprint, respects shots, and stays deterministic', () => {
    const r = rigWith('sprint_loop'); const e = events()
    e.reloads = []; e.sprints = [{ t0: 10, t1: 40 }]; e.frame = 23
    const before = read(r, e)
    expect(before.base?.action).toBe('sprint_loop'); expect(before.baseTime).toBeCloseTo(0.3)
    e.frame = 41; expect(read(r, e).base).toBeNull()
    e.frame = 23; expect(read(r, e)).toEqual(before)
    e.shots = [21]; expect(read(r, e).base).toBeNull()
    e.shots = []; expect(read(rigWith(), e).base).toBeNull()
    e.frame = 9; expect(read(r, e).base).toBeNull()
  })
  it('plays sprint transitions according to the frames, even when seeking backward', () => {
    const r = rigWith('sprint_enter', 'sprint_loop', 'sprint_exit'); const e = events()
    e.reloads = []; e.sprints = [{ t0: 10, t1: 40 }]
    e.frame = 10; expect(read(r, e).base?.action).toBe('sprint_enter'); expect(read(r, e).baseTime).toBe(0)
    e.frame = 15; const middle = read(r, e); expect(middle.baseTime).toBeCloseTo(0.5)
    e.frame = 20; expect(read(r, e).base?.action).toBe('sprint_loop')
    e.frame = 41; expect(read(r, e).base?.action).toBe('sprint_exit'); expect(read(r, e).baseTime).toBe(0)
    e.frame = 46; expect(read(r, e).baseTime).toBeCloseTo(0.5)
    e.frame = 51; expect(read(r, e).base).toBeNull()
    e.frame = 15; expect(read(r, e)).toEqual(middle)
  })
  it('fades an interrupted entry toward idle then the exit', () => {
    const r = rigWith('sprint_enter', 'sprint_loop', 'sprint_exit'); const e = events()
    e.reloads = []; e.sprints = [{ t0: 10, t1: 12 }]
    e.frame = 12.5; expect(read(r, e).base?.action).toBe('sprint_enter'); expect(read(r, e).baseWeight).toBeLessThan(0.5)
    e.frame = 13; expect(read(r, e).base?.action).toBe('sprint_exit'); expect(read(r, e).baseWeight).toBe(0)
    e.frame = 13.75; expect(read(r, e).baseWeight).toBeCloseTo(0.5)
  })
  it('keeps the priority of other actions during transitions', () => {
    const r = rigWith('sprint_enter', 'sprint_loop', 'sprint_exit', 'reload_full', 'melee_strike_1', 'fire_1')
    const e = events(); e.sprints = [{ t0: 10, t1: 40 }]; e.frame = 12
    expect(read(r, e).base?.action).toBe('reload_full')
    e.strikes = [11]; expect(read(r, e).base?.action).toBe('melee_strike_1')
    e.reloads = []; e.strikes = []; e.shots = [11]; expect(read(r, e).base).toBeNull()
  })
  it('plays the slide: entry, loop, exit, then nothing', () => {
    const r = rigWith('slide_enter', 'slide_loop', 'slide_exit')
    const e = events(); e.reloads = []; e.slides = [{ t0: 10, t1: 40 }]
    e.frame = 11
    let pose = read(r, e)
    expect(pose.base?.action).toBe('slide_enter'); expect(pose.baseTime).toBeCloseTo(0.1); expect(pose.baseWeight).toBe(1)
    e.frame = 25
    pose = read(r, e)
    expect(pose.base?.action).toBe('slide_loop'); expect(pose.baseTime).toBeCloseTo(0.5); expect(pose.baseWeight).toBe(1)
    e.frame = 42
    pose = read(r, e)
    expect(pose.base?.action).toBe('slide_exit'); expect(pose.baseTime).toBeCloseTo(0.2); expect(pose.baseWeight).toBe(1)
    e.frame = 50.5
    expect(read(r, e).base).toBeNull()
    e.frame = 49.99
    expect(read(r, e).baseWeight).toBeLessThan(0.1)
  })
  it('fades the slide loop over 0.15 s with no entry or exit', () => {
    const r = rigWith('slide_loop')
    const e = events(); e.reloads = []; e.slides = [{ t0: 10, t1: 40 }]
    e.frame = 11.5
    expect(read(r, e).baseWeight).toBeCloseTo(0.15 / 0.15)
    e.frame = 10.15
    expect(read(r, e).baseWeight).toBeCloseTo(0.015 / 0.15)
    e.frame = 39.85
    expect(read(r, e).baseWeight).toBeCloseTo(0.015 / 0.15)
    e.frame = 41
    expect(read(r, e).base).toBeNull()
  })
  it('the slide wins over the sprint and gets cut by a shot', () => {
    const r = rigWith('sprint_loop', 'slide_enter', 'slide_loop', 'slide_exit')
    const e = events(); e.reloads = []; e.sprints = [{ t0: 0, t1: 50 }]; e.slides = [{ t0: 10, t1: 40 }]
    e.frame = 23
    expect(read(r, e).base?.action).toBe('slide_loop')
    e.shots = [22]
    expect(read(r, e).base).toBeNull()
    e.shots = []; e.frame = 42
    expect(read(r, e).base?.action).toBe('slide_exit')
  })
  it('without slide_loop, the slide leaves the behavior as is', () => {
    const r = rigWith('sprint_loop', 'slide_enter', 'slide_exit')
    const e = events(); e.reloads = []; e.sprints = [{ t0: 0, t1: 50 }]; e.slides = [{ t0: 10, t1: 40 }]
    e.frame = 23
    expect(read(r, e).base?.action).toBe('sprint_loop')
    const e2 = events(); e2.reloads = []; e2.slides = [{ t0: 10, t1: 40 }]
    e2.frame = 23
    expect(read(r, e2).base).toBeNull()
  })
  it('the melee strike covers the slide', () => {
    const r = rigWith('melee_strike_1', 'slide_enter', 'slide_loop', 'slide_exit')
    const e = events(); e.reloads = []; e.slides = [{ t0: 10, t1: 40 }]; e.strikes = [22]; e.frame = 23
    expect(read(r, e).base?.action).toBe('melee_strike_1')
  })
  it('respects the priority of melee, reload, grenade, change, sprint', () => {
    const r = rigWith('melee_strike_1', 'reload_full', 'throw_grenade', 'ready', 'sprint_loop')
    const e = events(); e.frame = 12; e.strikes = [10]; e.grenades = [12]; e.weaponSwitches = [change(10)]; e.sprints = [{ t0: 0, t1: 40 }]
    expect(read(r, e).base?.action).toBe('melee_strike_1')
    e.strikes = []; expect(read(r, e).base?.action).toBe('reload_full')
    e.reloads = []; expect(read(r, e).base?.action).toBe('throw_grenade')
    e.grenades = []; expect(read(r, e).base?.action).toBe('ready')
    e.weaponSwitches = []; expect(read(r, e).base?.action).toBe('sprint_loop')
  })

  it('plays jump and landings at their bounds', () => {
    const r = rigWith('jump', 'land_soft', 'land_hard'); const e = events()
    e.reloads = []; e.jumps = [{ t0: 10, t1: 15 }]
    for (const [f, action, time] of [[10, 'jump', 0], [13, 'jump', 0.3], [16, 'land_soft', 0], [21, 'land_soft', 0.5], [26, null, 0]] as const) {
      e.frame = f; expect(read(r, e).base?.action ?? null).toBe(action); expect(read(r, e).baseTime).toBeCloseTo(time)
    }
    e.jumps = [{ t0: 10, t1: 24 }]
    for (const [f, action] of [[25, 'land_hard'], [30, 'land_hard'], [35, null]] as const) {
      e.frame = f; expect(read(r, e).base?.action ?? null).toBe(action)
    }
  })
  it('plays a climb once during its interval', () => {
    const r = rigWith('clamber'); const e = events(); e.reloads = []; e.climbs = [{ t0: 10, t1: 40 }]
    for (const [f, action] of [[10, 'clamber'], [15, 'clamber'], [20, null], [41, null]] as const) {
      e.frame = f; expect(read(r, e).base?.action ?? null).toBe(action)
    }
  })
  it('loops or holds crouch with the sprint\'s fades', () => {
    const r = rigWith('crouch'); const e = events(); e.reloads = []; e.crouches = [{ t0: 10, t1: 40 }]
    for (const [f, action] of [[10, 'crouch'], [25, 'crouch'], [41, null]] as const) {
      e.frame = f; expect(read(r, e).base?.action ?? null).toBe(action)
    }
    e.frame = 10.75; expect(read(r, e).baseWeight).toBeCloseTo(0.5)
    e.frame = 39.25; expect(read(r, e).baseWeight).toBeCloseTo(0.5)
    e.frame = 25; expect(read(r, e).baseTime).toBeCloseTo(0.5)
    const pose = rigWith('crouch'); pose.clips[0].frameCount = 2; expect(read(pose, e).baseTime).toBe(0)
  })
  it('respects the priority of movements and the reload', () => {
    const r = rigWith('crouch', 'sprint_loop', 'slide_loop', 'jump', 'clamber', 'reload_full')
    const e = events(); e.frame = 12; e.reloads = []; e.crouches = [{ t0: 0, t1: 40 }]; e.sprints = [{ t0: 0, t1: 40 }]
    expect(read(r, e).base?.action).toBe('sprint_loop')
    e.sprints = []; e.slides = [{ t0: 10, t1: 40 }]; expect(read(r, e).base?.action).toBe('slide_loop')
    e.slides = []; e.sprints = [{ t0: 0, t1: 40 }]; e.jumps = [{ t0: 10, t1: 20 }]; expect(read(r, e).base?.action).toBe('jump')
    e.climbs = [{ t0: 10, t1: 20 }]; expect(read(r, e).base?.action).toBe('clamber')
    e.reloads = [ep(10)]; expect(read(r, e).base?.action).toBe('reload_full')
  })
  it('cuts each movement on a shot and keeps the fallback with no clip', () => {
    for (const [action, field, interval, frame] of [
      ['crouch', 'crouches', { t0: 10, t1: 40 }, 12], ['jump', 'jumps', { t0: 10, t1: 15 }, 12],
      ['land_soft', 'jumps', { t0: 10, t1: 15 }, 17], ['land_hard', 'jumps', { t0: 0, t1: 15 }, 17],
      ['clamber', 'climbs', { t0: 10, t1: 40 }, 12],
    ] as const) {
      const e = events(); e.reloads = []; e[field] = [interval]; e.frame = frame
      expect(read(rigWith(action), e).base?.action).toBe(action); expect(read(rigWith(), e).base).toBeNull()
      e.shots = [frame - 1]; expect(read(rigWith(action), e).base).toBeNull()
      e.shots = [frame - 3]; expect(read(rigWith(action), e).base?.action).toBe(action)
    }
  })
  it('uses the airborne sprint then resumes the grounded sprint', () => {
    const r = rigWith('sprint_loop', 'sprint_loop_airborne'); const e = events()
    e.reloads = []; e.sprints = [{ t0: 0, t1: 40 }]; e.jumps = [{ t0: 10, t1: 15 }]; e.frame = 12
    expect(read(r, e).base?.action).toBe('sprint_loop_airborne'); expect(read(rigWith('sprint_loop'), e).base?.action).toBe('sprint_loop')
    e.frame = 16; expect(read(r, e).base?.action).toBe('sprint_loop')
  })

})
