// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * ProgressLine.test.tsx — the build's small detail line: it renders under the step name when
 * the prop is set and renders nothing when it is not (the bar and step stay as they are).
 */
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'

import { ProgressLine } from './ProgressLine'

it('renders the detail line under the step name when it is set', () => {
  render(<ProgressLine label="Compressing textures… 47 %" fraction={0.47} detail="Compressing textures  ·  4:12" />)

  expect(screen.getByText('Compressing textures… 47 %')).toBeInTheDocument()
  // The text matcher collapses runs of whitespace, so the needle uses single spaces.
  const detail = screen.getByText('Compressing textures · 4:12')
  expect(detail).toHaveClass('bc-detail')
})

it('renders no detail line when the prop is absent', () => {
  render(<ProgressLine label="Loading the replay" fraction={null} />)

  expect(screen.getByText('Loading the replay')).toBeInTheDocument()
  expect(screen.queryByText(/·/)).not.toBeInTheDocument()
})
