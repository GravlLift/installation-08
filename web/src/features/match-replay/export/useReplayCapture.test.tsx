// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * Tests — useReplayCapture (the React wiring of capture: image and video).
 *
 * WHAT THEY PROTECT. The command reads the canvas and the clock AT THE MOMENT OF THE CLICK,
 * not at render: the file must carry the instant it shows. When the canvas renders no frame —
 * no canvas, encoding refused — NOTHING downloads: an empty file would suggest a successful
 * capture. And recording has only ONE exit path: a second click, a pause, or the film's end
 * all lead to the same stop, hence a single clip handed back exactly once.
 *
 * EVERYTHING IS DOUBLED, AND THERE IS NOTHING LEFT TO DOUBLE LESS OF. jsdom has NEITHER
 * `MediaRecorder`, NOR `canvas.captureStream`, NOR `toBlob`: no REAL recording exists to
 * measure here. The question asked is therefore "who is called, when, with what" — the same
 * one asked by `useReplayPlayback.test.tsx`, which replaces the animation loop with a queue
 * drained by hand. What the output module actually DOES is verified in its own tests
 * (`replayCapture.test.ts`).
 */
import { act, renderHook } from '@testing-library/react'
import { createRef, type RefObject } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReplayExportOptions } from './useReplayExport'
import { captureCanvasImage, triggerDownload } from './replayCapture'
import { pickVideoMimeType } from './replayRecording'
import { testReplayDoc } from '../test/testDoc'
import type { MatchScoreboardRow } from '@/lib/api/types'
import { buildFilmAllegiance, NO_ALLEGIANCE } from '@/lib/replay/filmAllegiance'
import type { ReplayPlayer } from '@/lib/replay/rosterLogic'
import { useReplayCapture } from './useReplayCapture'

/**
 * THE SPY ON `useReplayExport` (2026-09-07) — it DELEGATES to the real hook.
 *
 * WHY THIS DETOUR IS NEEDED. `viewedLabel` — the word the export's panel will paint — is
 * computed INSIDE this wiring layer (`useViewedOutcome`) and does not come back out of
 * `useReplayCapture`: it goes straight down into the export's options. The one production
 * computation therefore had no test, and neutering it left the whole suite green. The options
 * are intercepted in passing, with nothing else changed: the real hook is called, with the
 * same object, at the same point in the hooks' order.
 *
 * `vi.hoisted` because `vi.mock`'s factory is hoisted to the top of the module: an ordinary
 * `const` would be in its dead zone there.
 */
const exportSpy = vi.hoisted(() => ({ options: [] as ReplayExportOptions[] }))

vi.mock('./useReplayExport', async (importOriginal) => {
  const real = await importOriginal<typeof import('./useReplayExport')>()
  return {
    ...real,
    useReplayExport: (o: ReplayExportOptions) => {
      exportSpy.options.push(o)
      return real.useReplayExport(o)
    },
  }
})

vi.mock('./replayCapture', async (importOriginal) => {
  // NAMING stays real: it is what proves the instant read is the right one.
  const real = await importOriginal<typeof import('./replayCapture')>()
  return {
    ...real,
    captureCanvasImage: vi.fn(),
    triggerDownload: vi.fn(),
  }
})

/** 20 frames per second: frame 40 therefore falls at the match's 2nd second. */
const DOC = testReplayDoc({ matchId: 'match-témoin', frameIntervalMs: 50 })

function mount(
  frame: number,
  canvas: HTMLCanvasElement | null = document.createElement('canvas'),
  audioTrack?: () => MediaStreamTrack | null,
) {
  const canvasRef = createRef<HTMLCanvasElement>() as RefObject<HTMLCanvasElement | null>
  canvasRef.current = canvas
  const frameRef = createRef<number>() as RefObject<number>
  frameRef.current = frame
  const play = vi.fn()
  const view = renderHook(
    ({ playing }: { playing: boolean }) =>
      useReplayCapture({ canvasRef, doc: DOC, frameRef, playing, play, audioTrack, viewpoint: null, allegiance: NO_ALLEGIANCE }),
    { initialProps: { playing: true } },
  )
  return { ...view, play }
}

/**
 * THE QUERY PROVIDER BECAME NECESSARY ON 2026-09-07 (F2 review): the wiring layer now resolves
 * the verdict's WORD through the title's mappings (`useOutcomeMapping`, TanStack Query) when
 * the viewpoint swaps the reading. Most cases here do not exercise that path — they mount the
 * capture with no verdict — but the hook is called unconditionally, like any hook.
 *
 * `outcomes` SET TO `true` SEEDS THE TITLE'S MAPPINGS into the cache, under the key
 * `useFieldMappings` builds from the store's defaults (`halo_infinite`, `fr`). The query stays
 * disabled in tests (`isBootstrapped` is false) and still reads the data. At `false`, this is
 * the degraded case: no canonical label.
 */
