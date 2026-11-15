/**
 * mixRender.test.ts — the just-in-time render: every source is placed before its start, the
 * graph never holds more than the sounds of the current step, the progress moves, and a
 * cancellation resolves `null` instead of hanging.
 *
 * The fake context below only plays the timeline of suspensions (`suspend` then `resume`), the
 * part that decides when the sources are wired. The sound itself is judged by ear on a clip.
 */
import { describe, expect, it } from 'vitest'

import { MIX_RENDER_STEP_S, renderScheduled, type TimedPlacement } from './mixRender'

/** An offline context reduced to its clock: suspensions resolve in time order as it "renders". */
class FakeOffline {
  readonly sampleRate = 48_000
  currentTime = 0
  private stops = new Map<number, () => void>()
  private resumeNext: (() => void) | null = null
  readonly length: number
  constructor(length: number) {
    this.length = length
  }
  suspend(t: number): Promise<void> {
    return new Promise((resolve) => this.stops.set(t, resolve))
  }
  resume(): Promise<void> {
    this.resumeNext?.()
    return Promise.resolve()
  }
  async startRendering(): Promise<AudioBuffer> {
    const end = this.length / this.sampleRate
    for (;;) {
      const next = [...this.stops.keys()].filter((t) => t > this.currentTime).sort((a, b) => a - b)[0]
      if (next === undefined || next >= end) break
      this.currentTime = next
      const fire = this.stops.get(next)!
      this.stops.delete(next)
      await new Promise<void>((resume) => {
        this.resumeNext = resume
        fire()
      })
    }
    this.currentTime = end
    return { duration: end } as AudioBuffer
  }
}

/** A placement that records the clock when it is wired and when its node is released. */
function tracked(log: { placedAt: number[]; live: Set<number>; peak: number }, ctx: FakeOffline, i: number, startS: number, endS: number): TimedPlacement {
  return {
    startS,
    endS,
    place: () => {
      log.placedAt[i] = ctx.currentTime
      log.live.add(i)
      log.peak = Math.max(log.peak, log.live.size)
      return { disconnect: () => log.live.delete(i) } as unknown as AudioNode
    },
  }
}

describe('renderScheduled — sources placed just in time', () => {
  it('places every source before its start, and keeps only the sounds of the step in the graph', async () => {
    const ctx = new FakeOffline(48_000 * 60)
    const log = { placedAt: [] as number[], live: new Set<number>(), peak: 0 }
    // One half-second sound per second over a minute.
    const items = Array.from({ length: 60 }, (_, i) => tracked(log, ctx, i, i, i + 0.5))
    const out = await renderScheduled(ctx as unknown as OfflineAudioContext, items)
    expect(out).not.toBeNull()
    expect(log.placedAt).toHaveLength(60)
    items.forEach((it, i) => expect(log.placedAt[i]).toBeLessThanOrEqual(it.startS))
    // Placed up front, all sixty would be in the graph; just in time, two steps' worth at most.
    expect(log.peak).toBeLessThanOrEqual(2 * MIX_RENDER_STEP_S + 1)
  })

  it('publishes a rising progress that ends at 1', async () => {
    const ctx = new FakeOffline(48_000 * 10)
    const seen: number[] = []
    await renderScheduled(ctx as unknown as OfflineAudioContext, [], { progress: (f) => seen.push(f) })
    expect(seen.length).toBeGreaterThan(2)
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
    expect(seen.at(-1)).toBe(1)
  })

  it('a cancellation resolves null at the next step instead of rendering on', async () => {
    const ctx = new FakeOffline(48_000 * 60)
    const out = await renderScheduled(ctx as unknown as OfflineAudioContext, [], { cancelled: () => true })
    expect(out).toBeNull()
  })

  it('a source that loops to the end is never released', async () => {
    const ctx = new FakeOffline(48_000 * 10)
    const log = { placedAt: [] as number[], live: new Set<number>(), peak: 0 }
    await renderScheduled(ctx as unknown as OfflineAudioContext, [tracked(log, ctx, 0, 1, Infinity)])
    expect(log.live.has(0)).toBe(true)
  })
})
