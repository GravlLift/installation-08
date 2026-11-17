// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import {
  SHIELD_BAR_H,
  SHIELD_BAR_W,
  SHIELD_CENTER,
  shieldBarPath,
  shieldGlossPath,
  shieldStreakPaths,
  traceShieldBar,
  traceShieldGloss,
  traceShieldStreak,
  type ShieldBarPath,
} from './shieldBarGeometry'

describe('shieldBarGeometry', () => {
  it('exports the 1000x74 unit box with the fill centered at x 500', () => {
    expect(SHIELD_BAR_W).toBe(1000)
    expect(SHIELD_BAR_H).toBe(74)
    expect(SHIELD_CENTER).toBe(500)
  })

  it('traces the bar outline into a path: start, two quadratic edges, chamfered ends', () => {
    const calls: [string, ...number[]][] = []
    const path = {
      moveTo: (...a: number[]) => calls.push(['moveTo', ...a]),
      quadraticCurveTo: (...a: number[]) => calls.push(['quadraticCurveTo', ...a]),
      lineTo: (...a: number[]) => calls.push(['lineTo', ...a]),
      closePath: () => calls.push(['closePath']),
    }
    traceShieldBar(path)
    expect(calls).toEqual([
      ['moveTo', 20, 6],
      ['quadraticCurveTo', 500, 34, 980, 6],
      ['lineTo', 1000, 40],
      ['lineTo', 988, 56],
      ['quadraticCurveTo', 500, 86, 12, 56],
      ['lineTo', 0, 40],
      ['closePath'],
    ])
  })

  it('traces the gloss line under the top edge', () => {
    const calls: [string, ...number[]][] = []
    const path: ShieldBarPath = {
      moveTo: (x: number, y: number) => calls.push(['moveTo', x, y]),
      quadraticCurveTo: (cpx: number, cpy: number, x: number, y: number) => calls.push(['quadraticCurveTo', cpx, cpy, x, y]),
      lineTo: (x: number, y: number) => calls.push(['lineTo', x, y]),
      closePath: () => calls.push(['closePath']),
    }
    traceShieldGloss(path)
    expect(calls).toEqual([
      ['moveTo', 24, 11],
      ['quadraticCurveTo', 500, 39, 976, 11],
    ])
  })

  it('traces the two streaks at their own heights', () => {
    const calls: [string, ...number[]][] = []
    const path: ShieldBarPath = {
      moveTo: (x: number, y: number) => calls.push(['moveTo', x, y]),
      quadraticCurveTo: (cpx: number, cpy: number, x: number, y: number) => calls.push(['quadraticCurveTo', cpx, cpy, x, y]),
      lineTo: (x: number, y: number) => calls.push(['lineTo', x, y]),
      closePath: () => calls.push(['closePath']),
    }
    traceShieldStreak(path, 0)
    traceShieldStreak(path, 1)
    expect(calls).toEqual([
      ['moveTo', 0, 30],
      ['quadraticCurveTo', 500, 58, 1000, 30],
      ['moveTo', 0, 44],
      ['quadraticCurveTo', 500, 72, 1000, 44],
    ])
  })

  it('emits the SVG path strings the live bar uses', () => {
    expect(shieldBarPath()).toBe('M20 6 Q500 34 980 6 L1000 40 L988 56 Q500 86 12 56 L0 40 Z')
    expect(shieldGlossPath()).toBe('M24 11 Q500 39 976 11')
    expect(shieldStreakPaths()).toEqual(['M0 30 Q500 58 1000 30', 'M0 44 Q500 72 1000 44'])
  })
})
