// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it, vi } from 'vitest'

import { ambienceAudible, AmbienceBedPlayer, bedOffsetS, type AmbienceBus } from './ambienceBed'

function fakeBus(duration = 50) {
  const sources: { loop: boolean; started: number[]; stopped: number[] }[] = []
  const ctx = {
    currentTime: 0,
    createGain: () => ({
      gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
    createBufferSource: () => {
      const rec = { loop: false, started: [] as number[], stopped: [] as number[] }
      sources.push(rec)
      return {
        set buffer(_b: unknown) {},
        set loop(v: boolean) { rec.loop = v },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: (_when: number, offset: number) => rec.started.push(offset),
        stop: (when: number) => rec.stopped.push(when),
        onended: null,
      }
    },
    decodeAudioData: vi.fn(async () => ({ duration }) as AudioBuffer),
  }
  return { bus: { ctx, out: {} } as unknown as AmbienceBus, ctx, sources }
}

const ok = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }) as Response
const missing = async () => ({ ok: false, status: 404 }) as Response

describe('ambienceAudible', () => {
  it('needs sound on, playback running and a speed that keeps sound', () => {
    expect(ambienceAudible({ on: true, playing: true, speedKeepsSound: true })).toBe(true)
    expect(ambienceAudible({ on: false, playing: true, speedKeepsSound: true })).toBe(false)
    expect(ambienceAudible({ on: true, playing: false, speedKeepsSound: true })).toBe(false)
    expect(ambienceAudible({ on: true, playing: true, speedKeepsSound: false })).toBe(false)
  })
})

describe('bedOffsetS', () => {
  it('wraps around the loop', () => {
    expect(bedOffsetS(0, 12, 50)).toBe(12)
    expect(bedOffsetS(45, 10, 50)).toBe(5)
    expect(bedOffsetS(3, 5, 0)).toBe(0)
  })
})

describe('AmbienceBedPlayer', () => {
  it('loops once loaded, pauses with a fade, and resumes where it stopped', async () => {
    const { bus, ctx, sources } = fakeBus(50)
    const bed = new AmbienceBedPlayer(bus, '/api/matches/m/ambience.ogg', ok)
    bed.setAudible(true) // asked before the decode: starts when it lands
    await vi.waitFor(() => expect(bed.loaded).toBe(true))
    expect(sources).toHaveLength(1)
    expect(sources[0].loop).toBe(true)
    expect(sources[0].started).toEqual([0])
    bed.setAudible(true) // every frame: no second voice
    expect(sources).toHaveLength(1)
    ctx.currentTime = 20
    bed.setAudible(false)
    expect(sources[0].stopped).toHaveLength(1)
    ctx.currentTime = 30
    bed.setAudible(true)
    expect(sources).toHaveLength(2)
    expect(sources[1].started).toEqual([20])
  })

  it('stays silent when the map has no bed', async () => {
    const { bus, sources } = fakeBus()
    const bed = new AmbienceBedPlayer(bus, '/api/matches/m/ambience.ogg', missing)
    bed.setAudible(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(bed.loaded).toBe(false)
    expect(sources).toHaveLength(0)
  })

  it('never starts after dispose', async () => {
    const { bus, sources } = fakeBus()
    const bed = new AmbienceBedPlayer(bus, '/api/matches/m/ambience.ogg', ok)
    bed.setAudible(true)
    bed.dispose()
    await new Promise((r) => setTimeout(r, 0))
    bed.setAudible(true)
    expect(sources).toHaveLength(0)
  })
})
