// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * ReplayExportDialog.test.tsx — THE TWO BOUNDS, THE SOUND CHECKBOX, AND WHAT HAPPENS DURING.
 *
 * What this locks in is what a user can BREAK: crossing the two sliders, launching a muted
 * export while believing they asked for sound, or losing the "Cancel" button in the middle of
 * a computation that takes several minutes.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { registerReplay3DExport } from './replay3dExportStore'
import { ReplayExportDialog } from './ReplayExportDialog'
import type { ReplayExport } from './useReplayExport'
import { EXPORT_FORMAT_KEY } from '../settings/replayPreferences'

function makeExport(over: Partial<ReplayExport> = {}): ReplayExport {
  return {
    supported: true,
    state: { phase: 'idle', done: 0, total: 0, pct: 0 },
    defaultBounds: () => ({ startFrame: 0, endFrame: 100 }),
    run: vi.fn(async () => {}),
    saveDone: vi.fn(),
    discardDone: vi.fn(),
    cancel: vi.fn(),
    clockOf: (f) => `frame:${f}`,
    lengthClock: (b) => `${b.startFrame}-${b.endFrame}`,
    zoomLevel: 1,
    ...over,
  }
}

function setup(over: Partial<ReplayExport> = {}) {
  const exporter = makeExport(over)
  const onClose = vi.fn()
  render(<ReplayExportDialog exporter={exporter} locale="en" onClose={onClose} />)
  return { exporter, onClose }
}

describe('ReplayExportDialog — at rest', () => {
  it('proposes the whole range by default', () => {
    setup()
    const start = screen.getByLabelText('Start') as HTMLInputElement
    const end = screen.getByLabelText('End') as HTMLInputElement
    expect(start.value).toBe('0')
    expect(end.value).toBe('100')
  })

  it('launches the export with the bounds and sound, included BY DEFAULT', async () => {
    const user = userEvent.setup()
    const { exporter } = setup()
    await user.click(screen.getByRole('button', { name: 'Export' }))
    expect(exporter.run).toHaveBeenCalledWith({ startFrame: 0, endFrame: 100 }, { sound: true, format: '1080p', framing: 'whole', view3d: null })
  })

  it('exports muted when the checkbox is unchecked', async () => {
    const user = userEvent.setup()
    const { exporter } = setup()
    await user.click(screen.getByLabelText('Include sound'))
    await user.click(screen.getByRole('button', { name: 'Export' }))
    expect(exporter.run).toHaveBeenCalledWith(expect.anything(), { sound: false, format: '1080p', framing: 'whole', view3d: null })
  })

  it('PREVENTS the two bounds from crossing', () => {
    setup()
    const start = screen.getByLabelText('Start') as HTMLInputElement
    const end = screen.getByLabelText('End') as HTMLInputElement
    // Dragging the start past the end does not produce an empty interval: it is bounded.
    fireChange(start, '80')
    fireChange(end, '40')
    expect(Number(start.value)).toBeLessThanOrEqual(Number(end.value))
  })

  it('closes on "Close", without launching anything', async () => {
    const user = userEvent.setup()
    const { exporter, onClose } = setup()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
    expect(exporter.run).not.toHaveBeenCalled()
  })
})

describe('ReplayExportDialog — the file format', () => {
  afterEach(() => {
    window.localStorage.removeItem(EXPORT_FORMAT_KEY)
  })

  it('offers 1080p and 720p with their dimensions, 1080p checked by default', () => {
    setup()
    expect(screen.getByRole('radiogroup', { name: 'Format' })).toBeInTheDocument()
    expect((screen.getByLabelText('1080p (1920 × 1080)') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('720p (1280 × 720)') as HTMLInputElement).checked).toBe(false)
  })

  it('exports at the chosen format, and REMEMBERS it for the next dialog', async () => {
    const user = userEvent.setup()
    const { exporter } = setup()
    await user.click(screen.getByLabelText('720p (1280 × 720)'))
    await user.click(screen.getByRole('button', { name: 'Export' }))
    expect(exporter.run).toHaveBeenCalledWith(expect.anything(), { sound: true, format: '720p', framing: 'whole', view3d: null })
    expect(window.localStorage.getItem(EXPORT_FORMAT_KEY)).toBe('720p')
    // A NEW dialog (page reloaded, other match) starts from the remembered choice.
    cleanup()
    const second = setup()
    expect((screen.getByLabelText('720p (1280 × 720)') as HTMLInputElement).checked).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Export' }))
    expect(second.exporter.run).toHaveBeenCalledWith(expect.anything(), { sound: true, format: '720p', framing: 'whole', view3d: null })
  })

  it('a remembered value outside the catalog falls back to 1080p', () => {
    window.localStorage.setItem(EXPORT_FORMAT_KEY, '4k')
    setup()
    expect((screen.getByLabelText('1080p (1920 × 1080)') as HTMLInputElement).checked).toBe(true)
  })

  it('does not change during the computation: the choice is no longer rendered', () => {
    setup({ state: { phase: 'encode', done: 1, total: 10, pct: 10 } })
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
  })
})

