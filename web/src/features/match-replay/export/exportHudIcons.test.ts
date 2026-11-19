// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { afterEach, expect, it, vi } from 'vitest'
import { testReplayDoc } from '../test/testDoc'
import type { ReplayKill } from '../model/killFeedLogic'
import { createExportHud } from './exportHud'

/** The HUD the mock serves by default: the in-hand rifle, a loaded grenade, the away pistol and
 * the carried equipment. `vi.mock` factories are hoisted above module scope, so the shape is
 * duplicated there too; tests swap it through the `vi.hoisted` handle below. */
const MOCK_HUD = { shield: null, label: { img: '/jeu/contour-01.png', tinted: true }, ammo: { mag: 12, res: 24 }, grenade: { rank: 0, name: 'Frag', count: 1 }, away: { id: 'b', label: { en: 'Pistol', fr: 'Pistolet', img: '/jeu/contour-02.png', tinted: false } }, nameTag: { text: 'RIFLE', opacity: 1 }, equipment: { rank: 11, uses: 3 } }
const { readHudMock } = vi.hoisted(() => ({
  readHudMock: { current: { shield: null, label: { img: '/jeu/contour-01.png', tinted: true }, ammo: { mag: 12, res: 24 }, grenade: { rank: 0, name: 'Frag', count: 1 }, away: { id: 'b', label: { en: 'Pistol', fr: 'Pistolet', img: '/jeu/contour-02.png', tinted: false } }, nameTag: { text: 'RIFLE', opacity: 1 }, equipment: { rank: 11, uses: 3 } } as unknown }
}))

vi.mock('../model/hud3d_logic', () => ({
  prepareHud: () => ({}),
  readScoreHud: () => null,
  hudClock: () => 0,
  readHud: () => readHudMock.current,
  readKillFeed: () => [
    { kill: { xuid: 'a', victimXuid: 'b', victimGamertag: 'Bravo', weaponImageUrl: '/weapon.png', weaponTinted: true }, opacity: 1, killer: true, victim: false },
    { kill: { xuid: 'a', victimXuid: 'b', victimGamertag: 'Bravo', weaponImageUrl: '/missing.png', weaponLabel: 'Bandit Evo / M392 Bandit' }, opacity: 1, killer: true, victim: false },
  ],
}))
vi.mock('../layers/replayDraw', () => ({ tintedIconCanvas: (img: { src?: string }) => ({ width: 100, height: 50, src: img?.src }) }))

afterEach(() => vi.unstubAllGlobals())

/** A recording canvas context: every method call and every `fillRect` is captured; `ops` keeps
 * both in paint order, each rect carrying the `globalAlpha` in effect when it was painted. */
function recordingCtx() {
  const calls: Record<string, unknown[][]> = {}
  const rects: { x: number; y: number; w: number; h: number; alpha: number }[] = []
  const ops: { op: string; args?: unknown[]; rect?: { x: number; y: number; w: number; h: number; alpha: number } }[] = []
  const state: Record<string, unknown> = {}
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (prop === 'measureText') return (s: string) => ({ width: String(s).length })
      if (prop === 'fillRect') return (x: number, y: number, w: number, h: number) => { const rect = { x, y, w, h, alpha: (target.globalAlpha as number | undefined) ?? 1 }; rects.push(rect); ops.push({ op: 'fillRect', rect }); return undefined }
      if (typeof prop === 'string' && prop in target) return target[prop]
      return (...args: unknown[]) => { (calls[prop as string] ??= []).push(args); ops.push({ op: prop as string, args }); return undefined }
    },
    set(target, prop, value) { target[prop as string] = value; return true },
  }) as unknown as CanvasRenderingContext2D
  const named = (name: string) => calls[name] ?? []
  return { ctx, rects, ops, named }
}

