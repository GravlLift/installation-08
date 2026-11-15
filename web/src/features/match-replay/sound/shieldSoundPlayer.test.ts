import { describe, expect, it } from 'vitest'

import { shieldHudTrackOf } from '../model/shieldHud'
import { SHIELD_SOUND, SHIELD_SOUND_STEMS, type ShieldSoundReading } from './shieldSound'
import { ShieldSoundPlayer, type ShieldBus } from './shieldSoundPlayer'

const MS = 33
const STEP = 1 / 64

// Full until 10; hit to 0.5 at 12, to 0.2 (low) at 20, broken at 24, recharge from 174, full at 238.
function brokenLife() {
  const points: { t: number; sh?: number }[] = [{ t: 0 }, { t: 10, sh: 1 }, { t: 12, sh: 0.5 }, { t: 20, sh: 0.2 }, { t: 24, sh: 0 }, { t: 100, sh: 0 }]
  for (let i = 0; i <= 64; i++) points.push({ t: 174 + i, sh: Math.min(1, i * STEP) })
  points.push({ t: 400, sh: 1 })
  return points
}

// The rises' file lengths measured on the installed game (rise_0 .. rise_9), in seconds.
const RISES_S = [0.557, 0.836, 1.574, 1.727, 0.686, 2.308, 1.108, 1.372, 1.697, 0.45]

/** A fake bus: every stem decoded; each started source is recorded with its stem, offset and stop. */
function fakeBus() {
  const buffers = new Map<string, AudioBuffer>()
  const stemOf = new Map<AudioBuffer, string>()
  for (const stem of SHIELD_SOUND_STEMS) {
    const rise = (SHIELD_SOUND.rises as readonly string[]).indexOf(stem)
    const buf = { duration: rise >= 0 ? RISES_S[rise] : stem === SHIELD_SOUND.lowLoop ? 0.823 : 2.3 } as AudioBuffer
    buffers.set(stem, buf)
    stemOf.set(buf, stem)
  }
  const started: { stem: string; offsetS: number; loop: boolean; stopped: boolean }[] = []
  const param = () => ({ value: 1, setValueAtTime() {}, cancelScheduledValues() {}, linearRampToValueAtTime() {} })
  const ctx = {
    currentTime: 0,
    createGain: () => ({ gain: param(), connect() {}, disconnect() {} }),
    createBufferSource: () => {
      const src = {
        buffer: null as AudioBuffer | null, loop: false, onended: null, connect() {}, disconnect() {},
        rec: null as null | (typeof started)[number],
        start(_t: number, offsetS: number) { src.rec = { stem: stemOf.get(src.buffer!)!, offsetS, loop: src.loop, stopped: false }; started.push(src.rec) },
        stop() { if (src.rec) src.rec.stopped = true },
      }
      return src
    },
  }
  const bus = { ctx, out: {}, bufferOf: (stem: string) => buffers.get(stem) } as unknown as ShieldBus
  return { bus, started, live: () => started.filter((s) => !s.stopped).map((s) => s.stem) }
}

const life = { id: 'life-1' }
const track = shieldHudTrackOf(brokenLife(), MS, 0)
const reading = (l: object = life): ShieldSoundReading => ({ life: l, track } as unknown as ShieldSoundReading)

/** Plays frames [from, to) one by one, as a 30 fps playback would. */
function play(p: ShieldSoundPlayer, from: number, to: number, r = reading(), continuous = true) {
  for (let f = from; f < to; f++) p.sync(r, f, f * MS, MS, continuous)
}

describe('ShieldSoundPlayer', () => {
  it('plays a life as the game does: low beep, break then depleted beep, recharge, full tone', () => {
    const { bus, started, live } = fakeBus()
    const p = new ShieldSoundPlayer(bus)
    play(p, 0, 22)
    expect(live()).toEqual([SHIELD_SOUND.lowLoop])
    play(p, 22, 30)
    expect(started.map((s) => s.stem)).toEqual([SHIELD_SOUND.lowLoop, SHIELD_SOUND.break, SHIELD_SOUND.brokenLoop])
    expect(live()).toEqual([SHIELD_SOUND.break, SHIELD_SOUND.brokenLoop])
    play(p, 30, 180)
    // The refill from empty takes 2 s: the 2.3 s rise (2.1 s of sound) is the one that ends with the bar.
    expect(live()).toEqual([SHIELD_SOUND.break, SHIELD_SOUND.rechargeStart, SHIELD_SOUND.rechargeLayer, SHIELD_SOUND.rises[5]])
    play(p, 180, 300)
    // At full the rise is cut and the full tone plays (the fake's one-shots never end by themselves).
    expect(live()).toEqual([SHIELD_SOUND.break, SHIELD_SOUND.full, SHIELD_SOUND.fullLayer])
    expect(started.filter((s) => s.stem === SHIELD_SOUND.break)).toHaveLength(1)
    expect(started.filter((s) => s.stem === SHIELD_SOUND.brokenLoop)).toHaveLength(1)
  })

  it('a seek into the depleted state replays no break: the loop enters at the beat the state start gives', () => {
    const { bus, started, live } = fakeBus()
    const p = new ShieldSoundPlayer(bus)
    play(p, 0, 5)
    p.sync(reading(), 100, 100 * MS, MS, false)
    expect(started.map((s) => s.stem)).toEqual([SHIELD_SOUND.brokenLoop])
    expect(started[0].loop).toBe(true)
    expect(started[0].offsetS).toBeCloseTo(((100 - 24) * MS / 1000) % 2.3, 6)
    // A forward jump past the recharge and the full, even flagged continuous, crosses nothing.
    p.sync(reading(), 260, 260 * MS, MS, true)
    expect(live()).toEqual([])
    expect(started).toHaveLength(1)
  })

  it('stops everything on death (no reading), on another life, and on stopAll; the next step crosses nothing', () => {
    const { bus, started, live } = fakeBus()
    const p = new ShieldSoundPlayer(bus)
    play(p, 0, 26)
    expect(live()).toContain(SHIELD_SOUND.brokenLoop)
    p.sync(null, 26, 26 * MS, MS, true)
    expect(live()).toEqual([])
    // Another life (respawn, another player) at a broken frame: its loop, never the break of the other.
    p.sync(reading({ id: 'life-2' }), 30, 30 * MS, MS, true)
    expect(live()).toEqual([SHIELD_SOUND.brokenLoop])
    p.stopAll()
    expect(live()).toEqual([])
    // The first step after a stop continues nothing: resuming past the recharge start fires no rise.
    const before = started.length
    p.sync(reading(), 176, 176 * MS, MS, true)
    play(p, 177, 200)
    expect(started.slice(before)).toEqual([])
  })
})
