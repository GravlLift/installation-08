// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useReplayExport.test.tsx — THE LOOP, its two outputs, and what it hands back to the screen.
 *
 * THE ENCODER IS SIMULATED: WebCodecs does not exist under jsdom, and it is not what we test
 * here (it has its own tests, and its real proof is an MP4 opened in a player). What this
 * checks is the WIRING: playback is paused, each plan frame is pushed once, cancelling drops
 * no file, and — above all — the frame from before the export is RESTORED no matter what.
 * The last one is the kind of guarantee that breaks silently: the user would find their replay
 * at the end of the match without knowing why.
 */
import { useEffect } from 'react'
import { renderHook, act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useReplayExport, type ReplayExportOptions } from './useReplayExport'
import type { ReplayWindowBounds } from '../model/replayWindow'
import type { ExportLayout } from './exportFormats'
import { readInk } from '../layers/canvasInk'
import { canvasPixelRatio, isExportActive, isExportLayoutApplied, useExportLayout } from './exportLayoutStore'
import { testReplayDoc } from '../test/testDoc'
import { NO_ALLEGIANCE } from '@/lib/replay/filmAllegiance'
import { registerReplay3DExport } from './replay3dExportStore'

// The SIGNATURE is carried by the mock's TYPE, not by named parameters: without it,
// `mock.calls` is an empty tuple and the assertion on the frame index does not compile; with
// named but unused parameters, the linter objects instead.
const addFrame = vi.fn<(canvas: HTMLCanvasElement, index: number) => Promise<void>>(async () => {})
const finish = vi.fn(async () => new Blob(['mp4']))
const abort = vi.fn()
const addAudioTracks = vi.fn<(t: readonly { name: string; buffer: AudioBuffer }[]) => Promise<void>>(async () => {})
/** The track names DECLARED when the container opens (their order is frozen there). */
const declaredNames: string[] = []
/** The dimensions the encoder was OPENED with, per export. */
const openedDims: { width: number; height: number }[] = []
/** Does the browser accept the sound track? Driven by the test (cf. the muted fallback). */
const audioOk = { value: true }
/** The rates asked at each opening, and the rate the simulated browser grants (null: the one asked). */
const fpsAsked: { fps?: number; fallbackFps?: number }[] = []
const fpsGranted: { value: number | null } = { value: null }

vi.mock('./replayVideoEncoder', async (orig) => ({
  ...(await orig<typeof import('./replayVideoEncoder')>()),
  canExportVideo: () => true,
  openVideoExport: async (o: { width: number; height: number; fps?: number; fallbackFps?: number; audioTracks?: readonly string[] }) => {
    openedDims.push({ width: o.width, height: o.height })
    fpsAsked.push({ fps: o.fps, fallbackFps: o.fallbackFps })
    declaredNames.length = 0
    declaredNames.push(...(o.audioTracks ?? []))
    const fps = fpsGranted.value ?? o.fps ?? 30
    return { addFrame, addAudioTracks, finish, abort, audioEnabled: audioOk.value, fps, fpsFallback: fps !== (o.fps ?? 30) }
  },
}))
vi.mock('../sound/replayAudioMix', async (orig) => {
  const real = await orig<typeof import('../sound/replayAudioMix')>()
  return { ...real, mixReplayAudio: vi.fn(async () => null) }
})
const releases = vi.hoisted(() => [] as { blob: Blob; filename: string }[])

vi.mock('./replayCapture', async (orig) => {
  const real = await orig<typeof import('./replayCapture')>()
  // THE HOOK NO LONGER CALLS `triggerDownload` DIRECTLY: it calls `holdDownload`, and it is
  // the latter's `save` — carried by the user's click — that starts the download. We therefore
  // double both: `holdDownload` returns a `{save, release}`, and `save` forwards to the
  // spied `triggerDownload` (jsdom has no `URL.createObjectURL`, the real `holdDownload`
  // would throw there). Each `release` is recorded in `releases` to verify that a held clip
  // is indeed released when a new export starts.
  const triggerDownload = vi.fn()
  return {
    ...real,
    triggerDownload,
    holdDownload: vi.fn((blob: Blob, filename: string) => ({
      save: () => triggerDownload(blob, filename),
      release: () => { releases.push({ blob, filename }) },
    })),
  }
})

vi.mock('../scene3d/cameraScriptStore', async (orig) => {
  const real = await orig<typeof import('../scene3d/cameraScriptStore')>()
  return {
    ...real,
    startScript: vi.fn(),
    stopScript: vi.fn(),
    setScriptPlaybackTime: vi.fn(),
  }
})

