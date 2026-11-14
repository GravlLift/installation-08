import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { testReplayDoc } from '../features/match-replay/test/testDoc'
import { PlayerTransport } from './PlayerTransport'
import { frameAt } from './scrubMath'
import { leadFrame, playerEvents } from './scrubMarks'
import type { ReplayKill } from '../features/match-replay/model/killFeedLogic'
import { framesPerSecond } from '../lib/replay/replayLogic'

const noop = vi.fn()
const sound = { available: false } as any

function baseProps(): Record<string, unknown> {
  return {
    doc: testReplayDoc(),
    frame: 0,
    playing: false,
    speed: 1,
    viewpoint: null,
    cameraMode: 'fp',
    onSetCameraMode: noop,
    events: [],
    onStepEvent: noop,
    sound,
    onTogglePlay: noop,
    onRestart: noop,
    onSetSpeed: noop,
    onSetViewpoint: noop,
    view: '3d',
    onSetView: noop,
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
  }
}

function renderTransport(overrides: Record<string, unknown> = {}) {
  const props = { ...baseProps(), ...overrides }
  return { doc: props.doc as ReturnType<typeof testReplayDoc>, utils: render(<PlayerTransport {...(props as any)} />) }
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

it('renders the view segments with the current one pressed', () => {
  renderTransport()
  expect(screen.getByRole('button', { name: '3D', pressed: true })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '2D', pressed: false })).toBeInTheDocument()
})

it('calls onSetView with the view of the clicked segment', () => {
  const onSetView = vi.fn()
  renderTransport({ view: '3d', onSetView })
  fireEvent.click(screen.getByRole('button', { name: '2D' }))
  expect(onSetView).toHaveBeenCalledOnce()
  expect(onSetView).toHaveBeenCalledWith('top')
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

it('groups view, camera mode and POV under one Camera label', () => {
  renderTransport()
  const group = screen.getByRole('group', { name: 'Camera' })
  expect(group.querySelector('[aria-label="View"]')).toBeTruthy()
  expect(group.querySelector('[aria-label="Camera mode"]')).toBeTruthy()
  expect(group.querySelector('.bc-pov')).toBeTruthy()
})

it('presses the current camera mode and calls onSetCameraMode with the clicked one', () => {
  const onSetCameraMode = vi.fn()
  renderTransport({ cameraMode: 'tp', onSetCameraMode })
  expect(screen.getByRole('button', { name: '3rd person', pressed: true })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Free view' }))
  expect(onSetCameraMode).toHaveBeenCalledWith('free')
})

it('keeps the camera mode segment in place but disabled in 2D', () => {
  renderTransport({ view: 'top' })
  for (const name of ['1st person', '3rd person', 'Free view']) {
    expect(screen.getByRole('button', { name })).toBeDisabled()
  }
  expect(screen.getByRole('combobox', { name: 'Viewpoint' })).not.toBeDisabled()
})

it('reads Free camera in the picker when no player is followed', () => {
  const { utils } = renderTransport({ viewpoint: null, cameraMode: 'free' })
  expect((utils.container.querySelector('.bc-pov') as HTMLSelectElement).value).toBe('')
})

it('carries the running export progress on the export button', () => {
  renderTransport({ exportProgress: 42.4, exportDisabled: true })
  const button = screen.getByRole('button', { name: 'Exporting 42%' })
  expect(button).not.toBeDisabled()
})
const markKills = [
  { xuid: 'A', victimXuid: 'B', victimGamertag: 'Bravo', replayMs: 20_000, weaponLabel: 'BR75', medals: [] },
  { xuid: 'B', victimXuid: 'A', victimGamertag: 'Alpha', replayMs: 40_000, weaponLabel: '', medals: [] },
] as unknown as ReplayKill[]
const markMedals = [{ ms: 20_000, xuid: 'A', name: 'Double Kill' }]
const markName = (xuid: string, fallback?: string) => fallback ?? xuid

it('seeks to the lead frame of a clicked mark without a track seek', () => {
  const onScrub = vi.fn()
  const doc = testReplayDoc()
  const events = playerEvents('A', markKills, markMedals, markName)
  renderTransport({ onScrub, events })
  const kill = screen.getByRole('button', { name: /^Kill: Bravo \(BR75\)/ })
  fireEvent.pointerDown(kill, { clientX: 5 })
  fireEvent.click(kill)
  expect(onScrub).toHaveBeenCalledOnce()
  expect(onScrub).toHaveBeenCalledWith(leadFrame(20_000, framesPerSecond(doc), doc.frameCount))
})

it("draws the selected player's kill, death and medal marks, and changes them with the viewpoint", () => {
  const { utils } = renderTransport({ events: playerEvents('A', markKills, markMedals, markName) })
  const kinds = () => [...utils.container.querySelectorAll('.bc-scrub-mark')].map((m) => m.className.match(/bc-scrub-mark-(kill|death|medal)/)?.[1]).sort()
  expect(kinds()).toEqual(['death', 'kill', 'medal'])
  expect(screen.getByRole('button', { name: /^Double Kill 0:20/ })).toBeInTheDocument()
  utils.rerender(<PlayerTransport {...({ ...baseProps(), events: playerEvents('B', markKills, markMedals, markName) } as any)} />)
  expect(kinds()).toEqual(['death', 'kill'])
  expect(screen.getByRole('button', { name: /^Kill: Alpha/ })).toBeInTheDocument()
})

it('steps to the previous and next event from the bar buttons', () => {
  const onStepEvent = vi.fn()
  renderTransport({ onStepEvent, events: playerEvents('A', markKills, markMedals, markName) })
  fireEvent.click(screen.getByRole('button', { name: 'Previous event' }))
  fireEvent.click(screen.getByRole('button', { name: 'Next event' }))
  expect(onStepEvent.mock.calls).toEqual([[-1], [1]])
})