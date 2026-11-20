// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** cameraScriptSmooth3d.test.ts — a player point's `smooth`: the centered Gaussian average of the feet. */
import { describe, expect, it } from 'vitest'

import {
  evaluateCameraScript,
  parseCameraScript,
  PLAYER_SMOOTH_DEFAULT_MS,
  type CameraScript,
  type PlayerPoint,
  type ScriptSubjects,
} from './cameraScript3d'
import { GAME_FOV_DEFAULT } from '../model/fovLogic'

/** The camera's position (GAME coordinates) for a one-key script whose pos is `pos`, at `tMs`. */
function camAt(pos: Partial<PlayerPoint> & { xuid: string }, subjects: ScriptSubjects, tMs: number): [number, number, number] {
  const script: CameraScript = {
    version: 1, matchId: 'm', name: 's',
    keys: [{ t: 0, pos: { at: 'player', ...pos }, look: { at: 'world', point: [0, 100, 0] } }],
  }
  const p = evaluateCameraScript(script, tMs, subjects, GAME_FOV_DEFAULT)!.position
  // toThree: three = [x, z, -y].
  return [p[0], -p[2], p[1]]
}

/** 'R' runs along +x at 10 u/s; 'J' does the same with a 30 Hz zigzag of 5 cm; 'T' teleports from x = 0 to x = 100 at 1 s. */
const subjects: ScriptSubjects = {
  feetAt(xuid, tMs) {
    const x = (tMs / 1000) * 10
    if (xuid === 'R') return { x, y: 0, z: 0, h: 0 }
    if (xuid === 'J') return { x: x + 0.05 * Math.sin((2 * Math.PI * tMs) / 33.3), y: 0, z: 0, h: 0 }
    if (xuid === 'T') return { x: tMs < 1000 ? 0 : 100, y: 0, z: 0, h: 0 }
    if (xuid === 'L') return tMs < 0 ? null : { x, y: 0, z: 0, h: 0 }
    return null
  },
}

describe('player point smooth', () => {
  it('parses 0 to 2000 and rejects the rest', () => {
    const raw = (smooth: unknown) => ({
      version: 1, matchId: 'm', name: 's',
      keys: [{ t: 0, pos: { at: 'player', xuid: 'R', smooth }, look: { at: 'world', point: [0, 0, 0] } }],
    })
    for (const ok of [0, 250, 2000]) {
      const r = parseCameraScript(raw(ok))
      expect(r.ok).toBe(true)
      if (r.ok) expect((r.script.keys[0].pos as PlayerPoint).smooth).toBe(ok)
    }
    for (const bad of [-1, 2001, Number.NaN, '250']) expect(parseCameraScript(raw(bad)).ok).toBe(false)
  })

  it('defaults to 250 ms', () => {
    expect(PLAYER_SMOOTH_DEFAULT_MS).toBe(250)
    for (const t of [500, 1234, 2010]) {
      expect(camAt({ xuid: 'J' }, subjects, t)).toEqual(camAt({ xuid: 'J', smooth: 250 }, subjects, t))
      expect(camAt({ xuid: 'J' }, subjects, t)[0]).not.toBe(camAt({ xuid: 'J', smooth: 0 }, subjects, t)[0])
    }
  })

  it('0 is the raw feet', () => {
    for (const t of [500, 1234, 2010]) expect(camAt({ xuid: 'J', smooth: 0 }, subjects, t)[0]).toBe(subjects.feetAt('J', t)!.x)
  })

  it('has no lag on a constant velocity (symmetric weights)', () => {
    for (const smooth of [100, 250, 2000]) {
      for (const t of [3000, 4321]) expect(camAt({ xuid: 'R', smooth }, subjects, t)[0]).toBeCloseTo((t / 1000) * 10, 9)
    }
  })

  it('removes the replication zigzag', () => {
    let rawMax = 0
    let smoothMax = 0
    for (let t = 1000; t < 2000; t += 4) {
      const line = (t / 1000) * 10
      rawMax = Math.max(rawMax, Math.abs(camAt({ xuid: 'J', smooth: 0 }, subjects, t)[0] - line))
      smoothMax = Math.max(smoothMax, Math.abs(camAt({ xuid: 'J' }, subjects, t)[0] - line))
    }
    expect(rawMax).toBeGreaterThan(0.045)
    expect(smoothMax).toBeLessThan(rawMax / 10)
  })

  it('stops at a teleport and at an unknown sample instead of averaging across them', () => {
    expect(camAt({ xuid: 'T' }, subjects, 990)[0]).toBe(0)
    expect(camAt({ xuid: 'T' }, subjects, 1010)[0]).toBe(100)
    const atStart = camAt({ xuid: 'L' }, subjects, 0)[0]
    expect(Number.isFinite(atStart)).toBe(true)
    expect(atStart).toBeGreaterThan(0) // only the later side is known: a one-sided average
  })

  it('is a pure function of the time', () => {
    const first = camAt({ xuid: 'J' }, subjects, 1500)
    camAt({ xuid: 'J' }, subjects, 2500)
    expect(camAt({ xuid: 'J' }, subjects, 1500)).toEqual(first)
  })
})
