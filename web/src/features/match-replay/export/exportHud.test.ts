// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * exportHud.test.ts — the export HUD resolves the team colors at PAINT TIME, not once when
 * the HUD is built: a team color changed after `createExportHud` runs (through the settings
 * CSS variables) is served by the next paint of the same frame. The shield bar is drawn the
 * way `ShieldBar3d` draws it: the glass outline, a center fill that drains from both ends,
 * and the state's colors (the alert red when low).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { KillEvent } from '../../match-view/_momentum'
import { toReplayKills } from '../model/killFeedLogic'
import { prepareCallouts } from '../model/mapCallouts'
import { testReplayDoc } from '../test/testDoc'
import { createExportHud } from './exportHud'

it('draws the requested player HUD without inventing an unknown player state', async () => {
  const doc = testReplayDoc()
  const ctx = {
    save: vi.fn(), restore: vi.fn(), fillText: vi.fn(), beginPath: vi.fn(),
    arc: vi.fn(), stroke: vi.fn(), fill: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D
  const paint = await createExportHud(doc, 'unknown', [], null, null, 'en')
  paint(ctx, { width: 960, height: 540 }, 0)
  expect(ctx.save).toHaveBeenCalledOnce()
  expect(ctx.restore).toHaveBeenCalledOnce()
  expect(ctx.arc).not.toHaveBeenCalled()
})

/** A kill where an enemy ('C') takes an ally ('B'); the viewpoint ('A') is on the ally team. */
function enemyKill(): KillEvent {
  return {
    tMs: 0,
    xuid: 'C',
    ally: false,
    teamID: 1,
    weaponKey: '',
    weaponLabel: '',
    weaponImageUrl: '',
    weaponTinted: false,
    assistState: '',
    assistGamertag: '',
    assistTeamID: null,
    killerDamagePct: null,
    assistDamagePct: null,
    victimXuid: 'B',
    victimGamertag: 'Bravo',
  }
}

function doc() {
  return testReplayDoc({
    roster: [
      { filmIndex: 0, xuid: 'A', name: 'Alpha', team: 0 },
      { filmIndex: 1, xuid: 'B', name: 'Bravo', team: 0 },
      { filmIndex: 2, xuid: 'C', name: 'Charlie', team: 1 },
    ],
  })
}

/** A recording canvas context: every `fillStyle` write is captured, every method is a no-op. */
function recordingCtx() {
  const state: Record<string, unknown> = {}
  const fills: string[] = []
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (prop === 'measureText') return () => ({ width: 8 })
      if (typeof prop === 'string' && prop in target) return target[prop]
      return () => {}
    },
    set(target, prop, value) {
      if (prop === 'fillStyle') fills.push(String(value))
      target[prop as string] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, fills }
}

const VIEW = { width: 1280, height: 720 }

beforeEach(() => {
  localStorage.clear()
  // jsdom does not load index.css: pose the defaults the way the app does.
  document.documentElement.style.setProperty('--team-ally', '#22c55e')
  document.documentElement.style.setProperty('--team-enemy', '#ef4444')
})

afterEach(() => {
  document.documentElement.style.removeProperty('--team-ally')
  document.documentElement.style.removeProperty('--team-enemy')
})

/** A doc whose followed player's life carries shield samples (`sh`), so the bar is drawn. */
function shieldDoc() {
  return testReplayDoc({
    roster: [
      { filmIndex: 0, xuid: 'A', name: 'Alpha', team: 0 },
      { filmIndex: 1, xuid: 'B', name: 'Bravo', team: 0 },
      { filmIndex: 2, xuid: 'C', name: 'Charlie', team: 1 },
    ],
    tracks: [
      { slot: 0, team: 0, xuid: 'A', points: [{ t: 0, x: 0, y: 0, sh: 0.5 }, { t: 100, x: 0, y: 0, sh: 0.1 }, { t: 200, x: 0, y: 0, sh: 0.1 }] },
      { slot: 1, team: 0, xuid: 'B', points: [{ t: 0, x: 0, y: 0 }, { t: 200, x: 0, y: 0 }] },
      { slot: 2, team: 1, xuid: 'C', points: [{ t: 0, x: 0, y: 0 }, { t: 200, x: 0, y: 0 }] },
    ],
  })
}