import { triggerDownload } from './replayCapture'
import { mixReplayAudio } from '../sound/replayAudioMix'
import { setScriptPlaybackTime, startScript, stopScript } from '../scene3d/cameraScriptStore'
import type { CameraScript } from '../scene3d/cameraScript3d'

const DOC = testReplayDoc({ frameIntervalMs: 50, frameCount: 200 })

/** The layout the last render of the mount read — what `ReplayCanvas` would receive from it. */
const seenLayout: { current: ExportLayout | null } = { current: null }

/**
 * THE MOUNT WITH ITS CANVAS: the export only paints its first frame once the layout is
 * APPLIED by the React framing (`useReplayView` -> `useExportLayout`). This mount holds that
 * role, and nothing else.
 */
function useExportWithView(o: ReplayExportOptions) {
  const layout = useExportLayout()
  useEffect(() => {
    seenLayout.current = layout
  }, [layout])
  return useReplayExport(o)
}

/**
 * THE SIMULATED CANVAS: `ReplayCanvas.draw`'s sizing, identically — drawing size (the
 * screen's, or the format frame) times `canvasPixelRatio()`, rounded.
 */
function simulatedCanvas(canvas: HTMLCanvasElement, screen = { width: 320, height: 180 }) {
  return vi.fn(() => {
    const frame = seenLayout.current ?? screen
    canvas.width = Math.round(frame.width * canvasPixelRatio())
    canvas.height = Math.round(frame.height * canvasPixelRatio())
  })
}

function setup() {
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 180
  const frameRef = { current: 42 }
  const redraw = simulatedCanvas(canvas)
  const pause = vi.fn()
  const hook = renderHook(() =>
    useExportWithView({
      canvasRef: { current: canvas },
      frameRef,
      redraw,
      pause,
      doc: DOC,
      playWindow: null,
      scoreboard: [],
      allegiance: NO_ALLEGIANCE,
      outcome: null,
      // THE VIEWPOINT IS MANDATORY since 2026-09-07 (review F4): `null` = the page's player,
      // the original behavior. It is passed at all six mounts in this file, and that is the
      // point — a forgotten relay between the canvas and the export no longer compiles.
      viewpoint: null,
      titleSlug: 'halo_infinite',
      locale: 'en',
    }),
  )
  return { hook, frameRef, redraw, pause }
}

beforeEach(() => {
  addFrame.mockClear()
  finish.mockClear()
  abort.mockClear()
  addAudioTracks.mockClear()
  openedDims.length = 0
  fpsAsked.length = 0
  fpsGranted.value = null
  // jsdom has no 2D context: without this double, every frame would write "Not implemented".
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  audioOk.value = true
  vi.mocked(triggerDownload).mockClear()
  releases.length = 0
  // The mix mock is SHARED across tests: without this cleanup, `mock.calls[0]`
  // would return a previous test's call.
  vi.mocked(mixReplayAudio).mockClear()
  vi.mocked(startScript).mockClear()
  vi.mocked(stopScript).mockClear()
  vi.mocked(setScriptPlaybackTime).mockClear()
  // jsdom does not provide `document.fonts`: the loop waits for it before the first frame.
  Object.defineProperty(document, 'fonts', { value: { ready: Promise.resolve() }, writable: true })
})

/** A 2D context double: every method a no-op, `measureText` a width. Enough for the 3D composition. */
function fakeContext(): CanvasRenderingContext2D {
  return new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : () => {}),
    set: (t, k, v) => { t[k] = v; return true },
  }) as unknown as CanvasRenderingContext2D
}

/** Registers a 3D view double; `pendingOnce` makes its first frame wait for one load. */
function load3d(pendingOnce: boolean) {
  const rendered: number[] = []
  const begun: { frameMs?: number; camera?: string }[] = []
  let pending = pendingOnce
  const source = {
    players: [],
    beginExport: vi.fn((s: { frameMs: number }) => { begun.push(s) }),
    exportFrame: vi.fn((f: number) => { rendered.push(f); return document.createElement('canvas') }),
    exportTags: () => [],
    exportPendingLoads: () => {
      if (!pending) return null
      pending = false
      return Promise.resolve(false)
    },
    endExport: vi.fn(),
  }
  const release = registerReplay3DExport({ source, live: true, camera: 'tp', pov: null })
  return { rendered, begun, release }
}

