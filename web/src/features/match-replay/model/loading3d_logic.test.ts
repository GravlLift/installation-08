// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { LOAD_STALL_MS, LoadProgress3d, sceneLoadSignal, type LoadState } from './loading3d_logic'

describe('sceneLoadSignal', () => {
  it('keeps the shape the release load check waits on', () => {
    expect(sceneLoadSignal({ kind: 'loading', phase: 'decode', fraction: 0.1, done: 1, total: 2 })).toBe('loading:decode')
    expect(sceneLoadSignal({ kind: 'ready' })).toBe('ready')
    expect(sceneLoadSignal({ kind: 'error' })).toBe('error')
    expect(sceneLoadSignal({ kind: 'error', stalled: 'decode' })).toBe('error:stalled:decode')
  })
})

const MB = 1024 * 1024

function fraction(state: LoadState): number {
  if (state.kind === 'ready') return 1
  if (state.kind === 'error') return Number.NaN
  return state.fraction
}

/** Runs a full load (map of `mapMb`, variant of `variantMb` or none), sampling after each report. */
function fullLoad(progress: LoadProgress3d, mapMb: number, variantMb: number | null): LoadState[] {
  const seen: LoadState[] = []
  const sample = () => seen.push(progress.snapshot())
  progress.subscribe(sample)
  const map = mapMb * MB
  const variant = (variantMb ?? 0) * MB
  if (variantMb === null) progress.variantNone()
  for (let i = 1; i <= 10; i++) {
    progress.mapBytes((map * i) / 10, map)
    if (variantMb !== null) progress.variantBytes((variant * i) / 10, variant)
  }
  progress.mapDownloaded()
  for (let i = 0; i <= 20; i++) progress.step('decode', i, 20)
  for (let i = 0; i <= 50; i++) progress.step('index', i, 50)
  progress.finish('decode')
  progress.finish('index')
  if (variantMb !== null) {
    for (let i = 0; i <= 10; i++) progress.step('variant-decode', i, 10)
    for (let i = 0; i <= 30; i++) progress.step('variant-index', i, 30)
    progress.variantSettled()
  }
  for (let i = 0; i <= 8; i++) progress.step('assets', i, 8)
  progress.finish('assets')
  progress.finish('warmup')
  progress.finish('first-frame')
  return seen
}

describe('LoadProgress3d', () => {
  it('rises monotonically and is ready only at the very end', () => {
    const seen = fullLoad(new LoadProgress3d(() => 0), 90, 126)
    const values = seen.map(fraction)
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1])
    expect(seen.at(-1)).toEqual({ kind: 'ready' })
    expect(seen.slice(0, -1).every((s) => s.kind === 'loading' && s.fraction < 1)).toBe(true)
  })

  it('weights the phases by cost: a bigger variant makes its preparation a larger part of the bar', () => {
    const share = (variantMb: number) => {
      const progress = new LoadProgress3d(() => 0)
      progress.snapshot()
      progress.mapBytes(10 * MB, 10 * MB)
      progress.variantBytes(variantMb * MB, variantMb * MB)
      progress.mapDownloaded()
      progress.finish('decode')
      progress.finish('index')
      const before = fraction(progress.snapshot())
      progress.variantSettled()
      return fraction(progress.snapshot()) - before
    }
    expect(share(130)).toBeGreaterThan(share(5) * 3)
    // At the default costs, 130 MB of Forge objects is about a third of the bar.
    expect(share(130)).toBeGreaterThan(0.3)
  })
  it('names the first unfinished phase with its count', () => {
    const progress = new LoadProgress3d(() => 0)
    progress.variantNone()
    progress.mapBytes(42 * MB, 130 * MB)
    expect(progress.snapshot()).toMatchObject({ kind: 'loading', phase: 'download', done: 42 * MB, total: 130 * MB })
    progress.mapBytes(130 * MB, 130 * MB)
    progress.mapDownloaded()
    progress.step('decode', 3, 40)
    expect(progress.snapshot()).toMatchObject({ phase: 'decode', done: 3, total: 40 })
    progress.finish('decode')
    progress.finish('index')
    progress.step('assets', 2, 5)
    expect(progress.snapshot()).toMatchObject({ phase: 'assets', done: 2, total: 5 })
    progress.finish('assets')
    expect(progress.snapshot()).toMatchObject({ phase: 'warmup' })
    progress.finish('warmup')
    expect(progress.snapshot()).toMatchObject({ phase: 'first-frame' })
  })

  it('sums both downloads in the download count', () => {
    const progress = new LoadProgress3d(() => 0)
    progress.mapBytes(10 * MB, 20 * MB)
    progress.variantBytes(30 * MB, 100 * MB)
    expect(progress.snapshot()).toMatchObject({ phase: 'download', done: 40 * MB, total: 120 * MB })
  })

  it('never goes backward when a size arrives larger than assumed', () => {
    const progress = new LoadProgress3d(() => 0)
    progress.mapBytes(5 * MB, 5 * MB)
    progress.mapDownloaded()
    progress.finish('decode')
    progress.finish('index')
    const before = fraction(progress.snapshot())
    expect(before).toBeGreaterThan(0)
    // The variant turns out far larger than the unknown-size guess.
    progress.variantBytes(0, 200 * MB)
    const after = fraction(progress.snapshot())
    expect(after).toBeGreaterThanOrEqual(before)
    progress.variantBytes(100 * MB, 200 * MB)
    expect(fraction(progress.snapshot())).toBeGreaterThan(after)
  })

  it('keeps moving after a weight change instead of stalling', () => {
    const progress = new LoadProgress3d(() => 0)
    progress.mapBytes(50 * MB, 100 * MB)
    const mid = fraction(progress.snapshot())
    // The variant is found absent: its reserved cost goes away.
    progress.variantNone()
    const rebased = fraction(progress.snapshot())
    expect(rebased).toBeGreaterThanOrEqual(mid)
    progress.mapBytes(60 * MB, 100 * MB)
    expect(fraction(progress.snapshot())).toBeGreaterThan(rebased)
  })

  it('holds below 1 while any phase is open, even with every count full', () => {
    const progress = new LoadProgress3d(() => 0)
    progress.variantNone()
    progress.mapBytes(MB, MB)
    progress.mapDownloaded()
    progress.step('decode', 4, 4)
    progress.step('index', 9, 9)
    progress.step('assets', 3, 3)
    const state = progress.snapshot()
    expect(state.kind).toBe('loading')
    expect(fraction(state)).toBeLessThan(1)
  })

  it('reserves a build cost while the variant is built on the server', () => {
    const progress = new LoadProgress3d(() => 0)
    progress.variantBuilding()
    progress.mapBytes(MB, MB)
    progress.mapDownloaded()
    progress.finish('decode')
    progress.finish('index')
    expect(progress.snapshot()).toMatchObject({ phase: 'variant-build' })
    progress.variantBytes(10 * MB, 10 * MB)
    expect(progress.snapshot()).toMatchObject({ phase: 'variant-prepare' })
  })

  it('reports an error and the timings of the completed phases', () => {
    let t = 0
    const progress = new LoadProgress3d(() => t)
    progress.variantNone()
    progress.mapBytes(8 * MB, 8 * MB)
    t = 120
    progress.mapDownloaded()
    expect(progress.report()).toMatchObject({ mapMb: 8, variantMb: 0, phasesMs: { download: 120 } })
    progress.fail()
    expect(progress.snapshot()).toEqual({ kind: 'error' })
  })
})

