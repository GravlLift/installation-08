// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * HomeScreen.test.tsx — the home screen's coatings setup control: when the coating status
 * says setup can fix it, the "Set up coatings" control shows in a stable row and the ticker
 * drops its copy of the notice; when it cannot (the IT3D_EKUR_DIR override wins), the notice
 * stays in the ticker with no button. `fetch` is mocked by route; nothing reaches a server.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HomeScreen } from './HomeScreen'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

/** A fetch mock that answers the home screen's routes: the match list, the auth state,
 *  the coating status (`override` toggles whether setup can fix it), and the setup state. */
function routeFetch(override: boolean, auth: unknown = { state: 'signed_out' }) {
  return vi.fn(async (url: string) => {
    if (url === '/api/matches') {
      return jsonResponse([{ matchId: 'm', mapName: 'Recharge', importedAt: '2026-11-01T12:00:00Z' }])
    }
    if (url === '/api/auth/state') return jsonResponse(auth)
    if (url === '/api/coatings/status') return jsonResponse({ export: 'not_set', override })
    if (url === '/api/coatings/setup/state') return jsonResponse({ state: 'idle' })
    return jsonResponse({ error: 'not found' }, 404)
  })
}

const NOTICE = 'Coatings off: no Ekur export found'

describe('HomeScreen', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows the Set up coatings control and drops the notice from the ticker when setup can fix it', async () => {
    vi.stubGlobal('fetch', routeFetch(false))
    render(<HomeScreen />)


    await screen.findByTestId('coatings-setup-button')
    expect(screen.getByTestId('coatings-notice').textContent).toBe(NOTICE)
    // The control carries the notice's text; the ticker must not repeat it.
    const ticker = document.querySelector('.bc-ticker')
    expect(ticker?.textContent).not.toContain(NOTICE)
    expect(ticker?.textContent).toContain('1 match stored')
  })

  it('keeps the notice in the ticker, without the button, when setup cannot fix it', async () => {
    vi.stubGlobal('fetch', routeFetch(true))
    render(<HomeScreen />)

    await screen.findByText(NOTICE)
    expect(screen.queryByTestId('coatings-setup-button')).toBeNull()
    // One copy of the notice, the ticker's.
    expect(screen.getAllByText(NOTICE)).toHaveLength(1)
  })

  it('is a sign-in page when signed out: one call to action, no Watch row or featured card', async () => {
    vi.stubGlobal('fetch', routeFetch(true))
    render(<HomeScreen />)
    await screen.findByText('Sign in with Xbox')
    expect(screen.getByText(/never sees your password/)).toBeTruthy()
    expect(screen.queryByText('Watch')).toBeNull()
    expect(screen.queryByText('Featured game')).toBeNull()
    fireEvent.click(screen.getByText('Sign in with Xbox'))
    expect(window.location.hash).toBe('#/matches?signin=1')
  })

  it('shows the desk once signed in', async () => {
    vi.stubGlobal('fetch', routeFetch(true, { state: 'signed_in', gamertag: 'Chief' }))
    render(<HomeScreen />)
    await screen.findByText('Recent matches')
    expect(screen.getByText('Watch')).toBeTruthy()
    expect(screen.queryByText('Sign in with Xbox')).toBeNull()
  })

  it('keeps the Watch list on a read-only server, without any sign-in', async () => {
    vi.stubGlobal('fetch', routeFetch(true, { state: 'signed_out', signedIn: false, readOnly: true }))
    render(<HomeScreen />)
    await screen.findByText('Watch')
    expect(screen.queryByText('Sign in with Xbox')).toBeNull()
    expect(screen.queryByRole('option', { name: /Sign in/ })).toBeNull()
  })

  it('credits the projects it builds on, in order, each linking out to a new browsing context', async () => {
    vi.stubGlobal('fetch', routeFetch(true))
    render(<HomeScreen />)
    await screen.findByText('Sign in with Xbox')
    const credits = screen.getByRole('navigation', { name: 'Credits' })
    const links = Array.from(credits.querySelectorAll('a'))
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['LevelUp', 'https://github.com/JGtm/LevelUp'],
      ['OpenSpartan', 'https://github.com/dend'],
      ['Ekur', 'https://github.com/TheHaloArchive/ekur'],
      ['SPNKr', 'https://github.com/acurtis166/SPNKr'],
      ['More in NOTICE', 'https://github.com/llampwall/installation-08#credits'],
      ['Made by Jordan Hewitt', 'https://github.com/llampwall'],
    ])
    // The app window's injected script hands cross-origin anchors to the default browser; a
    // plain browser tab must open them in a new tab, never replace the app.
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank')
      expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    }
    expect(credits.textContent).toContain('JGtm')
    expect(credits.textContent).toContain('Den Delimarsky')
    expect(credits.textContent).toContain('The Halo Archive')
    expect(credits.textContent).toContain('Andy Curtis')
  })
})
