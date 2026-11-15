import { describe, expect, it } from 'vitest'

import { SCENE3D_TEXT } from '../i18n/scene3dText'
import { nouveauProfil } from '../scene3d/profilRendu3d'
import { meterLines, snapshotOf } from './ReplayCadence3d'

describe('ReplayCadence3d meter lines', () => {
  const profil = { ...nouveauProfil(), appels: 812, triangles: 16_200_000, geometries: 1234, textures: 345, pixelRatio: 1, width: 1662, height: 1201 }

  it('heads with displayed / native fps and the real-time ratio', () => {
    const snap = snapshotOf({ displayedFps: 12.9, frameMsAvg: 77.5, frameMsWorst: 150, realtime: 1.004, scriptMs: 9.26 }, 30, profil, 0)
    const [head, cost] = meterLines(snap, SCENE3D_TEXT.en)
    expect(head).toBe('13 / 30 fps · 1.00x')
    expect(cost).toBe('77.5 ms · worst 150.0 ms · js 9.3 ms · 812 calls · 16.20M tri · 1234 geo · 345 tex')
  })

  it('says paused when the film does not advance', () => {
    const snap = snapshotOf({ displayedFps: 60, frameMsAvg: 16.7, frameMsWorst: 17, realtime: 0, scriptMs: 2 }, 30, profil, 0)
    expect(meterLines(snap, SCENE3D_TEXT.en)[0]).toBe('60 / 30 fps · paused')
  })
})