describe('LoadProgress3d stall watchdog', () => {
  function clocked() {
    let t = 0
    const progress = new LoadProgress3d(() => t)
    return { progress, advance: (ms: number) => { t += ms } }
  }

  it('fails a load with no progress for LOAD_STALL_MS, naming the phase', () => {
    const { progress, advance } = clocked()
    progress.variantNone()
    progress.mapBytes(10 * MB, 10 * MB)
    progress.mapDownloaded()
    progress.step('decode', 2, 40)
    expect(progress.checkStall()).toBeNull()
    advance(LOAD_STALL_MS - 1)
    expect(progress.checkStall()).toBeNull()
    advance(1)
    expect(progress.checkStall()).toBe('decode')
    expect(progress.snapshot()).toEqual({ kind: 'error', stalled: 'decode' })
  })

  it('a repeated identical report is not progress', () => {
    const { progress, advance } = clocked()
    progress.variantNone()
    progress.mapBytes(10 * MB, 10 * MB)
    progress.mapDownloaded()
    progress.step('decode', 2, 40)
    progress.checkStall()
    for (let i = 0; i < 4; i++) {
      advance(LOAD_STALL_MS / 4)
      progress.step('decode', 2, 40)
    }
    expect(progress.checkStall()).toBe('decode')
  })

  it('real progress keeps the load alive', () => {
    const { progress, advance } = clocked()
    progress.variantNone()
    for (let i = 1; i <= 10; i++) {
      progress.step('decode', i, 40)
      advance(LOAD_STALL_MS - 1)
      expect(progress.checkStall()).toBeNull()
    }
    expect(progress.snapshot().kind).toBe('loading')
  })

  it('never fires while the server builds the variant', () => {
    const { progress, advance } = clocked()
    progress.variantBuilding()
    progress.mapBytes(10 * MB, 10 * MB)
    progress.mapDownloaded()
    progress.finish('decode')
    progress.finish('index')
    for (let i = 0; i < 5; i++) {
      advance(LOAD_STALL_MS)
      expect(progress.checkStall()).toBeNull()
    }
  })

  it('does nothing once the load failed or finished', () => {
    const { progress, advance } = clocked()
    progress.fail()
    advance(LOAD_STALL_MS * 2)
    expect(progress.checkStall()).toBeNull()
    expect(progress.snapshot()).toEqual({ kind: 'error' })
  })
})
it('moves the bar as the server build advances', () => {
  const progress = new LoadProgress3d(() => 0)
  progress.variantBuilding(0.2)
  const before = progress.snapshot()
  progress.variantBuilding(0.7)
  expect(fraction(progress.snapshot())).toBeGreaterThan(fraction(before))
})
