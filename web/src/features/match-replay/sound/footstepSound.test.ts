// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * footstepSound.test.ts — THE PURE RULES of when a foot step sounds, from the film's motion.
 *
 * Cadence (a sprint stamps more than a walk), the silences (stationary, airborne), the slide
 * (one slide_into at the start, scrapes during, nothing after), the landing (soft vs hard), and
 * the deterministic take (same event, same file, live and export).
 */
import { describe, expect, it } from 'vitest'

import { planAudioMix } from './replayAudioMix'
import {
  footstepReplayEvents,
  footstepSoundEvents,
  footstepTimedEvents,
  FOOTSTEP_GAIN_DB,
  type FootstepInput,
} from './footstepSound'
import type { FootstepManifest } from './footstepManifest'
import { testReplayDoc } from '../test/testDoc'

/** A manifest that has a single take per sound: enough to see WHICH sound the rules name. */
const MANIFEST: FootstepManifest = {
  version: 1,
  feet: {
    default: {
      walk: { takes: [{ file: 'foot_walk.ogg', media: 1, durationMs: 180 }] },
      run: { takes: [{ file: 'foot_run.ogg', media: 2, durationMs: 170 }] },
      sprint: { takes: [{ file: 'foot_sprint.ogg', media: 3, durationMs: 160 }] },
      slide: { takes: [{ file: 'foot_slide.ogg', media: 4, durationMs: 240 }] },
    },
  },
  movement: {
    land: { takes: [{ file: 'move_land.ogg', media: 10, durationMs: 220 }] },
    landhard: { takes: [{ file: 'move_landhard.ogg', media: 11, durationMs: 260 }] },
    slide_into: { takes: [{ file: 'move_slide_into.ogg', media: 12, durationMs: 300 }] },
    slide_outof: { takes: [{ file: 'move_slide_outof.ogg', media: 14, durationMs: 300 }] },
    jumpup: { takes: [{ file: 'move_jumpup.ogg', media: 13, durationMs: 200 }] },
  },
}

const FRAME_MS = 20

/** frames of a horizontal walk at a fixed speed: x advances by speed * frameMs per frame. */
function horizontal(speed: number, frames: number): FootstepInput {
  const step = speed * (FRAME_MS / 1000)
  return {
    points: Array.from({ length: frames + 1 }, (_, i) => ({ t: i, x: i * step, y: 0 })),
    stances: [],
    frameIntervalMs: FRAME_MS,
    xuid: 'P',
    surface: 'default',
  }
}

describe('footstepTimedEvents — cadence', () => {
  it('a sprint stamps MORE steps than a walk over the same time', () => {
    const walk = footstepTimedEvents(horizontal(2, 300)).filter((e) => e.kind === 'step')
    const sprint = footstepTimedEvents(horizontal(8, 300)).filter((e) => e.kind === 'step')
    expect(walk.length).toBeGreaterThan(0)
    expect(sprint.length).toBeGreaterThan(walk.length)
  })

  it('names the gait by speed: walk below the run threshold, sprint above it', () => {
    expect(footstepTimedEvents(horizontal(2, 60)).find((e) => e.kind === 'step')?.action).toBe('walk')
    expect(footstepTimedEvents(horizontal(8, 60)).find((e) => e.kind === 'step')?.action).toBe('sprint')
  })
})

describe('footstepTimedEvents — the silences', () => {
  it('a stationary player makes NO step', () => {
    expect(footstepTimedEvents({ points: Array.from({ length: 50 }, (_, i) => ({ t: i, x: 5, y: 5 })), stances: [], frameIntervalMs: FRAME_MS, xuid: 'P', surface: 'default' })).toHaveLength(0)
  })

  it('a player fully in the air makes NO step (only the jump)', () => {
    const points = Array.from({ length: 40 }, (_, i) => ({ t: i, x: i * 0.2, y: 0, z: Math.sin((i / 39) * Math.PI) * 2 }))
    const stances = [{ kind: 'jumpDerived', t0: 0, t1: 39 }]
    const events = footstepTimedEvents({ points, stances, frameIntervalMs: FRAME_MS, xuid: 'P', surface: 'default' })
    expect(events.filter((e) => e.kind === 'step')).toHaveLength(0)
    expect(events.some((e) => e.kind === 'jump')).toBe(true)
  })
})

