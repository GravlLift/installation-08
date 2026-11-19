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
import { SHIELD_CHASE_INK, SHIELD_QUAD_URL } from '../model/shieldHud'
import { teamEmblemUrl } from '../model/teamEmblem'
import { SCORE_METER_URL } from '../ui/scoreMeter'
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

/** A loading `Image` that fails on the quad bitmap (jsdom never fires load on its own):
 * this file's tests pin the legacy hand-made bar; the quad mode is its own test and stubs
 * its own `Image`. */
class FakeQuadFailingImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(url: string) { queueMicrotask(() => (url === SHIELD_QUAD_URL ? this.onerror?.() : this.onload?.())) }
}

beforeEach(() => {
  localStorage.clear()
  // jsdom does not load index.css: pose the defaults the way the app does.
  document.documentElement.style.setProperty('--team-ally', '#22c55e')
  document.documentElement.style.setProperty('--team-enemy', '#ef4444')
  vi.stubGlobal('Image', FakeQuadFailingImage)
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.style.removeProperty('--team-ally')
  document.documentElement.style.removeProperty('--team-enemy')
})

/** A doc whose followed player's life carries shield samples (`sh`), so the bar is drawn. */
function shieldDoc(after = 0.1) {
  return testReplayDoc({
    roster: [
      { filmIndex: 0, xuid: 'A', name: 'Alpha', team: 0 },
      { filmIndex: 1, xuid: 'B', name: 'Bravo', team: 0 },
      { filmIndex: 2, xuid: 'C', name: 'Charlie', team: 1 },
    ],
    tracks: [
      { slot: 0, team: 0, xuid: 'A', points: [{ t: 0, x: 0, y: 0, sh: 0.5 }, { t: 100, x: 0, y: 0, sh: after }, { t: 200, x: 0, y: 0, sh: after }] },
      { slot: 1, team: 0, xuid: 'B', points: [{ t: 0, x: 0, y: 0 }, { t: 200, x: 0, y: 0 }] },
      { slot: 2, team: 1, xuid: 'C', points: [{ t: 0, x: 0, y: 0 }, { t: 200, x: 0, y: 0 }] },
    ],
  })
}

/**
 * A shield doc that also has damage events, on a slot that is not the followed player: the
 * export then preloads the chase bitmap, while the followed player's damage ring stays empty.
 */
