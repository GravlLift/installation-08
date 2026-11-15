/**
 * gamertagSearch.test.ts — the gamertag input's normalization and loose check, the
 * remembered last search (including storage that throws), the caption, and the rows a search
 * shows (stored ones as stored rows, the rest fetchable).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MatchSummary, RemoteMatch } from '../lib/api/standalone'
import {
  GAMERTAG_STORAGE_KEY,
  listCaption,
  loadSavedGamertag,
  normalizeGamertag,
  saveGamertag,
  searchedRows,
} from './gamertagSearch'

describe('normalizeGamertag', () => {
  it('trims and collapses spaces', () => {
    expect(normalizeGamertag('  Some   Player ')).toBe('Some Player')
  })

  it('accepts modern suffixes, digits and other scripts', () => {
    expect(normalizeGamertag('Name#1234')).toBe('Name#1234')
    expect(normalizeGamertag('Ünïcødé 42')).toBe('Ünïcødé 42')
    expect(normalizeGamertag('123456789012#123')).toBe('123456789012#123')
  })

  it('rejects empty, too long and odd characters', () => {
    expect(normalizeGamertag('')).toBeNull()
    expect(normalizeGamertag('    ')).toBeNull()
    expect(normalizeGamertag('12345678901234567')).toBeNull()
    expect(normalizeGamertag('a/b')).toBeNull()
    expect(normalizeGamertag('x(1)')).toBeNull()
    expect(normalizeGamertag('a?b')).toBeNull()
  })
})

describe('saved gamertag', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('round-trips and forgets', () => {
    expect(loadSavedGamertag()).toBe('')
    saveGamertag('Other Player')
    expect(window.localStorage.getItem(GAMERTAG_STORAGE_KEY)).toBe('Other Player')
    expect(loadSavedGamertag()).toBe('Other Player')
    saveGamertag(null)
    expect(loadSavedGamertag()).toBe('')
  })

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(loadSavedGamertag()).toBe('')
    expect(() => saveGamertag('X')).not.toThrow()
  })
})

describe('listCaption', () => {
  it('names whose matches are shown', () => {
    expect(listCaption(null)).toBe('My matches')
    expect(listCaption('Other Player')).toBe("Other Player's matches")
  })
})

describe('searchedRows', () => {
  const stored: MatchSummary[] = [
    { matchId: 'a', mapName: 'Aquarius', mapModule: 'm', build: 'b', durationMs: 1, players: null, importedAt: 'x' },
    { matchId: 'mine-only', mapName: 'Live Fire', mapModule: 'm', build: 'b', durationMs: 1, players: null, importedAt: 'x' },
  ]
  const remote: RemoteMatch[] = [
    { id: 'b', map: 'Streets', mode: 'Slayer', time: '2026-11-14T00:00:00Z' },
    { id: 'a', map: 'Aquarius', mode: 'CTF', time: '2026-11-13T00:00:00Z' },
  ]

  it("lists only that player's matches, stored ones as stored rows, in the service's order", () => {
    const rows = searchedRows(stored, remote, new Set(['a', 'mine-only']))
    expect(rows.map((r) => [r.kind, r.id])).toEqual([
      ['remote', 'b'],
      ['stored', 'a'],
    ])
  })

  it('falls back to a remote row when the stored summary is not loaded', () => {
    const rows = searchedRows([], remote, new Set(['a']))
    expect(rows.map((r) => r.kind)).toEqual(['remote', 'remote'])
  })
})
