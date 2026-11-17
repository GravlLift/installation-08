// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { SettingsToggle } from './SettingsControls'

it('allows long settings labels to wrap', () => {
  render(<SettingsToggle label="Show starting ground weapons" pressed={false} onToggle={vi.fn()} />)
  expect(screen.getByText('Show starting ground weapons')).not.toHaveClass('truncate')
})
