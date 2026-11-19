// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'
import { screenPixelRatio, SettledResize, type ResizeTimers } from './settledResize3d'

function fakeTimers() {
  let next = 1
  const live = new Map<number, () => void>()
  const timers: ResizeTimers = {
    set: (fn) => { const id = next++; live.set(id, fn); return id },
    clear: (h) => { live.delete(h as number) },
  }
  const fire = () => { const fns = [...live.values()]; live.clear(); for (const f of fns) f() }
  return { timers, fire, pending: () => live.size }
}

function harness() {
  const t = fakeTimers()
  const previews: string[] = []
  const applies: string[] = []
  const s = new SettledResize((w, h) => previews.push(`${w}x${h}`), (w, h) => applies.push(`${w}x${h}`), 150, t.timers)
  return { s, t, previews, applies }
}

describe('SettledResize', () => {
  it('applies the first size at once', () => {
    const { s, applies, previews } = harness()
    s.request(800, 450)
    expect(applies).toEqual(['800x450'])
    expect(previews).toEqual([])
  })

  it('previews every later size but reallocates once, for the last, after it settles', () => {
    const { s, t, applies, previews } = harness()
    s.request(800, 450)
    s.request(900, 500)
    s.request(1000, 560)
    s.request(1200, 675)
    expect(previews).toEqual(['900x500', '1000x560', '1200x675'])
    expect(applies).toEqual(['800x450'])
    expect(t.pending()).toBe(1)
    t.fire()
    expect(applies).toEqual(['800x450', '1200x675'])
  })

  it('ignores empty sizes and drops a pending size on cancel', () => {
    const { s, t, applies } = harness()
    s.request(0, 450)
    expect(applies).toEqual([])
    s.request(800, 450)
    s.request(900, 500)
    s.cancel()
    t.fire()
    expect(applies).toEqual(['800x450'])
  })
})

describe('screenPixelRatio', () => {
  it('follows the monitor the window is on, capped at 2, unless the knob sets it', () => {
    expect(screenPixelRatio(null, 1.5)).toBe(1.5)
    expect(screenPixelRatio(null, 1)).toBe(1)
    expect(screenPixelRatio(null, 3)).toBe(2)
    expect(screenPixelRatio(null, 0)).toBe(1)
    expect(screenPixelRatio(0.5, 1.5)).toBe(0.5)
  })
})
