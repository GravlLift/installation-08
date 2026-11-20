// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** hold3d.test.ts — the hold format (validation) and the held pose at a script time. */
import { describe, expect, it } from 'vitest'
import {
  activeHoldOf,
  activeHolds,
  holdStateAt,
  parseHolds,
  type Hold,
  type HoldStart,
} from './hold3d'

function accepts(raw: unknown): Hold[] {
  const r = parseHolds(raw)
  expect(r).not.toHaveProperty('error')
  return (r as { holds: Hold[] }).holds
}

function rejects(raw: unknown): string {
  const r = parseHolds(raw)
  expect(r).toHaveProperty('error')
  return (r as { error: string }).error
}

const hold = (at: number, extra: Partial<Hold> = {}): Hold => ({
  xuid: 'A',
  at,
  clip: 'mp:intro_emote:i_see_you',
  loop: false,
  blendMs: 250,
  heading: null,
  turnMs: 400,
  pitch: 0,
  weapon: 'keep',
  until: null,
  ...extra,
})

describe('parseHolds', () => {
  it('fills the defaults', () => {
    const [h] = accepts([{ xuid: 'A', at: 1000, clip: 'idle' }])
    expect(h).toEqual({
      xuid: 'A',
      at: 1000,
      clip: 'idle',
      loop: false,
      blendMs: 250,
      heading: null,
      turnMs: 400,
      pitch: 0,
      weapon: 'keep',
      until: null,
    })
  })

  it('rejects a bad at', () => {
    for (const at of [-1, NaN, null]) {
      expect(rejects([{ xuid: 'A', at, clip: 'idle' }])).toContain('holds[0].at')
    }
  })

  it('rejects an out-of-range blendMs', () => {
    expect(rejects([{ xuid: 'A', at: 0, clip: 'idle', blendMs: 3000 }])).toContain('holds[0].blendMs')
    expect(rejects([{ xuid: 'A', at: 0, clip: 'idle', blendMs: -1 }])).toContain('holds[0].blendMs')
  })

  it('rejects an out-of-range pitch', () => {
    expect(rejects([{ xuid: 'A', at: 0, clip: 'idle', pitch: 95 }])).toContain('holds[0].pitch')
    expect(rejects([{ xuid: 'A', at: 0, clip: 'idle', pitch: -90 }])).toContain('holds[0].pitch')
    expect(accepts([{ xuid: 'A', at: 0, clip: 'idle', pitch: -89 }])[0].pitch).toBe(-89)
  })

  it('rejects a bad weapon', () => {
    expect(rejects([{ xuid: 'A', at: 0, clip: 'idle', weapon: 'drop' }])).toContain("holds[0].weapon")
    expect(accepts([{ xuid: 'A', at: 0, clip: 'idle', weapon: 'hide' }])[0].weapon).toBe('hide')
  })

  it('rejects until that is not > at', () => {
    expect(rejects([{ xuid: 'A', at: 1000, clip: 'idle', until: 1000 }])).toContain('holds[0].until')
    expect(rejects([{ xuid: 'A', at: 1000, clip: 'idle', until: 500 }])).toContain('holds[0].until')
    expect(accepts([{ xuid: 'A', at: 1000, clip: 'idle', until: 1001 }])[0].until).toBe(1001)
  })

  it('rejects two holds for one xuid', () => {
    const r = rejects([
      { xuid: 'A', at: 0, clip: 'idle' },
      { xuid: 'A', at: 1000, clip: 'idle' },
    ])
    expect(r).toContain('xuid')
    expect(r).toContain('one hold per player')
  })

  it('rejects more than 16 holds', () => {
    const many = Array.from({ length: 17 }, (_, i) => ({ xuid: `P${i}`, at: i * 1000, clip: 'idle' }))
    const r = rejects(many)
    expect(r).toContain('17')
    expect(r).toContain('at most 16')
    expect(accepts(many.slice(0, 16)).length).toBe(16)
  })

  it('rejects an empty clip', () => {
    expect(rejects([{ xuid: 'A', at: 0, clip: '' }])).toContain('holds[0].clip')
    expect(rejects([{ xuid: 'A', at: 0, clip: 'x'.repeat(201) }])).toContain('holds[0].clip')
    expect(accepts([{ xuid: 'A', at: 0, clip: 'x'.repeat(200) }])[0].clip).toHaveLength(200)
  })

  it('drops unknown fields', () => {
    const [h] = accepts([{ xuid: 'A', at: 0, clip: 'idle', loop: true, junk: 1, bonus: 'x' }])
    expect(h).not.toHaveProperty('junk')
    expect(h).not.toHaveProperty('bonus')
    expect(h.loop).toBe(true)
  })

  it('sorts the clean copy by at', () => {
    const raw = [
      { xuid: 'B', at: 2000, clip: 'idle' },
      { xuid: 'A', at: 1000, clip: 'idle' },
      { xuid: 'C', at: 0, clip: 'idle' },
    ]
    expect(accepts(raw).map((h) => h.xuid)).toEqual(['C', 'A', 'B'])
  })

  it('rejects a non-array', () => {
    expect(rejects(null)).toContain('holds')
  })
})