describe('footstepTimedEvents — the slide', () => {
  it('marks one slide_into at the start, scrapes during, one slide_outof at the end, nothing after', () => {
    const speed = 6
    const step = speed * (FRAME_MS / 1000)
    const points = Array.from({ length: 60 }, (_, i) => ({ t: i, x: i * step, y: 0 }))
    const stances = [{ kind: 'slide', t0: 10, t1: 40 }]
    const events = footstepTimedEvents({ points, stances, frameIntervalMs: FRAME_MS, xuid: 'P', surface: 'default' })
    const into = events.filter((e) => e.kind === 'slide' && e.action === 'slide_into')
    const outof = events.filter((e) => e.kind === 'slide' && e.action === 'slide_outof')
    const scrapes = events.filter((e) => e.kind === 'slide' && e.action === 'slide')
    expect(into).toHaveLength(1)
    expect(into[0].timeMs).toBe(10 * FRAME_MS)
    expect(outof).toHaveLength(1)
    // The slide_outof sits after the last scrape, at the first non-slide frame.
    expect(scrapes.length).toBeGreaterThan(0)
    expect(outof[0].timeMs).toBeGreaterThan(scrapes[scrapes.length - 1].timeMs)
    expect(outof[0].timeMs).toBe(41 * FRAME_MS)
    // No slide scrape after the stance ends (the last scrape is at or before frame 40).
    expect(scrapes.every((e) => e.timeMs <= 40 * FRAME_MS)).toBe(true)
    // No ordinary steps while sliding.
    expect(events.filter((e) => e.kind === 'step' && e.timeMs >= 10 * FRAME_MS && e.timeMs <= 40 * FRAME_MS)).toHaveLength(0)
  })

  it('plays one slide_outof when a slide is cut short by a jump', () => {
    const speed = 6
    const step = speed * (FRAME_MS / 1000)
    const points = Array.from({ length: 60 }, (_, i) => ({ t: i, x: i * step, y: 0, z: i < 40 ? 0 : (i - 40) * 0.2 }))
    const stances = [{ kind: 'slide', t0: 10, t1: 30 }, { kind: 'jumpDerived', t0: 31, t1: 45 }]
    const events = footstepTimedEvents({ points, stances, frameIntervalMs: FRAME_MS, xuid: 'P', surface: 'default' })
    const outof = events.filter((e) => e.kind === 'slide' && e.action === 'slide_outof')
    expect(outof).toHaveLength(1)
    // It fires on the take-off frame, where the slide span ends.
    expect(outof[0].timeMs).toBe(31 * FRAME_MS)
  })
})

describe('footstepTimedEvents — the landing', () => {
  /** A jump: z rises then falls over frames, airborne across the whole arc. */
  function jump(peak: number) {
    const points = Array.from({ length: 21 }, (_, i) => ({ t: i, x: i * 0.1, y: 0, z: peak * Math.sin((i / 20) * Math.PI) }))
    const stances = [{ kind: 'jumpDerived', t0: 1, t1: 19 }]
    return { points, stances }
  }

  it('a low fall lands softly', () => {
    const { points, stances } = jump(0.8)
    const events = footstepTimedEvents({ points, stances, frameIntervalMs: FRAME_MS, xuid: 'P', surface: 'default' })
    expect(events.filter((e) => e.kind === 'land' && e.action === 'land')).toHaveLength(1)
    expect(events.some((e) => e.action === 'landhard')).toBe(false)
  })

  it('a high fall lands hard', () => {
    const { points, stances } = jump(3)
    const events = footstepTimedEvents({ points, stances, frameIntervalMs: FRAME_MS, xuid: 'P', surface: 'default' })
    expect(events.filter((e) => e.kind === 'land' && e.action === 'landhard')).toHaveLength(1)
  })
})

