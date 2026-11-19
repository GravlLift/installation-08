// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * masterBus.test.ts — the game's master compressor: the settings read from the install, the
 * calibration to the viewer's levels, the trim that takes Chromium's make-up back out, and its
 * place in the player (in front of the volume, every sound through it).
 *
 * What breaks silently: a sound wired past the compressor (it plays uncompressed, nothing
 * errs), the compressor after the volume (it works harder the louder the user listens), a
 * make-up left in (everything 6 dB louder).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'

import { flushAudio, installFakeAudio, type FakeContext } from '../test/fakeAudio'
import { chromiumMakeupDb, GAME_MASTER_COMPRESSOR, MASTER_THRESHOLD_DB, MASTER_TRIM_DB } from './masterBus'
import { ReplayAudioPlayer } from './replayAudio'

describe('masterBus — the settings', () => {
  it('moves the game threshold by the bus chain the viewer leaves out', () => {
    expect(GAME_MASTER_COMPRESSOR.thresholdDb).toBe(-17)
    expect(MASTER_THRESHOLD_DB).toBe(-12)
  })

  it("takes Chromium's make-up back out (measured +6.17 dB in Chromium's headless shell, 2026-11-19)", () => {
    expect(chromiumMakeupDb(-12, 7)).toBeCloseTo(6.171, 3)
    expect(MASTER_TRIM_DB).toBeCloseTo(0.5 - 6.171, 3)
  })
})

describe('masterBus — in the player', () => {
  let ctx: FakeContext
  beforeEach(() => {
    ctx = installFakeAudio(3).ctx
  })
  afterEach(() => vi.unstubAllGlobals())

  it('every sound feeds the compressor, which feeds the volume', async () => {
    const p = new ReplayAudioPlayer(0.5)
    const volume = ctx.gains[0]
    const [comp] = ctx.compressors
    expect(comp.threshold.value).toBe(MASTER_THRESHOLD_DB)
    expect(comp.knee.value).toBe(0)
    expect(comp.ratio.value).toBe(7)
    expect(comp.attack.value).toBe(0)
    expect(comp.release.value).toBe(0.5)
    const trim = ctx.gains[1]
    expect(comp.connections).toEqual([trim])
    expect(trim.connections).toEqual([volume])
    expect(trim.gain.value).toBeCloseTo(10 ** (MASTER_TRIM_DB / 20), 6)
    p.preload(['/a.ogg'])
    await flushAudio()
    p.play('/a.ogg')
    const voice = ctx.gains[ctx.gains.length - 1]
    expect(voice.connections).toContain(comp)
    expect(voice.connections).not.toContain(volume)
    expect(p.reverbBus().out).toBe(comp)
    expect(p.engineBus(1).out).not.toBe(volume)
  })
})
