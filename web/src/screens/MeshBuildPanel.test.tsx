import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MeshBuildPanel } from './MatchViewScreen'

afterEach(() => vi.unstubAllGlobals())

it('shows cancel only while building and posts to the cancel route', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ state: 'building', moduleKey: 'mod' }) })
  vi.stubGlobal('fetch', fetchMock)
  render(<MeshBuildPanel matchId="abc" moduleKey="mod" onReady={vi.fn()} onBack={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/matches/abc/mesh/cancel', expect.objectContaining({ method: 'POST' })))
  expect(screen.getByRole('button', { name: 'Cancelling…' })).toBeDisabled()
})

it.each(['absent', 'queued', 'cancelled'])('does not offer cancellation when %s', async (state) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ state, moduleKey: 'mod' }) }))
  render(<MeshBuildPanel matchId="abc" moduleKey="mod" onReady={vi.fn()} onBack={vi.fn()} />)
  await waitFor(() => expect(screen.queryByText('Checking build status…')).not.toBeInTheDocument())
  expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
})
