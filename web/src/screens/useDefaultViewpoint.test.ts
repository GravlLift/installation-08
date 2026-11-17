// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { requestedPlayer, xuidOfGamertag } from './useDefaultViewpoint'

const roster = [
  { xuid: '1', name: 'Rekkles AP' },
  { xuid: '2', name: 'TasteThePainbow' },
]

describe('xuidOfGamertag', () => {
  it('finds the signed-in player in the roster', () => {
    expect(xuidOfGamertag(roster, 'TasteThePainbow')).toBe('2')
  })
  it('ignores case and spacing', () => {
    expect(xuidOfGamertag(roster, 'rekklesap')).toBe('1')
  })
  it('returns null when the player is not in the match or no one is signed in', () => {
    expect(xuidOfGamertag(roster, 'Someone Else')).toBeNull()
    expect(xuidOfGamertag(roster, '')).toBeNull()
  })
})

describe('requestedPlayer', () => {
  it('reads the player a match link asks to follow', () => {
    expect(requestedPlayer('#/matches/abc?player=Gotenk%20Super')).toBe('Gotenk Super')
    expect(xuidOfGamertag(roster, requestedPlayer('#/matches/abc?player=rekkles%20ap'))).toBe('1')
  })
  it('is empty without the query', () => {
    expect(requestedPlayer('#/matches/abc')).toBe('')
  })
})