describe('useReplayExport, 3D at 60 fps', () => {
  const VIEW3D = { camera: 'tp' as const, pov: null, minimap: false }

  it('opens the encoder at 60 with 30 as the fallback, and encodes one frame per 1/60 s', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext() as never)
    const { release, begun } = load3d(false)
    const { hook } = setup()
    // 10 frames at 50 ms = 500 ms of match, at 60 fps: 30 steps + the end bound.
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 10 }, { view3d: VIEW3D }))
    release()
    expect(fpsAsked).toEqual([{ fps: 60, fallbackFps: 30 }])
    expect(addFrame).toHaveBeenCalledTimes(31)
    expect(addFrame.mock.calls.map((c) => c[1])).toEqual(Array.from({ length: 31 }, (_, i) => i))
    // The scene's match clock: the document's duration of a frame.
    expect(begun[0].frameMs).toBe(50)
    expect(hook.result.current.state).toMatchObject({ phase: 'done', fps: 60, fpsFallback: false })
  })

  it('the 2D map export stays at 30, with no fallback', async () => {
    const { hook } = setup()
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 10 }))
    expect(fpsAsked).toEqual([{ fps: 30, fallbackFps: undefined }])
  })

  it('a browser refusing 60 gets a 30 fps plan, and the state SAYS so', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext() as never)
    fpsGranted.value = 30
    const { release } = load3d(false)
    const { hook } = setup()
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 10 }, { view3d: VIEW3D }))
    release()
    // The plan follows the GRANTED rate: 15 steps + the end bound, or the clip would play slow.
    expect(addFrame).toHaveBeenCalledTimes(16)
    expect(hook.result.current.state).toMatchObject({ phase: 'done', fps: 30, fpsFallback: true })
  })

  it('a frame that asked for a model waits for it and is rendered again before it is encoded', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext() as never)
    const { release, rendered } = load3d(true)
    const { hook } = setup()
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 10 }, { view3d: VIEW3D }))
    release()
    // Frame 0 twice (before and after its load), then each later frame once.
    expect(rendered.slice(0, 3)).toEqual([0, 0, rendered[2]])
    expect(rendered[2]).toBeGreaterThan(0)
    expect(rendered).toHaveLength(32)
    expect(addFrame).toHaveBeenCalledTimes(31)
  })
})

describe('useReplayExport — the camera script export', () => {
  /** A script of 500 ms, no clock: script time runs with match time. */
  const SCRIPT: CameraScript = {
    version: 1,
    matchId: 'm',
    name: 'My cut',
    keys: [
      { t: 0, pos: { at: 'world', point: [0, 0, 0] }, look: { at: 'world', point: [1, 0, 0] } },
      { t: 500, pos: { at: 'world', point: [0, 0, 0] }, look: { at: 'world', point: [1, 0, 0] } },
    ],
  }

  it('starts the script at 0, poses EACH frame at its own script time, and stops it at the end', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext() as never)
    const { release } = load3d(false)
    const { hook } = setup()
    // 500 ms of script at 60 fps: 30 steps + the exact end, the bounds ignored.
    await act(() =>
      hook.result.current.run({ startFrame: 0, endFrame: 10 }, { view3d: { camera: 'tp', pov: null, minimap: false }, script: SCRIPT }),
    )
    release()
    expect(startScript).toHaveBeenCalledTimes(1)
    expect(startScript).toHaveBeenCalledWith(SCRIPT, 0)
    expect(addFrame).toHaveBeenCalledTimes(31)
    // The camera is posed at the SAME script time the world is sampled at, frame by frame.
    const times = vi.mocked(setScriptPlaybackTime)
    expect(times).toHaveBeenCalledTimes(31)
    expect(times.mock.calls[0][0]).toBe(0)
    expect(times.mock.calls[30][0]).toBe(500)
    // The script stops after the LAST frame, not before the first one.
    const stopped = vi.mocked(stopScript)
    const started = vi.mocked(startScript)
    expect(stopped).toHaveBeenCalledTimes(1)
    expect(stopped.mock.invocationCallOrder[0]).toBeGreaterThan(started.mock.invocationCallOrder[0])
    expect(hook.result.current.state).toMatchObject({ phase: 'done', fps: 60 })
  })

  it('the script takes over the FREE camera even when the dialog picked another', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext() as never)
    const { release, begun } = load3d(false)
    const { hook } = setup()
    await act(() =>
      hook.result.current.run({ startFrame: 0, endFrame: 10 }, { view3d: { camera: 'tp', pov: null, minimap: false }, script: SCRIPT }),
    )
    release()
    expect(begun[0].camera).toBe('free')
  })

  it('a script whose clock does not run at 1x is SILENT', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext() as never)
    const clocked: CameraScript = {
      ...SCRIPT,
      clock: { startMs: 0, rates: [{ s: 0, rate: 0.5, ease: 'cut' }] },
    }
    const { release } = load3d(false)
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const hook = renderHook(() =>
      useExportWithView({
        canvasRef: { current: canvas },
        frameRef: { current: 0 },
        redraw: simulatedCanvas(canvas),
        pause: vi.fn(),
        doc: DOC,
        playWindow: null,
        scoreboard: [],
        allegiance: NO_ALLEGIANCE,
        outcome: null,
        viewpoint: null,
        titleSlug: 'halo_infinite',
        locale: 'en',
        soundTrack: () => ({ timeline: [{ ms: 0, stem: 'x' }], endMatchStems: [], variationPercent: 0, distancePercent: 0, families: { voice: [], music: [] }, engines: [] }),
        soundVolume: 1,
      }),
    )
    await act(() =>
      hook.result.current.run({ startFrame: 0, endFrame: 10 }, { view3d: { camera: 'tp', pov: null, minimap: false }, script: clocked }),
    )
    release()
    // The clip's time and the match's time no longer run together: the sound would lie.
    expect(mixReplayAudio).not.toHaveBeenCalled()
    expect(hook.result.current.state).toMatchObject({ phase: 'done' })
  })

  it('without a 3D export, the script is IGNORED', async () => {
    const { hook } = setup()
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 10 }, { script: SCRIPT }))
    expect(startScript).not.toHaveBeenCalled()
    expect(setScriptPlaybackTime).not.toHaveBeenCalled()
    expect(stopScript).not.toHaveBeenCalled()
    expect(hook.result.current.state).toMatchObject({ phase: 'done' })
  })
})

