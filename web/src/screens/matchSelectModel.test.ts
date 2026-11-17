// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * matchSelectModel.test.ts — the match select page's pure logic: the merge of the stored
 * and the recent lists (with a match present in both), the sort, the tab filters, the score
 * fallback, a row without its context fields, the rosters' team ordering, and every fetch
 * state label.
 */
import { describe, expect, it } from 'vitest'

import type { MatchSummary, RemoteMatch } from '../lib/api/standalone'
import {
  cleanMapName,
  eyebrowOf,
  fetchStateLabel,
  filterByTab,
  formatDuration,
  formatPlayedAt,
  indexOfRow,
  localMatchIdSet,
  mergeMatchRows,
  playerTopMeta,
  previewOf,
  rostersOf,
  scoreLabel,
  storedAside,
  visibleTabs,
} from './matchSelectModel'

function stored(over: Partial<MatchSummary> = {}): MatchSummary {
  return {
    matchId: 'm1',
    mapName: 'Ascension',
    mapModule: 'ascension',
    build: 'test',
    durationMs: 480_000,
    players: null,
    importedAt: '2026-11-10T18:00:00Z',
    ...over,
  }
}

function remote(over: Partial<RemoteMatch> = {}): RemoteMatch {
  return { id: 'r1', map: 'Midtown', mode: 'SLC', time: '2026-11-11T12:00:00Z', ...over }
}

describe('mergeMatchRows', () => {
  it('lists the stored matches and keeps them when the recent list repeats one', () => {
    const a = stored({ matchId: 'a', startTime: '2026-11-01T00:00:00Z' })
    const b = stored({ matchId: 'b', startTime: '2026-11-02T00:00:00Z' })
    const recentSame = remote({ id: 'a', time: '2026-11-01T00:00:00Z' })
    const recentNew = remote({ id: 'r2', time: '2026-11-03T00:00:00Z' })
    const rows = mergeMatchRows([a, b], [recentSame, recentNew], localMatchIdSet([a, b]))
    expect(rows.map((r) => [r.kind, r.id])).toEqual([
      ['remote', 'r2'],
      ['stored', 'b'],
      ['stored', 'a'],
    ])
  })

  it('sorts by time played, newest first, and falls back to the import time', () => {
    const a = stored({ matchId: 'a', importedAt: '2026-11-01T00:00:00Z' })
    const b = stored({ matchId: 'b', startTime: '2026-11-03T00:00:00Z' })
    const c = stored({ matchId: 'c', startTime: '2026-11-02T00:00:00Z' })
    const r = remote({ id: 'r', time: '2026-11-04T00:00:00Z' })
    const rows = mergeMatchRows([c, a, b], [r], localMatchIdSet([a, b, c]))
    expect(rows.map((row) => row.id)).toEqual(['r', 'b', 'c', 'a'])
  })
})

describe('visibleTabs', () => {
  it('hides Recent when signed out', () => {
    expect(visibleTabs(true)).toEqual(['All', 'Stored', 'Ranked', 'Recent'])
    expect(visibleTabs(false)).toEqual(['All', 'Stored', 'Ranked'])
  })
})

describe('filterByTab', () => {
  const a = stored({ matchId: 'a', isRanked: true })
  const b = stored({ matchId: 'b' })
  const r = remote({ id: 'r' })
  const rows = [...mergeMatchRows([a, b], [r], localMatchIdSet([a, b]))]

  it('All keeps every row', () => {
    expect(filterByTab(rows, 'All', true).map((row) => row.id)).toEqual(['r', 'a', 'b'])
  })

  it('Stored keeps the stored rows only', () => {
    expect(filterByTab(rows, 'Stored', true).map((row) => row.id)).toEqual(['a', 'b'])
  })

  it('Ranked keeps the ranked stored rows only', () => {
    expect(filterByTab(rows, 'Ranked', true).map((row) => row.id)).toEqual(['a'])
  })

  it('Recent keeps the not-stored rows, and only when signed in', () => {
    expect(filterByTab(rows, 'Recent', true).map((row) => row.id)).toEqual(['r'])
    expect(filterByTab(rows, 'Recent', false)).toEqual([])
  })
})

