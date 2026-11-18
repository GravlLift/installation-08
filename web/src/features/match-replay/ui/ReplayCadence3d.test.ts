// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { SCENE3D_TEXT } from '../i18n/scene3dText'
import { newProfile } from '../scene3d/renderProfile3d'
import { meterLines, snapshotOf } from './ReplayCadence3d'

describe('ReplayCadence3d meter lines', () => {
  const profile = { ...newProfile(), calls: 812, triangles: 16_200_000, geometries: 1234, textures: 345, pixelRatio: 1, width: 1662, height: 1201 }

  it('heads with the playback fps and the real-time ratio', () => {
    const snap = snapshotOf({ displayedFps: 12.9, frameMsAvg: 77.5, frameMsWorst: 150, realtime: 1.004, scriptMs: 9.26 }, 30, profile, 0)
    const [head, cost] = meterLines(snap, SCENE3D_TEXT.en)
    expect(head).toBe('13 fps · 1.00x')
    expect(cost).toBe('77.5 ms · worst 150.0 ms · js 9.3 ms · 812 calls · 16.20M tri · 1234 geo · 345 tex')
  })

  it('lists the passes that drew, shadows apart from the scene', () => {
    const passes = { ...newProfile().passes, shadow: { calls: 30, triangles: 400_000 }, scene: { calls: 421, triangles: 5_400_000 }, ao: { calls: 3, triangles: 3 } }
    const snap = snapshotOf({ displayedFps: 30, frameMsAvg: 33, frameMsWorst: 40, realtime: 1, scriptMs: 5 }, 30, { ...profile, passes, gpuMs: 21.34 }, 0)
    const [, cost, , line] = meterLines(snap, SCENE3D_TEXT.en)
    expect(cost).toContain('js 5.0 ms · gpu 21.3 ms · 812 calls')
    expect(line).toBe('shadow 0.40M/30 · scene 5.40M/421 · ao 0.00M/3')
  })

  it("shows the bloom's own GPU time next to the frame's, and its draws among the passes", () => {
    const passes = { ...newProfile().passes, ao: { calls: 3, triangles: 3 }, bloom: { calls: 13, triangles: 13 }, output: { calls: 1, triangles: 1 } }
    const snap = snapshotOf({ displayedFps: 30, frameMsAvg: 33, frameMsWorst: 40, realtime: 1, scriptMs: 5 }, 30, { ...profile, passes, gpuMs: 21.34, bloomGpuMs: 0.84 }, 0)
    const [, cost, , line] = meterLines(snap, SCENE3D_TEXT.en)
    expect(snap.bloomGpuMs).toBe(0.8)
    expect(cost).toContain('gpu 21.3 ms (bloom 0.8 ms) · 812 calls')
    expect(line).toBe('ao 0.00M/3 · bloom 0.00M/13 · output 0.00M/1')
    const off = snapshotOf({ displayedFps: 30, frameMsAvg: 33, frameMsWorst: 40, realtime: 1, scriptMs: 5 }, 30, { ...profile, gpuMs: 21.34, bloomGpuMs: null }, 0)
    expect(meterLines(off, SCENE3D_TEXT.en)[1]).not.toContain('bloom')
  })

  it('says paused when the film does not advance', () => {
    const snap = snapshotOf({ displayedFps: 60, frameMsAvg: 16.7, frameMsWorst: 17, realtime: 0, scriptMs: 2 }, 30, profile, 0)
    expect(meterLines(snap, SCENE3D_TEXT.en)[0]).toBe('60 fps · paused')
  })
})