describe('useReplayExport', () => {
  it('PAUSES playback before starting', async () => {
    const { hook, pause } = setup()
    // Without this, the animation loop and the export would write over each other in `frameRef`.
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 10 }))
    expect(pause).toHaveBeenCalled()
  })

  it('pushes one frame per plan entry, then PREPARES the file — without downloading it', async () => {
    const { hook } = setup()
    // 10 frames at 50 ms = 500 ms of match, at 30 fps: 15 steps + the end bound.
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 10 }))
    expect(addFrame).toHaveBeenCalledTimes(16)
    expect(finish).toHaveBeenCalledTimes(1)
    // THE CLIP IS READY, BUT NOTHING LEAVES: minutes after the export click, a click on an
    // anchor the code dropped no longer has the gesture behind it, and Chrome blocks the
    // second unrequested file from a site. It is the "Save" button that starts the download.
    expect(triggerDownload).not.toHaveBeenCalled()
    // The `done` phase carries the NAME and the ready download: the dialog's "Save" button
    // reads them, and the click that starts the download comes from the user.
    expect(hook.result.current.state).toMatchObject({
      phase: 'done',
      filename: 'replay-m-0m00s-0m00s.mp4',
    })
    expect(hook.result.current.state.save).toBeDefined()
  })

  it('saving from the `done` phase triggers the clip download', async () => {
    const { hook } = setup()
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 10 }))
    expect(hook.result.current.state.phase).toBe('done')
    await act(() => {
      hook.result.current.saveDone()
    })
    // The click on "Save" starts the download: the file comes down, named on its bounds.
    expect(triggerDownload).toHaveBeenCalledWith(expect.any(Blob), 'replay-m-0m00s-0m00s.mp4')
  })

  it('a second export RELEASES the first clip, held without being saved', async () => {
    const { hook } = setup()
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 10 }))
    expect(hook.result.current.state.phase).toBe('done')
    // The clip is still held in memory, nobody saved or closed it: nothing was released.
    expect(releases).toHaveLength(0)
    // A NEW export starts: the previous clip must be released, or the old blob
    // would leak in memory until the tab closes.
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 10 }))
    expect(releases).toHaveLength(1)
    expect(hook.result.current.state.phase).toBe('done')
  })

  it('numbers the FILE frames continuously, starting from zero', async () => {
    const { hook } = setup()
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 10 }))
    // This index carries the timestamp: a gap in it would shift the whole clip.
    expect(addFrame.mock.calls.map((c) => c[1])).toEqual(Array.from({ length: 16 }, (_, i) => i))
  })

  it('RESTORES the frame from before the export, and repaints it', async () => {
    const { hook, frameRef, redraw } = setup()
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 10 }))
    expect(frameRef.current).toBe(42)
    expect(redraw).toHaveBeenCalled()
  })

  it('cancelled: no file delivered, and the encoder is closed', async () => {
    const { hook, frameRef } = setup()
    hook.result.current.cancel()
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 10 }))
    // `cancel` before `run` does not count: the loop resets the flag flat at the start.
    // The clip is assembled, but NOTHING LEAVES — even on this path, the download waits for a click.
    expect(triggerDownload).not.toHaveBeenCalled()
    expect(frameRef.current).toBe(42)
  })

  it('cancelled WHILE RUNNING: the file is not delivered', async () => {
    const { hook } = setup()
    addFrame.mockImplementationOnce(async () => {
      hook.result.current.cancel()
    })
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 10 }))
    expect(triggerDownload).not.toHaveBeenCalled()
    expect(abort).toHaveBeenCalledTimes(1)
    expect(finish).not.toHaveBeenCalled()
    // The on-screen layout also returns on this path too (same `finally`), gestures restored.
    expect(seenLayout.current).toBeNull()
    expect(isExportActive()).toBe(false)
    expect(isExportLayoutApplied()).toBe(true)
  })

  it('returns to the idle state once finished', async () => {
    const { hook } = setup()
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 10 }))
    await waitFor(() => expect(hook.result.current.state.phase).toBe('done'))
    // THE END is stated, with the file name: the clip goes into downloads, or
    // nothing ties it to the gesture just made.
    expect(hook.result.current.state.filename).toBe('replay-m-0m00s-0m00s.mp4')
  })

  it('tells the app window an export is running while it encodes, and done after', async () => {
    const spy = vi.fn()
    window.it3dExportBusy = spy
    try {
      const { hook } = setup()
      // Mounted idle: not running.
      expect(spy).toHaveBeenLastCalledWith(false)
      await act(() => hook.result.current.run({ startFrame: 0, endFrame: 10 }))
      // The guard saw the running phases, and the last word is "done".
      expect(spy).toHaveBeenCalledWith(true)
      expect(spy).toHaveBeenLastCalledWith(false)
    } finally {
      delete window.it3dExportBusy
    }
  })

  it('defaults to proposing the whole film when there is no framing', () => {
    const { hook } = setup()
    // Without a zoom level passed in, the map is at 1x: the dialog will not offer a framing choice.
    expect(hook.result.current.zoomLevel).toBe(1)
    expect(hook.result.current.defaultBounds()).toEqual({ startFrame: 0, endFrame: 199 })
  })
})

