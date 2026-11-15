/**
 * Tests: the objective object a carrier holds in hand (skull, CTF flag), and the identifier of the
 * flag's model.
 */
import { describe, expect, it } from 'vitest'

import type { ReplayDocument } from '@/lib/api/types'

import { heldWeaponAt } from '../scene3d/heldWeapon3d'
import { CARRIED_OBJECT_CLASS } from '../scene3d/weaponClass3d'
import { testReplayDoc } from '../test/testDoc'
import { armeEnMain, carriedObjectAt, flagObjectIdOf, flagTeamInHand, objetEnMain } from './armeEnMain'

const FLAG = '2a392328'

function track(slot: number, xuid: string, start: number, end: number) {
  return { slot, team: 0, xuid, startFrame: start, endFrame: end, points: [{ t: start, x: 0, y: 0, z: 0 }, { t: end, x: 4, y: 0, z: 0 }] }
}

/** A carries team 1's flag over frames 20-40 (dated), then 60-80 (end not dated); B never does. */
function ctfDoc(over: Partial<ReplayDocument> = {}) {
  return testReplayDoc({
    tracks: [track(512, 'A', 0, 100), track(513, 'B', 0, 100)],
    loadouts: [{ t: 10, slot: 512, w: ['0xAAAA', '0xBBBB'] }],
    inventory: [{ t: 10, slot: 512, d: 0 }],
    flagCarries: [{
      team: 1,
      spans: [
        { state: 'home', t0: 0, t1: 19, x: 1, y: 1, xuid: null },
        { state: 'carried', t0: 20, t1: 40, x: 1, y: 1, xuid: 'A' },
        { state: 'dropped', t0: 41, t1: 59, x: 3, y: 3, xuid: null },
        { state: 'carried_open', t0: 60, t1: 80, x: 3, y: 3, xuid: 'A' },
      ],
    }],
    weaponChanges: [{ t: 22, slot: 512, kind: 'taken', w: FLAG, k: 2 }],
    ...over,
  })
}

describe('carriedObjectAt', () => {
  it('names the flag over the carried spans of its carrier only', () => {
    const doc = ctfDoc()
    expect(carriedObjectAt(doc, 'A', 30)).toBe('flag')
    expect(carriedObjectAt(doc, 'A', 70)).toBe('flag')
    expect(carriedObjectAt(doc, 'A', 50)).toBeNull()
    expect(carriedObjectAt(doc, 'A', 10)).toBeNull()
    expect(carriedObjectAt(doc, 'B', 30)).toBeNull()
    expect(carriedObjectAt(doc, undefined, 30)).toBeNull()
  })

  it('names the skull over its carry periods', () => {
    const doc = ctfDoc({ flagCarries: [], skullCarries: [{ xuid: 'B', t0: 5, t1: 9, closed: true }] })
    expect(carriedObjectAt(doc, 'B', 7)).toBe('skull')
    expect(carriedObjectAt(doc, 'B', 10)).toBeNull()
  })

  it('gives the animation class the weap tag declares', () => {
    expect(CARRIED_OBJECT_CLASS.flag).toBe('hammer')
    expect(CARRIED_OBJECT_CLASS.skull).toBe('ball')
  })
})

describe('the flag in hand', () => {
  it('replaces the weapon while it is carried, and gives it back after', () => {
    const doc = ctfDoc()
    expect(armeEnMain(doc, 512, 30)).toBeNull()
    expect(objetEnMain(doc, 512, 30)).toEqual({ id: '0x2A392328', slotArme: 2 })
    expect(heldWeaponAt(doc, 512, 30, 'en')?.id).toBe('0x2A392328')
    expect(heldWeaponAt(doc, 512, 50, 'en')?.id).toBe('0xAAAA')
    expect(objetEnMain(doc, 512, 50)).toBeNull()
  })

  it('takes the identifier of any object pickup of the match when the carrier has none of his own', () => {
    const doc = ctfDoc({ weaponChanges: [{ t: 90, slot: 513, kind: 'taken', w: FLAG, k: 2 }] })
    expect(objetEnMain(doc, 512, 30)?.id).toBe('0x2A392328')
  })

  it('carries the team of the flag held (its banner), and no team with a weapon in hand', () => {
    const doc = ctfDoc()
    expect(flagTeamInHand(doc, 512, 30)).toBe(1)
    expect(flagTeamInHand(doc, 512, 50)).toBeNull()
    expect(flagTeamInHand(doc, 513, 30)).toBeNull()
    expect(heldWeaponAt(doc, 512, 30, 'en')?.flagTeam).toBe(1)
    expect(heldWeaponAt(doc, 512, 50, 'en')).not.toHaveProperty('flagTeam')
  })

  it('holds nothing when no object pickup names the object', () => {
    const doc = ctfDoc({ weaponChanges: [] })
    expect(objetEnMain(doc, 512, 30)).toBeNull()
    expect(heldWeaponAt(doc, 512, 30, 'en')).toBeNull()
  })
})

