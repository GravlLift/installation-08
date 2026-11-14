import { describe, expect, it, vi } from 'vitest'

import { MINIMAP_SHARE, minimapBox } from './export3dFrame'
import { registerReplay3DExport, replay3DExportEntry, type Replay3DExportSource } from './replay3dExportStore'
import { initialView3dChoice, view3dRunOptions } from './view3dChoice'

const source: Replay3DExportSource = {
  players: [],
  beginExport: vi.fn(),
  exportFrame: vi.fn(),
  exportTags: () => [],
  endExport: vi.fn(),
}

describe('minimapBox', () => {
  it('pose la carte en bas à droite, à sa part de largeur et à ses proportions', () => {
    const box = minimapBox({ width: 960, height: 540 }, { width: 1920, height: 1080 })
    expect(box.width).toBeCloseTo(960 * MINIMAP_SHARE)
    expect(box.height).toBeCloseTo((960 * MINIMAP_SHARE * 9) / 16)
    expect(box.x + box.width).toBe(960 - 16)
    expect(box.y + box.height).toBe(540 - 16)
  })

  it('une carte sans largeur ne donne pas de boîte', () => {
    expect(minimapBox({ width: 960, height: 540 }, { width: 0, height: 0 }).height).toBe(0)
  })
})

describe('replay3dExportStore', () => {
  it('inscrit et désinscrit la vue', () => {
    const release = registerReplay3DExport({ source, live: true, camera: 'fp', pov: null })
    expect(replay3DExportEntry()?.source).toBe(source)
    release()
    expect(replay3DExportEntry()).toBeNull()
  })

  it('une désinscription périmée ne retire pas l’inscription suivante', () => {
    const first = registerReplay3DExport({ source, live: true, camera: 'fp', pov: null })
    const second = registerReplay3DExport({ source, live: false, camera: 'tp', pov: 'x' })
    first()
    expect(replay3DExportEntry()?.camera).toBe('tp')
    second()
    expect(replay3DExportEntry()).toBeNull()
  })
})

describe('view3dChoice', () => {
  it('part de ce que l’écran montre, mini-carte comprise', () => {
    const entry = { source, live: true, camera: 'tp' as const, pov: 'x1' }
    expect(initialView3dChoice(entry)).toEqual({ on: true, camera: 'tp', pov: 'x1', minimap: true })
    expect(initialView3dChoice(null).on).toBe(false)
  })

  it('n’exporte en 3D que si la 3D est choisie ET chargée', () => {
    const entry = { source, live: true, camera: 'fp' as const, pov: null }
    const choice = { on: true, camera: 'free' as const, pov: 'x2', minimap: false }
    expect(view3dRunOptions(entry, choice)).toEqual({ camera: 'free', pov: 'x2', minimap: false })
    expect(view3dRunOptions(null, choice)).toBeNull()
    expect(view3dRunOptions(entry, { ...choice, on: false })).toBeNull()
  })
})
