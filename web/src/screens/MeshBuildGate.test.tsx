/**
 * MeshBuildGate.test.tsx — the in-viewer mesh build gate, in the `absent` phase, shows the
 * message line (`.bc-step`) and the "Build map" button together. This is a DOM-level check:
 * jsdom does no layout, so the gate-scoped CSS that keeps the message clear of the button
 * (`.bc-gate .bc-progress` in broadcast.css) is not asserted here, only that the message and
 * the button both render and that the gate carries the `bc-gate` class that scopes the CSS.
 */
import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { MeshBuildGate } from './MatchViewScreen'

// MatchViewScreen pulls the lifted 3D view and several live hooks; the gate renders none of
// them, so stand them in the way ReplayViewer.test.tsx does.
vi.mock('../features/match-replay/ui/Replay3DView', () => ({ Replay3DView: () => <div>3D view</div> }))
vi.mock('./useVariantLayer', () => ({ useVariantLayer: () => null, useVariantSource: () => ({ path: null, pending: false }) }))
vi.mock('./useMatchReplayContext', () => ({ useMatchReplayContext: () => ({ kills: [], medals: [], context: null, playWindow: null, timeLimitMs: null }) }))
vi.mock('./useMatchSummary', () => ({ useMatchSummary: () => null, useRemoteMatch: () => null }))
vi.mock('../features/match-replay/sound/useReplaySound', () => ({ useReplaySound: () => ({ available: false, setTransportPlaying: vi.fn(), seek: vi.fn(), wake: vi.fn(), intro: vi.fn() }) }))

// The `absent` build line, exactly what buildLineOf returns for that phase.
const absentLine = {
  text: 'This map has not been built yet. A first build takes minutes.',
  action: 'build' as const,
  actionLabel: 'Build map',
}

it('renders the message and the build button for the absent phase', () => {
  render(<MeshBuildGate line={absentLine} build={vi.fn()} cancel={vi.fn()} cancelling={false} />)

  const gate = screen.getByTestId('mesh-build-gate')
  expect(gate).toHaveClass('bc-gate')
  expect(screen.getByText('This map has not been built yet. A first build takes minutes.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Build map' })).toBeInTheDocument()
})
