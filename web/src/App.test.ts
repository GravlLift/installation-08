/**
 * App.test.ts — the hash router: the three routes of the broadcast app (Home, the match
 * list and the player) and nothing else.
 */
import { describe, expect, it } from 'vitest'

import { parseHash } from './App'

describe('parseHash', () => {
  it('parses the home route', () => {
    expect(parseHash('')).toEqual({ name: 'home' })
    expect(parseHash('#')).toEqual({ name: 'home' })
    expect(parseHash('#/')).toEqual({ name: 'home' })
  })

  it('parses the match list route', () => {
    expect(parseHash('#/matches')).toEqual({ name: 'list' })
    expect(parseHash('#/matches/')).toEqual({ name: 'list' })
  })

  it('parses a match route and decodes its id', () => {
    expect(parseHash('#/matches/abc')).toEqual({ name: 'match', matchId: 'abc' })
    expect(parseHash('#/matches/abc/')).toEqual({ name: 'match', matchId: 'abc' })
    expect(parseHash('#/matches/' + encodeURIComponent('a b/c'))).toEqual({
      name: 'match',
      matchId: 'a b/c',
    })
  })

  it('reads unknown paths as home', () => {
    expect(parseHash('#/nope')).toEqual({ name: 'home' })
  })
})
