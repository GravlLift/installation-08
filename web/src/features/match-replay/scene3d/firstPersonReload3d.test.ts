// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { newFirstPersonPose, firstPersonPose, type FirstPersonFrameEvents } from './firstPersonActions3d'
import type { FirstPersonClip, FirstPersonRig } from './firstPersonRig3d'
import { reloadEpisodes, reloadPhase, type ReloadClips } from './firstPersonReload3d'

const FPS = 30
/** ms on the 30 fps grid. */
const f = (ms: number) => (ms / 1000) * FPS

function clip(name: string, durationSeconds: number): FirstPersonClip {
  return { name, action: name, variant: 0, type: 'base', overlay: false, frameCount: Math.round(durationSeconds * 30), frameRate: 30, durationSeconds }
}
// The Heatwave's own clips (first-person library index, 2026-11-15).
const HEATWAVE: ReloadClips = {
  full: null, empty: null, enter: clip('reload_enter', 0.7), loop: clip('reload_continue_full', 0.367),
  loopEmpty: clip('reload_continue_full', 0.367), exit: clip('chamber_1', 1.033),
}
// The Hydra: its round clip lasts 0.83 s, the film's stages come every 0.42 s.
const HYDRA: ReloadClips = { ...HEATWAVE, enter: clip('reload_enter', 0.6), loop: clip('reload_full', 0.833), loopEmpty: clip('reload_full', 0.833) }

/** The film's messages of a Heatwave reload of `n` rounds (match 05dfe4e9, slot 532): starts and the closing cut, in frames. */
function heatwaveReload(n: number, from = 0): { starts: number[]; cuts: number[] } {
  const starts = [f(from)]
  for (let k = 0; k < n; k++) starts.push(f(from + 684 + 367 * k), f(from + 700 + 367 * k))
  return { starts, cuts: [f(from + 684 + 367 * n)] }
}

const name = (c: ReloadClips, episodes: ReturnType<typeof reloadEpisodes>, ms: number, shot = -Infinity) =>
  reloadPhase(c, episodes, f(ms), FPS, shot, -Infinity)?.clip.name ?? null

