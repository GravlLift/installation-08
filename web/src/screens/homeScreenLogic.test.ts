/**
 * homeScreenLogic.test.ts — the sign-in countdown helper.
 */
import { describe, expect, it } from 'vitest'

import { formatTimeLeft } from './homeScreenLogic'

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
