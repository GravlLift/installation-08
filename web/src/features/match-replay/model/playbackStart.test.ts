import { describe, expect, it } from 'vitest'

import { atPlaybackStart, firstSpawnFrame } from './playbackStart'

const track = (startFrame: number | undefined, firstT: number | null) => ({
  startFrame,
  points: firstT === null ? [] : [{ t: firstT, x: 0, y: 0 }, { t: firstT + 10, x: 1, y: 0 }],
})

describe('firstSpawnFrame', () => {
  it('is the earliest life opening across all tracks', () => {
    expect(firstSpawnFrame({ frameCount: 500, tracks: [track(120, 120), track(85, 85), track(300, 300)] })).toBe(85)
  })

  it('reads the first point when the track publishes no startFrame', () => {
    expect(firstSpawnFrame({ frameCount: 500, tracks: [track(undefined, 42), track(90, 90)] })).toBe(42)
  })

  it('prefers startFrame over the first point, as the 3D tracks do', () => {
    expect(firstSpawnFrame({ frameCount: 500, tracks: [track(30, 40)] })).toBe(30)
  })

  it('ignores tracks without points', () => {
    expect(firstSpawnFrame({ frameCount: 500, tracks: [track(5, null), track(60, 60)] })).toBe(60)
  })

  it('is 0 when nobody ever spawns', () => {
    expect(firstSpawnFrame({ frameCount: 500, tracks: [] })).toBe(0)
    expect(firstSpawnFrame({ frameCount: 500, tracks: [track(10, null)] })).toBe(0)
  })

  it('skips the frozen pre-match stretch: a second before the first player moves', () => {
    const frozen = (moveAt: number) => ({
      startFrame: 0,
      points: [{ t: 0, x: 5, y: 5 }, { t: 300, x: 5, y: 5 }, { t: moveAt, x: 5.5, y: 5 }],
    })
    expect(firstSpawnFrame({ frameCount: 5000, tracks: [frozen(679), frozen(700)] })).toBe(649)
  })

  it('never starts before the first spawn, and ignores jitter under the threshold', () => {
    const jitter = { startFrame: 0, points: [{ t: 0, x: 1, y: 1 }, { t: 50, x: 1.01, y: 1 }] }
    expect(firstSpawnFrame({ frameCount: 500, tracks: [jitter] })).toBe(0)
    expect(firstSpawnFrame({ frameCount: 500, tracks: [track(85, 85)] })).toBe(85)
  })

  it('stays inside the film', () => {
    expect(firstSpawnFrame({ frameCount: 100, tracks: [track(250, 250)] })).toBe(99)
    expect(firstSpawnFrame({ frameCount: 100, tracks: [track(-3, -3)] })).toBe(0)
    expect(firstSpawnFrame({ frameCount: 100, tracks: [track(undefined, 12.6)] })).toBe(13)
  })
})

describe('atPlaybackStart', () => {
  it('holds at the start frame and before it, not after', () => {
    expect(atPlaybackStart(85, 85)).toBe(true)
    expect(atPlaybackStart(0, 85)).toBe(true)
    expect(atPlaybackStart(86, 85)).toBe(false)
  })
})
