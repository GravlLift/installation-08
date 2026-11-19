// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it, vi } from 'vitest'

import {
  ambienceAudible,
  AmbienceZonesPlayer,
  AMBIENCE_CROSSFADE_S,
  AMBIENCE_FADE_OUT_S,
  bedOffsetS,
  type AmbienceBus,
} from './ambienceBed'
import type { AmbienceLayout } from './ambienceZones'
import type { ZoneReverbPlayer } from './zoneReverb'

/** A fake AudioBuffer the player can downmix and start voices on. */
function fakeBuffer(channels: number, seconds = 10, sampleRate = 44100): AudioBuffer {
  const length = seconds * sampleRate
  const data: Float32Array[] = Array.from({ length: channels }, () => new Float32Array(length))
  return {
    numberOfChannels: channels,
    length,
    sampleRate,
    duration: seconds,
    getChannelData: (c: number) => data[c],
  } as unknown as AudioBuffer
}

interface FakeSource {
  buffer: AudioBuffer | null
  loop: boolean
  started: number[]
  stopped: number[]
  onended: (() => void) | null
}

/** The file name the last arrayBuffer asked for, so decodeAudioData hands back the right buffer. */
let decodeTarget: string | null = null

function fakeBus() {
  const sources: FakeSource[] = []
  const ramps: ReturnType<typeof vi.fn>[] = []
  const ctx = {
    currentTime: 0,
    createGain: () => {
      const ramp = vi.fn()
      ramps.push(ramp)
      return {
        gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: ramp, cancelScheduledValues: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      }
    },
    createBufferSource: () => {
      const rec: FakeSource = { buffer: null, loop: false, started: [], stopped: [], onended: null }
      sources.push(rec)
      return {
        set buffer(b: AudioBuffer | null) {
          rec.buffer = b
        },
        get buffer() {
          return rec.buffer
        },
        set loop(v: boolean) {
          rec.loop = v
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: (_when: number, offset: number) => rec.started.push(offset),
        stop: (when: number) => rec.stopped.push(when),
      }
    },
    createBuffer: (channels: number, seconds: number, sampleRate: number) => fakeBuffer(channels, seconds / 44100, sampleRate),
    decodeAudioData: vi.fn(async () => buffers[decodeTarget ?? '']),
  }
  return { bus: { ctx, out: {} } as unknown as AmbienceBus, ctx, sources, ramps }
}

/** The files of the layouts used below, keyed by file name; `buffers` is what decodeAudioData hands back. */
const buffers: Record<string, AudioBuffer> = {}

const LAYOUT_URL = '/api/matches/m/ambience.json'
const fileUrlOf = (file: string): string => `/api/matches/m/ambience/${file}`

function layoutFetcher(t: { layout: AmbienceLayout | null }) {
  const urls: string[] = []
  const fetcher = async (url: string): Promise<Response> => {
    urls.push(url)
    if (url === LAYOUT_URL) {
      if (!t.layout) return { ok: false, status: 404 } as Response
      return { ok: true, json: async () => t.layout } as unknown as Response
    }
    const file = url.slice(url.lastIndexOf('/') + 1)
    if (!buffers[file]) return { ok: false, status: 404 } as Response
    return { ok: true, arrayBuffer: async () => {
      decodeTarget = file
      return new ArrayBuffer(8)
    } } as Response
  }
  return { fetcher, urls }
}

/** A layout with three 100 m^2 zones of height 10 plus the fallback; a listener per zone and one outside. */
function zoneLayout(): {
  layout: AmbienceLayout
  inA: { x: number; y: number; heading: number }
  inB: { x: number; y: number; heading: number }
  inC: { x: number; y: number; heading: number }
  out: { x: number; y: number; heading: number }
} {
  return {
    layout: {
      fallback: 'fb',
      files: { fb: 'fb.ogg', a: 'a.ogg', b: 'b.ogg', c: 'c.ogg' },
      zones: [
        { zone: 1, loop: 'a', floor: 0, height: 10, points: [[0, 0], [10, 0], [10, 10], [0, 10]] },
        { zone: 2, loop: 'b', floor: 0, height: 10, points: [[10, 0], [20, 0], [20, 10], [10, 10]] },
        { zone: 3, loop: 'c', floor: 0, height: 10, points: [[0, 10], [20, 10], [20, 20], [0, 20]] },
      ],
    },
    inA: { x: 5, y: 5, heading: 0 },
    inB: { x: 15, y: 5, heading: 0 },
    inC: { x: 5, y: 15, heading: 0 },
    out: { x: 50, y: 50, heading: 0 },
  }
}

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

describe('AmbienceZonesPlayer', () => {
  it('forwards the loaded layout, every listener update, and disposal to reverb', async () => {
    const { bus } = fakeBus()
    const { layout, inA } = zoneLayout()
    const { fetcher } = layoutFetcher({ layout })
    const reverb = { setLayout: vi.fn(), setListener: vi.fn(), dispose: vi.fn() }
    const player = new AmbienceZonesPlayer(bus, LAYOUT_URL, fileUrlOf, fetcher, reverb as unknown as ZoneReverbPlayer)
    player.setListener(inA)
    await vi.waitFor(() => expect(reverb.setLayout).toHaveBeenCalledWith(layout))
    player.setListener(null)
    expect(reverb.setListener.mock.calls).toEqual([[inA], [null]])
    player.dispose()
    expect(reverb.dispose).toHaveBeenCalledOnce()
  })
  it('fades each loop to its Wwise gain, defaulting to unity', async () => {
    buffers['fb.ogg'] = fakeBuffer(2)
    buffers['a.ogg'] = fakeBuffer(2)
    const { bus, ctx, sources, ramps } = fakeBus()
    const { layout, inA } = zoneLayout()
    layout.gains = { fb: -17 }
    const { fetcher } = layoutFetcher({ layout })
    const player = new AmbienceZonesPlayer(bus, LAYOUT_URL, fileUrlOf, fetcher)
    player.setAudible(true)
    await vi.waitFor(() => expect(sources).toHaveLength(1))
    expect(ramps[0]).toHaveBeenCalledWith(10 ** (-17 / 20), AMBIENCE_CROSSFADE_S)
    player.setListener(inA)
    ctx.currentTime = 0.5
    player.setListener(inA)
    await vi.waitFor(() => expect(sources).toHaveLength(2))
    expect(ramps[1]).toHaveBeenCalledWith(1, 0.5 + AMBIENCE_CROSSFADE_S)
  })
  it('a layout 404 is a clean silence and fetches no file', async () => {
    const { bus, sources } = fakeBus()
    const { fetcher, urls } = layoutFetcher({ layout: null })
    const player = new AmbienceZonesPlayer(bus, LAYOUT_URL, fileUrlOf, fetcher)
    player.setAudible(true)
    player.setListener({ x: 5, y: 5, heading: 0 })
    await vi.waitFor(() => expect(urls).toHaveLength(1))
    expect(urls[0]).toBe(LAYOUT_URL)
    expect(sources).toHaveLength(0)
  })

  it('fetches only the target loop, and only when it holds for the switch time', async () => {
    for (const f of ['fb.ogg', 'a.ogg', 'b.ogg', 'c.ogg']) buffers[f] = fakeBuffer(2)
    const { bus, ctx, sources } = fakeBus()
    const { layout, inA } = zoneLayout()
    const { fetcher, urls } = layoutFetcher({ layout })
    const player = new AmbienceZonesPlayer(bus, LAYOUT_URL, fileUrlOf, fetcher)
    player.setAudible(true)
    await vi.waitFor(() => expect(sources).toHaveLength(1)) // the fallback voice, from t 0
    player.setListener(inA) // one frame in zone a: a.ogg must not load
    expect(urls).not.toContain(fileUrlOf('a.ogg'))
    // The zone holds for the switch time: now a loads, b and c never do.
    ctx.currentTime = 0.5
    player.setListener(inA)
    await vi.waitFor(() => expect(urls).toContain(fileUrlOf('a.ogg')))
    expect(urls).not.toContain(fileUrlOf('b.ogg'))
    expect(urls).not.toContain(fileUrlOf('c.ogg'))
  })

  it('does not switch if the listener returns before the switch time', async () => {
    for (const f of ['fb.ogg', 'a.ogg', 'b.ogg']) buffers[f] = fakeBuffer(2)
    const { bus, ctx } = fakeBus()
    const { layout, inA, inB } = zoneLayout()
    const { fetcher, urls } = layoutFetcher({ layout })
    const player = new AmbienceZonesPlayer(bus, LAYOUT_URL, fileUrlOf, fetcher)
    player.setAudible(true)
    await vi.waitFor(() => expect(urls).toContain(fileUrlOf('fb.ogg')))
    ctx.currentTime = 1
    player.setListener(inA)
    ctx.currentTime = 1.3
    player.setListener(inA) // zone a holds: the target is a
    await vi.waitFor(() => expect(urls).toContain(fileUrlOf('a.ogg')))
    ctx.currentTime = 2
    player.setListener(inB) // crosses into b...
    ctx.currentTime = 2.15 // ...and back before the switch time
    player.setListener(inA)
    ctx.currentTime = 3
    player.setListener(inA)
    await new Promise((r) => setTimeout(r, 0))
    expect(urls).not.toContain(fileUrlOf('b.ogg'))
  })

  it('crossfades a switch: the old voice stops after the crossfade, the new one starts', async () => {
    buffers['fb.ogg'] = fakeBuffer(2)
    buffers['a.ogg'] = fakeBuffer(2)
    const { bus, ctx, sources } = fakeBus()
    const { layout, inA } = zoneLayout()
    const { fetcher } = layoutFetcher({ layout })
    const player = new AmbienceZonesPlayer(bus, LAYOUT_URL, fileUrlOf, fetcher)
    player.setAudible(true)
    await vi.waitFor(() => expect(sources).toHaveLength(1)) // the fallback voice
    ctx.currentTime = 4
    player.setListener(inA)
    ctx.currentTime = 4.5
    player.setListener(inA) // zone a holds: the switch commits, a is loading
    ctx.currentTime = 5
    await vi.waitFor(() => expect(sources).toHaveLength(2)) // a lands: the crossfade
    expect(sources[0].stopped).toEqual([5 + AMBIENCE_CROSSFADE_S])
    expect(sources[1].started).toEqual([0])
    expect(sources[1].loop).toBe(true)
  })

  it('returns to a zone at the offset that loop had left', async () => {
    for (const f of ['fb.ogg', 'a.ogg', 'b.ogg']) buffers[f] = fakeBuffer(2, 10)
    const { bus, ctx, sources } = fakeBus()
    const { layout, inA, inB } = zoneLayout()
    const { fetcher } = layoutFetcher({ layout })
    const player = new AmbienceZonesPlayer(bus, LAYOUT_URL, fileUrlOf, fetcher)
    player.setAudible(true)
    await vi.waitFor(() => expect(sources).toHaveLength(1)) // fb, from t 0
    ctx.currentTime = 4
    player.setListener(inA)
    ctx.currentTime = 4.5
    player.setListener(inA)
    ctx.currentTime = 5
    await vi.waitFor(() => expect(sources).toHaveLength(2)) // a lands at t 5, offset 0
    ctx.currentTime = 8
    player.setListener(inB)
    ctx.currentTime = 8.5
    player.setListener(inB)
    ctx.currentTime = 10
    await vi.waitFor(() => expect(sources).toHaveLength(3)) // b lands at t 10: a stops at its offset 5
    ctx.currentTime = 12
    player.setListener(inA)
    ctx.currentTime = 12.5
    player.setListener(inA) // back to a, already decoded
    const voicesOfA = sources.filter((s) => s.buffer === buffers['a.ogg'])
    expect(voicesOfA).toHaveLength(2)
    expect(voicesOfA[1].started).toEqual([5])
  })

  it('downmixes a 4-channel decode to a 2-channel buffer of averaged samples', async () => {
    const length = 2
    const data = [new Float32Array([1, 2]), new Float32Array([3, 4]), new Float32Array([5, 6]), new Float32Array([7, 8])]
    // FL, FR, RL, RR
    const quad = {
      numberOfChannels: 4,
      length,
      sampleRate: 44100,
      duration: length / 44100,
      getChannelData: (c: number) => data[c],
    } as unknown as AudioBuffer
    buffers['fb.ogg'] = quad
    const { bus, sources } = fakeBus()
    const { layout } = zoneLayout()
    const { fetcher } = layoutFetcher({ layout })
    const player = new AmbienceZonesPlayer(bus, LAYOUT_URL, fileUrlOf, fetcher)
    player.setAudible(true)
    await vi.waitFor(() => expect(sources).toHaveLength(1))
    const buf = sources[0].buffer as unknown as AudioBuffer
    expect(buf.numberOfChannels).toBe(2)
    expect(Array.from(buf.getChannelData(0))).toEqual([3, 4]) // (FL + RL) / 2
    expect(Array.from(buf.getChannelData(1))).toEqual([5, 6]) // (FR + RR) / 2
  })

  it('evicts the least recently used non-sounding loop when a fourth decodes, and re-fetches it when needed', async () => {
    for (const f of ['fb.ogg', 'a.ogg', 'b.ogg', 'c.ogg']) buffers[f] = fakeBuffer(2)
    const { bus, ctx } = fakeBus()
    const { layout, inA, inB, inC, out } = zoneLayout()
    const { fetcher, urls } = layoutFetcher({ layout })
    const player = new AmbienceZonesPlayer(bus, LAYOUT_URL, fileUrlOf, fetcher)
    // Sound off: nothing sounds, every decoded buffer is evictable.
    await vi.waitFor(() => expect(urls).toContain(fileUrlOf('fb.ogg'))) // fb decoded at t 0
    ctx.currentTime = 0
    player.setListener(inA)
    ctx.currentTime = 0.3
    player.setListener(inA) // a decoded at t 0.3
    await vi.waitFor(() => expect(urls).toContain(fileUrlOf('a.ogg')))
    ctx.currentTime = 0.6
    player.setListener(inB)
    ctx.currentTime = 0.9
    player.setListener(inB) // b decoded at t 0.9
    await vi.waitFor(() => expect(urls).toContain(fileUrlOf('b.ogg')))
    ctx.currentTime = 1.2
    player.setListener(inC)
    ctx.currentTime = 1.5
    player.setListener(inC)
    // Let every landing settle: c is decoded, fb (least used, not sounding) is evicted.
    await new Promise((r) => setTimeout(r, 0))
    ctx.currentTime = 3
    player.setListener(out)
    ctx.currentTime = 3.5
    player.setListener(out) // back to the fallback: it was evicted, so it is fetched again
    await vi.waitFor(() => expect(urls.filter((u) => u === fileUrlOf('fb.ogg'))).toHaveLength(2))
  })

  it('never evicts the current target: a former target landing late gives up another loop', async () => {
    for (const f of ['fb.ogg', 'a.ogg', 'b.ogg', 'c.ogg']) buffers[f] = fakeBuffer(2)
    const { bus, ctx, sources } = fakeBus()
    const { layout, inA, inB, inC, out } = zoneLayout()
    const base = layoutFetcher({ layout })
    let releaseC: () => void = () => {}
    const cHeld = new Promise<void>((r) => { releaseC = r })
    const fetcher = async (url: string): Promise<Response> => {
      if (url === fileUrlOf('c.ogg')) await cHeld
      return base.fetcher(url)
    }
    const player = new AmbienceZonesPlayer(bus, LAYOUT_URL, fileUrlOf, fetcher)
    // Sound off (paused): fb at t 0, a at t 0.3, b at t 0.9 are decoded, fb the least used.
    await vi.waitFor(() => expect(base.urls).toContain(fileUrlOf('fb.ogg')))
    for (const [t, pos, file] of [[0.3, inA, 'a.ogg'], [0.9, inB, 'b.ogg']] as const) {
      ctx.currentTime = t - 0.35
      player.setListener(pos)
      ctx.currentTime = t
      player.setListener(pos)
      await vi.waitFor(() => expect(base.urls).toContain(fileUrlOf(file)))
    }
    await new Promise((r) => setTimeout(r, 0))
    // Toward c (its file held), then back outside: the target is fb again before c lands.
    ctx.currentTime = 1.2
    player.setListener(inC)
    ctx.currentTime = 1.5
    player.setListener(inC)
    ctx.currentTime = 2
    player.setListener(out)
    ctx.currentTime = 2.5
    player.setListener(out)
    releaseC()
    await vi.waitFor(() => expect(base.urls).toContain(fileUrlOf('c.ogg')))
    await new Promise((r) => setTimeout(r, 0))
    // Resume: fb (the target) is still decoded and starts at once, no second fetch.
    player.setAudible(true)
    expect(sources).toHaveLength(1)
    expect(sources[0].buffer).toBe(buffers['fb.ogg'])
    expect(base.urls.filter((u) => u === fileUrlOf('fb.ogg'))).toHaveLength(1)
  })

  it('pauses with a fade out and resumes at the stored offset, one voice per loop', async () => {
    buffers['fb.ogg'] = fakeBuffer(2, 10)
    const { bus, ctx, sources } = fakeBus()
    const { layout } = zoneLayout()
    const { fetcher } = layoutFetcher({ layout })
    const player = new AmbienceZonesPlayer(bus, LAYOUT_URL, fileUrlOf, fetcher)
    player.setAudible(true)
    await vi.waitFor(() => expect(sources).toHaveLength(1))
    player.setAudible(true) // every frame: no second voice
    expect(sources).toHaveLength(1)
    ctx.currentTime = 3
    player.setAudible(false)
    expect(sources[0].stopped).toEqual([3 + AMBIENCE_FADE_OUT_S])
    ctx.currentTime = 5
    player.setAudible(true)
    expect(sources).toHaveLength(2)
    expect(sources[1].started).toEqual([3])
  })

  it('never starts after dispose, even a decode landing later', async () => {
    for (const f of ['fb.ogg', 'a.ogg']) buffers[f] = fakeBuffer(2)
    const { bus, ctx, sources } = fakeBus()
    const { layout, inA } = zoneLayout()
    const { fetcher } = layoutFetcher({ layout })
    const player = new AmbienceZonesPlayer(bus, LAYOUT_URL, fileUrlOf, fetcher)
    player.setAudible(true)
    await vi.waitFor(() => expect(sources).toHaveLength(1))
    player.dispose()
    ctx.currentTime = 2
    player.setListener(inA)
    ctx.currentTime = 2.5
    player.setListener(inA)
    player.setAudible(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(sources).toHaveLength(1)
  })

  it('a dispose before the layout lands starts nothing', async () => {
    buffers['fb.ogg'] = fakeBuffer(2)
    const { bus, sources } = fakeBus()
    const { layout } = zoneLayout()
    const { fetcher } = layoutFetcher({ layout })
    const player = new AmbienceZonesPlayer(bus, LAYOUT_URL, fileUrlOf, fetcher)
    player.dispose()
    player.setAudible(true)
    player.setListener({ x: 5, y: 5, heading: 0 })
    await new Promise((r) => setTimeout(r, 0))
    expect(sources).toHaveLength(0)
  })
})
