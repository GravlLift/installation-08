// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { MatchId } from './MatchId'

it('shows and copies the match ID with feedback', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
  render(<MatchId matchId="match-123" />)
  fireEvent.click(screen.getByRole('button', { name: /match-123/ }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('match-123'))
  expect(await screen.findByText('Copied')).toBeInTheDocument()
  vi.unstubAllGlobals()
})
