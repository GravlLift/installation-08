/**
 * reloadSound.test.ts — one detection rule for every weapon, the animation's timing, and the
 * cancellations (life end, hand change, melee or throw from the same instant, shot, next reload).
 */
import { describe, expect, it } from 'vitest'

import type { ReplayDocument } from '@/lib/api/types'

import { testReplayDoc } from '../test/testDoc'
import type { ReloadLibrary } from './reloadManifest'
import { firstAt, reloadSoundEvents } from './reloadSound'

const FPS = 30
// A loadout names the weapon by its tag alone; a shot by its 64-bit id.
const BR = '0x2B1824D5'
const PLASMA_PISTOL = '0xC3542946'
const BR_SHOT = '0x2B1824D542C9679F'

/** The BR75 reloads: three sounds standing (the first with two takes), one crouched. */
const LIBRARY: ReloadLibrary = new Map([
  [
    '2b1824d5',
    {
      combat: {
        durationMs: 1900,
        gainDb: -3,
        sounds: [
          { atMs: 0, stems: ['reload_0000000a', 'reload_0000000b'] },
          { atMs: 600, stems: ['reload_0000000c'] },
          { atMs: 1400, stems: ['reload_0000000d'] },
        ],
      },
      crouch: { durationMs: 2000, gainDb: -2, sounds: [{ atMs: 100, stems: ['reload_0000000e'] }] },
    },
  ],
])

const ms = (frame: number) => (frame * 1000) / FPS

/** A player on slot 1 for ten seconds, BR75 in hand, plasma pistol in the other slot from frame 240 on. */
function doc(over: Partial<ReplayDocument> = {}, endFrame = 300) {
  return testReplayDoc({
    frameIntervalMs: 1000 / FPS,
    frameCount: 301,
    tracks: [{
      slot: 1, team: 0, xuid: 'A', startFrame: 0, endFrame,
      points: Array.from({ length: endFrame + 1 }, (_, t) => ({ t, x: 0.1 * t, y: 2, z: 0, h: 0 })),
    }],
    loadouts: [{ t: 0, slot: 1, w: [BR, PLASMA_PISTOL] }],
    inventory: [{ t: 0, slot: 1, d: 0 }, { t: 240, slot: 1, d: 1 }],
    weaponLabels: {
      [BR]: { en: 'BR75', fr: 'BR75', tint: 'kinetic', key: 'hinf_br75' },
      [PLASMA_PISTOL]: { en: 'Plasma pistol', fr: 'Pistolet plasma', tint: 'plasma', key: 'hinf_plasma_pistol' },
    },
    ...over,
  })
}

const reload = (frame: number) => ({ t: frame, ms: ms(frame), slot: 1, kind: 'reload' })
const at = (events: { ms: number }[]) => events.map((e) => Math.round(e.ms))

describe('reloadSoundEvents', () => {
  it('a complete reload plays every sound at its moment, with its takes, gain and place', () => {
    const events = reloadSoundEvents(doc({ actions: [reload(30)] }), LIBRARY)
    expect(at(events)).toEqual([1000, 1600, 2400])
    expect(events[0]).toMatchObject({ stem: 'reload_0000000a', variants: ['reload_0000000a', 'reload_0000000b'], gainDb: -3 })
    expect(events[1].variants).toBeUndefined()
    expect(events.every((e) => e.cutMs === undefined)).toBe(true)
    expect(events[1].at?.x).toBeCloseTo(4.8)
    expect(events[1].at?.y).toBe(2)
  })

  it('the same action written twice at one instant is one reload', () => {
    expect(at(reloadSoundEvents(doc({ actions: [reload(30), reload(30)] }), LIBRARY))).toEqual([1000, 1600, 2400])
  })

  it('a weapon without a reload in the library is silent: battery weapons, and no library at all', () => {
    expect(reloadSoundEvents(doc({ actions: [reload(250)] }), LIBRARY)).toEqual([])
    expect(reloadSoundEvents(doc({ actions: [reload(30)] }), new Map())).toEqual([])
    expect(reloadSoundEvents(doc({ actions: [reload(30)] }), undefined)).toEqual([])
  })

  it('crouched, the weapon plays its crouched reload', () => {
    const events = reloadSoundEvents(doc({ actions: [reload(30)], stances: [{ kind: 'crouch', slot: 1, t0: 20, t1: 60 }] }), LIBRARY)
    expect(events.map((e) => [Math.round(e.ms), e.stem, e.gainDb])).toEqual([[1100, 'reload_0000000e', -2]])
  })

  it('a melee or a throw at the very instant of the action cancels it entirely', () => {
    for (const kind of ['melee', 'throwStart']) {
      expect(reloadSoundEvents(doc({ actions: [reload(30), { t: 30, ms: ms(30), slot: 1, kind }] }), LIBRARY)).toEqual([])
    }
  })

  it('a shot after the action stops the later sounds and cuts the ones still sounding', () => {
    const events = reloadSoundEvents(doc({ actions: [reload(30)], shots: [{ t: 51, slot: 1, x: 0, y: 0, w: BR_SHOT }] }), LIBRARY)
    expect(at(events)).toEqual([1000, 1600])
    expect(events.map((e) => Math.round(e.cutMs ?? -1))).toEqual([700, 100])
  })

  it('the next reload cancels the one before', () => {
    const events = reloadSoundEvents(doc({ actions: [reload(30), reload(39)] }), LIBRARY)
    expect(at(events)).toEqual([1000, 1300, 1900, 2700])
    expect(Math.round(events[0].cutMs ?? -1)).toBe(300)
    expect(events[1].cutMs).toBeUndefined()
  })

  it('death, a hand flip and a pickup cancel at their instant', () => {
    expect(at(reloadSoundEvents(doc({ actions: [reload(30)] }, 45), LIBRARY))).toEqual([1000])
    const flip = doc({ actions: [reload(30)], drawnWeapons: [{ t: 45, slot: 1, d: 1 }] })
    expect(at(reloadSoundEvents(flip, LIBRARY))).toEqual([1000])
    const pickup = doc({ actions: [reload(30)], weaponChanges: [{ t: 66, slot: 1, kind: 'taken', w: PLASMA_PISTOL }] })
    expect(at(reloadSoundEvents(pickup, LIBRARY))).toEqual([1000, 1600])
  })

  it('a flip to the slot already in hand does not cancel', () => {
    const same = doc({ actions: [reload(30)], drawnWeapons: [{ t: 45, slot: 1, d: 0 }] })
    expect(at(reloadSoundEvents(same, LIBRARY))).toEqual([1000, 1600, 2400])
  })
})

describe('firstAt', () => {
  it('finds the first instant after, or at, a moment', () => {
    expect(firstAt([100, 200, 300], 200, false)).toBe(300)
    expect(firstAt([100, 200, 300], 200, true)).toBe(200)
    expect(firstAt([100, 200, 300], 300, false)).toBe(Infinity)
    expect(firstAt([], 0, true)).toBe(Infinity)
  })
})
