/**
 * MatchHeaderBar.test.tsx — the header bar above the 3D viewer: back button always present and
 * wired, map name (with its mapModule/unknown fallbacks) and import time shown once a summary is
 * known, nothing but the back button while it is not.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { MatchSummary } from '../lib/api/standalone'
import { MatchHeaderBar } from './MatchHeaderBar'

function summaryOf(overrides: Partial<MatchSummary> = {}): MatchSummary {
  return {
    matchId: 'm1',
    mapName: 'Aquarius',
    mapModule: 'mod_aquarius',
    build: '1.0',
    durationMs: 600_000,
    players: null,
    // Noon UTC: safely the same calendar day in every real local timezone, so the date
    // assertion below does not depend on the machine running the test.
    importedAt: '2026-11-11T12:00:00Z',
    ...overrides,
  }
}

describe('MatchHeaderBar', () => {
  it('always renders the back button and calls onBack when clicked', () => {
    const onBack = vi.fn()
    render(<MatchHeaderBar summary={null} onBack={onBack} />)

    const button = screen.getByRole('button', { name: '← Matches' })
    button.click()
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('shows nothing but the back button while the summary is not known yet', () => {
    render(<MatchHeaderBar summary={null} onBack={() => {}} />)

    expect(screen.queryByText(/Imported/)).not.toBeInTheDocument()
  })

  it('shows the map name and a readable import time once the summary loads', () => {
    render(<MatchHeaderBar summary={summaryOf()} onBack={() => {}} />)

    expect(screen.getByText('Aquarius')).toBeInTheDocument()
    expect(screen.getByText(/Imported/)).toBeInTheDocument()
    expect(screen.getByText(/Nov 11, 2026/)).toBeInTheDocument()
  })

  it('falls back to the map module when mapName is empty, and to "Unknown map" when both are', () => {
    render(<MatchHeaderBar summary={summaryOf({ mapName: '' })} onBack={() => {}} />)
    expect(screen.getByText('mod_aquarius')).toBeInTheDocument()

    render(<MatchHeaderBar summary={summaryOf({ mapName: '', mapModule: '' })} onBack={() => {}} />)
    expect(screen.getByText('Unknown map')).toBeInTheDocument()
  })
})
