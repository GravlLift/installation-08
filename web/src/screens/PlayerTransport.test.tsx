import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { testReplayDoc } from '../features/match-replay/test/testDoc'
import { PlayerTransport } from './PlayerTransport'
import { frameAt } from './scrubMath'

const noop = vi.fn()
const sound = { available: false } as any

function renderTransport(overrides: Record<string, unknown> = {}) {
  const doc = testReplayDoc()
  const props = {
    doc,
    frame: 0,
    playing: false,
    speed: 1,
    viewpoint: null,
    kills: [],
    colorOfXuid: () => null,
    sound,
    onTogglePlay: noop,
    onRestart: noop,
    onSetSpeed: noop,
    onSetViewpoint: noop,
    onScrub: noop,
    onSeekBy: noop,
    onToggleScoreboard: noop,
    scoreboardOn: false,
    onToggleSettings: noop,
    settingsRef: { current: null },
    onToggleExport: noop,
    exportDisabled: true,
    onToggleFullscreen: noop,
    fullscreenActive: false,
    ...overrides,
  }
  return { doc, utils: render(<PlayerTransport {...(props as any)} />) }
}

it('renders the scrub bar as a slider with the match time', () => {
  renderTransport()
  const slider = screen.getByRole('slider', { name: 'Match time' })
  expect(slider).toHaveAttribute('data-replay-timeline', '')
})

it('shows the clock and the total time', () => {
  renderTransport()
  const time = document.querySelector('.bc-time')
  expect(time).toBeTruthy()
  expect(time!.textContent).toMatch(/0:00 \/ \d+:\d\d/)
})

it('renders one speed segment per multiplier, with the current one pressed', () => {
  renderTransport()
  const segments = screen.getByRole('group', { name: 'Speed' }).querySelectorAll('button')
  expect(segments.length).toBeGreaterThan(1)
  expect(screen.getByRole('button', { name: '1×', pressed: true })).toBeInTheDocument()
})

it('renders the viewpoint picker with roster entries', () => {
  const { doc, utils } = renderTransport()
  const select = utils.container.querySelector('.bc-pov') as HTMLSelectElement
  expect(select).toBeTruthy()
  expect(select.options.length).toBe(doc.roster.length + 1) // the roster plus "Free camera"
})

it('calls onTogglePlay when the play button is clicked', () => {
  const onTogglePlay = vi.fn()
  renderTransport({ onTogglePlay })
  fireEvent.click(screen.getByRole('button', { name: 'Play' }))
  expect(onTogglePlay).toHaveBeenCalledOnce()
})

it('calls onScrub with the frame under the pointer when the scrub bar is clicked', () => {
  const onScrub = vi.fn()
  const { doc, utils } = renderTransport({ onScrub })
  const bar = utils.container.querySelector('.bc-scrub')!
  vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, width: 200, height: 18, right: 200, bottom: 18, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect)
  fireEvent.pointerDown(bar, { clientX: 100, clientY: 9 })
  expect(onScrub).toHaveBeenCalledOnce()
  expect(onScrub).toHaveBeenCalledWith(frameAt(0.5, doc.frameCount))
})

it('calls onScrub(0) on Home and onScrub(last) on End', () => {
  const onScrub = vi.fn()
  const { doc, utils } = renderTransport({ onScrub })
  const bar = utils.container.querySelector('.bc-scrub')!
  fireEvent.keyDown(bar, { key: 'Home' })
  expect(onScrub).toHaveBeenLastCalledWith(0)
  fireEvent.keyDown(bar, { key: 'End' })
  expect(onScrub).toHaveBeenLastCalledWith(doc.frameCount - 1)
})

it('calls onSetSpeed with the value of the clicked speed segment', () => {
  const onSetSpeed = vi.fn()
  renderTransport({ onSetSpeed })
  fireEvent.click(screen.getByRole('button', { name: '2×' }))
  expect(onSetSpeed).toHaveBeenCalledOnce()
  expect(onSetSpeed).toHaveBeenCalledWith(2)
})

it('calls onSeekBy(-10) for back and onSeekBy(10) for forward', () => {
  const onSeekBy = vi.fn()
  renderTransport({ onSeekBy })
  fireEvent.click(screen.getByRole('button', { name: 'Back 10 seconds' }))
  expect(onSeekBy).toHaveBeenCalledWith(-10)
  fireEvent.click(screen.getByRole('button', { name: 'Forward 10 seconds' }))
  expect(onSeekBy).toHaveBeenCalledWith(10)
})
