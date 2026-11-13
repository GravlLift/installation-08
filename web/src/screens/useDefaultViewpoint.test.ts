import { describe, expect, it } from 'vitest'

import { xuidOfGamertag } from './useDefaultViewpoint'

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
