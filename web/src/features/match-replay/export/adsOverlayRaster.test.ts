/**
 * adsOverlayRaster.test.ts — the export's ADS overlays are the live SVG drawing, made a
 * standalone image: the match's weapons pick which overlays are rasterized, the SVG carries no
 * theme variable an image cannot read, every level is loaded in white and hostile red, and the
 * magazine count is printed where the drawing prints it.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ADS_MINIMAL, ADS_OVERLAYS } from '../model/adsOverlay'
import { testReplayDoc } from '../test/testDoc'
import { adsOverlaySvg, adsOverlaysOfDoc, createAdsOverlayAtlas, paintAdsAmmo } from './adsOverlayRaster'

const TOKENS: [string, string][] = [
  ['--replay-ads-shade', '#000'],
  ['--replay-ads-ink', '#101214'],
  ['--replay-ads-white', '#f4f8fa'],
  ['--replay-ads-s7', '#8fd3ff'],
  ['--replay-ads-s7-far', '#8ff0d8'],
  ['--replay-ads-amber', '#ffd34a'],
  ['--reticle-hostile', '#ef4444'],
  ['--display', "'Bahnschrift', system-ui"],
]

beforeEach(() => { for (const [k, v] of TOKENS) document.documentElement.style.setProperty(k, v) })
afterEach(() => { for (const [k] of TOKENS) document.documentElement.style.removeProperty(k) })

describe('adsOverlaysOfDoc', () => {
  it('lists the overlays of the match weapons, and the minimal fallback', () => {
    const doc = testReplayDoc({
      weaponLabels: {
        '0x0A1992BC42C9679F': { en: 'S7', fr: 'S7', key: 'hinf_s7_sniper' },
        '0x11112222': { en: 'Skewer', fr: 'Skewer', key: 'hinf_skewer' },
        '0x33334444': { en: 'MA40', fr: 'MA40', key: 'hinf_ma40_ar' },
        '0x55556666': { en: 'Sidekick', fr: 'Sidekick', key: 'hinf_sidekick' },
      },
    })
    const designs = adsOverlaysOfDoc(doc).map((s) => s.design).sort()
    expect(designs).toEqual(['minimal', 's7', 'skewer', 'smartLink'])
  })
})

describe('adsOverlaySvg', () => {
  it('is a standalone SVG at the file size, every theme variable resolved', () => {
    const svg = adsOverlaySvg(renderToStaticMarkup, ADS_OVERLAYS.hinf_s7_sniper, 1, false, 1920, 1080)
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"')).toBe(true)
    expect(svg).not.toContain('var(--')
    expect(svg).not.toContain('position:absolute')
    // The 10x face's ink, and the display font.
    expect(svg).toContain('#8ff0d8')
    expect(svg).toContain("'Bahnschrift', system-ui")
    expect(svg).toContain('data-ads-level="2"')
  })

  it('draws the center reticle hostile red on request', () => {
    const white = adsOverlaySvg(renderToStaticMarkup, ADS_MINIMAL, 0, false, 1280, 720)
    const red = adsOverlaySvg(renderToStaticMarkup, ADS_MINIMAL, 0, true, 1280, 720)
    expect(white).toContain('#f4f8fa')
    expect(white).not.toContain('#ef4444')
    expect(red).toContain('#ef4444')
  })

  it('leaves the magazine count out of the raster', () => {
    expect(adsOverlaySvg(renderToStaticMarkup, ADS_OVERLAYS.hinf_bandit, 0, false, 1280, 720)).not.toMatch(/<text[^>]*>\d+<\/text>/)
  })
})

describe('createAdsOverlayAtlas', () => {
  it('loads every level in white and red before the first frame, then serves them', async () => {
    const loaded: string[] = []
    const load = vi.fn(async (svg: string) => { loaded.push(svg); return { svg } as unknown as CanvasImageSource })
    const atlas = await createAdsOverlayAtlas([ADS_OVERLAYS.hinf_s7_sniper], { width: 1280, height: 720 }, { hostile: true, load })
    // Two levels, two reticle colors.
    expect(load).toHaveBeenCalledTimes(4)
    const level2Red = atlas.get(ADS_OVERLAYS.hinf_s7_sniper, 1, true) as unknown as { svg: string }
    expect(level2Red.svg).toContain('data-ads-level="2"')
    expect(level2Red.svg).toContain('#ef4444')
    // A level past the last draws the last.
    expect(atlas.get(ADS_OVERLAYS.hinf_s7_sniper, 5, true)).toBe(level2Red)
  })

  it('starts an unforeseen overlay on its first miss and serves it once loaded', async () => {
    const load = vi.fn(async () => ({}) as CanvasImageSource)
    const atlas = await createAdsOverlayAtlas([], { width: 1280, height: 720 }, { hostile: false, load })
    expect(atlas.get(ADS_OVERLAYS.hinf_br75, 0, false)).toBeNull()
    await Promise.resolve()
    await Promise.resolve()
    expect(load).toHaveBeenCalledOnce()
    expect(atlas.get(ADS_OVERLAYS.hinf_br75, 0, false)).not.toBeNull()
  })
})

describe('paintAdsAmmo', () => {
  it('prints the count at the drawing place, in units of 1/720 of the height', () => {
    const fillText = vi.fn()
    const ctx = { save: vi.fn(), restore: vi.fn(), fillText, globalAlpha: 1 } as unknown as CanvasRenderingContext2D
    paintAdsAmmo(ctx, { width: 960, height: 540 }, 'bandit', '15', 'system-ui')
    // Bandit: (340, 13) from the center, right-aligned, 29 units.
    const u = 540 / 720
    expect(fillText).toHaveBeenCalledWith('15', 480 + 340 * u, 270 + 13 * u)
    expect(ctx.textAlign).toBe('right')
    expect(ctx.fillStyle).toBe('#ffd34a')
    expect(ctx.font).toBe(`500 ${29 * u}px system-ui`)
  })

  it('prints nothing for an overlay without a count', () => {
    const fillText = vi.fn()
    paintAdsAmmo({ save: vi.fn(), restore: vi.fn(), fillText } as unknown as CanvasRenderingContext2D, { width: 960, height: 540 }, 's7', '04', 'system-ui')
    expect(fillText).not.toHaveBeenCalled()
  })
})
