// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * BuildActivity.test.tsx — the header's build indicator: the view reduced from GET /api/builds,
 * hidden while idle, the label and queue count while a build runs, the tooltip listing the
 * queue, and the polling back to hidden when the build ends. `fetch` is mocked.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BuildActivity } from './BuildActivity'
import { buildActivityView } from './buildActivityModel'

const IDLE = { active: null, queued: [] }
const BUSY = {
  active: { key: 'variant:m', label: 'Vacancy Forge layer', elapsedMs: 1200 },
  queued: [{ key: 'weapons', label: 'Weapons' }, { key: 'spartan-pieces', label: 'Armor' }],
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
})

describe('buildActivityView', () => {
  it('is null when idle or unreadable', () => {
    expect(buildActivityView(IDLE)).toBeNull()
    expect(buildActivityView(null)).toBeNull()
  })

  it('names the active build, counts the queue and lists it in the tooltip', () => {
    expect(buildActivityView(BUSY)).toEqual({
      label: 'Vacancy Forge layer',
      queued: 2,
      title: 'Building: Vacancy Forge layer\nQueued:\n1. Weapons\n2. Armor',
    })
    expect(buildActivityView({ ...BUSY, queued: [] })).toEqual({ label: 'Vacancy Forge layer', queued: 0, title: 'Building: Vacancy Forge layer' })
  })
})

describe('BuildActivity', () => {
  it('shows the build with its queue, then hides when the server is idle again', async () => {
    const mock = sequence([BUSY, IDLE])
    vi.stubGlobal('fetch', mock)
    render(<BuildActivity pollMs={{ active: 40, idle: 1000 }} />)
    const el = await screen.findByTestId('build-activity')
    expect(el.textContent).toContain('Building: Vacancy Forge layer')
    expect(el.textContent).toContain('· 2 queued')
    expect(el.getAttribute('title')).toContain('1. Weapons')
    await waitFor(() => expect(screen.queryByTestId('build-activity')).toBeNull())
  })

  it('renders nothing while idle, and nothing for a server without the route', async () => {
    const mock = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response)
    vi.stubGlobal('fetch', mock)
    render(<BuildActivity pollMs={{ active: 40, idle: 1000 }} />)
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('build-activity')).toBeNull()
  })

  it('omits the queue count when nothing waits', async () => {
    vi.stubGlobal('fetch', sequence([{ ...BUSY, queued: [] }]))
    render(<BuildActivity pollMs={{ active: 1000, idle: 1000 }} />)
    const el = await screen.findByTestId('build-activity')
    expect(el.textContent).not.toContain('queued')
  })
})