describe('ReplayExportDialog — the framing (D6)', () => {
  it('is NOT offered on a map at 1x', () => {
    setup({ zoomLevel: 1 })
    expect(screen.queryByRole('radiogroup', { name: 'Framing' })).not.toBeInTheDocument()
  })

  it('zoomed in: offers the whole map, checked by default, and the current framing with its level', async () => {
    const user = userEvent.setup()
    const { exporter } = setup({ zoomLevel: 1.5 })
    expect(screen.getByRole('radiogroup', { name: 'Framing' })).toBeInTheDocument()
    expect((screen.getByLabelText('Whole map') as HTMLInputElement).checked).toBe(true)
    expect(screen.getByLabelText('Current view (1.5x)')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Export' }))
    expect(exporter.run).toHaveBeenCalledWith(expect.anything(), { sound: true, format: '1080p', framing: 'whole', view3d: null })
  })

  it('exports at the current framing when chosen, without remembering anything', async () => {
    const user = userEvent.setup()
    const keys = () => Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i)).sort()
    const before = keys()
    const { exporter } = setup({ zoomLevel: 2 })
    await user.click(screen.getByLabelText('Current view (2x)'))
    await user.click(screen.getByRole('button', { name: 'Export' }))
    expect(exporter.run).toHaveBeenCalledWith(expect.anything(), { sound: true, format: '1080p', framing: 'current', view3d: null })
    // NOT REMEMBERED: no new key, and a new dialog starts from the whole map again.
    expect(keys()).toEqual(before)
    cleanup()
    setup({ zoomLevel: 2 })
    expect((screen.getByLabelText('Whole map') as HTMLInputElement).checked).toBe(true)
  })
})

describe('ReplayExportDialog — during the computation', () => {
  const running = { phase: 'encode', done: 300, total: 1200, pct: 25 } as const

  it('shows the progress in words, and the bar', () => {
    setup({ state: running })
    expect(screen.getByText('Frame 300 / 1200')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
  })

  it('offers ONLY cancellation', () => {
    setup({ state: running })
    // Relaunching an export during an export, or closing the dialog while leaving the
    // computation running without a word about it: both are withdrawn.
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('cancels on click', async () => {
    const user = userEvent.setup()
    const { exporter } = setup({ state: running })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(exporter.cancel).toHaveBeenCalled()
  })
})

describe('ReplayExportDialog — the 3D view', () => {
  let release: (() => void) | null = null
  afterEach(() => {
    release?.()
    release = null
  })

  function load3d(live: boolean) {
    const source = {
      players: [
        { xuid: 'x1', name: 'Alpha' },
        { xuid: 'x2', name: 'Bravo' },
      ],
      beginExport: vi.fn(),
      exportFrame: vi.fn(),
      exportTags: vi.fn(() => []),
      exportPendingLoads: () => null,
      endExport: vi.fn(),
    }
    release = registerReplay3DExport({ source, live, camera: 'tp', pov: 'x1' })
  }

  it('exports only the available 3D view without offering a blank minimap', async () => {
    load3d(true)
    const exporter = makeExport()
    render(<ReplayExportDialog exporter={exporter} locale="en" onClose={vi.fn()} threeDOnly />)
    expect(screen.queryByLabelText('2D map')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('2D minimap in a corner')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Export$/ }))
    expect(exporter.run).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      view3d: { camera: 'tp', pov: 'x1', minimap: false },
    }))
  })

  it('offers nothing without a loaded 3D map', () => {
    setup()
    expect(screen.queryByRole('radiogroup', { name: 'View' })).not.toBeInTheDocument()
  })

  it('3D on screen: offers it by default, with the camera and the player from the screen', async () => {
    const user = userEvent.setup()
    load3d(true)
    const { exporter } = setup()
    expect((screen.getByLabelText('3D view') as HTMLInputElement).checked).toBe(true)
    await user.selectOptions(screen.getByRole('combobox'), 'x2')
    await user.click(screen.getByLabelText('Free view, fixed'))
    await user.click(screen.getByLabelText('2D mini-map in a corner'))
    await user.click(screen.getByRole('button', { name: 'Export' }))
    expect(exporter.run).toHaveBeenCalledWith(expect.anything(), {
      sound: true,
      format: '1080p',
      framing: 'whole',
      view3d: { camera: 'free', pov: 'x2', minimap: false },
    })
  })

  it('3D loaded but off: 2D by default, and the framing stays the 2D one', async () => {
    const user = userEvent.setup()
    load3d(false)
    setup({ zoomLevel: 2 })
    expect((screen.getByLabelText('2D map') as HTMLInputElement).checked).toBe(true)
    expect(screen.getByRole('radiogroup', { name: 'Framing' })).toBeInTheDocument()
    await user.click(screen.getByLabelText('3D view'))
    expect(screen.queryByRole('radiogroup', { name: 'Framing' })).not.toBeInTheDocument()
  })
})