describe('indexOfRow', () => {
  it('finds a row by id and falls back to the first row', () => {
    const rows = mergeMatchRows([stored({ matchId: 'a' })], [remote({ id: 'r' })], new Set(['a']))
    expect(indexOfRow(rows, 'r')).toBe(0)
    expect(indexOfRow(rows, 'a')).toBe(1)
    expect(indexOfRow(rows, null)).toBe(0)
    expect(indexOfRow(rows, 'missing')).toBe(0)
  })
})

describe('cleanMapName', () => {
  it('drops the trailing Ranked mark', () => {
    expect(cleanMapName('Ascension - Ranked')).toBe('Ascension')
    expect(cleanMapName('  Ascension - ranked')).toBe('  Ascension')
    expect(cleanMapName('Midtown')).toBe('Midtown')
  })
})

describe('scoreLabel', () => {
  it('prefers the signed-in player\'s score over the team scores', () => {
    expect(scoreLabel(stored({ scoreMine: 3, scoreTheirs: 1, teamScores: [9, 9] }))).toBe('3 - 1')
    expect(scoreLabel(stored({ teamScores: [9, 5] }))).toBe('9 - 5')
    expect(scoreLabel(stored({}))).toBeNull()
  })
})

describe('eyebrowOf', () => {
  it('joins the playlist and the mode and drops the empty ones', () => {
    expect(eyebrowOf(stored({ playlistName: 'Slayer', modeName: 'Competitive' }))).toBe(
      'Slayer / Competitive',
    )
    expect(eyebrowOf(stored({ modeName: 'Custom' }))).toBe('Custom')
    expect(eyebrowOf(stored({}))).toBe('')
  })
})

describe('formatDuration and formatPlayedAt', () => {
  it('formats a duration as M:SS', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(90_000)).toBe('1:30')
    expect(formatDuration(600_000)).toBe('10:00')
  })

  it('formats an instant as a locale date, keeping an unparseable one raw', () => {
    expect(formatPlayedAt('not-a-date')).toBe('not-a-date')
    expect(formatPlayedAt('2026-11-10T18:00:00Z')).toMatch(/\d{4}/)
  })
})

describe('playerTopMeta', () => {
  it('prefers the stored summary mode and start time', () => {
    const meta = playerTopMeta(
      stored({ modeName: 'SLC', startTime: '2026-11-09T20:00:00Z' }),
      remote(),
    )
    expect(meta).toBe(`SLC · ${formatPlayedAt('2026-11-09T20:00:00Z')}`)
  })

  it('falls back to the remote row when the summary has no mode or start time', () => {
    const meta = playerTopMeta(stored({}), remote({ mode: 'SLC', time: '2026-11-11T12:00:00Z' }))
    expect(meta).toBe(`SLC · ${formatPlayedAt('2026-11-11T12:00:00Z')}`)
  })

  it('mixes: a stored mode with a remote time', () => {
    const meta = playerTopMeta(stored({ modeName: 'SLC' }), remote({ mode: 'FFA' }))
    expect(meta).toBe(`SLC · ${formatPlayedAt('2026-11-11T12:00:00Z')}`)
  })

  it('falls back to the import date when nothing else gives a time', () => {
    const meta = playerTopMeta(stored({}), null)
    expect(meta).toBe(`Imported ${formatPlayedAt('2026-11-10T18:00:00Z')}`)
  })

  it('is empty when nothing is known', () => {
    expect(playerTopMeta(null, null)).toBe('')
  })
})