function shieldDocWithDamages() {
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
    damages: [{ t: 50, slot: 99, by: 512 }],
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

    it('right after a drop fills the chase band additively, and none once it has closed', async () => {
      const hud = await createExportHud(shieldDoc(), 'A', [], null, null, 'en')
      // The drop (0.5 -> 0.1) lands at frame 100: the band spans from the live fill out to the
      // chase, on each side, inside the bar's clip (band width (250 - 50) * s, s = 0.36 here).
      const dropped = callRecorder()
      hud(dropped.ctx, VIEW, 100)
      const bands = dropped.named('fillRect').filter((c) => c.args[1] === 720 * 0.08)
      expect(bands.some((c) => c.args[0] === 460 + 250 * 0.36 && c.args[2] === 200 * 0.36)).toBe(true)
      expect(bands.some((c) => c.args[0] === 460 + 550 * 0.36 && c.args[2] === 200 * 0.36)).toBe(true)
      expect(dropped.sets.some((s) => s.prop === 'globalCompositeOperation' && s.value === 'lighter')).toBe(true)
      expect(dropped.sets.some((s) => s.prop === 'fillStyle' && s.value === SHIELD_CHASE_INK)).toBe(true)
      // 1000 ms past the drop (frame 170): the chase has closed on the live value, no band.
      const closed = callRecorder()
      hud(closed.ctx, VIEW, 170)
      expect(closed.sets.some((s) => s.prop === 'globalCompositeOperation' && s.value === 'lighter')).toBe(false)
      expect(closed.sets.some((s) => s.prop === 'fillStyle' && s.value === SHIELD_CHASE_INK)).toBe(false)
    })

    it('still draws the chase band when the hit empties the shield (no fill left)', async () => {
      const hud = await createExportHud(shieldDoc(0), 'A', [], null, null, 'en')
      const dropped = callRecorder()
      hud(dropped.ctx, VIEW, 100)
      // The band runs from the center out to the chase on each side: 250 units wide, s = 0.36.
      const bands = dropped.named('fillRect').filter((c) => c.args[1] === 720 * 0.08)
      expect(bands.some((c) => c.args[0] === 460 + 250 * 0.36 && c.args[2] === 250 * 0.36)).toBe(true)
      expect(bands.some((c) => c.args[0] === 460 + 500 * 0.36 && c.args[2] === 250 * 0.36)).toBe(true)
      expect(dropped.sets.some((s) => s.prop === 'fillStyle' && s.value === SHIELD_CHASE_INK)).toBe(true)
    })

    it('with the bitmap loaded, draws the tinted band under a clip, not the flat rects', async () => {
      // The bitmap preloads only when the match has damage events, and it loads (jsdom never
      // fires load on its own): the same microtask stub the icon tests use. The quad bitmap is
      // FAILED on purpose: this test pins the legacy hand-made bar (the quad mode is its own test).
      class FakeImage {
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        set src(url: string) { queueMicrotask(() => (url === SHIELD_QUAD_URL ? this.onerror?.() : this.onload?.())) }
      }
      vi.stubGlobal('Image', FakeImage)
      // The bitmap read by `tintedChase`: a canvas stub over a buffer of the bitmap's own size.
      const buffer = new Uint8ClampedArray(940 * 64 * 4)
      const bitmapCtx = {
        clearRect: () => {},
        drawImage: () => { buffer.fill(77) },
        getImageData: () => ({ data: buffer }),
        putImageData: () => {},
      }
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
        tag === 'canvas' ? ({ width: 0, height: 0, getContext: () => bitmapCtx } as unknown as HTMLElement) : ({} as HTMLElement))
      const hud = await createExportHud(shieldDocWithDamages(), 'A', [], null, null, 'en')
      const dropped = callRecorder()
      hud(dropped.ctx, VIEW, 100)
      // The band: one drawImage of the tinted bitmap stretched to the bar's box, additive.
      const draws = dropped.named('drawImage')
      expect(draws).toHaveLength(1)
      const [, dx, dy, dw, dh] = draws[0].args as [unknown, number, number, number, number]
      expect(dx).toBe(460)
      expect(dy).toBe(720 * 0.08)
      expect(dw).toBe(360)
      expect(dh).toBeCloseTo(360 * 74 / 1000, 12)
      expect(dropped.sets.some((s) => s.prop === 'globalCompositeOperation' && s.value === 'lighter')).toBe(true)
      // No flat fallback: no band-width rect at the bar's y, no tint fillStyle.
      const rectsAtBar = dropped.named('fillRect').filter((c) => c.args[1] === 720 * 0.08)
      expect(rectsAtBar.some((c) => c.args[2] === 200 * 0.36)).toBe(false)
      expect(dropped.sets.some((s) => s.prop === 'fillStyle' && s.value === SHIELD_CHASE_INK)).toBe(false)
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    })

    it('with the quad loaded, masks the bar to the quad: the quad image drawn with destination-in', async () => {
      // Both bitmaps load (jsdom never fires load on its own): the same microtask stub the
      // legacy test uses, this time with the quad among them.
      const made: FakeQuadImage[] = []
      class FakeQuadImage {
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        private _src = ''
        constructor() { made.push(this) }
        get src() { return this._src }
        set src(url: string) { this._src = url; queueMicrotask(() => this.onload?.()) }
      }
      vi.stubGlobal('Image', FakeQuadImage)
      // The offscreen canvas the quad mode composes on: a recording context (the same stub the
      // legacy test uses for the chase bitmap's canvas; `getImageData` feeds `tintedChase`).
      const events: { kind: 'op' | 'set'; name: string; args?: unknown[]; value?: unknown }[] = []
      const octx = new Proxy({}, {
        get(_t, prop) {
          if (prop === 'createLinearGradient') return () => ({ addColorStop: () => {} })
          if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(940 * 64 * 4) })
          return (...args: unknown[]) => { events.push({ kind: 'op', name: String(prop), args }); return undefined }
        },
        set(_t, prop, value) { events.push({ kind: 'set', name: String(prop), value }); return true },
      }) as unknown as CanvasRenderingContext2D
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
        tag === 'canvas' ? ({ width: 0, height: 0, getContext: () => octx } as unknown as HTMLElement) : ({} as HTMLElement))
      const hud = await createExportHud(shieldDocWithDamages(), 'A', [], null, null, 'en')
      const dropped = callRecorder()
      hud(dropped.ctx, VIEW, 100)
      // The frame receives one drawImage: the offscreen canvas, at the bar's position and width
      // with the quad's aspect (80/940), not the legacy 74/1000.
      const draws = dropped.named('drawImage')
      expect(draws).toHaveLength(1)
      const [, dx, dy, dw, dh] = draws[0].args as [unknown, number, number, number, number]
      expect(dx).toBe(460)
      expect(dy).toBe(720 * 0.08)
      expect(dw).toBe(360)
      expect(dh).toBeCloseTo(360 * 80 / 940, 12)
      // On the offscreen canvas: the chase band is additive, and the quad's alpha is applied
      // as a mask with `destination-in`: the quad image is read into the boosted-alpha mask
      // canvas, and that mask is drawn over the whole box right after the mask is set.
      const quad = made.find((img) => img.src === SHIELD_QUAD_URL)
      expect(quad).toBeDefined()
      expect(events.some((e) => e.kind === 'op' && e.name === 'drawImage' && e.args?.[0] === quad)).toBe(true)
      const maskSet = events.findIndex((e) => e.kind === 'set' && e.name === 'globalCompositeOperation' && e.value === 'destination-in')
      expect(maskSet).toBeGreaterThanOrEqual(0)
      const maskDraw = events.findIndex((e, i) => i > maskSet && e.kind === 'op' && e.name === 'drawImage')
      expect(maskDraw).toBeGreaterThan(maskSet)
      expect((events[maskDraw].args as unknown[])[3]).toBe(360)
      expect(events.some((e) => e.kind === 'set' && e.name === 'globalCompositeOperation' && e.value === 'lighter')).toBe(true)
      // The band sits at the chase's own offset in the 80-tall quad, at the bar's pixel width.
      const u = 360 / 940
      expect(events.some((e) => e.kind === 'op' && e.name === 'drawImage' && e.args?.[1] === 0 && Math.abs(e.args?.[2] as number - 8 * u) < 1e-9 && e.args?.[3] === 360 && Math.abs(e.args?.[4] as number - 64 * u) < 1e-9)).toBe(true)
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
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

  describe('team emblems at the score bars', () => {
    /** The followed player is on camp 0; the timeline names camps 0 (10) and 1 (5) of 250. */
    function scoreDoc() {
      return testReplayDoc({
        roster: [
          { filmIndex: 0, xuid: 'A', name: 'Alpha', team: 0 },
          { filmIndex: 1, xuid: 'B', name: 'Bravo', team: 0 },
          { filmIndex: 2, xuid: 'C', name: 'Charlie', team: 1 },
        ],
        scoreTimeline: {
          targetScore: 250,
          teams: [
            { teamId: 0, total: [{ t: 10, v: 10 }], rounds: [] },
            { teamId: 1, total: [{ t: 20, v: 5 }], rounds: [] },
          ],
        },
      })
    }

    /** A recording context: every `drawImage` is captured with the `globalAlpha` in effect. */
    function emblemCtx() {
      const state: Record<string, unknown> = {}
      const draws: { img: unknown; x: number; y: number; w: number; h: number; alpha: number }[] = []
      const ctx = new Proxy(state, {
        get(target, prop) {
          if (prop === 'measureText') return () => ({ width: 8 })
          if (prop === 'drawImage') return (img: unknown, x: number, y: number, w: number, h: number) => { draws.push({ img, x, y, w, h, alpha: (target.globalAlpha as number | undefined) ?? 1 }) }
          if (typeof prop === 'string' && prop in target) return target[prop]
          return () => {}
        },
        set(target, prop, value) { target[prop as string] = value; return true },
      }) as unknown as CanvasRenderingContext2D
      return { ctx, draws }
    }

    /** A loading `Image` (jsdom never fires load on its own) that fails on `fail(url)`: the
     * icons test's microtask pattern; `made` keeps each instance so a draw matches a URL. */
    function fakeImages(fail: (url: string) => boolean) {
      const made: { src: string }[] = []
      const requested: string[] = []
      class FakeImage {
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        private _src = ''
        get src() { return this._src }
        set src(url: string) {
          this._src = url
          requested.push(url)
          made.push(this as { src: string })
          queueMicrotask(() => (fail(url) ? this.onerror?.() : this.onload?.()))
        }
      }
      vi.stubGlobal('Image', FakeImage)
      return { made, requested }
    }

    it('draws each side emblem at the bar outer end, at 0.7, when its image loaded', async () => {
      const { made } = fakeImages(() => false)
      const hud = await createExportHud(scoreDoc(), 'A', [], null, null, 'en')
      const { ctx, draws } = emblemCtx()
      hud(ctx, VIEW, 100)
      // The game's proportions (cusc 21a7dab4): 1.55 x the bar height (size * 0.8), a gap of
      // 0.27 x the bar height beyond the bar's outer end, centered on the bar.
      const size = Math.max(19, Math.min(39, 7.7 + VIEW.height * 0.0287))
      const bar = size * 4.2
      const emblemH = size * 0.8 * 1.55
      const gap = size * 0.8 * 0.27
      const y = VIEW.height * 0.94 - size * 0.7
      const leftBar = VIEW.width / 2 - size * 1.6 - bar
      const rightBar = VIEW.width / 2 + size * 1.6
      const allyEmblem = made.find((img) => img.src === teamEmblemUrl(0))
      const enemyEmblem = made.find((img) => img.src === teamEmblemUrl(1))
      expect(allyEmblem).toBeDefined()
      expect(enemyEmblem).toBeDefined()
      expect(draws.some((d) => d.img === allyEmblem && d.alpha === 0.7 && d.w === emblemH && d.h === emblemH && d.x === leftBar - gap - emblemH && d.y === y - emblemH / 2)).toBe(true)
      expect(draws.some((d) => d.img === enemyEmblem && d.alpha === 0.7 && d.w === emblemH && d.h === emblemH && d.x === rightBar + bar + gap && d.y === y - emblemH / 2)).toBe(true)
      vi.unstubAllGlobals()
    })

    it('draws no emblem when its image failed to load, though it was preloaded', async () => {
      const { requested } = fakeImages((url) => url.startsWith('/static/weapons-assets/halo_infinite/hud/TeamEmblem'))
      const hud = await createExportHud(scoreDoc(), 'A', [], null, null, 'en')
      const { ctx, draws } = emblemCtx()
      hud(ctx, VIEW, 100)
      // The document's two camps were preloaded, their emblems failed: nothing is drawn
      // (the quad fails in this file too, and there is no shield to draw).
      expect(requested).toContain(teamEmblemUrl(0))
      expect(requested).toContain(teamEmblemUrl(1))
      expect(draws).toHaveLength(0)
      vi.unstubAllGlobals()
    })
  })

  describe('score bars filled with the game meter', () => {
    /** The followed player is on camp 0; the timeline names camps 0 (10) and 1 (5) of 250, so
     * both bars carry a nonzero fill (each side is ~5% of the 250 target). */
    function scoreDoc() {
      return testReplayDoc({
        roster: [
          { filmIndex: 0, xuid: 'A', name: 'Alpha', team: 0 },
          { filmIndex: 1, xuid: 'B', name: 'Bravo', team: 0 },
          { filmIndex: 2, xuid: 'C', name: 'Charlie', team: 1 },
        ],
        scoreTimeline: {
          targetScore: 250,
          teams: [
            { teamId: 0, total: [{ t: 10, v: 10 }], rounds: [] },
            { teamId: 1, total: [{ t: 20, v: 5 }], rounds: [] },
          ],
        },
      })
    }

    /** A canvas whose 2d context is a fake: `getImageData` serves a fully-shaped mask (G and B
     * high everywhere), so `readScoreMeterMask` returns a real mask and `paintScoreMeter` runs. */
    function maskCanvasStub() {
      const buffer = new Uint8ClampedArray(400 * 64 * 4)
      for (let i = 0; i < buffer.length; i += 4) { buffer[i + 1] = 255; buffer[i + 2] = 255 } // G ramp, B shape
      const octx = {
        clearRect: () => {},
        drawImage: () => {},
        getImageData: () => ({ data: buffer }),
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: () => {},
      }
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
        tag === 'canvas' ? ({ width: 0, height: 0, getContext: () => octx } as unknown as HTMLElement) : ({} as HTMLElement))
    }

    /** A loading `Image` that loads every URL (jsdom never fires load on its own). */
    function loadingImages() {
      class FakeImage {
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        set src(_url: string) { queueMicrotask(() => this.onload?.()) }
      }
      vi.stubGlobal('Image', FakeImage)
    }

    it('with the meter bitmap loaded, fills the bars with the meter, not the flat rect', async () => {
      loadingImages()
      maskCanvasStub()
      const hud = await createExportHud(scoreDoc(), 'A', [], null, null, 'en')
      const rec = callRecorder()
      hud(rec.ctx, VIEW, 100)
      // Each side's fill is drawn through the meter (a drawImage of its scratch canvas), at the
      // bar's position, under the 0.7 fill alpha.
      const draws = rec.named('drawImage')
      expect(draws.length).toBeGreaterThanOrEqual(2)
      expect(rec.sets.some((s) => s.prop === 'globalAlpha' && s.value === 0.7)).toBe(true)
      // The team colors are NOT used as a fill: the flat fillRect the meter replaces is gone.
      expect(rec.sets.some((s) => s.prop === 'fillStyle' && (s.value === '#22c55e' || s.value === '#ef4444'))).toBe(false)
      // No legacy fill at the bar's fill geometry: only the full-width track rect sits at the
      // fill's y, no partial-width fill rect.
      const size = Math.max(19, Math.min(39, 7.7 + VIEW.height * 0.0287))
      const bar = size * 4.2
      const fillY = VIEW.height * 0.94 - size * 0.7 - size * 0.4
      const rects = rec.named('fillRect')
      expect(rects.some((c) => Math.abs((c.args[1] as number) - fillY) < 1 && (c.args[2] as number) > 0 && (c.args[2] as number) < bar)).toBe(false)
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    })

    it('without the meter bitmap, fills the bars with the flat rect, as before', async () => {
      // The meter bitmap fails to load (the quad fails in this file too): the legacy fill is used.
      class FakeImage {
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        set src(url: string) { queueMicrotask(() => (url === SCORE_METER_URL ? this.onerror?.() : this.onload?.())) }
      }
      vi.stubGlobal('Image', FakeImage)
      const hud = await createExportHud(scoreDoc(), 'A', [], null, null, 'en')
      const rec = callRecorder()
      hud(rec.ctx, VIEW, 100)
      // The flat fill: each side's team color is set as the fillStyle and a partial-width rect
      // is drawn at the fill's geometry.
      expect(rec.sets.some((s) => s.prop === 'fillStyle' && (s.value === '#22c55e' || s.value === '#ef4444'))).toBe(true)
      const size = Math.max(19, Math.min(39, 7.7 + VIEW.height * 0.0287))
      const bar = size * 4.2
      const fillY = VIEW.height * 0.94 - size * 0.7 - size * 0.4
      const rects = rec.named('fillRect')
      expect(rects.some((c) => Math.abs((c.args[1] as number) - fillY) < 1 && (c.args[2] as number) > 0 && (c.args[2] as number) < bar)).toBe(true)
      vi.unstubAllGlobals()
    })
  })
})
