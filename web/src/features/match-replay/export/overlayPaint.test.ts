// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * overlayPaint.test.ts — WHAT THE OVERLAYS PAINT, on a spied context.
 *
 * This does not test pixels (jsdom produces none) but the SEQUENCE OF CALLS: what gets painted,
 * in which order, and in which ink. That is what locks in the decisions that would be checked
 * by eye on an export — the background-to-text order, the dash in the muted ink, the text
 * NEVER in the team color, no panel at all when there is nothing to say.
 *
 * FIDELITY to the DOM is not tested here: that is judged by eye on the clip, and is the user
 * acceptance gate of plan step E2.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  neutralStatusStyle,
  paintOverlayPanel,
  type OverlayFonts,
  type OverlayInk,
  type OverlayPanel,
} from './overlayPaint'

const INK: OverlayInk = {
  background: 'rgb(10 10 10)',
  foreground: 'rgb(240 240 240)',
  muted: 'rgb(140 140 140)',
  border: 'rgb(60 60 60)',
  card: 'rgb(24 24 24)',
}
const FONTS: OverlayFonts = { sans: 'Inter, sans-serif', mono: 'JetBrains Mono, monospace' }
const VIEW = { width: 800, height: 400 }

/** A spied 2D context: each call is recorded along with the ink in effect at the time. */
function spyContext() {
  const trace: { op: string; args: unknown[]; fill: string; alpha: number }[] = []
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    font: '',
    letterSpacing: '0px',
    textAlign: '',
    textBaseline: '',
    lineWidth: 0,
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetY: 0,
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    drawImage: vi.fn(),
    measureText: (t: string) => ({ width: t.length * 10 }),
    fillRect: vi.fn(),
    fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D & { __trace: typeof trace }
  for (const op of ['fillRect', 'fillText', 'drawImage', 'roundRect', 'stroke', 'fill'] as const) {
    const brut = ctx[op] as unknown as ReturnType<typeof vi.fn>
    brut.mockImplementation((...args: unknown[]) => {
      trace.push({
        op,
        args,
        // Both inks are typed `string | CanvasGradient | CanvasPattern`; this painter only ever
        // uses strings, and the test only needs those.
        fill: (op === 'stroke' ? ctx.strokeStyle : ctx.fillStyle) as string,
        alpha: ctx.globalAlpha,
      })
    })
  }
  ctx.__trace = trace
  return ctx
}

const VICTORY: OverlayPanel = {
  status: 'Victory',
  statusStyle: { background: 'rgb(0 90 200)', border: 'rgb(0 120 255)' },
  label: 'Team Eagle',
  score: { ally: 50, enemy: 43 },
  veil: true,
}