it('preloads and paints HUD icons, using a short label when an image is unavailable', async () => {
  const requested: string[] = []
  class FakeImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    private _src = ''
    get src() { return this._src }
    set src(url: string) {
      this._src = url
      requested.push(url)
      queueMicrotask(() => (url === '/missing.png' ? this.onerror?.() : this.onload?.()))
    }
  }
  vi.stubGlobal('Image', FakeImage)
  const doc = testReplayDoc({ weaponLabels: { a: { en: 'Rifle', fr: 'Rifle', img: '/jeu/contour-01.png' }, b: { en: 'Pistol', fr: 'Pistolet', img: '/jeu/contour-02.png' } }, grenadeLabels: [{ en: 'Frag', fr: 'Frag', img: '/grenade.png' }], abilityLabels: { '11': { en: 'Translocator', fr: 'Translocateur', img: '/equip.png' } } })
  const kills = [{ weaponImageUrl: '/weapon.png' }, { weaponImageUrl: '/missing.png' }] as ReplayKill[]
  const paint = await createExportHud(doc, 'a', kills, null, null, 'en')
  const { ctx, rects, ops, named } = recordingCtx()
  paint(ctx, { width: 960, height: 540 }, 0)
  paint(ctx, { width: 960, height: 540 }, 1)
  // The equipment icon and the away weapon's silhouette join the preload set.
  expect(requested.sort()).toEqual(['/equip.png', '/grenade.png', '/jeu/silhouette-01.png', '/jeu/silhouette-02.png', '/missing.png', '/weapon.png'].sort())
  // The icons per frame: the kill feed's, the away weapon, the grenade box and the in-hand weapon.
  const draws = named('drawImage')
  expect(draws).toHaveLength(10)
  // The equipment icon is actually PAINTED (not only preloaded): the tinted canvas of
  // /equip.png goes through drawImage, one pass per frame.
  expect(draws.some((args) => (args[0] as { src?: string })?.src === '/equip.png')).toBe(true)
  // The upper row is laid out from the right edge leftward: the grenade box sits to the LEFT
  // of the equipment box (its right edge at the equipment box's left edge minus the gap).
  // With no score, the only fillRects are the two boxes, painted twice (two frames).
  const size = Math.max(19, Math.min(39, 7.7 + 540 * 0.0287))
  const boxHeight = size * 0.78
  const boxes = rects.filter((r) => Math.abs(r.h - boxHeight) < 0.001)
  expect(boxes).toHaveLength(4) // two boxes, two frames
  // First frame: boxes[0] is the equipment box (rightmost, painted first), boxes[1] the grenade.
  const equipmentBox = boxes[0], grenadeBox = boxes[1]
  expect(grenadeBox.x + grenadeBox.w).toBeCloseTo(equipmentBox.x - size * 0.3, 5)
  const texts = (named('fillText') as unknown[][]).map((args) => args[0])
  expect(texts).toContain('Bandit Evo')
  expect(texts).not.toContain('Bandit Evo / M392 Bandit')
  // The name tag is painted (the weapon's name under the in-hand row), at full opacity here.
  expect(texts).toContain('RIFLE')
  // The name tag sits on a dark plate: a fillRect behind the letters, painted BEFORE the tag's
  // fillText, at the tag's opacity.
  readHudMock.current = { ...MOCK_HUD, nameTag: { text: 'RIFLE', opacity: 0.4 } }
  paint(ctx, { width: 960, height: 540 }, 2)
  const plate = rects.find((r) => r.alpha === 0.4 && Math.abs(r.h - 1.7 * size * 0.55) < 0.001)
  expect(plate).toBeDefined()
  const plateOp = ops.findIndex((o) => o.rect === plate)
  const tagOp = ops.findIndex((o, i) => i > plateOp && o.op === 'fillText' && o.args?.[0] === 'RIFLE')
  expect(tagOp).toBeGreaterThan(plateOp)
})

it('an indeterminate grenade (rank null) draws its generic text, no box icon', async () => {
  class FakeImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_url: string) {
      queueMicrotask(() => this.onload?.())
    }
  }
  vi.stubGlobal('Image', FakeImage)
  const doc = testReplayDoc({ weaponLabels: { a: { en: 'Rifle', fr: 'Rifle', img: '/jeu/contour-01.png' } }, grenadeLabels: [{ en: 'Frag', fr: 'Frag', img: '/grenade.png' }] })
  // The mocked HUD swaps in the indeterminate grenade, no equipment.
  readHudMock.current = { ...MOCK_HUD, grenade: { rank: null, name: 'Grenade', count: null }, equipment: null }
  const paint = await createExportHud(doc, 'a', [{ weaponImageUrl: '/weapon.png' }] as ReplayKill[], null, null, 'en')
  const { ctx, named } = recordingCtx()
  paint(ctx, { width: 960, height: 540 }, 0)
  // The indeterminate grenade has no image of its own: its box carries the generic text.
  expect((named('fillText') as unknown[][]).some((args) => args[0] === 'Grenade')).toBe(true)
  // No equipment carried: nothing equipment-shaped is painted.
  expect(named('drawImage').some((args) => (args[0] as { src?: string })?.src === '/equip.png')).toBe(false)
})
