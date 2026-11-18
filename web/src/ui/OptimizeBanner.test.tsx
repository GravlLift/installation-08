// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * OptimizeBanner.test.tsx — the top-of-page "Optimizing assets" banner: the view reduced from
 * GET /api/builds (hidden while idle, the fraction and step while a build runs), the banner's
 * own rendering (the fill width, the fixed text, the step), the body class it toggles so
 * broadcast.css pushes every page's frame down, and the polling back to hidden when the queue
 * empties. `fetch` is mocked.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { OptimizeBanner } from './OptimizeBanner'
import { optimizeBannerView } from './optimizeBannerModel'

const IDLE = { active: null, queued: [], overall: { done: 0, total: 0, fraction: 0 } }
const BUSY = {
  active: { key: 'weapons', label: 'Weapons', step: 'Weapons 84/190' },
  queued: [],
  overall: { done: 2, total: 9, fraction: 0.3 },
}

function sequence(bodies: unknown[]) {
  let i = 0
  return vi.fn(async (url: string) => {
    if (url !== '/api/builds') return { ok: false, status: 404, json: async () => ({}) } as Response
    const body = bodies[Math.min(i++, bodies.length - 1)]
    return { ok: true, status: 200, json: async () => body } as Response
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.body.classList.remove('bc-has-optimize-bar')
})

describe('optimizeBannerView', () => {
  it('is null when idle, unreadable, or total is 0', () => {
    expect(optimizeBannerView(IDLE)).toBeNull()
    expect(optimizeBannerView(null)).toBeNull()
    expect(optimizeBannerView({ active: { key: 'w', label: 'Weapons' }, queued: [] })).toEqual({ fraction: 0, step: 'Weapons' })
  })

  it('reads the overall fraction and prefers the active job\'s step over its bare label', () => {
    expect(optimizeBannerView(BUSY)).toEqual({ fraction: 0.3, step: 'Weapons 84/190' })
  })

  it('clamps an out-of-range fraction', () => {
    expect(optimizeBannerView({ ...BUSY, overall: { done: 9, total: 9, fraction: 1.4 } })).toEqual({ fraction: 1, step: 'Weapons 84/190' })
  })
})

describe('OptimizeBanner', () => {
  it('shows the fraction and step, sets the body class, then hides and clears it when idle', async () => {
    vi.stubGlobal('fetch', sequence([BUSY, IDLE]))
    render(<OptimizeBanner pollMs={{ active: 40, idle: 1000 }} />)
    const el = await screen.findByTestId('optimize-banner')
    expect(el.textContent).toContain('Optimizing assets. Playback may be less smooth until this finishes.')
    expect(el.textContent).toContain('Weapons 84/190')
    expect(document.body.classList.contains('bc-has-optimize-bar')).toBe(true)
    await waitFor(() => expect(screen.queryByTestId('optimize-banner')).toBeNull())
    await waitFor(() => expect(document.body.classList.contains('bc-has-optimize-bar')).toBe(false))
  })

  it('keeps the body class through progress updates while the bar stays up', async () => {
    const LATER = { ...BUSY, active: { ...BUSY.active, step: 'Weapons 120/190' }, overall: { done: 3, total: 9, fraction: 0.5 } }
    vi.stubGlobal('fetch', sequence([BUSY, LATER]))
    render(<OptimizeBanner pollMs={{ active: 40, idle: 1000 }} />)
    await waitFor(() => expect(screen.getByTestId('optimize-banner').textContent).toContain('Weapons 120/190'))
    expect(document.body.classList.contains('bc-has-optimize-bar')).toBe(true)
  })

  it('renders nothing while idle, and nothing for a server without the route', async () => {
    const mock = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response)
    vi.stubGlobal('fetch', mock)
    render(<OptimizeBanner pollMs={{ active: 40, idle: 1000 }} />)
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('optimize-banner')).toBeNull()
    expect(document.body.classList.contains('bc-has-optimize-bar')).toBe(false)
  })
})