/**
 * THE THREE DEFECTS FOUND BY THE ADVERSARIAL REVIEW OF 2026-08-28, locked in here.
 *
 * None was covered: the first made the sound of a clip lie, the second left the user facing
 * a bar that vanished without a word, the third leaked an encoder.
 */
describe('useReplayExport — adversarial review non-regressions', () => {
  const TRACK = () => ({
    timeline: [{ ms: 100, stem: 'shot' }],
    endMatchStems: ['fanfare'],
    variationPercent: 0,
    distancePercent: 0,
    families: { voice: [], music: [] },
    engines: [],
  })
  const WINDOW = { startFrame: 0, leadInFrame: 0, endFrame: 100, startMs: 0, endMs: 5000 }

  function setupWithSound(playWindow: ReplayWindowBounds | null = WINDOW) {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const frameRef = { current: 0 }
    return renderHook(() =>
      useExportWithView({
        canvasRef: { current: canvas },
        frameRef,
        redraw: simulatedCanvas(canvas),
        pause: vi.fn(),
        doc: DOC,
        playWindow,
        scoreboard: [],
        allegiance: NO_ALLEGIANCE,
        outcome: null,
        viewpoint: null,
        titleSlug: 'halo_infinite',
        locale: 'en',
        soundTrack: TRACK,
        soundVolume: 1,
      }),
    )
  }

  it('does NOT attach the end fanfare to a mid-match clip', async () => {
    const hook = setupWithSound()
    // The range stops well before the end: a clip does not end on the announcer's voice and
    // the victory fanfare — the sound would assert a false fact.
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 40 }))
    expect(vi.mocked(mixReplayAudio).mock.calls[0]?.[2].endMatchStems).toEqual([])
  })

  it('attaches the fanfare when the range GOES to the end of the match', async () => {
    const hook = setupWithSound()
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 100 }))
    expect(vi.mocked(mixReplayAudio).mock.calls[0]?.[2].endMatchStems).toEqual(['fanfare'])
  })

  it('without a gameplay window, does NOT assume the range is the end', async () => {
    const hook = setupWithSound(null)
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 199 }))
    expect(vi.mocked(mixReplayAudio).mock.calls[0]?.[2].endMatchStems).toEqual([])
  })

  it('a failure is STATED, logged, and delivers no file', async () => {
    const hook = setupWithSound()
    const error = new Error('encoder out of service')
    addFrame.mockRejectedValueOnce(error)
    const trace = vi.spyOn(console, 'error').mockImplementation(() => {})
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 40 }))
    expect(hook.result.current.state.phase).toBe('failed')
    expect(hook.result.current.state.message).toBe('encoder out of service')
    expect(trace).toHaveBeenCalled()
    expect(triggerDownload).not.toHaveBeenCalled()
    trace.mockRestore()
  })

  it('a failure CLOSES the encoder instead of leaving it open', async () => {
    const hook = setupWithSound()
    addFrame.mockRejectedValueOnce(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 40 }))
    // Without this `abort`, the VideoEncoder and its muxer would stay in memory until the
    // tab closes.
    expect(abort).toHaveBeenCalledTimes(1)
  })
})