describe('the spawn hand', () => {
  /** A life over frames 0-100 read only from its birth loadout (no keyframe, no inventory read). */
  function spawnDoc(over: Partial<ReplayDocument> = {}) {
    return testReplayDoc({
      tracks: [track(512, 'A', 0, 100)],
      loadouts: [{ t: 0, slot: 512, w: ['0xAAAA', '0xBBBB'], src: 'birth', k: [0, 1] }],
      ...over,
    })
  }

  it('holds the weapon of emplacement 0 from birth until the first selector flip', () => {
    const doc = spawnDoc({ drawnWeapons: [{ t: 50, slot: 512, d: 1 }] })
    expect(armeEnMain(doc, 512, 20)).toEqual({ id: '0xAAAA', slotArme: 0 })
    expect(armeEnMain(doc, 512, 60)).toEqual({ id: '0xBBBB', slotArme: 1 })
  })

  it('holds the weapon of emplacement 0 for a whole life no read ever locates', () => {
    expect(armeEnMain(spawnDoc(), 512, 90)).toEqual({ id: '0xAAAA', slotArme: 0 })
  })

  it('does not claim the spawn weapon once a weapon change is dated since birth', () => {
    const doc = spawnDoc({ weaponChanges: [{ t: 10, slot: 512, kind: 'swapped', w: 'cccccccc', from: 'aaaa', k: 0 }] })
    expect(armeEnMain(doc, 512, 20)?.id).not.toBe('0xAAAA')
  })

  it('keeps the old rule for a keyframe row: two weapons and no read leave the hand empty', () => {
    const doc = spawnDoc({ loadouts: [{ t: 0, slot: 512, w: ['0xAAAA', '0xBBBB'] }] })
    expect(armeEnMain(doc, 512, 20)).toBeNull()
  })
})

describe('a life without any loadout reading', () => {
  /** A life over frames 0-100, flipped to emplacement 1 at 30, that fires the C weapon at 60. */
  function bareDoc(over: Partial<ReplayDocument> = {}) {
    return testReplayDoc({
      tracks: [track(512, 'A', 0, 100)],
      drawnWeapons: [{ t: 30, slot: 512, d: 1 }],
      shots: [{ t: 60, slot: 512, x: 0, y: 0, w: '0xCCCCCCCC42C9679F' }],
      ...over,
    })
  }

  it('names the weapon of the emplacement in hand by the shots fired from it', () => {
    expect(armeEnMain(bareDoc(), 512, 40)).toEqual({ id: '0xCCCCCCCC', slotArme: 1 })
    expect(armeEnMain(bareDoc(), 512, 90)).toEqual({ id: '0xCCCCCCCC', slotArme: 1 })
  })

  it('leaves the other emplacement unnamed: before the flip the hand holds emplacement 0', () => {
    expect(armeEnMain(bareDoc(), 512, 20)).toBeNull()
  })

  it('ignores a shot fired from a vehicle, and a shot past a weapon change of that emplacement', () => {
    expect(armeEnMain(bareDoc({ shots: [{ t: 60, slot: 512, x: 0, y: 0, v: 3, w: '0xCCCCCCCC42C9679F' }] }), 512, 40)).toBeNull()
    const changed = bareDoc({ weaponChanges: [{ t: 70, slot: 512, kind: 'swapped', w: 'dddddddd', from: 'cccccccc', k: 1 }] })
    expect(armeEnMain(changed, 512, 80)).toBeNull()
  })
})

describe('flagObjectIdOf', () => {
  it('is the object the first located carrier holds', () => {
    expect(flagObjectIdOf(ctfDoc())).toBe('0x2A392328')
  })

  it('is null without a carry or without an object pickup', () => {
    expect(flagObjectIdOf(ctfDoc({ flagCarries: [] }))).toBeNull()
    expect(flagObjectIdOf(ctfDoc({ weaponChanges: [] }))).toBeNull()
  })
})
