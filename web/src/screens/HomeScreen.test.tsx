/**
 * HomeScreen.test.tsx — the home screen's coatings setup control: when the coating status
 * says setup can fix it, the "Set up coatings" control shows in a stable row and the ticker
 * drops its copy of the notice; when it cannot (the IT3D_EKUR_DIR override wins), the notice
 * stays in the ticker with no button. `fetch` is mocked by route; nothing reaches a server.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HomeScreen } from './HomeScreen'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

/** A fetch mock that answers the home screen's routes: the match list, the auth state,
 *  the coating status (`override` toggles whether setup can fix it), and the setup state. */
function routeFetch(override: boolean) {
  return vi.fn(async (url: string) => {
    if (url === '/api/matches') {
      return jsonResponse([{ matchId: 'm', mapName: 'Recharge', importedAt: '2026-11-01T12:00:00Z' }])
    }
    if (url === '/api/auth/state') return jsonResponse({ state: 'signed_out' })
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
})