describe('useReplayExport — the MUTED fallback when the browser refuses the track', () => {
  it('produces a muted clip, SAYS so, and does not fail', async () => {
    // Observed in the field on 2026-08-28: `AudioEncoder` existed, the AAC configuration was
    // refused ASYNCHRONOUSLY, and the failure only surfaced at `flush()`, under the
    // misleading shape "Encoder must be configured first" — the whole export was lost.
    audioOk.value = false
    vi.mocked(mixReplayAudio).mockResolvedValueOnce({ full: { duration: 2 } as AudioBuffer, families: [] })
    const trace = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const hook = renderHook(() =>
      useExportWithView({
        canvasRef: { current: canvas },
        frameRef: { current: 0 },
        redraw: simulatedCanvas(canvas),
        pause: vi.fn(),
        doc: DOC,
        playWindow: null,
        scoreboard: [],
        allegiance: NO_ALLEGIANCE,
        outcome: null,
        viewpoint: null,
        titleSlug: 'halo_infinite',
        locale: 'en',
        soundTrack: () => ({ timeline: [{ ms: 0, stem: 'x' }], endMatchStems: [], variationPercent: 0, distancePercent: 0, families: { voice: [], music: [] }, engines: [] }),
        soundVolume: 1,
      }),
    )
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 10 }))
    expect(addAudioTracks).not.toHaveBeenCalled()
    expect(hook.result.current.state.phase).toBe('done')
    expect(hook.result.current.state.mutedFallback).toBe(true)
    expect(trace).toHaveBeenCalled()
    trace.mockRestore()
  })
})

