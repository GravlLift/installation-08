// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * TextureQualityToggle.test.tsx — the match select page's texture-quality toggle: it shows the
 * stored preference (Standard by default), a click writes the shared key, and the player's
 * settings drawer, mounted at the same time, follows it live (one preference, every place in
 * sync). `fetch` is mocked by route; nothing reaches a server.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ReplaySettingsDrawer } from '../features/match-replay/settings/ReplaySettingsDrawer'
import type { Action3dShow } from '../features/match-replay/scene3d/action3dInputs'
import type { ReplaySound } from '../features/match-replay/sound/useReplaySound'
import { MatchSelectScreen } from './MatchSelectScreen'

const QUALITY_KEY = 'replay-texture-quality'

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

const show: Action3dShow = {
  shots: false,
  kills: false,
  weaponPads: false,
  groundWeapons: false,
  groundWeaponsSpecialOnly: false,
  groundWeaponsStarting: false,
  placements: false,
  vehicles: false,
  objectives: false,
  flags: false,
  vipCrown: false,
  bombCarrier: false,
}
const toggle = Object.fromEntries(Object.keys(show).map((key) => [key, () => {}])) as {
  [K in keyof Action3dShow]: () => void
}
const sound = {
  categories: { weapon: false, grenade: false, melee: false, equipment: false, announcer: false },
  toggleCategory: () => {},
} as unknown as ReplaySound

describe('the match select texture-quality toggle', () => {
  beforeEach(() => {
    localStorage.removeItem(QUALITY_KEY)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/matches') return json([{ matchId: 'm', mapName: 'Streets', importedAt: '2026-11-01T12:00:00Z' }])
        if (url === '/api/auth/state') return json({ state: 'signed_out' })
        return json({ error: 'not found' }, 404)
      }),
    )
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    localStorage.removeItem(QUALITY_KEY)
  })

  it('shows Standard by default', async () => {
    render(<MatchSelectScreen />)
    await screen.findByText('Match library')
    expect(screen.getByRole('radiogroup', { name: 'Texture quality' })).toBeInTheDocument()
    expect(screen.getByTestId('select-texture-quality-standard').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByTestId('select-texture-quality-high').getAttribute('aria-checked')).toBe('false')
  })

  it('writes the preference and the drawer follows it', async () => {
    render(
      <>
        <MatchSelectScreen />
        <ReplaySettingsDrawer locale="en" sound={sound} show={show} toggle={toggle} onClose={() => {}} />
      </>,
    )
    await screen.findByText('Match library')
    expect(screen.getByTestId('texture-quality-standard').getAttribute('aria-checked')).toBe('true')

    act(() => {
      fireEvent.click(screen.getByTestId('select-texture-quality-high'))
    })

    expect(localStorage.getItem(QUALITY_KEY)).toBe('high')
    expect(screen.getByTestId('select-texture-quality-high').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByTestId('texture-quality-high').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByTestId('texture-quality-standard').getAttribute('aria-checked')).toBe('false')

    // And back the other way: the drawer's choice shows on the matches page.
    act(() => {
      fireEvent.click(screen.getByTestId('texture-quality-standard'))
    })
    expect(localStorage.getItem(QUALITY_KEY)).toBe('standard')
    expect(screen.getByTestId('select-texture-quality-standard').getAttribute('aria-checked')).toBe('true')
  })

  it('shows a stored High on open', async () => {
    localStorage.setItem(QUALITY_KEY, 'high')
    render(<MatchSelectScreen />)
    await screen.findByText('Match library')
    expect(screen.getByTestId('select-texture-quality-high').getAttribute('aria-checked')).toBe('true')
  })
})
