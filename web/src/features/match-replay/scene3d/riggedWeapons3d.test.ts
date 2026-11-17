// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { testReplayDoc } from '../test/testDoc'

import { clesRigsRejeu } from './riggedWeapons3d'

describe('clesRigsRejeu', () => {
  it('unions loadouts and weapon changes, with no duplicate', () => {
    const doc = testReplayDoc({
      loadouts: [{ t: 0, slot: 0, w: ['12345678', '0xdeadbeef01234567'] }],
      weaponChanges: [
        { t: 10, slot: 0, kind: 'swapped', w: 'abcdef12', from: '12345678' },
        { t: 20, slot: 1, kind: 'dropped', from: 'abcdef12' },
      ],
    })
    expect(clesRigsRejeu(doc)).toEqual(['12345678', 'deadbeef', 'abcdef12'])
  })
  it('reduces a full id to its family, and drops ones with none', () => {
    const doc = testReplayDoc({
      weaponChanges: [{ t: 1, slot: 0, kind: 'swapped', w: '0x1234567890abcdef', from: 'grenade012' }],
    })
    expect(clesRigsRejeu(doc)).toEqual(['12345678'])
  })
  it('returns an empty list without a carried weapon', () => {
    expect(clesRigsRejeu(testReplayDoc())).toEqual([])
  })
})