/** A recording canvas context that also captures `fillRect`, `strokeStyle`, and gradient stops. */
function recordingCtxFull() {
  const state: Record<string, unknown> = {}
  const fills: string[] = []
  const fillRects: { x: number; y: number; w: number; h: number }[] = []
  const strokes: string[] = []
  const gradientStops: { offset: number; color: string }[] = []
  const measureText = () => ({ width: 8 })
  const fillRect = (x: number, y: number, w: number, h: number) => { fillRects.push({ x, y, w, h }) }
  const createLinearGradient = () => ({ addColorStop: (offset: number, color: string) => { gradientStops.push({ offset, color }) } })
  const noop = () => {}
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (prop === 'measureText') return measureText
      if (prop === 'fillRect') return fillRect
      if (prop === 'createLinearGradient') return createLinearGradient
      if (prop === 'fill') return noop
      if (prop === 'stroke') return noop
      if (prop === 'clip') return noop
      if (prop === 'save') return noop
      if (prop === 'restore') return noop
      if (prop === 'beginPath') return noop
      if (prop === 'moveTo') return noop
      if (prop === 'lineTo') return noop
      if (prop === 'quadraticCurveTo') return noop
      if (prop === 'arc') return noop
      if (prop === 'closePath') return noop
      if (prop === 'fillText') return noop
      if (typeof prop === 'string' && prop in target) return target[prop]
      return noop
    },
    set(target, prop, value) {
      if (prop === 'fillStyle') fills.push(String(value))
      if (prop === 'strokeStyle') strokes.push(String(value))
      target[prop as string] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, fills, fillRects, strokes, gradientStops }
}

/** A recording context: every method call and every property write, in order. */
function callRecorder() {
  const state: Record<string, unknown> = {}
  const calls: { name: string; args: unknown[] }[] = []
  const sets: { prop: string; value: unknown }[] = []
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (prop === 'measureText') return () => ({ width: 8 })
      if (prop === 'createLinearGradient') return () => ({ addColorStop: () => {} })
      if (typeof prop === 'string' && prop in target) return target[prop]
      return (...args: unknown[]) => { calls.push({ name: String(prop), args }) }
    },
    set(target, prop, value) {
      sets.push({ prop: String(prop), value })
      target[prop as string] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  const named = (name: string) => calls.filter((c) => c.name === name)
  return { ctx, calls, sets, named }
}

const S7 = '0x0A1992BC42C9679F'
const MA40 = '0x33334444AAAABBBB'

/** 'A' holding `weapon` (label `key`), zoomed to `level` the whole life, with 4 in the magazine. */
function aimDoc(level: number, weapon = S7, key = 'hinf_s7_sniper') {
  return testReplayDoc({
    frameIntervalMs: 20,
    tracks: [{ slot: 512, xuid: 'A', team: -1, startFrame: 0, endFrame: 1000, points: [{ t: 0, x: 0, y: 0, z: 0, h: 0, s: level }, { t: 1000, x: 0, y: 0, z: 0, h: 0, s: level }] }],
    inventory: [{ t: 0, slot: 512, d: 0, am: [{ mag: 4, res: 20 }], g: [] }],
    loadouts: [{ t: 0, slot: 512, w: [weapon] }],
    roster: [{ filmIndex: 0, xuid: 'A', name: 'Alpha', team: 0 }],
    weaponLabels: { [weapon]: { en: key, fr: key, key } },
  })
}

/** A loader that "rasterizes" an overlay to an object carrying its SVG. */
const fakeLoad = vi.fn(async (svg: string) => ({ svg }) as unknown as CanvasImageSource)