beforeEach(() => {
  vi.mocked(captureCanvasImage).mockReset()
  vi.mocked(triggerDownload).mockReset()
})

describe('useReplayCapture — capturing the image', () => {
  it('downloads a PNG named on the displayed match instant', async () => {
    const blob = new Blob(['png'])
    vi.mocked(captureCanvasImage).mockResolvedValue(blob)
    const { result } = mount(40)
    await act(async () => {
      result.current.captureImage()
    })
    expect(captureCanvasImage).toHaveBeenCalledTimes(1)
    // The match id is sanitized along the way (the accent does not survive into the filename).
    expect(triggerDownload).toHaveBeenCalledWith(blob, 'replay-match-t-moin-0m02s.png')
  })

  it('a canvas that renders no frame downloads NOTHING', async () => {
    vi.mocked(captureCanvasImage).mockResolvedValue(null)
    const { result } = mount(40)
    await act(async () => {
      result.current.captureImage()
    })
    expect(triggerDownload).not.toHaveBeenCalled()
  })

  it('with no canvas mounted, the command does nothing and does not throw', async () => {
    const { result } = mount(40, null)
    await act(async () => {
      result.current.captureImage()
    })
    expect(captureCanvasImage).not.toHaveBeenCalled()
    expect(triggerDownload).not.toHaveBeenCalled()
  })
})

describe('pickVideoMimeType — the most portable container first', () => {
  it('MP4/H.264 wins as soon as it is accepted', () => {
    expect(pickVideoMimeType(() => true)).toEqual({ mime: 'video/mp4;codecs=avc1', ext: 'mp4' })
  })

  it('with no MP4, falls back to WebM/VP9 — and the extension FOLLOWS the chosen type', () => {
    // A `.mp4` that actually contained WebM would not open anywhere: the (type, extension)
    // pair is the decision, never the type alone.
    const choice = pickVideoMimeType((t) => t.startsWith('video/webm'))
    expect(choice).toEqual({ mime: 'video/webm;codecs=vp9', ext: 'webm' })
  })

  it('no accepted container: `null`, and especially not a made-up fallback', () => {
    expect(pickVideoMimeType(() => false)).toBeNull()
  })
})

/**
 * THE DOUBLED RECORDER: it notes what it is asked, and returns a single slice on stop.
 * `stop()` emits the slice THEN `onstop`, in that order — the browser's own order, and that is
 * what makes the clip truly contain its last frame.
 */
class FakeMediaRecorder {
  static supported: string[] = ['video/mp4;codecs=avc1']
  static last: FakeMediaRecorder | null = null
  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supported.includes(type)
  }
  state: 'inactive' | 'recording' = 'inactive'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  stream: { getTracks: () => unknown[] }
  options: { mimeType: string }
  constructor(
    stream: { getTracks: () => unknown[] },
    options: { mimeType: string },
  ) {
    this.stream = stream
    this.options = options
    FakeMediaRecorder.last = this
  }
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['clip']) })
    this.onstop?.()
  }
}

/** The stream's tracks: checked to be stopped at the end, and not before. */
let tracksStopped = 0

/** The multi-track stream the image+sound assembly builds. */
class FakeMediaStream {
  tracks: unknown[]
  constructor(tracks: unknown[]) {
    this.tracks = tracks
  }
  getTracks() {
    return this.tracks
  }
}

/** The canvas's video track — the one that must be stopped at the end, and only it. */
const VIDEO_TRACK = { kind: 'video', stop: () => (tracksStopped += 1) }

function armRecording(supported = ['video/mp4;codecs=avc1']) {
  FakeMediaRecorder.supported = supported
  FakeMediaRecorder.last = null
  tracksStopped = 0
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  vi.stubGlobal('MediaStream', FakeMediaStream)
  HTMLCanvasElement.prototype.captureStream = () =>
    ({ getTracks: () => [VIDEO_TRACK] }) as unknown as MediaStream
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream
})

