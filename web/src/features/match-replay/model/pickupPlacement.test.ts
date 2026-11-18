// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** pickupPlacement.test.ts: where a weapon pickup that no weapon change saw lands (`pickupEffects`). */
import { describe, expect, it } from 'vitest'
import { testReplayDoc } from '../test/testDoc'
import { pickupEffects } from './pickupPlacement'
import { pickupPlacements } from './weaponInHand'

describe('pickupEffects', () => {
  const birth = new Map([[0, '0x6ACDC44D'], [1, '0x2B1824D5']])
  const lifeDoc = (extra: Parameters<typeof testReplayDoc>[0] = {}) => testReplayDoc({
    frameIntervalMs: 33,
    tracks: [{ slot: 530, xuid: 'A', team: 1, startFrame: 100, endFrame: 900, points: [{ t: 100, x: 0, y: 0 }, { t: 900, x: 0, y: 0 }] }],
    loadouts: [{ t: 100, slot: 530, w: ['0x6ACDC44D', '0x2B1824D5'], src: 'birth', k: [0, 1] }],
    ...extra,
  })
  const handIn = (weaponSlot: number) => () => ({ weaponSlot })
  const effects = (doc: ReturnType<typeof testReplayDoc>, weapons = birth, hand = handIn(0)) => pickupEffects(doc, doc.tracks[0], weapons, hand)

  it('reads a family already carried as a refill of the emplacement that holds it', () => {
    const doc = lifeDoc({ pickups: [{ t: 300, slot: 530, class: 0, kind: 'weapon', w: '2b1824d5' }] })
    expect(effects(doc)).toEqual([{ t: 300, w: '2b1824d5', effect: 'refill', emplacement: 1 }])
  })

  it('follows the weapon changes: a family picked up earlier is refilled where it went', () => {
    const doc = lifeDoc({
      weaponChanges: [{ t: 200, slot: 530, kind: 'swapped', w: 'aaaa1111', from: '2b1824d5', k: 1 }],
      pickups: [
        { t: 200, slot: 530, class: 0, kind: 'weapon', w: 'aaaa1111' },
        { t: 300, slot: 530, class: 0, kind: 'weapon', w: 'aaaa1111' },
      ],
    })
    expect(effects(doc)).toEqual([{ t: 300, w: 'aaaa1111', effect: 'refill', emplacement: 1 }])
  })

  it('places a new weapon in the empty emplacement, replacing nothing', () => {
    const doc = lifeDoc({ pickups: [{ t: 300, slot: 530, class: 0, kind: 'weapon', w: 'aaaa1111' }] })
    expect(effects(doc, new Map([[0, '0x6ACDC44D']]))).toEqual([{ t: 300, w: 'aaaa1111', effect: 'fill', emplacement: 1 }])
  })

  it('replaces the weapon in hand just before the pickup when both emplacements are full', () => {
    const doc = lifeDoc({ pickups: [{ t: 300, slot: 530, class: 0, kind: 'weapon', w: 'aaaa1111' }] })
    expect(effects(doc, birth, handIn(1))).toEqual([{ t: 300, w: 'aaaa1111', effect: 'replace', emplacement: 1 }])
  })

  it('locates that hand from the film when the document places its pickups', () => {
    const doc = lifeDoc({
      pickups: [{ t: 300, slot: 530, class: 0, kind: 'weapon', w: 'aaaa1111' }],
      drawnWeapons: [{ t: 250, slot: 530, d: 1 }],
    })
    expect(pickupPlacements(doc).get(doc.tracks[0])).toEqual([{ t: 300, w: 'aaaa1111', effect: 'replace', emplacement: 1 }])
  })

  it('cannot place a pickup once a weapon change without an emplacement is dated in the life', () => {
    const doc = lifeDoc({
      weaponChanges: [{ t: 200, slot: 530, kind: 'swapped', w: 'bbbb2222' }],
      pickups: [{ t: 300, slot: 530, class: 0, kind: 'weapon', w: '6acdc44d' }],
    })
    expect(effects(doc)).toEqual([{ t: 300, w: '6acdc44d', effect: 'unknown' }])
  })
})