describe('the first-person aim and the place label', () => {
  const VIEW_FILE = { width: 960, height: 540 }

  beforeEach(() => {
    fakeLoad.mockClear()
    document.documentElement.style.setProperty('--reticle-hostile', '#ff1100')
    document.documentElement.style.setProperty('--replay-hud-on-dark', '#eaf2f5')
  })

  afterEach(() => {
    document.documentElement.style.removeProperty('--reticle-hostile')
    document.documentElement.style.removeProperty('--replay-hud-on-dark')
  })

  it('S7 scoped: the S7 overlay over the whole frame, faded with the zoom, no hip reticle', async () => {
    const hud = await createExportHud(aimDoc(1), 'A', [], null, null, 'en', { aim: true, loadSvg: fakeLoad })
    const rec = callRecorder()
    hud(rec.ctx, VIEW_FILE, 50)
    const draws = rec.named('drawImage')
    expect(draws).toHaveLength(1)
    expect((draws[0].args[0] as { svg: string }).svg).toContain('data-ads="s7"')
    expect(draws[0].args.slice(1)).toEqual([0, 0, 960, 540])
    // The S7's own reticle replaces the hip one: no arc at the center.
    expect(rec.named('arc')).toHaveLength(0)
  })

  it('at the hip: the weapon hip reticle at the center, no overlay', async () => {
    const hud = await createExportHud(aimDoc(0), 'A', [], null, null, 'en', { aim: true, loadSvg: fakeLoad })
    const rec = callRecorder()
    hud(rec.ctx, VIEW_FILE, 50)
    expect(rec.named('drawImage')).toHaveLength(0)
    // The S7 hip reticle is a dot ('point'): one arc at the center.
    const arcs = rec.named('arc')
    expect(arcs).toHaveLength(1)
    expect(arcs[0].args.slice(0, 2)).toEqual([480, 270])
  })

  it('smart link zoomed: the frame, its magazine count, and the hip reticle kept', async () => {
    const hud = await createExportHud(aimDoc(1, MA40, 'hinf_ma40_ar'), 'A', [], null, null, 'en', { aim: true, loadSvg: fakeLoad })
    const rec = callRecorder()
    hud(rec.ctx, VIEW_FILE, 50)
    expect((rec.named('drawImage')[0].args[0] as { svg: string }).svg).toContain('data-ads="smartLink"')
    const u = 540 / 720
    expect(rec.named('fillText').some((c) => c.args[0] === '04' && c.args[1] === 480 + 152 * u && c.args[2] === 270 - 119 * u)).toBe(true)
    expect(rec.named('arc').length).toBeGreaterThan(0)
  })

  it('third person: no reticle and no overlay, nothing rasterized', async () => {
    const hud = await createExportHud(aimDoc(1), 'A', [], null, null, 'en', { aim: false, loadSvg: fakeLoad })
    const rec = callRecorder()
    hud(rec.ctx, VIEW_FILE, 50)
    expect(fakeLoad).not.toHaveBeenCalled()
    expect(rec.named('drawImage')).toHaveLength(0)
    expect(rec.named('arc')).toHaveLength(0)
  })

  it('over an enemy: the hip reticle turns hostile red, and the red overlays are loaded', async () => {
    const redReticle = vi.fn(() => true)
    const hud = await createExportHud(aimDoc(0, MA40, 'hinf_ma40_ar'), 'A', [], null, null, 'en', { aim: true, loadSvg: fakeLoad, redReticle })
    expect(fakeLoad.mock.calls.some(([svg]) => svg.includes('#ff1100'))).toBe(true)
    const rec = callRecorder()
    hud(rec.ctx, VIEW_FILE, 50)
    expect(redReticle).toHaveBeenCalledWith(50, expect.anything(), { weaponId: MA40, zoomLevel: 0 })
    expect(rec.sets.filter((s) => s.prop === 'strokeStyle').map((s) => s.value)).toContain('#ff1100')
  })

  it('the place label bottom left, in capitals, only inside a named area', async () => {
    const zone = (x: number) => prepareCallouts({ version: 1, source: 'level', zones: [{ en: 'Overhang', polygon: [[x - 1, -1], [x + 1, -1], [x + 1, 1], [x - 1, 1]], zBottom: -1, zTop: 2 }] })
    const inside = await createExportHud(aimDoc(0), 'A', [], null, null, 'en', { callouts: zone(0) })
    const rec = callRecorder()
    inside(rec.ctx, VIEW_FILE, 50)
    const label = rec.named('fillText').find((c) => c.args[0] === 'OVERHANG')
    expect(label?.args.slice(1)).toEqual([960 * 0.03, 540 * 0.94])
    const outside = await createExportHud(aimDoc(0), 'A', [], null, null, 'en', { callouts: zone(50) })
    const none = callRecorder()
    outside(none.ctx, VIEW_FILE, 50)
    expect(none.named('fillText').some((c) => c.args[0] === 'OVERHANG')).toBe(false)
  })
})

