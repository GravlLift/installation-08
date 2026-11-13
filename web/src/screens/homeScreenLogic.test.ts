/**
 * homeScreenLogic.test.ts — pure helpers for the account panel and remote-matches section.
 */
import { describe, expect, it } from 'vitest'

import type { MatchSummary, RemoteMatch } from '../lib/api/standalone'
import {
  formatRemoteMatchTime,
  formatTimeLeft,
  isMatchLocal,
  localMatchIdSet,
} from './homeScreenLogic'

function remoteMatch(id: string): RemoteMatch {
  return { id, map: 'Recharge', mode: 'Slayer', time: '2026-11-13T12:00:00Z' }
}

function localMatch(matchId: string): MatchSummary {
  return {
    matchId,
    mapName: 'Recharge',
    mapModule: 'm',
    build: 'b',
    durationMs: 1000,
    players: null,
    importedAt: '2026-11-13T12:00:00Z',
  }
}

describe('localMatchIdSet', () => {
  it('collects every match id', () => {
    const set = localMatchIdSet([localMatch('a'), localMatch('b')])
    expect(set.has('a')).toBe(true)
    expect(set.has('b')).toBe(true)
    expect(set.has('c')).toBe(false)
  })
})

describe('isMatchLocal', () => {
  it('is true only when the remote match id is in the local set', () => {
    const set = new Set(['a'])
    expect(isMatchLocal(remoteMatch('a'), set)).toBe(true)
    expect(isMatchLocal(remoteMatch('b'), set)).toBe(false)
  })
})

describe('formatTimeLeft', () => {
  const now = new Date('2026-11-13T12:00:00Z').getTime()

  it('formats minutes and seconds when over a minute remains', () => {
    expect(formatTimeLeft('2026-11-13T12:02:30Z', now)).toBe('2m 30s')
  })

  it('formats seconds only under a minute', () => {
    expect(formatTimeLeft('2026-11-13T12:00:45Z', now)).toBe('45s')
  })

  it('returns null once the deadline has passed', () => {
    expect(formatTimeLeft('2026-11-13T11:59:00Z', now)).toBeNull()
  })

  it('returns null for an unparseable timestamp', () => {
    expect(formatTimeLeft('not-a-date', now)).toBeNull()
  })
})

describe('formatRemoteMatchTime', () => {
  it('falls back to the raw string for an unparseable timestamp', () => {
    expect(formatRemoteMatchTime('not-a-date')).toBe('not-a-date')
  })

  it('formats a valid timestamp (non-empty, not the raw string)', () => {
    const formatted = formatRemoteMatchTime('2026-11-13T12:00:00Z')
    expect(formatted).not.toBe('2026-11-13T12:00:00Z')
    expect(formatted.length).toBeGreaterThan(0)
  })
})
