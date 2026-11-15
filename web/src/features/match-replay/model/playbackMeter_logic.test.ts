import { describe, expect, it } from 'vitest'

import { newPlaybackMeter, readPlayback, recordFrame, recordScript } from './playbackMeter_logic'

/** feed records `n` frames every `dtMs`, the film advancing `filmPerFrame` frames each. */
function feed(n: number, dtMs: number, filmPerFrame: number, start = 1000) {
  const m = newPlaybackMeter()
  let t = start
  let f = 0
  for (let i = 0; i < n; i++) {
    recordFrame(m, t, f)
    t += dtMs
    f += filmPerFrame
  }
  return { m, last: t - dtMs }
}

describe('playbackMeter_logic', () => {
  it('reads 60 fps in real time from 16.67 ms frames of a 30 fps film', () => {
    const { m, last } = feed(200, 1000 / 60, 0.5)
    const r = readPlayback(m, 30, last)!
    expect(r.displayedFps).toBeCloseTo(60, 1)
    expect(r.frameMsAvg).toBeCloseTo(16.67, 1)
    expect(r.frameMsWorst).toBeCloseTo(16.67, 1)
    expect(r.realtime).toBeCloseTo(1, 3)
  })

  it('covers only the last second', () => {
    const m = newPlaybackMeter()
    let t = 0
    for (let i = 0; i < 100; i++) recordFrame(m, (t += 10), i) // a fast run long ago...
    for (let i = 0; i < 20; i++) recordFrame(m, (t += 75), 100 + i * 2.25) // ...then one second and a half at 75 ms
    const r = readPlayback(m, 30, t)!
    expect(r.displayedFps).toBeCloseTo(1000 / 75, 1)
    expect(r.frameMsWorst).toBeCloseTo(75, 5)
    expect(r.realtime).toBeCloseTo(1, 3) // 2.25 film frames per 75 ms at 30 fps: real time, frames skipped
  })

  it('keeps the worst frame of the window', () => {
    const m = newPlaybackMeter()
    let t = 0
    for (let i = 0; i < 30; i++) recordFrame(m, (t += i === 20 ? 150 : 20), i)
    expect(readPlayback(m, 30, t)!.frameMsWorst).toBe(150)
  })

  it('reads a slowed film as below real time and a paused one as 0', () => {
    const slow = feed(80, 20, 0.3) // 0.3 film frames per 20 ms = 15 film fps of a 30 fps film
    expect(readPlayback(slow.m, 30, slow.last)!.realtime).toBeCloseTo(0.5, 3)
    const paused = feed(80, 20, 0)
    expect(readPlayback(paused.m, 30, paused.last)!.realtime).toBe(0)
  })

  it('restarts after a gap and reads nothing once the loop stopped', () => {
    const { m, last } = feed(80, 20, 0.6)
    recordFrame(m, last + 5000, 0) // tab hidden 5 s
    expect(readPlayback(m, 30, last + 5000)).toBeNull()
    recordFrame(m, last + 5020, 0.6)
    recordFrame(m, last + 5040, 1.2)
    expect(readPlayback(m, 30, last + 5040)!.displayedFps).toBeCloseTo(50, 5)
    expect(readPlayback(m, 30, last + 9000)).toBeNull()
  })

  it('wraps the ring without losing the window', () => {
    const { m, last } = feed(2000, 4, 0.12) // 250 fps, ring of 512
    const r = readPlayback(m, 30, last)!
    expect(r.displayedFps).toBeCloseTo(250, 1)
    expect(r.realtime).toBeCloseTo(1, 3)
  })

  it('smooths the script time', () => {
    const m = newPlaybackMeter()
    for (let i = 0; i < 200; i++) recordScript(m, 12)
    recordScript(m, -1)
    recordScript(m, NaN)
    expect(m.scriptMs).toBeCloseTo(12, 3)
  })
})