describe('previewOf', () => {
  it('shows the score, length and date for a stored match, with its rosters', () => {
    const m = stored({
      scoreMine: 3,
      scoreTheirs: 1,
      startTime: '2026-11-09T20:00:00Z',
      modeName: 'SLC',
      playlistName: 'Free for all',
      mapImageUrl: '/static/maps/halo_infinite/1.png',
      players: [
        { name: 'Jordan', teamId: 0 },
        { name: 'A', teamId: 0 },
        { name: 'B', teamId: 1 },
        { name: 'C', teamId: 1 },
      ],
    })
    const p = previewOf({ kind: 'stored', id: 'm1', match: m }, 'Jordan')
    expect(p.title).toBe('Ascension')
    expect(p.eyebrow).toBe('Free for all / SLC')
    expect(p.imageUrl).toBe('/static/maps/halo_infinite/1.png')
    expect(p.facts).toEqual([
      { label: 'Final', value: '3 - 1' },
      { label: 'Length', value: '8:00' },
      { label: 'Played', value: formatPlayedAt('2026-11-09T20:00:00Z') },
    ])
    expect(p.rosters.map((r) => r.title)).toEqual(['Your team', 'Opponents'])
    expect(p.rosters[0].names).toEqual(['Jordan', 'A'])
    expect(p.rosters[1].names).toEqual(['B', 'C'])
    expect(p.note).toBeNull()
  })

  it('reads a row without context fields', () => {
    const m = stored({ mapName: '', mapModule: '' })
    const p = previewOf({ kind: 'stored', id: 'm1', match: m }, null)
    expect(p.title).toBe('Unknown map')
    expect(p.eyebrow).toBeNull()
    expect(p.imageUrl).toBeNull()
    expect(p.facts).toEqual([
      { label: 'Length', value: '8:00' },
      { label: 'Played', value: formatPlayedAt('2026-11-10T18:00:00Z') },
    ])
    expect(p.rosters).toEqual([])
  })

  it('says a remote match is not fetched yet and what Enter does', () => {
    const p = previewOf({ kind: 'remote', id: 'r1', match: remote({ mode: 'SLC' }) }, 'Jordan')
    expect(p.title).toBe('Midtown')
    expect(p.eyebrow).toBe('SLC')
    expect(p.facts).toEqual([])
    expect(p.rosters).toEqual([])
    expect(p.note).toMatch(/not fetched yet/)
    expect(p.note).toMatch(/Enter/)
  })
})

describe('rostersOf', () => {
  const players = [
    { name: 'Jordan', teamId: 1 },
    { name: 'A', teamId: 1 },
    { name: 'B', teamId: 0 },
    { name: 'C', teamId: 0 },
    { name: 'D', teamId: -1 },
  ]

  it('names Team 1 and Team 2 when the player is not in the match', () => {
    expect(rostersOf(stored({ players }), null).map((r) => r.title)).toEqual(['Team 1', 'Team 2'])
  })

  it('reads the player\'s team first and leaves out campless players', () => {
    const rosters = rostersOf(stored({ players }), 'Jordan')
    expect(rosters.map((r) => r.title)).toEqual(['Your team', 'Opponents'])
    expect(rosters[0].names).toEqual(['Jordan', 'A'])
    expect(rosters[1].names).toEqual(['B', 'C'])
  })
})

describe('storedAside', () => {
  it('gives the score and result, or nothing without a score', () => {
    expect(storedAside(stored({ scoreMine: 3, scoreTheirs: 1, outcome: 'win' }))).toEqual({
      score: '3 - 1',
      result: 'Victory',
    })
    expect(storedAside(stored({ teamScores: [9, 5] }))).toEqual({ score: '9 - 5', result: '' })
    expect(storedAside(stored({}))).toBeNull()
  })
})

describe('fetchStateLabel', () => {
  it('labels every state of the queue', () => {
    expect(fetchStateLabel({ phase: 'idle' })).toBe('Fetch')
    expect(fetchStateLabel({ phase: 'queued', position: 1 })).toBe('Queued…')
    expect(fetchStateLabel({ phase: 'queued', position: 2 })).toBe('Queued (2)…')
    expect(fetchStateLabel({ phase: 'downloading', done: 3, total: 10 })).toBe('Downloading… 3/10')
    expect(fetchStateLabel({ phase: 'building' })).toBe('Building…')
    expect(fetchStateLabel({ phase: 'ready' })).toBe('Ready')
    expect(fetchStateLabel({ phase: 'blocked' })).toBe('Another fetch is already in progress…')
    expect(fetchStateLabel({ phase: 'failed', error: 'film not available' })).toBe(
      'This film is no longer available on the Halo service.',
    )
    expect(fetchStateLabel({ phase: 'failed', error: 'boom' })).toBe('Fetch failed: boom')
  })
})