describe('paintOverlayPanel — the match-end screen', () => {
  it('paints the veil first, over the whole canvas, at 70%', () => {
    const ctx = spyContext()
    paintOverlayPanel(ctx, VIEW, VICTORY, FONTS, INK)
    const veil = ctx.__trace[0]
    expect(veil.op).toBe('fillRect')
    expect(veil.args).toEqual([0, 0, 800, 400])
    expect(veil.fill).toBe(INK.background)
    expect(veil.alpha).toBeCloseTo(0.7)
  })

  it('uppercases the verdict, as `uppercase` does in the DOM', () => {
    const ctx = spyContext()
    paintOverlayPanel(ctx, VIEW, VICTORY, FONTS, INK)
    const texts = ctx.__trace.filter((e) => e.op === 'fillText').map((e) => e.args[0])
    expect(texts).toContain('VICTORY')
    expect(texts).toContain('TEAM EAGLE')
  })

  it('writes the text in `--foreground`, NEVER in the team color', () => {
    const ctx = spyContext()
    paintOverlayPanel(ctx, VIEW, VICTORY, FONTS, INK)
    const verdict = ctx.__trace.find((e) => e.op === 'fillText' && e.args[0] === 'VICTORY')
    // A team color can be very light: contrast is not negotiable.
    expect(verdict?.fill).toBe(INK.foreground)
  })

  it('paints the status card with the team color as its background and border', () => {
    const ctx = spyContext()
    paintOverlayPanel(ctx, VIEW, VICTORY, FONTS, INK)
    expect(ctx.__trace.find((e) => e.op === 'fill')?.fill).toBe(VICTORY.statusStyle.background)
    expect(ctx.__trace.find((e) => e.op === 'stroke')?.fill).toBe(VICTORY.statusStyle.border)
  })

  it('puts the score dash in the muted ink, and both numbers in the text ink', () => {
    const ctx = spyContext()
    paintOverlayPanel(ctx, VIEW, VICTORY, FONTS, INK)
    const byNumber = (t: string) =>
      ctx.__trace.find((e) => e.op === 'fillText' && e.args[0] === t)?.fill
    expect(byNumber('50')).toBe(INK.foreground)
    expect(byNumber('43')).toBe(INK.foreground)
    expect(byNumber('-')).toBe(INK.muted)
  })

  it('writes the ally LEFT of the enemy — the order the banner uses', () => {
    const ctx = spyContext()
    paintOverlayPanel(ctx, VIEW, VICTORY, FONTS, INK)
    const x = (t: string) =>
      ctx.__trace.find((e) => e.op === 'fillText' && e.args[0] === t)?.args[1] as number
    expect(x('50')).toBeLessThan(x('43'))
  })

  it('places the watermark BELOW the text, and at 20%', () => {
    const ctx = spyContext()
    const logo = {} as CanvasImageSource
    paintOverlayPanel(ctx, VIEW, { ...VICTORY, logo }, FONTS, INK)
    const iLogo = ctx.__trace.findIndex((e) => e.op === 'drawImage')
    const iText = ctx.__trace.findIndex((e) => e.op === 'fillText')
    expect(iLogo).toBeGreaterThanOrEqual(0)
    expect(iLogo).toBeLessThan(iText)
    expect(ctx.__trace[iLogo].alpha).toBeCloseTo(0.2)
  })

  it('paints NO watermark at all as long as the logo is not loaded', () => {
    const ctx = spyContext()
    paintOverlayPanel(ctx, VIEW, VICTORY, FONTS, INK)
    // The panel never needed the logo to say how the match ended.
    expect(ctx.__trace.some((e) => e.op === 'drawImage')).toBe(false)
  })

  it('centers the column vertically, score included', () => {
    const blockTop = (p: OverlayPanel) => {
      const c = spyContext()
      paintOverlayPanel(c, VIEW, p, FONTS, INK)
      return c.__trace.find((e) => e.op === 'roundRect')?.args[1] as number
    }
    // A taller column starts higher: that is what `items-center` does.
    expect(blockTop(VICTORY)).toBeLessThan(blockTop({ ...VICTORY, score: null, label: null }))
  })
})

describe('paintOverlayPanel — the tie and the round-break message', () => {
  it('the tie borrows neither a logo nor a team name', () => {
    const ctx = spyContext()
    paintOverlayPanel(
      ctx,
      VIEW,
      { status: 'Tie', statusStyle: neutralStatusStyle(INK), score: { ally: 50, enemy: 50 }, veil: true },
      FONTS,
      INK,
    )
    expect(ctx.__trace.some((e) => e.op === 'drawImage')).toBe(false)
    expect(ctx.__trace.find((e) => e.op === 'fill')?.fill).toBe(INK.card)
    expect(ctx.__trace.find((e) => e.op === 'stroke')?.fill).toBe(INK.border)
  })

  it('the round-break message does NOT post a veil', () => {
    const ctx = spyContext()
    paintOverlayPanel(
      ctx,
      VIEW,
      { status: 'Round 2 over', statusStyle: neutralStatusStyle(INK), veil: false },
      FONTS,
      INK,
    )
    // The DOM doesn't post one either: a round ending does not hide the field.
    expect(ctx.__trace.some((e) => e.op === 'fillRect')).toBe(false)
    expect(ctx.__trace.some((e) => e.op === 'fillText')).toBe(true)
  })

  it('paints nothing at all when there is no status to say', () => {
    const ctx = spyContext()
    paintOverlayPanel(ctx, VIEW, { status: '   ', statusStyle: neutralStatusStyle(INK), veil: true }, FONTS, INK)
    expect(ctx.__trace).toHaveLength(0)
  })
})
