// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * aimHud.test.ts — the first-person aim shared by the live HUD and the export: the hip reticle's
 * shape per weapon family, and, at a frame, which ADS overlay is drawn and whether the hip
 * reticle stays (an overlay with its own reticle hides it past half the fade).
 */
import { describe, expect, it } from 'vitest'

import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import { aimHudAt, heldModelKey, reticleBoxPx, reticleGeometry, segmentsPath } from './aimHud'

describe('reticleGeometry', () => {
  it('draws each family the way the live SVG did', () => {
    expect(reticleGeometry('default', 0, 0)).toMatchObject({ ring: 25, dot: true, ticks: [], hit: null })
    expect(reticleGeometry('large', 0, 0)).toMatchObject({ ring: 32, dot: false })
    expect(reticleGeometry('precision', 0, 0)).toMatchObject({ ring: 15, dot: true })
    expect(reticleGeometry('dot', 0, 0)).toMatchObject({ ring: null, dot: true, ticks: [] })
    const pistol = reticleGeometry('pistol', 0, 0)
    expect(pistol.ring).toBeNull()
    expect(segmentsPath(pistol.ticks)).toBe('M50 18L50 23 M50 77L50 82 M18 50L23 50 M77 50L82 50')
  })

  it('marks a hit in the reticle color and a kill heavier, at the mark opacity', () => {
    expect(reticleGeometry('circle', 0, 0.4).hit).toMatchObject({ kill: false, opacity: 0.4 })
    expect(reticleGeometry('circle', 0.8, 0.4).hit).toMatchObject({ kill: true, opacity: 0.8 })
    expect(segmentsPath(reticleGeometry('circle', 1, 0).hit!.segments)).toBe('M20 20L27 27 M80 20L73 27 M20 80L27 73 M80 80L73 73')
  })

  it('sizes the box at 10 % of the height, never under 50 px', () => {
    expect(reticleBoxPx(540)).toBe(54)
    expect(reticleBoxPx(300)).toBe(50)
  })
})

describe('heldModelKey', () => {
  it('is the first eight hex digits, lowercase, without the prefix', () => {
    expect(heldModelKey('0x0A1992BC42C9679F')).toBe('0a1992bc')
    expect(heldModelKey(undefined)).toBeUndefined()
  })
})

/** A life of 'A' zoomed to `level` from frame 0 to 100, at the hip after (20 ms frames). */
function zoomDoc(level: number): ReplayDocumentReady {
  return {
    frameIntervalMs: 20,
    tracks: [{ slot: 1, team: -1, xuid: 'A', startFrame: 0, endFrame: 1000, points: [{ t: 0, x: 0, y: 0, h: 0, s: level }, { t: 100, x: 0, y: 0, h: 0, s: 0 }] }],
  } as ReplayDocumentReady
}

describe('aimHudAt', () => {
  it('S7 scoped: its own overlay at the zoom level, the hip reticle hidden', () => {
    const aim = aimHudAt(zoomDoc(2), 'A', 50, '0a1992bc', 'hinf_s7_sniper', null)
    expect(aim.ads?.design).toBe('s7')
    expect(aim.adsLevel).toBe(1)
    expect(aim.zoom.amount).toBe(1)
    expect(aim.reticleShown).toBe(false)
  })

  it('at the hip: no overlay, the hip reticle at full size', () => {
    const aim = aimHudAt(zoomDoc(0), 'A', 50, '0a1992bc', 'hinf_s7_sniper', null)
    expect(aim.ads).toBeNull()
    expect(aim.reticleShown).toBe(true)
    expect(aim.reticleScale).toBe(1)
  })

  it('smart link zoomed: the cyan frame, and the hip reticle stays, 30 % smaller', () => {
    const aim = aimHudAt(zoomDoc(1), 'A', 50, undefined, 'hinf_ma40_ar', null)
    expect(aim.ads?.design).toBe('smartLink')
    expect(aim.reticleShown).toBe(true)
    expect(aim.reticleScale).toBeCloseTo(0.7)
  })

  it('selects each weapon its own overlay, by label or by model key', () => {
    const design = (model: string | undefined, label: string | undefined) => aimHudAt(zoomDoc(1), 'A', 50, model, label, null).ads?.design ?? null
    expect(design(undefined, 'hinf_skewer')).toBe('skewer')
    expect(design(undefined, 'hinf_bandit')).toBe('bandit')
    expect(design(undefined, 'hinf_vestige_carbine')).toBe('vestige')
    expect(design('1a22fee6', undefined)).toBe('shock')
    // A weapon nobody captured, not scoped: no overlay, its hip reticle only.
    expect(design(undefined, 'hinf_unknown')).toBeNull()
  })

  it('fading out: the overlay keeps the level it left, the hip reticle returns below half the fade', () => {
    // The zoom leaves at frame 100; the fade lasts 120 ms = 6 frames.
    const early = aimHudAt(zoomDoc(2), 'A', 101, '0a1992bc', 'hinf_s7_sniper', null)
    expect(early.ads?.design).toBe('s7')
    expect(early.adsLevel).toBe(1)
    const late = aimHudAt(zoomDoc(2), 'A', 105, '0a1992bc', 'hinf_s7_sniper', null)
    expect(late.zoom.amount).toBeLessThan(0.5)
    expect(late.reticleShown).toBe(true)
  })
})
