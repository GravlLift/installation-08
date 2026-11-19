// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it, vi } from 'vitest'

import { REVERB_CROSSFADE_S, REVERB_SWITCH_HOLD_S, ZoneReverbPlayer, type ReverbBus } from './zoneReverb'
import type { AmbienceLayout } from './ambienceZones'

function fakeBus() {
  const gains: { gain: { value: number; setValueAtTime: ReturnType<typeof vi.fn>; linearRampToValueAtTime: ReturnType<typeof vi.fn>; cancelScheduledValues: ReturnType<typeof vi.fn> }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = []
  const convolvers: { normalize: boolean; buffer: AudioBuffer | null; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = []
  const buffer = {} as AudioBuffer
  const ctx = {
    currentTime: 0,
    createGain: () => {
      const node = { gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }
      gains.push(node)
      return node
    },
    createConvolver: () => {
      const node = { normalize: true, buffer: null as AudioBuffer | null, connect: vi.fn(), disconnect: vi.fn() }
      convolvers.push(node)
      return node
    },
    decodeAudioData: vi.fn(async () => buffer),
  }
  const send = { connect: vi.fn() }
  const out = {}
  return { bus: { ctx, send, out } as unknown as ReverbBus, ctx, gains, convolvers, send, out, buffer }
}

const fileUrl = (file: string) => `/ambience/${file}`
const response = { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as Response

function zoneLayout(): AmbienceLayout {
  return {
    fallback: '', files: {}, fallbackReverb: 'hall',
    reverbs: { hall: { file: 'hall.wav', wetDb: -6 }, room: { file: 'room.wav', wetDb: -12 } },
    zones: [
      { zone: 1, loop: '', reverb: 'room', floor: 0, height: 10, points: [[0, 0], [20, 0], [20, 20], [0, 20]] },
      { zone: 2, loop: '', reverb: 'missing', floor: 0, height: 2, points: [[8, 8], [12, 8], [12, 12], [8, 12]] },
    ],
  }
}

describe('ZoneReverbPlayer', () => {
  it('loads every response, wires unnormalized convolvers and ramps only the fallback', async () => {
    const { bus, gains, convolvers, send, out, buffer } = fakeBus()
    const fetcher = vi.fn(async (_url: string) => response)
    const player = new ZoneReverbPlayer(bus, fileUrl, fetcher)
    player.setLayout(zoneLayout())
    await vi.waitFor(() => expect(convolvers).toHaveLength(2))
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/ambience/hall.wav', '/ambience/room.wav'])
    expect(convolvers.map((c) => [c.normalize, c.buffer])).toEqual([[false, buffer], [false, buffer]])
    expect(gains[1].gain.value).toBeCloseTo(10 ** (-6 / 20))
    expect(gains[3].gain.value).toBeCloseTo(10 ** (-12 / 20))
    expect(gains[0].gain.value).toBe(0)
    expect(gains[2].gain.value).toBe(0)
    expect(gains[0].gain.setValueAtTime).toHaveBeenCalledWith(0, 0)
    expect(gains[0].gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, REVERB_CROSSFADE_S)
    expect(gains[2].gain.linearRampToValueAtTime).not.toHaveBeenCalled()
    expect(send.connect).toHaveBeenCalledWith(gains[0])
    expect(gains[0].connect).toHaveBeenCalledWith(convolvers[0])
    expect(convolvers[0].connect).toHaveBeenCalledWith(gains[1])
    expect(gains[1].connect).toHaveBeenCalledWith(out)
    player.dispose()
    for (const node of [...gains, ...convolvers]) expect(node.disconnect).toHaveBeenCalledOnce()
  })

  it('holds a new room before switching and ignores an unknown smaller zone', async () => {
    const { bus, ctx, gains, convolvers } = fakeBus()
    const player = new ZoneReverbPlayer(bus, fileUrl, async () => response)
    player.setLayout(zoneLayout())
    await vi.waitFor(() => expect(convolvers).toHaveLength(2))
    const pos = { x: 10, y: 10, heading: 0 }
    player.setListener(pos)
    ctx.currentTime = REVERB_SWITCH_HOLD_S / 2
    player.setListener(pos)
    expect(player.current()).toBe('hall')
    expect(gains[2].gain.linearRampToValueAtTime).not.toHaveBeenCalled()
    ctx.currentTime = REVERB_SWITCH_HOLD_S + 0.01
    player.setListener(pos)
    expect(player.current()).toBe('room')
    expect(gains[0].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, ctx.currentTime + REVERB_CROSSFADE_S)
    expect(gains[2].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(1, ctx.currentTime + REVERB_CROSSFADE_S)
  })

  it('leaves a 404 room absent without throwing', async () => {
    const { bus, gains, convolvers } = fakeBus()
    const fetcher = vi.fn(async (url: string) => url.endsWith('room.wav') ? { ok: false, status: 404 } as Response : response)
    const player = new ZoneReverbPlayer(bus, fileUrl, fetcher)
    expect(() => player.setLayout(zoneLayout())).not.toThrow()
    await vi.waitFor(() => expect(convolvers).toHaveLength(1))
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(gains).toHaveLength(2)
  })

  it('does not fetch or build rooms without reverbs', () => {
    const { bus, gains } = fakeBus()
    const fetcher = vi.fn(async () => response)
    const player = new ZoneReverbPlayer(bus, fileUrl, fetcher)
    player.setLayout({ fallback: '', files: {}, zones: [] })
    expect(fetcher).not.toHaveBeenCalled()
    expect(gains).toHaveLength(0)
    expect(player.current()).toBe('')
  })

  it('builds no nodes when decoding finishes after disposal', async () => {
    const { bus, ctx, gains, convolvers } = fakeBus()
    let release!: (buffer: AudioBuffer) => void
    ctx.decodeAudioData.mockImplementation(() => new Promise<AudioBuffer>((resolve) => { release = resolve }))
    const player = new ZoneReverbPlayer(bus, fileUrl, async () => response)
    const layout = zoneLayout()
    layout.reverbs = { hall: layout.reverbs!.hall }
    player.setLayout(layout)
    await vi.waitFor(() => expect(ctx.decodeAudioData).toHaveBeenCalledOnce())
    player.dispose()
    release({} as AudioBuffer)
    await new Promise((resolve) => setTimeout(resolve, 0))
    player.setLayout(layout)
    expect(ctx.decodeAudioData).toHaveBeenCalledOnce()
    expect(gains).toHaveLength(0)
    expect(convolvers).toHaveLength(0)
  })
})
