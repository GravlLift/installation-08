// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { WALL_OPENING_RAD, WALL_RADIUS_M } from '../layers/placementWall'
import { WALL_DISSOLVE_MS, WALL_PANEL_COUNT, WALL_RADIUS_U, WALL_RISE_MS, wallPanels, wallPhaseAt } from './dropWall3d_logic'

const FRAME_MS = 50

describe('wallPhaseAt — the barrier rises at its deployment and dissolves at its end', () => {
  const t0 = 100
  const end = 300
  const riseFrames = WALL_RISE_MS / FRAME_MS
  const dissolveFrames = WALL_DISSOLVE_MS / FRAME_MS

  it('shows nothing before the deployment', () => {
    expect(wallPhaseAt(t0, end, 99.9, FRAME_MS)).toBeNull()
  })

  it('rises from the ground over the rise, then stands whole', () => {
    expect(wallPhaseAt(t0, end, t0, FRAME_MS)).toEqual({ rise: 0, dissolve: 0 })
    expect(wallPhaseAt(t0, end, t0 + riseFrames / 2, FRAME_MS)?.rise).toBeCloseTo(0.5)
    expect(wallPhaseAt(t0, end, end, FRAME_MS)).toEqual({ rise: 1, dissolve: 0 })
  })

  it('dissolves after its end, then is gone', () => {
    expect(wallPhaseAt(t0, end, end + dissolveFrames / 2, FRAME_MS)?.dissolve).toBeCloseTo(0.5)
    expect(wallPhaseAt(t0, end, end + dissolveFrames, FRAME_MS)).toBeNull()
  })

  it('is a function of the frame alone', () => {
    const a = wallPhaseAt(t0, end, 150, FRAME_MS)
    wallPhaseAt(t0, end, 302, FRAME_MS)
    expect(wallPhaseAt(t0, end, 150, FRAME_MS)).toEqual(a)
  })
})

describe('wallPanels — the 2D arc cut into flat panels facing away from the planter', () => {
  const panels = wallPanels({ x: 10, y: 20 }, 90)

  it('cuts the arc into the panel count, each on its chord', () => {
    expect(panels).toHaveLength(WALL_PANEL_COUNT)
    const step = WALL_OPENING_RAD / WALL_PANEL_COUNT
    for (const p of panels) {
      expect(p.width).toBeCloseTo(2 * WALL_RADIUS_U * Math.sin(step / 2))
      expect(Math.hypot(p.x - 10, p.y - 20)).toBeCloseTo(WALL_RADIUS_U * Math.cos(step / 2))
    }
  })

  it('takes the 2D radius as meters: a 2.6 m chord, about 0.85 u, not 2.6 u', () => {
    expect(WALL_RADIUS_U).toBeCloseTo(WALL_RADIUS_M / 3.048)
    const chord = 2 * WALL_RADIUS_U * Math.sin(WALL_OPENING_RAD / 2)
    expect(chord * 3.048).toBeCloseTo(2.62, 1)
  })

  it('puts the middle panel in front of the planter, along the heading, the others symmetric', () => {
    const mid = panels[(WALL_PANEL_COUNT - 1) / 2]
    expect(mid.headingDeg).toBeCloseTo(90)
    expect(mid.x).toBeCloseTo(10)
    expect(mid.y).toBeGreaterThan(20)
    const first = panels[0]
    const last = panels[WALL_PANEL_COUNT - 1]
    expect(first.x - 10).toBeCloseTo(-(last.x - 10))
    expect(first.y).toBeCloseTo(last.y)
  })
})
