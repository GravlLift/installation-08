// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useAutoExport.test.tsx — THE DRIVEN RUN, end to end, with no page: the URL asks, the run
 * renders, the clip goes up.
 *
 * WHAT THEY PROTECT. The contract the driving tool relies on: the run happens ONCE, with the
 * options the URL chose (and the defaults where it did not); the clip is uploaded, not held
 * for a click; a refusal is said, not swallowed. The `ReplayExport` is a FAKE — its phases
 * are the ones the real one reports (`useReplayExport`'s contract), and the script's fetch
 * and the upload are mocked at the API boundary.
 */
import type { ReactElement } from 'react'
import { renderHook, act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAutoExport, type AutoExportInputs } from './useAutoExport'
import type { ReplayExport, ReplayExportState } from './useReplayExport'
import type { ExportBounds } from './replayExportPlan'
import type { ExportRunOptions } from './useReplayExport'
import type { Replay3DExportEntry } from './replay3dExportStore'
import type { CameraScript } from '../scene3d/cameraScript3d'

const api = vi.hoisted(() => ({
  fetchCameraScript: vi.fn<(matchId: string, name: string) => Promise<CameraScript>>(),
  uploadExport: vi.fn<(matchId: string, name: string, blob: Blob) => Promise<{ name: string; path: string; bytes: number }>>(),
}))

vi.mock('../camera-script/cameraScriptApi', () => api)

/** A script whose only job in these tests is to be fetched and to arrive. */
const SCRIPT = { matchId: 'm-1', name: 'demo-5', keys: [] } as unknown as CameraScript

/** The 3D scene the screen registers: any entry, non-null, is "ready". */
const SCENE = { source: {}, live: true, camera: 'free', pov: null } as unknown as Replay3DExportEntry

/** The idle state a fresh export reports. */
function idle(): ReplayExportState {
  return { phase: 'idle', done: 0, total: 0, pct: 0 }
}

/**
 * THE FAKE EXPORT: the real one's surface, with the phases the test sets. `set` changes the
 * state and the test re-renders, which is how the real one would be seen changing (a state
 * change re-renders the screen, and the screen re-renders the hook).
 */
function fakeExport() {
  const box: { current: ReplayExportState } = { current: idle() }
  const run = vi.fn<(bounds: ExportBounds, options?: ExportRunOptions) => Promise<void>>(async () => {})
  const discardDone = vi.fn()
  const re: ReplayExport = {
    supported: true,
    get state() {
      return box.current
    },
    defaultBounds: () => ({ startFrame: 0, endFrame: 1000 }),
    run,
    saveDone: vi.fn(),
    discardDone,
    zoomLevel: 1,
    cancel: vi.fn(),
    clockOf: () => '0m00s',
    lengthClock: () => '0m00s',
  }
  return { export: re, run, discardDone, set: (state: ReplayExportState) => { box.current = state } }
}

function inputs(matchId: string, videoExport: ReplayExport | null, exportScene: Replay3DExportEntry | null): AutoExportInputs {
  return { matchId, videoExport, exportScene }
}

describe('useAutoExport — the run', () => {
  beforeEach(() => {
    window.location.hash = ''
    api.fetchCameraScript.mockReset()
    api.uploadExport.mockReset()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    window.location.hash = ''
  })

  it('waits for the scene, fetches the script, and runs once with the URL\'s options', async () => {
    window.location.hash = '#/matches/m-1?autoexport=demo-5'
    api.fetchCameraScript.mockResolvedValue(SCRIPT)
    const fake = fakeExport()
    const { result, rerender } = renderHook((o) => useAutoExport(o), {
      initialProps: inputs('m-1', fake.export, null),
    })
    // THE SCENE IS NOT THERE YET: nothing runs, and the pill says the run is waiting.
    expect(fake.run).not.toHaveBeenCalled()
    expect(result.current.state?.status).toBe('waiting')
    expect(result.current.pill).not.toBeNull()

    // THE SCENE APPEARS: the run starts, once.
    rerender(inputs('m-1', fake.export, SCENE))
    await waitFor(() => expect(fake.run).toHaveBeenCalledTimes(1))
    expect(api.fetchCameraScript).toHaveBeenCalledTimes(1)
    expect(api.fetchCameraScript).toHaveBeenCalledWith('m-1', 'demo-5')

    // THE OPTIONS ARE THE DIALOG'S, exactly: the script decides the range, so the bounds are
    // the default ones; the rest comes from the URL (here: all the defaults).
    const [bounds, options] = fake.run.mock.calls[0]
    expect(bounds).toEqual({ startFrame: 0, endFrame: 1000 })
    expect(options).toEqual({
      sound: true,
      format: '1080p',
      view3d: { camera: 'free', pov: null, minimap: false },
      clean: true,
      script: SCRIPT,
    })

    // RERENDERING AGAIN CHANGES NOTHING: the run is a once-a-page-load thing.
    rerender(inputs('m-1', fake.export, SCENE))
    expect(fake.run).toHaveBeenCalledTimes(1)
  })

  it('the URL\'s parameters reach the run: 720p, no clean, no sound', async () => {
    window.location.hash = '#/matches/m-1?autoexport=demo-5&format=720p&clean=0&sound=0'
    api.fetchCameraScript.mockResolvedValue(SCRIPT)
    const fake = fakeExport()
    const { rerender } = renderHook((o) => useAutoExport(o), {
      initialProps: inputs('m-1', fake.export, SCENE),
    })
    await waitFor(() => expect(fake.run).toHaveBeenCalledTimes(1))
    const options = fake.run.mock.calls[0][1]
    expect(options?.format).toBe('720p')
    expect(options?.clean).toBe(false)
    expect(options?.sound).toBe(false)
    // The upload's name defaults to the script's name; the parameters do not leak into the run.
    void rerender
  })

  it('done: the clip is uploaded under the URL\'s out, and released', async () => {
    window.location.hash = '#/matches/m-1?autoexport=demo-5&out=clip-1'
    api.fetchCameraScript.mockResolvedValue(SCRIPT)
    api.uploadExport.mockResolvedValue({ name: 'clip-1', path: 'exports/m-1/clip-1.mp4', bytes: 481 })
    const fake = fakeExport()
    const { result, rerender } = renderHook((o) => useAutoExport(o), {
      initialProps: inputs('m-1', fake.export, SCENE),
    })
    await waitFor(() => expect(fake.run).toHaveBeenCalledTimes(1))

    const blob = new Blob(['mp4'])
    act(() => {
      fake.set({ phase: 'done', done: 481, total: 481, pct: 100, filename: 'clip.mp4', save: { blob, save: vi.fn(), release: vi.fn() } })
    })
    rerender(inputs('m-1', fake.export, SCENE))

    await waitFor(() => expect(api.uploadExport).toHaveBeenCalledTimes(1))
    expect(api.uploadExport).toHaveBeenCalledWith('m-1', 'clip-1', blob)
    expect(fake.discardDone).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(result.current.state).toEqual({ status: 'done', path: 'exports/m-1/clip-1.mp4' }))
    // THE PILL SAYS IT TOO, the way a driver reads it.
    const pill = result.current.pill as ReactElement<{ 'data-autoexport-state': string; children: string }>
    expect(pill.props['data-autoexport-state']).toBe('done')
  })

  it('the rendering progress is said, with its counts', async () => {
    window.location.hash = '#/matches/m-1?autoexport=demo-5'
    api.fetchCameraScript.mockResolvedValue(SCRIPT)
    const fake = fakeExport()
    const { result, rerender } = renderHook((o) => useAutoExport(o), {
      initialProps: inputs('m-1', fake.export, SCENE),
    })
    await waitFor(() => expect(fake.run).toHaveBeenCalledTimes(1))

    act(() => {
      fake.set({ phase: 'encode', done: 120, total: 481, pct: 25 })
    })
    rerender(inputs('m-1', fake.export, SCENE))

    await waitFor(() => expect(result.current.state).toEqual({ status: 'rendering', done: 120, total: 481 }))
    const pill = result.current.pill as ReactElement<{ 'data-autoexport-state': string; children: string }>
    expect(pill.props['data-autoexport-state']).toBe('rendering')
    expect(pill.props.children).toBe('Auto export demo-5: rendering 120/481')
    expect(document.title).toBe('Auto export demo-5: rendering 120/481')
  })

  it('an upload failure fails the run with the upload\'s reason, and releases the clip', async () => {
    window.location.hash = '#/matches/m-1?autoexport=demo-5'
    api.fetchCameraScript.mockResolvedValue(SCRIPT)
    api.uploadExport.mockRejectedValue(new Error('PUT .../exports/demo-5: HTTP 413 (clip too large)'))
    const fake = fakeExport()
    const { result, rerender } = renderHook((o) => useAutoExport(o), {
      initialProps: inputs('m-1', fake.export, SCENE),
    })
    await waitFor(() => expect(fake.run).toHaveBeenCalledTimes(1))

    const blob = new Blob(['mp4'])
    act(() => {
      fake.set({ phase: 'done', done: 10, total: 10, pct: 100, save: { blob, save: vi.fn(), release: vi.fn() } })
    })
    rerender(inputs('m-1', fake.export, SCENE))

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: 'failed', reason: 'PUT .../exports/demo-5: HTTP 413 (clip too large)' }),
    )
    expect(fake.discardDone).toHaveBeenCalledTimes(1)
  })

  it('a failed export fails the run with the run\'s own message', async () => {
    window.location.hash = '#/matches/m-1?autoexport=demo-5'
    api.fetchCameraScript.mockResolvedValue(SCRIPT)
    const fake = fakeExport()
    const { result, rerender } = renderHook((o) => useAutoExport(o), {
      initialProps: inputs('m-1', fake.export, SCENE),
    })
    await waitFor(() => expect(fake.run).toHaveBeenCalledTimes(1))

    act(() => {
      fake.set({ phase: 'failed', done: 3, total: 481, pct: 0, message: 'the encoder refused the frame' })
    })
    rerender(inputs('m-1', fake.export, SCENE))

    await waitFor(() => expect(result.current.state).toEqual({ status: 'failed', reason: 'the encoder refused the frame' }))
    expect(api.uploadExport).not.toHaveBeenCalled()
  })

  it('a script the server does not have fails the run with the fetch\'s reason', async () => {
    window.location.hash = '#/matches/m-1?autoexport=missing'
    api.fetchCameraScript.mockRejectedValue(new Error('GET .../camera-scripts/missing: HTTP 404'))
    const fake = fakeExport()
    const { result } = renderHook((o) => useAutoExport(o), {
      initialProps: inputs('m-1', fake.export, SCENE),
    })
    await waitFor(() => expect(result.current.state).toEqual({ status: 'failed', reason: 'GET .../camera-scripts/missing: HTTP 404' }))
    expect(fake.run).not.toHaveBeenCalled()
  })
})

