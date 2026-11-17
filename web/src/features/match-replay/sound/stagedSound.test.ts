// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * stagedSound.test.ts — the first-person sounds of a staged reload, with the rig's timing: the enter
 * clip's sounds before the first round, one round clip per stage, the closing clip at the repeated
 * last message, the followed player only, a shot cutting the rest.
 */
import { describe, expect, it } from 'vitest'

import type { ReplayDocument } from '@/lib/api/types'

import { testReplayDoc } from '../test/testDoc'
import type { StagedLibrary } from './reloadManifest'
import { stagedSoundEvents } from './stagedSound'

const FPS = 30
const HEATWAVE = '0x2AC9C2FF'

/** The Heatwave's staged clips, as its manifest entry gives them (lengths and sound frames). */
const STAGED: StagedLibrary = new Map([
  ['2ac9c2ff', {
    enter: { durationMs: 700, gainDb: -2, sounds: [{ atMs: 567, stems: ['fins_a', 'fins_b'] }, { atMs: 633, stems: ['vent'] }] },
    round: { durationMs: 367, gainDb: -2, sounds: [{ atMs: 133, stems: ['round'] }] },
    roundEmpty: { durationMs: 367, gainDb: -2, sounds: [{ atMs: 133, stems: ['round_empty'] }] },
    closing: { durationMs: 1033, gainDb: -2, sounds: [{ atMs: 67, stems: ['close'] }] },
  }],
])

const ms = (frame: number) => (frame * 1000) / FPS

function doc(over: Partial<ReplayDocument> = {}) {
  return testReplayDoc({
    frameIntervalMs: 1000 / FPS,
    frameCount: 301,
    tracks: [{
      slot: 1, team: 0, xuid: 'A', startFrame: 0, endFrame: 300,
      points: Array.from({ length: 301 }, (_, t) => ({ t, x: 0, y: 0, z: 0, h: 0 })),
    }],
    loadouts: [{ t: 0, slot: 1, w: [HEATWAVE] }],
    inventory: [{ t: 0, slot: 1, d: 0 }],
    weaponLabels: { [HEATWAVE]: { en: 'Heatwave', fr: 'Heatwave', tint: 'kinetic', key: 'hinf_heatwave' } },
    ...over,
  })
}

const reload = (frame: number) => ({ t: frame, ms: ms(frame), slot: 1, kind: 'reload' })
// A reload of three rounds: the start, a message at each round, the repeated message at the end.
const ACTIONS = [reload(30), reload(51), reload(62), reload(73), reload(84), reload(84)]
const at = (events: { ms: number }[]) => events.map((e) => Math.round(e.ms))

describe('stagedSoundEvents', () => {
  it('plays the enter, one round per stage and the closing clip, at their frames', () => {
    const events = stagedSoundEvents(doc({ actions: ACTIONS }), STAGED, 'A')
    expect(at(events)).toEqual([1567, 1633, 1833, 2200, 2566, 2867])
    expect(events.map((e) => e.stem)).toEqual(['fins_a', 'vent', 'round', 'round', 'round', 'close'])
    expect(events[0].variants).toEqual(['fins_a', 'fins_b'])
    expect(events.every((e) => e.at === undefined)).toBe(true)
  })

  it('plays nothing for a player the camera does not follow', () => {
    expect(stagedSoundEvents(doc({ actions: ACTIONS }), STAGED, 'B')).toEqual([])
  })

  it('a shot after the start cuts what follows', () => {
    const events = stagedSoundEvents(doc({ actions: ACTIONS, shots: [{ t: 63, slot: 1, x: 0, y: 0, w: `${HEATWAVE}42C9679F` }] }), STAGED, 'A')
    expect(at(events)).toEqual([1567, 1633, 1833])
    expect(events.every((e) => e.cutMs !== undefined)).toBe(true)
  })
})
