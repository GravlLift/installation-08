import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, expect, it, vi } from 'vitest'
import { testReplayDoc } from '../features/match-replay/test/testDoc'
import { ReplayViewer } from './MatchViewScreen'

vi.mock('../features/match-replay/ui/Replay3DView', () => ({ Replay3DView: () => <div>3D view</div> }))
vi.mock('./useVariantLayer', () => ({ useVariantLayer: () => null, useVariantSource: () => ({ path: null, pending: false }) }))
vi.mock('./useMatchReplayContext', () => ({ useMatchReplayContext: () => ({ kills: [], medals: [], context: null, playWindow: null, timeLimitMs: null }) }))
vi.mock('./useMatchSummary', () => ({ useMatchSummary: () => null, useRemoteMatch: () => null }))
vi.mock('../features/match-replay/sound/useReplaySound', () => ({ useReplaySound: () => ({ available: false, setTransportPlaying: vi.fn(), seek: vi.fn(), wake: vi.fn(), intro: vi.fn() }) }))

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})

it('uses a full-window viewer and requests fullscreen on that container', () => {
  render(<ReplayViewer matchId="test" doc={testReplayDoc()} onBack={vi.fn()} />)
  const viewer = screen.getByTestId('replay-viewer')
  expect(screen.getByTestId('replay-view')).toBeInTheDocument()
  const requestFullscreen = vi.fn().mockResolvedValue(undefined)
  viewer.requestFullscreen = requestFullscreen
  fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }))
  expect(requestFullscreen).toHaveBeenCalledOnce()
  // Windowed, the strip and the bar sit outside the scene; fullscreen lays them over it.
  expect(viewer).not.toHaveClass('bc-player-full')
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: viewer })
  fireEvent(document, new Event('fullscreenchange'))
  expect(viewer).toHaveClass('bc-player-full')
  const exitFullscreen = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen })
  fireEvent.click(screen.getByRole('button', { name: 'Exit fullscreen' }))
  expect(exitFullscreen).toHaveBeenCalledOnce()
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
  fireEvent(document, new Event('fullscreenchange'))
  expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeInTheDocument()
})
