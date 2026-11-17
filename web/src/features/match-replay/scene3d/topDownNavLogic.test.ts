// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import {
  FOLLOW_BOX,
  INSET_GAP_PX,
  MAX_ZOOM,
  NAV_HOME,
  NO_INSETS,
  followed,
  frameOf,
  highestBar,
  insetsFrom,
  panBy,
  screenAt,
  wheelFactor,
  worldAt,
  zoomAt,
  type NavContext,
} from './topDownNavLogic'

const BOUNDS = { minX: -10, minZ: 0, maxX: 10, maxZ: 20 }
const VIEW = { width: 1600, height: 900 }
const ctx = (over: Partial<NavContext> = {}): NavContext => ({ bounds: BOUNDS, view: VIEW, insets: NO_INSETS, nav: NAV_HOME, ...over })

describe('frameOf — the whole area in the safe area at zoom 1', () => {
  it('centers the area and fits its depth in a wide view', () => {
    const f = frameOf(BOUNDS, VIEW, NO_INSETS, NAV_HOME)
    expect(f.center).toEqual([0, 10])
    expect(f.halfHeight).toBeCloseTo(10)
    expect(f.halfWidth).toBeCloseTo(17.778)
  })

  it('fits the width in a tall view', () => {
    const f = frameOf(BOUNDS, { width: 900, height: 1600 }, NO_INSETS, NAV_HOME)
    expect(f.halfWidth).toBeCloseTo(10)
  })

  it('frames the area between the chrome: its top edge under the strip, its bottom edge over the bar', () => {
    const insets = { top: 60, bottom: 140 }
    const f = frameOf(BOUNDS, VIEW, insets, NAV_HOME)
    expect(screenAt(f, VIEW, 0, BOUNDS.minZ)[1]).toBeCloseTo(60)
    expect(screenAt(f, VIEW, 0, BOUNDS.maxZ)[1]).toBeCloseTo(900 - 140)
  })
})

describe('zoomAt — the wheel zooms toward the cursor', () => {
  it('keeps the world point under the cursor in place', () => {
    const c = ctx()
    const before = frameOf(BOUNDS, VIEW, NO_INSETS, NAV_HOME)
    const p = worldAt(before, VIEW, 900, 300)
    const nav = zoomAt(c, 900, 300, 2)
    const after = frameOf(BOUNDS, VIEW, NO_INSETS, nav)
    expect(nav.zoom).toBe(2)
    const back = worldAt(after, VIEW, 900, 300)
    expect(back[0]).toBeCloseTo(p[0])
    expect(back[1]).toBeCloseTo(p[1])
  })

  it('clamps the zoom to [1, MAX_ZOOM]', () => {
    expect(zoomAt(ctx(), 800, 450, 0.1).zoom).toBe(1)
    expect(zoomAt(ctx(), 800, 450, 1000).zoom).toBe(MAX_ZOOM)
  })

  it('zooms in for a wheel turned away from the user and out toward him', () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1)
    expect(wheelFactor(100)).toBeLessThan(1)
  })
})

describe('panBy — the drag moves the map with the pointer, inside the area', () => {
  it('moves the focus against the drag and turns follow off', () => {
    const zoomed = { zoom: 4, focus: [0, 10] as [number, number], follow: true }
    const nav = panBy(ctx({ nav: zoomed }), 40, -20)
    const upp = frameOf(BOUNDS, VIEW, NO_INSETS, zoomed).unitsPerPx
    expect(nav.focus?.[0]).toBeCloseTo(-40 * upp)
    expect(nav.focus?.[1]).toBeCloseTo(10 + 20 * upp)
    expect(nav.follow).toBe(false)
  })

  it('stops at the area edge', () => {
    const zoomed = { zoom: 4, focus: [0, 10] as [number, number], follow: true }
    const nav = panBy(ctx({ nav: zoomed }), -1e6, -1e6)
    const f = frameOf(BOUNDS, VIEW, NO_INSETS, nav)
    expect(f.center[0] + f.halfWidth).toBeCloseTo(BOUNDS.maxX)
    expect(f.center[1] + f.halfHeight).toBeCloseTo(BOUNDS.maxZ)
  })

  it('keeps an axis centered while the view is wider than the area on it', () => {
    const nav = panBy(ctx(), 300, 0)
    expect(frameOf(BOUNDS, VIEW, NO_INSETS, nav).center[0]).toBeCloseTo(0)
  })
})

describe('followed — the followed player stays in the central box when zoomed in', () => {
  const zoomed = { zoom: 4, focus: [0, 10] as [number, number], follow: true }

  it('does not move while he is inside the box', () => {
    expect(followed(ctx({ nav: zoomed }), [0.5, 10.5])).toBe(zoomed)
  })

  it('moves the least that brings him back to the box edge', () => {
    const nav = followed(ctx({ nav: zoomed }), [8, 10])
    const f = frameOf(BOUNDS, VIEW, NO_INSETS, nav)
    const [sx] = screenAt(f, VIEW, 8, 10)
    expect(sx).toBeCloseTo(VIEW.width / 2 + (VIEW.width / 2) * FOLLOW_BOX)
  })

  it('does nothing at zoom 1, with follow off, or without a player', () => {
    expect(followed(ctx(), [9, 19])).toBe(NAV_HOME)
    const off = { ...zoomed, follow: false }
    expect(followed(ctx({ nav: off }), [9, 19])).toBe(off)
    expect(followed(ctx({ nav: zoomed }), null)).toBe(zoomed)
  })
})

describe('insetsFrom — the chrome over the canvas', () => {
  it('is the strip bottom and the bar top, plus the gap', () => {
    const insets = insetsFrom({ top: 100, bottom: 820 }, { top: 100, bottom: 146 }, { top: 760, bottom: 808 })
    expect(insets).toEqual({ top: 46 + INSET_GAP_PX, bottom: 60 + INSET_GAP_PX })
  })

  it('is 0 without the chrome, or for chrome that does not overlap the canvas', () => {
    expect(insetsFrom({ top: 0, bottom: 800 }, null, null)).toEqual({ top: 0, bottom: 0 })
    expect(insetsFrom({ top: 0, bottom: 800 }, { top: -60, bottom: -10 }, { top: 900, bottom: 950 })).toEqual({ top: 0, bottom: 0 })
  })

  it('fits over the highest of the bottom elements (score strip over a windowed bar under the canvas)', () => {
    const canvas = { top: 50, bottom: 850 }
    const bar = { top: 860, bottom: 910 }
    const score = { top: 770, bottom: 810 }
    expect(highestBar([bar, null, score])).toBe(score)
    expect(insetsFrom(canvas, null, highestBar([bar, score]))).toEqual({ top: 0, bottom: 80 + INSET_GAP_PX })
  })

  it('has no bottom element when none is found', () => {
    expect(highestBar([])).toBeNull()
    expect(highestBar([null, undefined])).toBeNull()
  })
})