describe('useReplayExport — the output format', () => {
  /** Mounts an export on a given SCREEN canvas, under a given screen density. */
  function mount(screen: { width: number; height: number }, dpr: number) {
    Object.defineProperty(window, 'devicePixelRatio', { value: dpr, configurable: true })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(screen.width * dpr)
    canvas.height = Math.round(screen.height * dpr)
    const hook = renderHook(() =>
      useExportWithView({
        canvasRef: { current: canvas },
        frameRef: { current: 0 },
        redraw: simulatedCanvas(canvas, screen),
        pause: vi.fn(),
        doc: DOC,
        playWindow: null,
        scoreboard: [],
        allegiance: NO_ALLEGIANCE,
        outcome: null,
        viewpoint: null,
        titleSlug: 'halo_infinite',
        locale: 'en',
      }),
    )
    return { hook, canvas }
  }
  /** The canvas size at the moment of EACH frame pushed to the encoder. */
  function pushedSizes(): string[] {
    return addFrame.mock.calls.map(([c]) => `${c.width}x${c.height}`)
  }

  afterEach(() => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true })
  })

  it('with no choice: 1920x1080, whatever the screen canvas', async () => {
    const { hook } = mount({ width: 1234, height: 567 }, 1)
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 10 }))
    expect(openedDims).toEqual([{ width: 1920, height: 1080 }])
    expect(new Set(pushedSizes())).toEqual(new Set(['1920x1080']))
  })

  it.each([
    { format: '1080p' as const, expected: '1920x1080', screen: { width: 502, height: 480 }, dpr: 1 },
    { format: '1080p' as const, expected: '1920x1080', screen: { width: 1400, height: 720 }, dpr: 2.5 },
    { format: '720p' as const, expected: '1280x720', screen: { width: 502, height: 480 }, dpr: 1 },
    { format: '720p' as const, expected: '1280x720', screen: { width: 1400, height: 720 }, dpr: 3 },
  ])('$format on a $screen.width x $screen.height canvas at DPR $dpr -> $expected', async ({ format, expected, screen, dpr }) => {
    const { hook } = mount(screen, dpr)
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 10 }, { format }))
    const [w, h] = expected.split('x').map(Number)
    expect(openedDims).toEqual([{ width: w, height: h }])
    // EVERY frame, not just the first: a canvas that changed size mid-way would be
    // cropped by the encoder.
    expect(addFrame).toHaveBeenCalledTimes(16)
    expect(new Set(pushedSizes())).toEqual(new Set([expected]))
  })

  it('restores the SCREEN layout at the end: screen density, no more format frame', async () => {
    const { hook } = mount({ width: 800, height: 450 }, 2)
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 10 }, { format: '720p' }))
    expect(seenLayout.current).toBeNull()
    expect(isExportLayoutApplied()).toBe(true)
    expect(canvasPixelRatio()).toBe(2)
  })

  it('restores it even when the export FAILS', async () => {
    const { hook } = mount({ width: 800, height: 450 }, 1)
    addFrame.mockRejectedValueOnce(new Error('boom'))
    const trace = vi.spyOn(console, 'error').mockImplementation(() => {})
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 10 }))
    expect(hook.result.current.state.phase).toBe('failed')
    expect(seenLayout.current).toBeNull()
    expect(isExportActive()).toBe(false)
    expect(canvasPixelRatio()).toBe(1)
    trace.mockRestore()
  })

  it('PURE BLACK backdrop and DARK THEME inks, even on a light-theme page; the page knows nothing of it', async () => {
    // A transparent pixel means nothing to H.264: the backdrop is PAINTED under the whole
    // image, 16:9 frame bars included, and it is black whatever the theme (D8). The inks
    // read during encoding are the dark theme's (D9).
    const theme = document.createElement('style')
    theme.textContent = [
      ":root, :root[data-theme='dark'], :root[data-theme='light'] { --replay-export-backdrop: rgb(0 0 0); }",
      ":root, :root[data-theme='dark'] { --foreground: rgb(250 250 250); }",
      ":root[data-theme='light'] { --foreground: rgb(20 20 20); }",
    ].join(' ')
    document.head.appendChild(theme)
    const before = document.documentElement.getAttribute('data-theme')
    document.documentElement.setAttribute('data-theme', 'light')
    const painted: string[] = []
    const inks: string[] = []
    const ctx = {
      globalCompositeOperation: 'source-over',
      fillStyle: '',
      setTransform: () => {},
      fillRect: (x: number, y: number, w: number, h: number) =>
        painted.push(`${ctx.globalCompositeOperation} ${ctx.fillStyle} ${x},${y},${w},${h}`),
    }
    // `as never`: the WebGPU types pulled in by @types/three add the getContext('webgpu') overload,
    // the one the mock keeps.
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(ctx as never)
    addFrame.mockImplementation(async () => {
      inks.push(readInk('--foreground'))
    })
    try {
      const { hook } = mount({ width: 700, height: 700 }, 1)
      await act(() => hook.result.current.run({ startFrame: 0, endFrame: 10 }))
      expect(painted).toHaveLength(16)
      expect(new Set(painted)).toEqual(new Set(['destination-over rgb(0 0 0) 0,0,1920,1080']))
      // The composite mode is RESTORED: the next draw would otherwise paint under the image.
      expect(ctx.globalCompositeOperation).toBe('source-over')
      expect(new Set(inks)).toEqual(new Set(['rgb(250 250 250)']))
      // THE PAGE: still in light theme, and its inks are its own again.
      expect(document.documentElement.getAttribute('data-theme')).toBe('light')
      expect(readInk('--foreground')).toBe('rgb(20 20 20)')
    } finally {
      addFrame.mockImplementation(async () => {})
      theme.remove()
      if (before === null) document.documentElement.removeAttribute('data-theme')
      else document.documentElement.setAttribute('data-theme', before)
    }
  })

  it('passes the FRAMING to the layout: whole map by default, current framing on request', async () => {
    const framings: string[] = []
    const { hook } = mount({ width: 800, height: 450 }, 1)
    addFrame.mockImplementation(async () => {
      framings.push(seenLayout.current?.framing ?? 'none')
    })
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 10 }))
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 10 }, { framing: 'current' }))
    addFrame.mockImplementation(async () => {})
    expect(framings.slice(0, 16)).toEqual(Array(16).fill('whole'))
    expect(framings.slice(16)).toEqual(Array(16).fill('current'))
  })

  it('holds the canvas FROM preparation onward (gestures off before the sound mix)', async () => {
    let activeDuringMix = false
    vi.mocked(mixReplayAudio).mockImplementationOnce(async () => {
      activeDuringMix = isExportActive()
      return null
    })
    const canvas = document.createElement('canvas')
    const hook = renderHook(() =>
      useExportWithView({
        canvasRef: { current: canvas },
        frameRef: { current: 0 },
        redraw: simulatedCanvas(canvas),
        pause: vi.fn(),
        doc: DOC,
        playWindow: null,
        scoreboard: [],
        allegiance: NO_ALLEGIANCE,
        outcome: null,
        viewpoint: null,
        titleSlug: 'halo_infinite',
        locale: 'en',
        soundTrack: () => ({ timeline: [{ ms: 0, stem: 'x' }], endMatchStems: [], variationPercent: 0, distancePercent: 0, families: { voice: [], music: [] }, engines: [] }),
        zoomLevel: 2,
      }),
    )
    // The screen's zoom level is RELAYED to the dialog, which decides whether to offer a framing choice.
    expect(hook.result.current.zoomLevel).toBe(2)
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 10 }))
    expect(activeDuringMix).toBe(true)
    expect(isExportActive()).toBe(false)
  })

  it('a canvas that NEVER takes the format: failure stated, encoder never opened', async () => {
    // No framing mounted: the requested layout never applies. Time is advanced artificially
    // to avoid waiting for the real delay.
    const canvas = document.createElement('canvas')
    let t = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => (t += 1000))
    const trace = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hook = renderHook(() =>
      useReplayExport({
        canvasRef: { current: canvas },
        frameRef: { current: 0 },
        redraw: vi.fn(),
        pause: vi.fn(),
        doc: DOC,
        playWindow: null,
        scoreboard: [],
        allegiance: NO_ALLEGIANCE,
        outcome: null,
        viewpoint: null,
        titleSlug: 'halo_infinite',
        locale: 'en',
      }),
    )
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 10 }))
    expect(hook.result.current.state.phase).toBe('failed')
    expect(hook.result.current.state.message).toContain('Export layout was not applied')
    expect(openedDims).toEqual([])
    clock.mockRestore()
    trace.mockRestore()
  })
})

