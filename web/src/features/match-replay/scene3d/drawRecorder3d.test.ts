// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { DrawRecorder, drawRecorder, killIdsOf, markHeldWeapon, weaponFamilyOf } from './drawRecorder3d'

describe('DrawRecorder', () => {
  it('records nothing while off, and each event once with every layer that drew it while on', () => {
    const r = new DrawRecorder()
    r.mark('shot/1', 'shots3d/tracer')
    r.start()
    r.frame = 10
    r.mark('shot/1', 'shots3d/tracer')
    r.frame = 12
    r.mark('shot/1', 'shots3d/tracer')
    r.mark('shot/1', 'bodyShell3d/shield_hit')
    r.frame = 8
    r.mark('grenade/0', 'flights3d/stuck')
    const marks = r.stop()
    expect(marks.get('shot/1')).toEqual({ by: ['shots3d/tracer', 'bodyShell3d/shield_hit'], first: 10, last: 12 })
    expect(marks.get('grenade/0')).toEqual({ by: ['flights3d/stuck'], first: 8, last: 8 })
    expect(r.on).toBe(false)
    r.mark('shot/2', 'shots3d/tracer')
    r.start()
    expect(r.stop().size).toBe(0)
  })
})

describe('killIdsOf', () => {
  it("names each kill by killer, victim and its rank among that pair's kills, in time order", () => {
    const kills = [
      { xuid: 'A', victimXuid: 'B', replayMs: 500 },
      { xuid: 'A', victimXuid: 'B', replayMs: 100 },
      { xuid: 'B', victimXuid: 'A', replayMs: 300 },
      { xuid: 'A', victimXuid: '', replayMs: 50 },
    ]
    const ids = killIdsOf(kills)
    expect(kills.map((k) => ids.get(k))).toEqual(['kill/A/B/1', 'kill/A/B/0', 'kill/B/A/0', 'kill/A//0'])
    expect(killIdsOf(kills)).toBe(ids)
  })
})

describe('markHeldWeapon', () => {
  it("marks the life's takes of the weapon in hand at or before the frame, not drops nor other weapons", () => {
    const doc = {
      weaponChanges: [
        { t: 100, slot: 7, kind: 'taken', w: '1a22fee6' },
        { t: 150, slot: 7, kind: 'dropped', w: '1a22fee6' },
        { t: 200, slot: 7, kind: 'taken', w: '1a22fee6' },
        { t: 100, slot: 8, kind: 'taken', w: '1a22fee6' },
      ],
      pickups: [
        { t: 90, slot: 7, kind: 'weapon', w: '1a22fee6' },
        { t: 90, slot: 7, kind: 'grenade', w: 'caaadcb0' },
      ],
    }
    drawRecorder.start()
    markHeldWeapon(doc, 7, 120, '0x1A22FEE642C9679F', 'avatar3d/held_weapon')
    const marks = drawRecorder.stop()
    expect([...marks.keys()].sort()).toEqual(['pickup/0', 'weaponChange/0'])
    expect(weaponFamilyOf('0x1A22FEE642C9679F')).toBe('1a22fee6')
  })
})