describe('footstepReplayEvents — the take and the place', () => {
  it('picks the SAME take for the same event (deterministic, live and export agree)', () => {
    const timed = footstepTimedEvents(horizontal(2, 120))
    const a = footstepReplayEvents(MANIFEST, 'default', timed, null)
    const b = footstepReplayEvents(MANIFEST, 'default', timed, null)
    expect(a.map((e) => e.stem)).toEqual(b.map((e) => e.stem))
    expect(a.every((e) => e.gainDb === FOOTSTEP_GAIN_DB)).toBe(true)
    // Marked for the voice ceiling: a step takes only a step's slot (`admitVoice`).
    expect(a.every((e) => e.footstep === true)).toBe(true)
  })

  it('draws across takes deterministically when there are several', () => {
    const manifest: FootstepManifest = {
      version: 1,
      feet: { default: { walk: { takes: [{ file: 'foot_a.ogg', media: 1, durationMs: 1 }, { file: 'foot_b.ogg', media: 2, durationMs: 1 }, { file: 'foot_c.ogg', media: 3, durationMs: 1 }] } } },
      movement: {},
    }
    const timed = footstepTimedEvents(horizontal(2, 200))
    const stems = footstepReplayEvents(manifest, 'default', timed, null).map((e) => e.stem)
    expect(new Set(stems).size).toBeGreaterThan(1)
    // Stable: the same input draws the same sequence again.
    expect(footstepReplayEvents(manifest, 'default', timed, null).map((e) => e.stem)).toEqual(stems)
  })

  it('the followed player is unplaced; every other player is', () => {
    const doc = testReplayDoc({
      frameIntervalMs: FRAME_MS,
      tracks: [
        { slot: 1, team: -1, xuid: 'ME', points: Array.from({ length: 61 }, (_, i) => ({ t: i, x: i * 0.04, y: 0 })), startFrame: 0, endFrame: 60 },
        { slot: 2, team: -1, xuid: 'OTHER', points: Array.from({ length: 61 }, (_, i) => ({ t: i, x: 4 + i * 0.04, y: 3 })), startFrame: 0, endFrame: 60 },
      ],
    })
    const events = footstepSoundEvents(MANIFEST, doc, 'default', 'ME')
    expect(events.filter((e) => e.ms >= 0 && e.at === undefined).length).toBeGreaterThan(0)
    const me = events.filter((e) => e.stem !== undefined).length
    expect(me).toBeGreaterThan(0)
    // OTHER's steps carry a place; ME's do not.
    const withPlace = events.filter((e) => e.at).length
    const withoutPlace = events.filter((e) => !e.at).length
    expect(withPlace).toBeGreaterThan(0)
    expect(withoutPlace).toBeGreaterThan(0)
  })
})

describe('the mix', () => {
  it('footsteps enter the export in the effects family, a bit under gunfire', () => {
    const doc = testReplayDoc({
      frameIntervalMs: FRAME_MS,
      tracks: [{ slot: 1, team: -1, xuid: 'ME', points: Array.from({ length: 121 }, (_, i) => ({ t: i, x: i * 0.04, y: 0 })), startFrame: 0, endFrame: 120 }],
    })
    const events = footstepSoundEvents(MANIFEST, doc, 'default', 'ME')
    expect(events.length).toBeGreaterThan(0)
    const mixed = planAudioMix(events, { startMs: 0, endMs: events[events.length - 1].ms + 1000 }, { variationPercent: 0 })
    expect(mixed.length).toBeGreaterThan(0)
    expect(mixed.every((s) => s.family === 'sfx')).toBe(true)
    expect(mixed.every((s) => s.footstep === true)).toBe(true)
  })
})