describe('createExportHud', () => {
  it('paints the kill feed with the team colors current at paint time', async () => {
    const hud = await createExportHud(doc(), 'A', toReplayKills([enemyKill()], 0), null, null, 'en')

    const first = recordingCtx()
    hud(first.ctx, VIEW, 100)
    expect(first.fills).toContain('#ef4444')
    expect(first.fills).toContain('#22c55e')

    // The user changes the enemy color after the HUD was built (the settings section does
    // exactly this on the document root).
    document.documentElement.style.setProperty('--team-enemy', '#8b5cf6')

    const second = recordingCtx()
    hud(second.ctx, VIEW, 100)
    expect(second.fills).toContain('#8b5cf6')
    expect(second.fills).not.toContain('#ef4444')
  })

  describe('shield bar', () => {
    beforeEach(() => {
      // jsdom does not load index.css: pose the shield tokens the way the app does.
      for (const [name, value] of [
        ['--replay-hud-shield', '#c2e3f8'],
        ['--replay-hud-shield-deep', '#86a7c4'],
        ['--replay-hud-shield-rim', '#dcefff'],
        ['--replay-hud-shield-track', 'rgba(8, 16, 26, 0.35)'],
        ['--replay-hud-shield-alert', '#ff4b3e'],
      ]) document.documentElement.style.setProperty(name, value)
    })

    afterEach(() => {
      for (const name of ['--replay-hud-shield', '--replay-hud-shield-deep', '--replay-hud-shield-rim', '--replay-hud-shield-track', '--replay-hud-shield-alert']) {
        document.documentElement.style.removeProperty(name)
      }
    })

    it('draws the glass bar and a center fill that drains from both ends at 50%', async () => {
      const hud = await createExportHud(shieldDoc(), 'A', [], null, null, 'en')
      const { ctx, fillRects, gradientStops } = recordingCtxFull()
      hud(ctx, VIEW, 30)
      // There should be at least one fillRect (the shield fill band).
      expect(fillRects.length).toBeGreaterThan(0)
      // The gradient is bright at the center: main color at offset 0.5, deep at the ends.
      expect(gradientStops.length).toBe(3)
      expect(gradientStops[1].offset).toBe(0.5)
      expect(gradientStops[1].color).toBe('#c2e3f8')
      expect(gradientStops[0].color).toBe('#86a7c4')
      expect(gradientStops[2].color).toBe('#86a7c4')
    })

    it('turns the fill red when the shield is low', async () => {
      const hud = await createExportHud(shieldDoc(), 'A', [], null, null, 'en')
      const { ctx, gradientStops } = recordingCtxFull()
      // Sample at t=200 is 0.2 (< 0.25), so frame 150+ is low.
      hud(ctx, VIEW, 150)
      // The alert color is the main ink of the gradient when low: the center stop turns red.
      expect(gradientStops.length).toBe(3)
      expect(gradientStops[1].color).toBe('#ff4b3e')
    })

    it('does not draw the old plain rectangle shield', async () => {
      const hud = await createExportHud(shieldDoc(), 'A', [], null, null, 'en')
      const { ctx, fillRects } = recordingCtxFull()
      hud(ctx, VIEW, 30)
      // The old shield was a full-width rect from the left edge; no fillRect should
      // start at the bar's left edge and span the full bar width.
      const barLeft = 460
      expect(fillRects.some((r) => Math.abs(r.x - barLeft) < 1 && r.w >= 350)).toBe(false)
    })
  })
})