describe('useAutoExport — the refusals', () => {
  beforeEach(() => {
    window.location.hash = ''
    api.fetchCameraScript.mockReset()
    api.uploadExport.mockReset()
  })

  afterEach(() => {
    window.location.hash = ''
  })

  it('an invalid parameter fails at once, with its stated reason — and nothing runs', async () => {
    window.location.hash = '#/matches/m-1?autoexport=demo-5&format=4k'
    const fake = fakeExport()
    const { result } = renderHook((o) => useAutoExport(o), {
      initialProps: inputs('m-1', fake.export, SCENE),
    })
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: 'failed', reason: "format '4k' is not a known export format (1080p, 720p)" }),
    )
    expect(api.fetchCameraScript).not.toHaveBeenCalled()
    expect(fake.run).not.toHaveBeenCalled()
  })

  it('a URL without a request runs nothing and says nothing', () => {
    window.location.hash = '#/matches/m-1'
    const fake = fakeExport()
    const { result } = renderHook((o) => useAutoExport(o), {
      initialProps: inputs('m-1', fake.export, SCENE),
    })
    expect(result.current.state).toBeNull()
    expect(result.current.pill).toBeNull()
    expect(fake.run).not.toHaveBeenCalled()
    expect(api.fetchCameraScript).not.toHaveBeenCalled()
  })
})
