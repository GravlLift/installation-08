import { renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { useReplayShortcuts, type ReplayShortcutHandlers } from './useReplayShortcuts'

function handlers(overrides: Partial<ReplayShortcutHandlers> = {}): ReplayShortcutHandlers {
  return {
    togglePlay: vi.fn(),
    seekBy: vi.fn(),
    stepFrames: vi.fn(),
    restart: vi.fn(),
    toggleSound: vi.fn(),
    toggleFullscreen: vi.fn(),
    skipSeconds: 10,
    enabled: true,
    ...overrides,
  }
}

function press(key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  window.dispatchEvent(event)
  return event
}

it('chooses the camera mode with 1, 2 and 3, in the order of the control bar', () => {
  const setCameraMode = vi.fn()
  const { unmount } = renderHook(() => useReplayShortcuts(handlers({ setCameraMode })))
  press('1')
  press('2')
  press('3')
  expect(setCameraMode.mock.calls).toEqual([['fp'], ['tp'], ['free']])
  unmount()
})

it('leaves the camera keys to the browser when the page has no camera choice (2D)', () => {
  const { unmount } = renderHook(() => useReplayShortcuts(handlers()))
  expect(press('1').defaultPrevented).toBe(false)
  unmount()
})