/** An `<input type="range">` cannot be driven by keyboard in jsdom: we set the value directly. */
function fireChange(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('ReplayExportDialog — the computation phases', () => {
  it('while PREPARING, says what is happening instead of counting frames', () => {
    setup({ state: { phase: 'prepare', done: 0, total: 1200, pct: 0 } })
    // This is the phase that used to show "Frame 0 / 1200" without moving for several seconds.
    expect(screen.getByText('Preparing sound and frames…')).toBeInTheDocument()
    expect(screen.queryByText(/Frame 0/)).not.toBeInTheDocument()
    // INDETERMINATE bar: nothing is encoded yet, no percentage is true.
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow')
  })

  it('while the sound MIXES, the bar moves and says which step runs', () => {
    setup({ state: { phase: 'prepare', done: 0, total: 1200, pct: 0, prepareStep: { stage: 'mix', pct: 42 } } })
    expect(screen.getByText('Mixing sound… 42 %')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
  })

  it('then while its tracks ENCODE', () => {
    setup({ state: { phase: 'prepare', done: 0, total: 1200, pct: 0, prepareStep: { stage: 'audio', pct: 50 } } })
    expect(screen.getByText('Encoding sound… 50 %')).toBeInTheDocument()
    expect(screen.queryByText(/Frame 0/)).not.toBeInTheDocument()
  })

  it('while ENCODING, counts the frames AND announces the remaining time', () => {
    setup({ state: { phase: 'encode', done: 300, total: 1200, pct: 25, etaMs: 80_000 } })
    expect(screen.getByText('Frame 300 / 1200')).toBeInTheDocument()
    expect(screen.getByText(/about 1:20 remaining/)).toBeInTheDocument()
  })

  it('does NOT show an estimate that says nothing', () => {
    // "about 0:00 remaining" reads as "it's done" while the computation is still running.
    setup({ state: { phase: 'encode', done: 300, total: 1200, pct: 25, etaMs: 900 } })
    expect(screen.queryByText(/remaining/)).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
  })

  it('without a reliable estimate, does not invent one', () => {
    setup({ state: { phase: 'encode', done: 3, total: 1200, pct: 0.25 } })
    expect(screen.queryByText(/remaining/)).not.toBeInTheDocument()
  })

  it('warns of the field scrolling DURING the computation, not before', () => {
    setup({ state: { phase: 'encode', done: 300, total: 1200, pct: 25 } })
    // The key is `exportRunningHint`, and it used to show in the form instead.
    expect(screen.getByText(/The field scrolls inside the video frame while it computes/)).toBeInTheDocument()
  })

  it('at the END, names the ready file and renders the "Save video" button', () => {
    setup({ state: { phase: 'done', done: 10, total: 10, pct: 100, filename: 'replay-m-0m00s-5m00s.mp4' } })
    expect(screen.getByText('File ready: replay-m-0m00s-5m00s.mp4')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save video' })).toBeInTheDocument()
  })

  it('clicking "Save video" starts the download', async () => {
    const user = userEvent.setup()
    const { exporter } = setup({ state: { phase: 'done', done: 10, total: 10, pct: 100, filename: 'replay-m-0m00s-5m00s.mp4' } })
    await user.click(screen.getByRole('button', { name: 'Save video' }))
    expect(exporter.saveDone).toHaveBeenCalled()
  })

  it('closing WITHOUT saving releases the clip: `discardDone` is called', async () => {
    const user = userEvent.setup()
    const { exporter, onClose } = setup({ state: { phase: 'done', done: 10, total: 10, pct: 100, filename: 'replay-m-0m00s-5m00s.mp4' } })
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(exporter.discardDone).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('saving does NOT close: the state stays `done`, and the button is still there', async () => {
    const user = userEvent.setup()
    const { onClose } = setup({ state: { phase: 'done', done: 10, total: 10, pct: 100, filename: 'replay-m-0m00s-5m00s.mp4' } })
    await user.click(screen.getByRole('button', { name: 'Save video' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save video' })).toBeInTheDocument()
  })
})