describe('staged first-person reloads', () => {
  it('groups the film messages into one episode: the start, one stage per round, the closing cut', () => {
    const { starts, cuts } = heatwaveReload(2)
    const [ep, ...rest] = reloadEpisodes(starts, cuts, FPS)
    expect(rest).toEqual([])
    expect(ep.stages.map((e) => Math.round((e.t / FPS) * 1000))).toEqual([0, 684, 1051, 1418])
    expect(ep.stages.map((e) => e.cut)).toEqual([false, false, false, true])
  })

  it('starts no episode at a cut, and leaves out a cut long after the last stage', () => {
    const eps = reloadEpisodes([f(5000)], [f(2000), f(7000)], FPS)
    expect(eps).toHaveLength(1)
    expect(eps[0].stages).toEqual([{ t: f(5000), cut: false }])
  })

  it('plays enter, one round clip per round, then the closing clip, and a fuller reload takes longer', () => {
    const one = reloadEpisodes(...Object.values(heatwaveReload(1)) as [number[], number[]], FPS)
    const four = reloadEpisodes(...Object.values(heatwaveReload(4)) as [number[], number[]], FPS)
    expect(name(HEATWAVE, four, 100)).toBe('reload_enter')
    expect(name(HEATWAVE, four, 700)).toBe('reload_continue_full')
    expect(name(HEATWAVE, four, 1800)).toBe('reload_continue_full')
    expect(name(HEATWAVE, four, 2200)).toBe('chamber_1')
    expect(name(HEATWAVE, four, 2152 + 1100)).toBeNull()
    // One round: the closing clip starts at 1051 ms, four rounds at 2152 ms.
    expect(name(HEATWAVE, one, 1100)).toBe('chamber_1')
    expect(name(HEATWAVE, one, 1051 + 1100)).toBeNull()
    expect(name(HEATWAVE, four, 1100)).toBe('reload_continue_full')
  })

  it('restarts the round clip at each stage, at full weight across the joins', () => {
    const eps = reloadEpisodes(...Object.values(heatwaveReload(3)) as [number[], number[]], FPS)
    const a = reloadPhase(HEATWAVE, eps, f(1051), FPS, -Infinity, -Infinity)!
    expect(a.time).toBeCloseTo(0)
    expect(a.weight).toBe(1)
    const b = reloadPhase(HEATWAVE, eps, f(1040), FPS, -Infinity, -Infinity)!
    expect(b.time).toBeCloseTo(0.356, 2)
    expect(b.weight).toBe(1)
    expect(reloadPhase(HEATWAVE, eps, f(683), FPS, -Infinity, -Infinity)?.weight).toBe(1)
  })

  it('fits a round clip longer than its stage into the stage (Hydra, 0.83 s clip every 0.42 s)', () => {
    const starts = [0, 584, 601, 1001, 1018, 1418, 1435].map(f)
    const eps = reloadEpisodes(starts, [f(1835)], FPS)
    const p = reloadPhase(HYDRA, eps, f(1209), FPS, -Infinity, -Infinity)!
    expect(p.clip.name).toBe('reload_full')
    expect(p.time).toBeCloseTo(0.833 * (208 / 417), 2)
    expect(name(HYDRA, eps, 1900)).toBe('chamber_1')
  })

  it('plays no closing clip after a reload cut mid-round, nor after a shot', () => {
    // Cindershot, match 05dfe4e9 slot 543: the second round is cut 0.13 s in.
    const c = { ...HEATWAVE, enter: clip('reload_enter', 0.633), loop: clip('reload_continue_full', 0.533), exit: clip('chamber_1', 1.5) }
    const eps = reloadEpisodes([0, 617, 634, 1152, 1168].map(f), [f(1285)], FPS)
    expect(name(c, eps, 1200)).toBe('reload_continue_full')
    // The cut round keeps the episode's pace (no fast forward into the cut).
    expect(reloadPhase(c, eps, f(1200), FPS, -Infinity, -Infinity)?.time).toBeCloseTo(0.048, 2)
    expect(name(c, eps, 1300)).toBeNull()
    const full = reloadEpisodes(...Object.values(heatwaveReload(2)) as [number[], number[]], FPS)
    expect(name(HEATWAVE, full, 1500, f(1450))).toBeNull()
    expect(name(HEATWAVE, full, 900, f(800))).toBeNull()
  })

  it('a magazine reload plays its one clip from the episode start, empty or full by the magazine', () => {
    const ma40: ReloadClips = { full: clip('reload_full', 2.33), empty: clip('reload_empty', 2.67), enter: null, loop: null, loopEmpty: null, exit: null }
    // MA40, match 05dfe4e9 slot 693: two more messages 233/266 ms in no longer restart the clip.
    const eps = reloadEpisodes([0, 233, 266].map(f), [], FPS, () => true)
    const p = reloadPhase(ma40, eps, f(500), FPS, -Infinity, -Infinity)!
    expect(p.clip.name).toBe('reload_empty')
    expect(p.time).toBeCloseTo(0.5)
    expect(p.weight).toBeNull()
    expect(name(ma40, reloadEpisodes([0], [], FPS, () => false), 500)).toBe('reload_full')
    expect(name(ma40, reloadEpisodes([0], [], FPS), 500)).toBe('reload_full')
    expect(name(ma40, eps, 2700)).toBeNull()
  })

  it('drives the first-person pose: the staged phases override the usual fade, a melee still wins', () => {
    const names = ['reload_enter', 'reload_continue_full', 'reload_continue_empty', 'chamber_1', 'melee_strike_1']
    const durations: Record<string, number> = { reload_enter: 0.7, reload_continue_full: 0.367, reload_continue_empty: 0.367, chamber_1: 1.033, melee_strike_1: 1.5 }
    const rig: FirstPersonRig = { file: '', bones: 0, triangles: 0, bytes: 0, missingActions: [],
      clips: names.filter((n) => n !== 'reload_continue_empty').map((n) => clip(n, durations[n])),
      actions: names.map((n) => ({ action: n, variant: 0, clip: n === 'reload_continue_empty' ? 'reload_continue_full' : n })) }
    const e: FirstPersonFrameEvents = { reloads: reloadEpisodes(...Object.values(heatwaveReload(2)) as [number[], number[]], FPS),
      strikes: [], shots: [], grenades: [], weaponSwitches: [], sprints: [], slides: [], crouches: [], jumps: [], climbs: [], usages: [],
      frame: f(1051), fps: FPS, reloadValid: () => true }
    let pose = firstPersonPose(rig, e, newFirstPersonPose())
    expect(pose.base?.name).toBe('reload_continue_full')
    expect(pose.baseWeight).toBe(1)
    e.frame = f(1500)
    expect(firstPersonPose(rig, e, newFirstPersonPose()).base?.name).toBe('chamber_1')
    e.strikes = [f(1400)]
    pose = firstPersonPose(rig, e, newFirstPersonPose())
    expect(pose.base?.name).toBe('melee_strike_1')
  })
})

// The Ravager's own clips (first-person library, 2026-11-15): no reload clip, a vent.
const RAVAGER: ReloadClips = {
  full: null, empty: null, enter: null, loop: null, loopEmpty: null, exit: null,
  vent: { enter: clip('vent_enter', 0.3), loop: clip('vent_loop', 0.933), exit: clip('vent_exit', 0.6) },
}

describe('the vent of a heat weapon', () => {
  // Match 05dfe4e9, TasteThePainbow's Ravager: reload messages at 7:56.8 and 7:57.4 (606 ms apart).
  const episodes = reloadEpisodes([f(0), f(606)], [], FPS)

  it('plays the vent clips from the film reload message: enter, loop, exit', () => {
    expect(name(RAVAGER, episodes, 100)).toBe('vent_enter')
    expect(name(RAVAGER, episodes, 700)).toBe('vent_loop')
    expect(name(RAVAGER, episodes, 1300)).toBe('vent_exit')
    expect(name(RAVAGER, episodes, 1900)).toBeNull()
  })

  it('holds the loop until the last message of a longer vent', () => {
    const long = reloadEpisodes([f(0), f(800), f(1600)], [], FPS)
    expect(name(RAVAGER, long, 1500)).toBe('vent_loop')
    expect(name(RAVAGER, long, 1700)).toBe('vent_exit')
  })

  it('ends at a shot fired after the vent starts', () => {
    expect(name(RAVAGER, episodes, 700, f(500))).toBeNull()
  })

  it('leaves a weapon with reload clips on its reload', () => {
    const ma40: ReloadClips = { full: clip('reload_full', 2.33), empty: null, enter: null, loop: null, loopEmpty: null, exit: null, vent: RAVAGER.vent }
    expect(name(ma40, episodes, 700)).toBe('reload_full')
  })
})