describe('useReplayCapture — recording the video', () => {
  beforeEach(() => armRecording())

  it('a click opens recording in the chosen container', () => {
    const { result } = mount(40)
    expect(result.current.recordingSupported).toBe(true)
    act(() => {
      result.current.toggleRecording()
    })
    expect(result.current.recording).toBe(true)
    expect(FakeMediaRecorder.last?.options.mimeType).toBe('video/mp4;codecs=avc1')
    expect(FakeMediaRecorder.last?.state).toBe('recording')
  })

  it('the second click stops, assembles, and downloads ONCE — with the right extension', () => {
    const { result } = mount(40)
    act(() => {
      result.current.toggleRecording()
    })
    act(() => {
      result.current.toggleRecording()
    })
    expect(result.current.recording).toBe(false)
    expect(triggerDownload).toHaveBeenCalledTimes(1)
    const [blob, name] = vi.mocked(triggerDownload).mock.calls[0]
    expect(name).toBe('replay-match-t-moin-0m02s.mp4')
    expect(blob.type).toBe('video/mp4;codecs=avc1')
    // The canvas's tracks only stop AFTER the last slice.
    expect(tracksStopped).toBe(1)
  })

  it('with no MP4 accepted, the clip comes out as WebM — name and container agree', () => {
    armRecording(['video/webm'])
    const { result } = mount(40)
    act(() => {
      result.current.toggleRecording()
    })
    act(() => {
      result.current.toggleRecording()
    })
    expect(vi.mocked(triggerDownload).mock.calls[0][1]).toBe('replay-match-t-moin-0m02s.webm')
  })

  // DECISION 3 — a single exit path. The film's end pauses playback (useReplayPlayback): it is
  // that FALLING EDGE that closes the clip, with no second click.
  it('playback stopping closes recording and downloads', () => {
    const { result, rerender } = mount(40)
    act(() => {
      result.current.toggleRecording()
    })
    expect(triggerDownload).not.toHaveBeenCalled()
    act(() => {
      rerender({ playing: false })
    })
    expect(result.current.recording).toBe(false)
    expect(triggerDownload).toHaveBeenCalledTimes(1)
  })

  // The pitfall the TRANSITION guard avoids: starting from a pause, `playing` is still
  // `false` for one render. Reading the STATE rather than its falling edge would close the
  // clip as soon as it opened — and make the button unusable on a paused replay.
  it('starting from a PAUSE resumes playback, and does not close right away', () => {
    const { result, rerender, play } = mount(40)
    act(() => {
      rerender({ playing: false })
    })
    act(() => {
      result.current.toggleRecording()
    })
    expect(play).toHaveBeenCalledTimes(1)
    expect(result.current.recording).toBe(true)
    expect(triggerDownload).not.toHaveBeenCalled()
    act(() => {
      rerender({ playing: true })
    })
    expect(result.current.recording).toBe(true)
  })

  // DECISION 6 — sound joins video AT START, and only if it is already active.
  it('with sound active: TWO tracks, image and sound', () => {
    const track = { kind: 'audio', stop: vi.fn() } as unknown as MediaStreamTrack
    const { result } = mount(40, document.createElement('canvas'), () => track)
    act(() => {
      result.current.toggleRecording()
    })
    expect(FakeMediaRecorder.last?.stream.getTracks()).toEqual([VIDEO_TRACK, track])
  })

  it('with no sound: ONE track, and the canvas stream passes through as is', () => {
    const { result } = mount(40, document.createElement('canvas'), () => null)
    act(() => {
      result.current.toggleRecording()
    })
    expect(FakeMediaRecorder.last?.stream.getTracks()).toEqual([VIDEO_TRACK])
  })

  it('on stop, the AUDIO track survives — it belongs to the sound player', () => {
    // Stopping it here would mute every following recording: the player lives longer than
    // the clip, and it is the player that owns this track.
    const stop = vi.fn()
    const track = { kind: 'audio', stop } as unknown as MediaStreamTrack
    const { result } = mount(40, document.createElement('canvas'), () => track)
    act(() => {
      result.current.toggleRecording()
    })
    act(() => {
      result.current.toggleRecording()
    })
    expect(tracksStopped).toBe(1) // the canvas's own track, however, is indeed stopped
    expect(stop).not.toHaveBeenCalled()
  })

  it('leaving the page during a recording closes it WITHOUT dropping a file', () => {
    const { result, unmount } = mount(40)
    act(() => {
      result.current.toggleRecording()
    })
    act(() => {
      unmount()
    })
    expect(FakeMediaRecorder.last?.state).toBe('inactive')
    expect(triggerDownload).not.toHaveBeenCalled()
  })
})

