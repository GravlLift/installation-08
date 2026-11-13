import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { testReplayDoc } from '../features/match-replay/test/testDoc'
import type { ReplaySound } from '../features/match-replay/sound/useReplaySound'
import { PlaybackBar } from './MatchViewScreen'
import { isTypingTarget } from '../features/match-replay/hooks/useReplayShortcuts'

it('renders sound controls in the transport and keeps volume arrows native', () => {
  const toggle = vi.fn()
  const sound = { available: true, on: false, volume: 0.7, mutedBySpeed: false, toggle } as unknown as ReplaySound
  render(<PlaybackBar doc={testReplayDoc()} frameRef={{ current: 0 }} frame={0} setFrame={vi.fn()} playing={false} setPlaying={vi.fn()} speed={1} setSpeed={vi.fn()} viewpoint={null} setViewpoint={vi.fn()} sound={sound} />)
  fireEvent.click(screen.getByRole('button', { name: 'Sound' }))
  expect(toggle).toHaveBeenCalledOnce()
  const volume = screen.getByRole('slider', { name: 'Sound volume' })
  expect(volume).toBeDisabled()
  expect(isTypingTarget(volume)).toBe(true)
})
