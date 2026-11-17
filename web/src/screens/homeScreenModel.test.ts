// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * homeScreenModel.test.ts — the Home page's pure logic: the featured match, its facts,
 * the menu and the ticker.
 */
import { describe, expect, it } from 'vitest'

import type { MatchSummary } from '../lib/api/standalone'
import {
  cleanMapName,
  featuredFacts,
  featuredMatch,
  formatPlayedAt,
  homeMenu,
  homeMode,
  matchPlayTime,
  resultLabel,
  scoreLabel,
  tickerItems,
} from './homeScreenModel'

function match(over: Partial<MatchSummary>): MatchSummary {
  return {
    matchId: 'm',
    mapName: 'Recharge',
    mapModule: 'recharge',
    build: 'b',
    durationMs: 600000,
    players: null,
    importedAt: '2026-11-01T12:00:00Z',
    ...over,
  }
}

describe('matchPlayTime', () => {
  it('prefers startTime', () => {
    expect(matchPlayTime(match({ startTime: '2026-11-10T09:00:00Z' }))).toBe('2026-11-10T09:00:00Z')
  })

  it('falls back to importedAt', () => {
    expect(matchPlayTime(match({}))).toBe('2026-11-01T12:00:00Z')
  })
})

describe('featuredMatch', () => {
  it('returns null for an empty list', () => {
    expect(featuredMatch([])).toBeNull()
  })

  it('picks the newest startTime', () => {
    const older = match({ matchId: 'a', startTime: '2026-11-01T09:00:00Z' })
    const newer = match({ matchId: 'b', startTime: '2026-11-05T09:00:00Z' })
    expect(featuredMatch([older, newer])?.matchId).toBe('b')
  })

  it('falls back to importedAt when a match has no startTime', () => {
    const dated = match({ matchId: 'a', importedAt: '2026-11-01T09:00:00Z' })
    const newerImport = match({ matchId: 'b', importedAt: '2026-11-09T09:00:00Z' })
    expect(featuredMatch([dated, newerImport])?.matchId).toBe('b')
  })
})

describe('cleanMapName', () => {
  it('strips a trailing " - Ranked"', () => {
    expect(cleanMapName(match({ mapName: 'Recharge - Ranked' }))).toBe('Recharge')
  })

  it('keeps a plain name', () => {
    expect(cleanMapName(match({ mapName: 'Recharge' }))).toBe('Recharge')
  })

  it('falls back to the module and then to a placeholder', () => {
    expect(cleanMapName(match({ mapName: '', mapModule: 'recharge' }))).toBe('recharge')
    expect(cleanMapName(match({ mapName: '', mapModule: '' }))).toBe('Unknown map')
  })
})

describe('scoreLabel', () => {
  it('uses scoreMine/scoreTheirs when present', () => {
    expect(scoreLabel(match({ scoreMine: 3, scoreTheirs: 1 }))).toBe('3 - 1')
  })

  it('falls back to teamScores', () => {
    expect(scoreLabel(match({ teamScores: [5, 2] }))).toBe('5 - 2')
  })

  it('stays empty when no score is known', () => {
    expect(scoreLabel(match({}))).toBe('')
  })
})

describe('resultLabel', () => {
  it('maps win and loss', () => {
    expect(resultLabel(match({ outcome: 'win' }))).toBe('Victory')
    expect(resultLabel(match({ outcome: 'loss' }))).toBe('Defeat')
  })

  it('is empty for any other outcome', () => {
    expect(resultLabel(match({ outcome: 'tie' }))).toBe('')
    expect(resultLabel(match({}))).toBe('')
  })
})

describe('formatPlayedAt', () => {
  it('formats a valid instant (not the raw string)', () => {
    const out = formatPlayedAt('2026-11-05T09:00:00Z')
    expect(out).not.toBe('2026-11-05T09:00:00Z')
    expect(out.length).toBeGreaterThan(0)
  })

  it('returns the raw string when it does not parse', () => {
    expect(formatPlayedAt('not-a-date')).toBe('not-a-date')
  })
})

describe('featuredFacts', () => {
  it('lists mode, final, result and played for a full match', () => {
    const facts = featuredFacts(
      match({
        modeName: 'Slayer',
        scoreMine: 3,
        scoreTheirs: 1,
        outcome: 'win',
        startTime: '2026-11-05T09:00:00Z',
      }),
    )
    expect(facts.mapName).toBe('Recharge')
    expect(facts.facts).toEqual([
      { label: 'Mode', value: 'Slayer' },
      { label: 'Final', value: '3 - 1' },
      { label: 'Result', value: 'Victory' },
      { label: 'Played', value: formatPlayedAt('2026-11-05T09:00:00Z') },
    ])
  })

  it('omits empty cells', () => {
    const facts = featuredFacts(match({}))
    expect(facts.facts).toEqual([
      { label: 'Played', value: formatPlayedAt('2026-11-01T12:00:00Z') },
    ])
  })
})

describe('homeMenu', () => {
  it('is Watch plus Recent matches when signed in', () => {
    expect(homeMenu(true).map((m) => m.name)).toEqual(['Watch', 'Recent matches'])
  })

  it('is Watch plus Sign in when signed out, and Sign in opens the plate directly', () => {
    expect(homeMenu(false).map((m) => m.name)).toEqual(['Watch', 'Sign in'])
    expect(homeMenu(false).find((m) => m.name === 'Sign in')?.route).toBe('/matches?signin=1')
  })

  it('points the watch rows at the match select page', () => {
    expect(homeMenu(true).every((m) => m.route === '/matches')).toBe(true)
  })

  it('offers no Sign in row on a read-only server', () => {
    expect(homeMenu(false, true).map((m) => m.name)).toEqual(['Watch'])
  })
})

describe('homeMode', () => {
  it('is a sign-in page signed out, the desk signed in or read-only, nothing while loading', () => {
    expect(homeMode('signed_out', false)).toBe('signin')
    expect(homeMode('pending', false)).toBe('signin')
    expect(homeMode('failed', false)).toBe('signin')
    expect(homeMode('signed_in', false)).toBe('desk')
    expect(homeMode('signed_out', true)).toBe('desk')
    expect(homeMode('loading', false)).toBe('loading')
  })
})

describe('tickerItems', () => {
  it('counts matches with the right plural', () => {
    expect(tickerItems(0, null, false)).toEqual(['0 matches stored'])
    expect(tickerItems(1, null, false)).toEqual(['1 match stored'])
    expect(tickerItems(3, null, false)).toEqual(['3 matches stored'])
  })

  it('adds the coatings notice when there is one and no setup control shows it', () => {
    expect(tickerItems(2, 'Coatings off: no Ekur export found', false)).toEqual([
      '2 matches stored',
      'Coatings off: no Ekur export found',
    ])
  })

  it('omits the coatings notice when the setup control shows it', () => {
    expect(tickerItems(2, 'Coatings off: no Ekur export found', true)).toEqual(['2 matches stored'])
  })
})
