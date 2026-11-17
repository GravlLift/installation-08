// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useReplayExport.prepare.test.tsx — the PREPARATION reports its sound work and obeys Cancel.
 *
 * A full match spends its preparation mixing then encoding the sound: the state must say which
 * step runs and how far it is (`prepareStep`), and Cancel must reach the mix, which reads it at
 * each step. The mix and the encoder are doubles here; the render itself is `mixRender.test.ts`.
 */
import { useEffect } from 'react'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useReplayExport, type ReplayExportOptions, type ReplayExportState } from './useReplayExport'
import type { ExportLayout } from './exportFormats'
import { canvasPixelRatio, useExportLayout } from './exportLayoutStore'
import type { RenderHooks } from '../sound/mixRender'
import { testReplayDoc } from '../test/testDoc'
import { NO_ALLEGIANCE } from '@/lib/replay/filmAllegiance'

const opened: number[] = []
const addAudioTracks = vi.fn(async (_t: unknown, progress?: (f: number) => void) => {
  progress?.(0.5)
  progress?.(1)
})

vi.mock('./replayVideoEncoder', async (orig) => ({
  ...(await orig<typeof import('./replayVideoEncoder')>()),
  canExportVideo: () => true,
  openVideoExport: async () => {
    opened.push(1)
    return { addFrame: async () => {}, addAudioTracks, finish: async () => new Blob(['mp4']), abort: vi.fn(), audioEnabled: true }
  },
}))
vi.mock('../sound/replayAudioMix', async (orig) => ({
  ...(await orig<typeof import('../sound/replayAudioMix')>()),
  mixReplayAudio: vi.fn(async () => null),
}))
vi.mock('./replayCapture', async (orig) => ({
  ...(await orig<typeof import('./replayCapture')>()),
  triggerDownload: vi.fn(),
  // Le vrai `holdDownload` appellerait `URL.createObjectURL`, absent de jsdom : on le double
  // par un `{save, release}` inerte — ce test ne vérifie que la préparation, pas le dépôt.
  holdDownload: vi.fn(() => ({ save: vi.fn(), release: vi.fn() })),
}))

import { mixReplayAudio } from '../sound/replayAudioMix'

const layoutSeen: { current: ExportLayout | null } = { current: null }

/** The export mounted with the layout reader the canvas would be, recording every state. */
function mount(states: ReplayExportState[]) {
  const canvas = document.createElement('canvas')
  const redraw = () => {
    const frame = layoutSeen.current ?? { width: 320, height: 180 }
    canvas.width = Math.round(frame.width * canvasPixelRatio())
    canvas.height = Math.round(frame.height * canvasPixelRatio())
  }
  const options: ReplayExportOptions = {
    canvasRef: { current: canvas },
    frameRef: { current: 0 },
    redraw,
    pause: vi.fn(),
    doc: testReplayDoc({ frameIntervalMs: 50, frameCount: 200 }),
    playWindow: null,
    scoreboard: [],
    allegiance: NO_ALLEGIANCE,
    outcome: null,
    viewpoint: null,
    titleSlug: 'halo_infinite',
    locale: 'en',
    soundTrack: () => ({ timeline: [{ ms: 0, stem: 'x' }], endMatchStems: [], variationPercent: 0, distancePercent: 0, families: { voice: [], music: [] }, engines: [] }),
  }
  return renderHook(() => {
    const layout = useExportLayout()
    useEffect(() => {
      layoutSeen.current = layout
    }, [layout])
    const exporter = useReplayExport(options)
    states.push(exporter.state)
    return exporter
  })
}

const MIX = { full: { duration: 1 } as AudioBuffer, families: [] }

beforeEach(() => {
  opened.length = 0
  addAudioTracks.mockClear()
  vi.mocked(mixReplayAudio).mockReset()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  Object.defineProperty(document, 'fonts', { value: { ready: Promise.resolve() }, writable: true })
})

describe('useReplayExport — the preparation', () => {
  it('publishes the mix then the sound encoding, each with its share done', async () => {
    const states: ReplayExportState[] = []
    const hook = mount(states)
    // Each step is let through a render before the next one: the state is read as the page shows it.
    const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)))
    vi.mocked(mixReplayAudio).mockImplementationOnce(async (_t, _b, o) => {
      o.hooks?.progress?.(0.25)
      o.hooks?.progress?.(0.251) // same whole percent: not republished
      await settle()
      return MIX
    })
    addAudioTracks.mockImplementationOnce(async (_t, progress) => {
      progress?.(0.5)
      await settle()
      progress?.(1)
      await settle()
    })
    await hook.result.current.run({ startFrame: 0, endFrame: 10 })
    await settle()
    const steps = states.flatMap((s) => (s.phase === 'prepare' && s.prepareStep ? [s.prepareStep] : []))
    const distinct = steps.filter((s, i) => i === 0 || s.stage !== steps[i - 1].stage || s.pct !== steps[i - 1].pct)
    expect(distinct).toEqual([
      { stage: 'mix', pct: 25 },
      { stage: 'audio', pct: 50 },
      { stage: 'audio', pct: 100 },
    ])
    expect(hook.result.current.state.phase).toBe('done')
  })

  it('Cancel during the mix reaches it, and nothing is encoded', async () => {
    let hooks: RenderHooks | undefined
    const states: ReplayExportState[] = []
    const hook = mount(states)
    vi.mocked(mixReplayAudio).mockImplementationOnce(async (_t, _b, o) => {
      hooks = o.hooks
      hook.result.current.cancel()
      // The real mix reads `cancelled` at its next step and resolves `null`.
      return hooks?.cancelled?.() ? null : MIX
    })
    await act(() => hook.result.current.run({ startFrame: 0, endFrame: 10 }))
    expect(hooks?.cancelled?.()).toBe(true)
    expect(opened).toEqual([])
    expect(hook.result.current.state.phase).toBe('idle')
  })
})