describe('useReplayExport — the separated sound tracks', () => {
  it('declares the FULL MIX first, then the families', async () => {
    audioOk.value = true
    vi.mocked(mixReplayAudio).mockResolvedValueOnce({
      full: { duration: 2 } as AudioBuffer,
      families: [
        { family: 'sfx', buffer: { duration: 2 } as AudioBuffer },
        { family: 'music', buffer: { duration: 2 } as AudioBuffer },
      ],
    })
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const hook = renderHook(() =>
      useExportWithView({
        canvasRef: { current: canvas },
        frameRef: { current: 0 },
        redraw: simulatedCanvas(canvas),
        pause: vi.fn(),
        doc: DOC,
        playWindow: null,
        scoreboard: [],
        allegiance: NO_ALLEGIANCE,
        outcome: null,
        viewpoint: null,
        titleSlug: 'halo_infinite',
        locale: 'en',
        soundTrack: () => ({ timeline: [{ ms: 0, stem: 'x' }], endMatchStems: [], variationPercent: 0, distancePercent: 0, families: { voice: [], music: [] }, engines: [] }),
        soundVolume: 1,
      }),
    )
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 10 }))
    expect(mixReplayAudio).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ trimToBounds: true }))
    // THE MIX FIRST: an ordinary player only plays the first track, and a browser does not
    // even expose the others. The families alone would let the sound effects be heard
    // without the music or the voice.
    expect(declaredNames).toEqual(['Full mix', 'Sound effects', 'Music'])
    expect(addAudioTracks.mock.calls[0][0].map((p) => p.name)).toEqual(declaredNames)
  })
})
