// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { afterEach, expect, it, vi } from 'vitest'
import { testReplayDoc } from '../test/testDoc'
import type { ReplayKill } from '../model/killFeedLogic'
import { createExportHud } from './exportHud'

vi.mock('../model/hud3d_logic', () => ({
  prepareHud: () => ({}),
  readScoreHud: () => null,
  hudClock: () => 0,
  readHud: () => ({ shield: null, label: { img: '/jeu/contour-01.png', tinted: true }, ammo: { mag: 12, res: 24 }, grenades: [{ rank: 0, name: 'Frag', count: 1 }] }),
  readKillFeed: () => [
    { kill: { xuid: 'a', victimXuid: 'b', victimGamertag: 'Bravo', weaponImageUrl: '/weapon.png', weaponTinted: true }, opacity: 1, killer: true, victim: false },
    { kill: { xuid: 'a', victimXuid: 'b', victimGamertag: 'Bravo', weaponImageUrl: '/missing.png', weaponLabel: 'Bandit Evo / M392 Bandit' }, opacity: 1, killer: true, victim: false },
  ],
}))
vi.mock('../layers/replayDraw', () => ({ tintedIconCanvas: () => ({ width: 100, height: 50 }) }))

afterEach(() => vi.unstubAllGlobals())

it('preloads and paints HUD icons, using a short label when an image is unavailable', async () => {
  const requested: string[] = []
  class FakeImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(url: string) {
      requested.push(url)
      queueMicrotask(() => (url === '/missing.png' ? this.onerror?.() : this.onload?.()))
    }
  }
  vi.stubGlobal('Image', FakeImage)
  const doc = testReplayDoc({ weaponLabels: { a: { en: 'Rifle', fr: 'Rifle', img: '/jeu/contour-01.png' } }, grenadeLabels: [{ en: 'Frag', fr: 'Frag', img: '/grenade.png' }] })
  const kills = [{ weaponImageUrl: '/weapon.png' }, { weaponImageUrl: '/missing.png' }] as ReplayKill[]
  const paint = await createExportHud(doc, 'a', kills, null, null, 'en')
  const ctx = { save: vi.fn(), restore: vi.fn(), fillText: vi.fn(), measureText: (s: string) => ({ width: s.length }), drawImage: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), stroke: vi.fn(), fill: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn() } as unknown as CanvasRenderingContext2D
  paint(ctx, { width: 960, height: 540 }, 0)
  paint(ctx, { width: 960, height: 540 }, 1)
  expect(requested.sort()).toEqual(['/grenade.png', '/jeu/silhouette-01.png', '/missing.png', '/weapon.png'].sort())
  expect(ctx.drawImage).toHaveBeenCalledTimes(6)
  expect(ctx.fillText).toHaveBeenCalledWith('Bandit Evo', expect.any(Number), expect.any(Number))
  expect(ctx.fillText).not.toHaveBeenCalledWith('Bandit Evo / M392 Bandit', expect.any(Number), expect.any(Number))
})
