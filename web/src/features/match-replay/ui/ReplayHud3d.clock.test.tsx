// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { render, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { ReplayHud3d } from './ReplayHud3d'
import { testReplayDoc } from '../test/testDoc'

it('shows the clock without score numbers when the film has no score timeline', async () => {
  const doc = testReplayDoc({ frameIntervalMs: 100, tracks: [], roster: [] })
  const { container } = render(<ReplayHud3d doc={doc} xuid="A" frameRef={{ current: 260 }} locale="en" kills={[]} playWindow={null} timeLimitMs={null} hud="score" />)
  await waitFor(() => expect(container.querySelector('[data-map-inset="bottom"]')?.textContent).toBe('0:26'))
  expect(container.querySelectorAll('[data-score-bar]')).toHaveLength(0)
})
