import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ReplayTransport } from './ReplayTransport'
import { testReplayDoc } from '../test/testDoc'
import type { ReplaySound } from '../sound/useReplaySound'

it('exposes playback, seeking, speed, and autoplay controls', () => {
  const toggle = vi.fn(), seek = vi.fn(), restart = vi.fn(), setSpeed = vi.fn(), toggleAutoPlay = vi.fn()
  render(<ReplayTransport doc={testReplayDoc()} frame={0} playing={false} onTogglePlay={toggle} onSeekBy={seek} onRestart={restart} onScrub={vi.fn()} speed={1} onSetSpeed={setSpeed} autoPlay={false} onToggleAutoPlay={toggleAutoPlay} sound={{ available: false } as ReplaySound} />)
  fireEvent.click(screen.getByRole('button', { name: 'Play' }))
  fireEvent.click(screen.getByRole('button', { name: /Back 10 s/ }))
  fireEvent.click(screen.getByRole('button', { name: /Forward 10 s/ }))
  fireEvent.click(screen.getByRole('button', { name: /Restart/ }))
  fireEvent.click(screen.getByRole('switch', { name: 'Auto-play' }))
  fireEvent.click(screen.getByRole('button', { name: 'Speed' }))
  fireEvent.click(screen.getByRole('button', { name: '2×' }))
  expect(toggle).toHaveBeenCalledOnce()
  expect(seek.mock.calls).toEqual([[-10], [10]])
  expect(restart).toHaveBeenCalledOnce()
  expect(toggleAutoPlay).toHaveBeenCalledOnce()
  expect(setSpeed).toHaveBeenCalledWith(2)
})
