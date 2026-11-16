/**
 * ventSound.test.ts — the vent of a heat weapon, with the vent animation's own timing: the enter
 * from the episode's first message, the exit after the loop hold (the later of the episode's last
 * message and one full loop), no loop sound, the shot cut, and the followed player non-spatial.
 */
import { describe, expect, it } from 'vitest'

import type { ReplayDocument } from '@/lib/api/types'

import { testReplayDoc } from '../test/testDoc'
import type { VentLibrary } from './reloadManifest'
import { ventSoundEvents } from './ventSound'

const FPS = 30
// A loadout names the weapon by its tag alone; a shot by its 64-bit id.
const BR = '0x2B1824D5'
const PLASMA_PISTOL = '0xC3542946'
const PISTOL_SHOT = '0xC354294642C9679F'

/**
 * The Plasma Pistol's vent: an enter whoosh with two takes, a silent loop, an exit whoosh. The
 * clip lengths are short so a stage within the episode's one-second window can outlast the
 * enter + loop (500 ms here) and hold the exit to itself.
 */
const VENTS: VentLibrary = new Map([
  [
    'c3542946',
    {
      combat: {
        enter: { durationMs: 300, gainDb: -3, sounds: [{ atMs: 0, stems: ['vent_enter_1', 'vent_enter_2'] }] },
        loop: { durationMs: 200, gainDb: -3, sounds: [] },
        exit: { durationMs: 400, gainDb: -3, sounds: [{ atMs: 50, stems: ['vent_exit_1'] }] },
      },
      crouch: {
        enter: { durationMs: 300, gainDb: -2, sounds: [{ atMs: 0, stems: ['vent_enter_c'] }] },
        loop: { durationMs: 200, gainDb: -2, sounds: [] },
        exit: { durationMs: 400, gainDb: -2, sounds: [{ atMs: 50, stems: ['vent_exit_c'] }] },
      },
    },
  ],
])

const ms = (frame: number) => (frame * 1000) / FPS

/** A player on slot 1 for ten seconds, plasma pistol in hand. */
function doc(over: Partial<ReplayDocument> = {}, endFrame = 300) {
  return testReplayDoc({
    frameIntervalMs: 1000 / FPS,
    frameCount: 301,
    tracks: [{
      slot: 1, team: 0, xuid: 'A', startFrame: 0, endFrame,
      points: Array.from({ length: endFrame + 1 }, (_, t) => ({ t, x: 0.1 * t, y: 2, z: 0, h: 0 })),
    }],
    loadouts: [{ t: 0, slot: 1, w: [BR, PLASMA_PISTOL] }],
    inventory: [{ t: 0, slot: 1, d: 1 }],
    weaponLabels: {
      [BR]: { en: 'BR75', fr: 'BR75', tint: 'kinetic', key: 'hinf_br75' },
      [PLASMA_PISTOL]: { en: 'Plasma pistol', fr: 'Pistolet plasma', tint: 'plasma', key: 'hinf_plasma_pistol' },
    },
    ...over,
  })
}

const reload = (frame: number) => ({ t: frame, ms: ms(frame), slot: 1, kind: 'reload' })
const at = (events: { ms: number }[]) => events.map((e) => Math.round(e.ms))

describe('ventSoundEvents', () => {
  it('a vent episode plays the enter at its start and the exit after the loop hold, no loop sound', () => {
    const events = ventSoundEvents(doc({ actions: [reload(30), reload(45)] }), VENTS, 'A')
    expect(at(events)).toEqual([1000, 1550])
    expect(events[0]).toMatchObject({ stem: 'vent_enter_1', variants: ['vent_enter_1', 'vent_enter_2'], gainDb: -3 })
    expect(events[1]).toMatchObject({ stem: 'vent_exit_1', gainDb: -3 })
    expect(events[1].variants).toBeUndefined()
    expect(events.every((e) => e.cutMs === undefined)).toBe(true)
  })

  it('a late message holds the exit to itself, past one full enter and loop', () => {
    // Last stage 1600 ms, one full enter + loop 1500 ms: the exit starts at the message.
    const events = ventSoundEvents(doc({ actions: [reload(30), reload(48)] }), VENTS, 'A')
    expect(at(events)).toEqual([1000, 1650])
  })

  it('the followed player is non-spatial, the others positioned', () => {
    const followed = ventSoundEvents(doc({ actions: [reload(30)] }), VENTS, 'A')
    expect(followed.every((e) => e.at === undefined)).toBe(true)
    const other = ventSoundEvents(doc({ actions: [reload(30)] }), VENTS, 'OTHER')
    expect(other[0].at?.x).toBeCloseTo(3)
    expect(other[0].at?.y).toBe(2)
  })

  it('a shot after the vent starts ends it: the enter is cut, the exit does not play', () => {
    const events = ventSoundEvents(doc({ actions: [reload(30)], shots: [{ t: 40, slot: 1, x: 0, y: 0, w: PISTOL_SHOT }] }), VENTS, 'A')
    expect(at(events)).toEqual([1000])
    expect(Math.round(events[0].cutMs ?? -1)).toBe(333)
  })

  it('a weapon without a vent in the library is silent', () => {
    // The BR75 in hand: it reloads, it has no vent in the library.
    const br = doc({ actions: [reload(30)], inventory: [{ t: 0, slot: 1, d: 0 }] })
    expect(ventSoundEvents(br, VENTS, 'A')).toEqual([])
    expect(ventSoundEvents(doc({ actions: [reload(30)] }), new Map(), 'A')).toEqual([])
    expect(ventSoundEvents(doc({ actions: [reload(30)] }), undefined, 'A')).toEqual([])
  })

  it('the next vent episode ends the previous one', () => {
    const events = ventSoundEvents(doc({ actions: [reload(30), reload(45), reload(200)] }), VENTS, 'A')
    expect(at(events)).toEqual([1000, 1550, 6667, 7217])
  })

  it('crouched, the weapon plays its crouched vent', () => {
    const events = ventSoundEvents(doc({ actions: [reload(30)], stances: [{ kind: 'crouch', slot: 1, t0: 20, t1: 60 }] }), VENTS, 'A')
    expect(events.map((e) => [Math.round(e.ms), e.stem, e.gainDb])).toEqual([[1000, 'vent_enter_c', -2], [1550, 'vent_exit_c', -2]])
  })

  it('a hand leaving the weapon ends the vent', () => {
    const flip = doc({ actions: [reload(30)], drawnWeapons: [{ t: 45, slot: 1, d: 0 }] })
    const events = ventSoundEvents(flip, VENTS, 'A')
    expect(at(events)).toEqual([1000])
    expect(Math.round(events[0].cutMs ?? -1)).toBe(500)
  })
})
