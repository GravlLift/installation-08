// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * FirstRunPanel.test.tsx — the home screen's "Getting ready" plate: the steps reduced from the
 * state routes, the determinate bar and current step while work runs, "Ready" then gone, a
 * failed step's message, and nothing at all when the first read finds everything done. `fetch`
 * is mocked by route.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FirstRunPanel } from './FirstRunPanel'
import { currentStep, firstRunStepsOf, stepStatusOf, useFirstRunProgress } from './useFirstRunProgress'

function Harness() {
  const { view } = useFirstRunProgress(80, 120)
  return <FirstRunPanel view={view} />
}

/** Answers each state route from `script[route]`, one body per read (the last repeats). */
function routeFetch(script: Record<string, unknown[]>) {
  const seen: Record<string, number> = {}
  return vi.fn(async (url: string) => {
    const bodies = script[url]
    if (!bodies) return { ok: false, status: 404, json: async () => ({}) } as Response
    const i = seen[url] ?? 0
    seen[url] = i + 1
    return { ok: true, status: 200, json: async () => bodies[Math.min(i, bodies.length - 1)] } as Response
  })
}

const READY = { state: 'ready' }

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('step reduction', () => {
  it('maps the server states to step statuses', () => {
    expect(stepStatusOf({ state: 'extracting' }).status).toBe('running')
    expect(stepStatusOf({ state: 'building' }).status).toBe('running')
    expect(stepStatusOf({ state: 'queued' }).status).toBe('pending')
    expect(stepStatusOf({ state: 'idle' }).status).toBe('done')
    expect(stepStatusOf({ state: 'absent' }).status).toBe('done')
    expect(stepStatusOf(null).status).toBe('done')
    expect(stepStatusOf({ state: 'failed', error: 'boom' })).toEqual({ status: 'failed', error: 'boom' })
  })

  it('names the running step, else the first queued one', () => {
    const steps = firstRunStepsOf({ coatings: READY, weapons: { state: 'queued' }, armor: { state: 'building' } })
    expect(currentStep(steps)?.label).toBe('Building armor')
    expect(currentStep(firstRunStepsOf({ firstPerson: { state: 'queued' } }))?.label).toBe('Building first-person arms')
  })

  it('counts the coating libraries as still ahead while the coatings setup runs', () => {
    const steps = firstRunStepsOf({
      coatings: { state: 'extracting' },
      announcer: READY,
      weapons: { state: 'absent' },
      armor: READY,
      firstPerson: { state: 'absent' },
    })
    expect(steps.map((s) => s.status)).toEqual(['running', 'done', 'pending', 'pending', 'pending'])
  })
})

describe('FirstRunPanel', () => {
  it('shows progress while work runs, then Ready, then nothing', async () => {
    vi.stubGlobal('fetch', routeFetch({
      '/api/coatings/setup/state': [{ state: 'extracting' }, READY],
      '/api/announcer/state': [READY],
      '/api/weapons/state': [{ state: 'queued' }, { state: 'building' }, READY],
      '/api/spartan-pieces/state': [{ state: 'queued' }, { state: 'queued' }, READY],
      '/api/first-person/state': [{ state: 'absent' }],
    }))
    render(<Harness />)
    await waitFor(() => expect(screen.getByTestId('first-run-step').textContent).toBe('Reading coatings from the game'))
    // Only the announcer is finished: the first-person library reads "absent" but the coatings
    // setup has not queued it yet.
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1')
    expect(screen.getByTestId('first-run-panel').textContent).toContain('You can use the viewer meanwhile')
    await waitFor(() => expect(screen.getByTestId('first-run-step').textContent).toBe('Building weapons'))
    await waitFor(() => expect(screen.getByTestId('first-run-panel').textContent).toContain('Ready'))
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('5')
    await waitFor(() => expect(screen.queryByTestId('first-run-panel')).toBeNull())
  })

  it('keeps a failed step with its message', async () => {
    vi.stubGlobal('fetch', routeFetch({
      '/api/coatings/setup/state': [{ state: 'failed', error: 'the export failed' }],
      '/api/weapons/state': [{ state: 'building' }, READY],
    }))
    render(<Harness />)
    await waitFor(() => expect(screen.getByTestId('first-run-error').textContent).toBe('Reading coatings from the game failed: the export failed'))
    await waitFor(() => expect(screen.getByTestId('first-run-panel').textContent).toContain('Setup incomplete'))
  })

  it('shows nothing when everything is already done', async () => {
    const mock = routeFetch({ '/api/coatings/setup/state': [{ state: 'idle' }], '/api/weapons/state': [READY] })
    vi.stubGlobal('fetch', mock)
    render(<Harness />)
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(5))
    await new Promise((r) => setTimeout(r, 200))
    expect(screen.queryByTestId('first-run-panel')).toBeNull()
    expect(mock).toHaveBeenCalledTimes(5)
  })
})