describe('holdStateAt', () => {
  const h = hold(1000, { blendMs: 200, turnMs: 400, heading: 10, pitch: 20 })
  const start: HoldStart = { h: 350, p: 10 }

  it('is null before at', () => {
    expect(holdStateAt(h, 999, start)).toBeNull()
  })

  it('eases weight in over blendMs with a smoothstep', () => {
    expect(holdStateAt(h, 1000, start)!.weight).toBe(0)
    expect(holdStateAt(h, 1100, start)!.weight).toBeCloseTo(0.5, 10)
    expect(holdStateAt(h, 1200, start)!.weight).toBe(1)
  })

  it('blendMs 0 gives weight 1 at at', () => {
    const h0 = hold(1000, { blendMs: 0 })
    expect(holdStateAt(h0, 1000, start)!.weight).toBe(1)
  })

  it('reports sinceMs and clipTimeS', () => {
    const s = holdStateAt(h, 2000, start)!
    expect(s.sinceMs).toBe(1000)
    expect(s.clipTimeS).toBe(1)
  })

  it('turns the short way around (350 to 10 passes through 0, never 180)', () => {
    const s0 = holdStateAt(h, 1000, start)!
    expect(s0.heading).toBeCloseTo(350, 10)
    const sMid = holdStateAt(h, 1200, start)! // half turnMs (400/2 = 200)
    expect(sMid.heading).toBeCloseTo(0, 10)
    const sEnd = holdStateAt(h, 1400, start)!
    expect(sEnd.heading).toBeCloseTo(10, 10)
  })

  it('heading null keeps the start heading', () => {
    const hn = hold(1000, { heading: null, turnMs: 400 })
    expect(holdStateAt(hn, 1200, start)!.heading).toBeCloseTo(350, 10)
    expect(holdStateAt(hn, 2000, start)!.heading).toBeCloseTo(350, 10)
  })

  it('eases pitch to the hold pitch over blendMs', () => {
    expect(holdStateAt(h, 1000, start)!.pitch).toBeCloseTo(10, 10)
    expect(holdStateAt(h, 1100, start)!.pitch).toBeCloseTo(15, 10) // smoothstep(0.5) = 0.5
    expect(holdStateAt(h, 1200, start)!.pitch).toBeCloseTo(20, 10)
  })

  it('with until: weight returns to 0 at until + blendMs and the state is null after', () => {
    const hu = hold(1000, { blendMs: 200, turnMs: 400, heading: 10, until: 3000 })
    expect(holdStateAt(hu, 3000, start)!.weight).toBe(1)
    expect(holdStateAt(hu, 3100, start)!.weight).toBeCloseTo(0.5, 10)
    expect(holdStateAt(hu, 3199, start)!.weight).toBeCloseTo(0, 1)
    expect(holdStateAt(hu, 3199, start)!.heading).toBeCloseTo(10, 10) // stays at the hold heading after until
    expect(holdStateAt(hu, 3200, start)).toBeNull() // null once fully blended out (sMs >= until + blendMs)
    expect(holdStateAt(hu, 3201, start)).toBeNull()
  })

  it('a held player whose turnMs runs past until still snaps to the hold heading there', () => {
    const hl = hold(1000, { blendMs: 200, turnMs: 1000, heading: 90, until: 1500 })
    expect(holdStateAt(hl, 1500, start)!.heading).toBeCloseTo(90, 10)
  })

  it('blendMs 0 with until: the rejoin switch is instant', () => {
    const hb = hold(1000, { blendMs: 0, until: 2000 })
    expect(holdStateAt(hb, 1999, start)!.weight).toBe(1)
    expect(holdStateAt(hb, 2000, start)).toBeNull() // at until + blendMs the rejoin is done, even instantly
  })
})

describe('activeHolds', () => {
  const h1 = hold(1000, { xuid: 'A', until: 2000, blendMs: 200 })
  const h2 = hold(500, { xuid: 'B' })

  it('lists the holds whose window contains sMs', () => {
    expect(activeHolds([h1, h2], 400).size).toBe(0)
    expect([...activeHolds([h1, h2], 500).keys()]).toEqual(['B'])
    expect([...activeHolds([h1, h2], 1000).keys()].sort()).toEqual(['A', 'B'])
    expect([...activeHolds([h1, h2], 2100).keys()].sort()).toEqual(['A', 'B']) // h1's blend-out runs to 2200
    expect([...activeHolds([h1, h2], 2200).keys()]).toEqual(['B'])
  })
})

describe('activeHoldOf', () => {
  const h1 = hold(1000, { xuid: 'A', until: 2000, blendMs: 200 })
  const h2 = hold(500, { xuid: 'B' })

  it("answers one player's hold the way activeHolds does", () => {
    for (const sMs of [0, 400, 500, 999, 1000, 1500, 2100, 2199, 2200, 9000]) {
      const map = activeHolds([h1, h2], sMs)
      for (const xuid of ['A', 'B', 'C']) expect(activeHoldOf([h1, h2], xuid, sMs)).toBe(map.get(xuid) ?? null)
    }
  })
})
