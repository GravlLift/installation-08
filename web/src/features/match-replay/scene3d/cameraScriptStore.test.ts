// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** cameraScriptStore.test.ts — the camera-script host's registration: register, read, unregister. */
import { describe, expect, it } from 'vitest'

import { cameraScriptHost, registerCameraScriptHost, type CameraScriptHost } from './cameraScriptStore'

function host(frameMs = 1000 / 30): CameraScriptHost {
  return {
    setScript: () => undefined,
    setScriptTime: () => undefined,
    capture: () => ({ position: [0, 0, 0], target: [0, 0, 0], verticalFov: 60 }),
    subjectAt: () => null,
    frameMs,
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
