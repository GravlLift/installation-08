/**
 * MeshBuildGate.test.tsx — the in-viewer mesh build gate: in the `absent` phase it shows the
 * message line (`.bc-step`) and the "Build map" button together; while building it fills the
 * bar to the server's real fraction and names the stage (sweeping only before any progress has
 * arrived). This is a DOM-level check: jsdom does no layout, so the gate-scoped CSS that keeps
 * the message clear of the button (`.bc-gate .bc-progress` in broadcast.css) is not asserted
 * here, only that the message and the button both render and that the gate carries the
 * `bc-gate` class that scopes the CSS.
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

// The `outdated` build line, exactly what buildLineOf returns for that phase: the map is on
// disk in an older build format, so the gate offers an update, not a first build.
const outdatedLine = {
  text: 'This map was built by an older version. Update it to get the new textures.',
  action: 'build' as const,
  actionLabel: 'Update map',
}

it('renders the message and the build button for the absent phase', () => {
  render(<MeshBuildGate line={absentLine} build={vi.fn()} cancel={vi.fn()} cancelling={false} />)

  const gate = screen.getByTestId('mesh-build-gate')
  expect(gate).toHaveClass('bc-gate')
  expect(screen.getByText('This map has not been built yet. A first build takes minutes.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Build map' })).toBeInTheDocument()
})

it('offers the update, not a first build, for the outdated phase', () => {
  render(<MeshBuildGate line={outdatedLine} build={vi.fn()} cancel={vi.fn()} cancelling={false} />)

  expect(screen.getByText('This map was built by an older version. Update it to get the new textures.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Update map' })).toBeInTheDocument()
  expect(screen.queryByText('This map has not been built yet. A first build takes minutes.')).not.toBeInTheDocument()
})

// A building line with the server's real fraction: the bar fills to it (no sweep).
const buildingLine = {
  text: 'Compressing textures… 47 % — about 3:00 left',
  action: 'cancel' as const,
  actionLabel: 'Cancel',
  fraction: 0.47,
}

// A building line before any progress has arrived (queued long enough to start, or an old
// server): the bar sweeps.
const buildingLineNoProgress = {
  text: 'Building… 12s elapsed',
  action: 'cancel' as const,
  actionLabel: 'Cancel',
  fraction: null,
}

it('fills the bar to the real fraction and shows the stage line while building', () => {
  render(<MeshBuildGate line={buildingLine} build={vi.fn()} cancel={vi.fn()} cancelling={false} />)

  const gate = screen.getByTestId('mesh-build-gate')
  expect(gate).toHaveClass('bc-gate')
  expect(screen.getByText('Compressing textures… 47 % — about 3:00 left')).toBeInTheDocument()
  const fill = gate.querySelector('.bc-bar i')
  expect(fill).toHaveStyle({ width: '47%' })
  expect(fill?.classList.contains('indeterminate')).toBe(false)
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
})

it('sweeps the bar only while no progress has arrived', () => {
  render(<MeshBuildGate line={buildingLineNoProgress} build={vi.fn()} cancel={vi.fn()} cancelling={false} />)

  const gate = screen.getByTestId('mesh-build-gate')
  const fill = gate.querySelector('.bc-bar i')
  expect(fill?.classList.contains('indeterminate')).toBe(true)
})