describe('useReplayCapture — browser with no recording', () => {
  it('`recordingSupported` is false when the API is missing, and the image button stays useful', async () => {
    // Neither `MediaRecorder` nor `captureStream`: jsdom's default state, and an old
    // browser's. Image capture itself depends on neither.
    const blob = new Blob(['png'])
    vi.mocked(captureCanvasImage).mockResolvedValue(blob)
    const { result } = mount(40)
    expect(result.current.recordingSupported).toBe(false)
    await act(async () => {
      result.current.captureImage()
    })
    expect(triggerDownload).toHaveBeenCalledTimes(1)
  })
})

/**
 * ADDED ON 2026-09-07 — THE WORD THE CLIP WILL PAINT, AND ITS SINGLE SOURCE.
 *
 * `useViewedOutcome` is the ONLY production computation of `viewedLabel`, and nothing covered
 * it: a clip exported from an opponent's viewpoint announced "Victory" over the team that
 * lost. The word now comes from the title's mappings in ALL cases — the page only sends down
 * the code — and these cases pin down both regimes, plus the degraded one.
 *
 * THEY DO NOT OBSERVE THE PANEL but the export's INPUT: what `exportOverlayPanels` does with
 * it is proven in its own tests (`exportOverlayPanels.test.ts`, five cases on `viewedLabel`).
 * Here, the only question is "did the wiring resolve the right word?".
 */
describe('useReplayCapture — the verdict\'s word, passed to the export', () => {
  const SB = [
    { xuid: 'me', team_side: 't0', is_me: true },
    { xuid: 'them', team_side: 't1', is_me: false },
  ] as MatchScoreboardRow[]

  /**
   * The verdict served by the header: the page's own player WON (code 2). THE CODE ALONE —
   * since 2026-09-07 the page no longer sends down a label, the word is resolved here.
   */
  const OUTCOME = { code: 2 }

  /** The same lobby, plus a TEAMMATE of the page's own player. */
  const SB_TRIO = [...SB, { xuid: 'buddy', team_side: 't0', is_me: false } as MatchScoreboardRow]

  /**
   * The page's FILM allegiance, from the viewpoint (the page's own player by default, like the
   * model): each player on the sheet carries into the film the team of their own side.
   */
  function allegianceOf(board: MatchScoreboardRow[], viewpoint: string | null) {
    const players = board.map(
      (r) => ({ xuid: r.xuid, team: Number((r.team_side ?? '').slice(1)), lives: [], board: r }) as ReplayPlayer,
    )
    return buildFilmAllegiance(players, viewpoint ?? 'me')
  }

  /** Mounts the capture with a verdict and a viewpoint, and returns the options seen by the export. */
  function optionsFor(
    viewpoint: string | null,
    { board = SB }: { board?: MatchScoreboardRow[] } = {},
  ) {
    exportSpy.options.length = 0
    const canvasRef = createRef<HTMLCanvasElement>() as RefObject<HTMLCanvasElement | null>
    canvasRef.current = document.createElement('canvas')
    const frameRef = createRef<number>() as RefObject<number>
    frameRef.current = 0
    renderHook(
      () =>
        useReplayCapture({
          canvasRef,
          doc: DOC,
          frameRef,
          playing: false,
          play: vi.fn(),
          // `redraw` is what makes the export AVAILABLE (see `useExportSeam`): without it the
          // hook still runs, but its result is discarded — and the options escape us.
          redraw: vi.fn(),
          scoreboard: board,
          allegiance: allegianceOf(board, viewpoint),
          outcome: OUTCOME,
          viewpoint,
        }),

    )
    return exportSpy.options[exportSpy.options.length - 1]
  }

  it('OPPONENT viewpoint: the CANONICAL label of the swapped outcome', () => {
    // The page's own player won (code 2); seen from `them`, the reading is a defeat, and that
    // word — `outcomes.toml`'s own — is what the clip must paint, not "Victory".
    expect(optionsFor('them').outcome?.viewedLabel).toBe('Defeat')
  })

  it('viewpoint = THE PAGE\'S OWN PLAYER: their outcome\'s label, as is', () => {
    expect(optionsFor('me').outcome?.viewedLabel).toBe('Victory')
  })

  it('ABSENT viewpoint (`null`): the page\'s own outcome label', () => {
    expect(optionsFor(null).outcome?.viewedLabel).toBe('Victory')
  })

  it('TEAMMATE of the page\'s own player: same side, so nothing swapped', () => {
    expect(optionsFor('buddy', { board: SB_TRIO }).outcome?.viewedLabel).toBe('Victory')
  })

  it('the rest of the verdict passes through UNCHANGED: only the viewed word is added', () => {
    const outcome = optionsFor('them').outcome
    expect(outcome).toMatchObject({ code: 2, viewedLabel: 'Defeat' })
  })
})
