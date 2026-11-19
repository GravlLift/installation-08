// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** cameraScriptStore.test.ts — the camera-script host's registration and the script's playback state. */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  cameraScriptHost,
  registerCameraScriptHost,
  scriptPlayback,
  setScriptPlaybackTime,
  startScript,
  stopScript,
  useScriptPlayback,
  type CameraScriptHost,
} from './cameraScriptStore'
import type { CameraScript } from './cameraScript3d'

function host(frameMs = 1000 / 30): CameraScriptHost {
  return {
    setScript: () => undefined,
    setScriptTime: () => undefined,
    capture: () => ({ position: [0, 0, 0], target: [0, 0, 0], verticalFov: 60 }),
    subjectAt: () => null,
    frameMs,
  }
}

/** A host whose setScript/setScriptTime record their calls. */
function spyHost(): CameraScriptHost {
  const setScript = vi.fn<(script: CameraScript | null) => void>()
  const setScriptTime = vi.fn<(sMs: number) => void>()
  return {
    setScript,
    setScriptTime,
    capture: () => ({ position: [0, 0, 0], target: [0, 0, 0], verticalFov: 60 }),
    subjectAt: () => null,
    frameMs: 1000 / 30,
  }
}

function worldScript(): CameraScript {
  return {
    version: 1,
    matchId: 'm',
    name: 'two-key',
    keys: [
      { t: 0, pos: { at: 'world', point: [0, 0, 0] }, look: { at: 'world', point: [1, 0, 0] } },
      { t: 2000, pos: { at: 'world', point: [2, 0, 0] }, look: { at: 'world', point: [3, 0, 0] } },
    ],
  }
}

describe('cameraScriptStore', () => {
  it('registers, reads, and unregisters the host', () => {
    const registered = host()
    const off = registerCameraScriptHost(registered)
    expect(cameraScriptHost()).toBe(registered)
    off()
    expect(cameraScriptHost()).toBeNull()
  })

  it('a stale unregister after a replacement is a no-op', () => {
    const first = host()
    const offFirst = registerCameraScriptHost(first)
    const second = host(1000 / 20)
    registerCameraScriptHost(second)
    offFirst()
    expect(cameraScriptHost()).toBe(second)
  })
})

describe('cameraScriptStore playback', () => {
  afterEach(() => {
    stopScript()
    vi.restoreAllMocks()
  })

  it('startScript/stopScript drive the registered host', () => {
    const h = spyHost()
    const off = registerCameraScriptHost(h)
    const script = worldScript()

    startScript(script, 100)
    expect(h.setScript).toHaveBeenLastCalledWith(script)
    expect(h.setScriptTime).toHaveBeenLastCalledWith(100)
    expect(scriptPlayback()?.sMs).toBe(100)

    stopScript()
    expect(h.setScript).toHaveBeenLastCalledWith(null)
    expect(scriptPlayback()).toBeNull()
    off()
  })

  it('a host registered after startScript receives the script and time', () => {
    const script = worldScript()
    startScript(script, 120)
    const h = spyHost()
    const off = registerCameraScriptHost(h)

    expect(h.setScript).toHaveBeenLastCalledWith(script)
    expect(h.setScriptTime).toHaveBeenLastCalledWith(120)
    off()
  })

  it('setScriptPlaybackTime advances the time without notifying subscribers', () => {
    startScript(worldScript())
    const renders = vi.fn()
    const { result } = renderHook(() => {
      renders()
      return useScriptPlayback()
    })
    expect(result.current).not.toBeNull()
    const before = renders.mock.calls.length

    setScriptPlaybackTime(500)

    expect(scriptPlayback()?.sMs).toBe(500)
    expect(result.current).not.toBeNull()
    expect(result.current?.sMs).toBe(500)
    // the per-frame advance must not trigger a re-render
    expect(renders.mock.calls.length).toBe(before)
  })

  it('useScriptPlayback re-renders on start and stop only', () => {
    const renders = vi.fn()
    const { result } = renderHook(() => {
      renders()
      return useScriptPlayback()
    })
    expect(result.current).toBeNull()

    act(() => {
      startScript(worldScript())
    })
    expect(result.current).not.toBeNull()

    act(() => {
      stopScript()
    })
    expect(result.current).toBeNull()
    // started once and stopped once: exactly two re-renders after the initial one
    expect(renders.mock.calls.length).toBe(3)
  })
})
