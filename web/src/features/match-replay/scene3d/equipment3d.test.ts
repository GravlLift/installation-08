// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * 3D EQUIPMENT SHOWS WHAT 2D SHOWS, ON THE SAME FRAMES: placements (wall, sensor, dropped
 * objects, seeker), rifts, grapple cables and knockbacks, on a hand-built document.
 */
import { describe, expect, it } from 'vitest'

import { riftStations, riftStationsAt } from '../model/riftStations'
import { testReplayDoc } from '../test/testDoc'
import {
  equipmentTime3d,
  knockbackArrow,
  knockbackShownAt,
  placementDrawn,
  placementShownAt,
  placementSpans3d,
} from './equipment3d'
import { grapplePhaseAt } from './grapple3d_logic'

/** 100 ms per frame: 2D durations read directly as frames. */
const FRAME_MS = 100

function life(slot: number, start: number, end: number) {
  return { slot, team: 0, startFrame: start, endFrame: end, points: [{ t: start, x: 0, y: 0 }, { t: end, x: 1, y: 0 }] }
}

const doc = testReplayDoc({
  frameCount: 2000,
  frameIntervalMs: FRAME_MS,
  tracks: [life(3, 0, 400), life(4, 0, 400)],
  abilityLabels: { '11': { fr: 'Translocateur quantique', en: 'Quantum Translocator' } },
  equipmentPlacements: [
    // A deployed wall's panels: drawn, 12.48 s fallback.
    { family: 'wall', id: '0x528fce46', origin: 'deployed', owner: 3, t0: 100, t1: 105, x: 1, y: 2, z: 0, h: 90 },
    // The device of the same wall: never drawn when deployed (only the panels are).
    { family: 'wall', id: '0x8e2dc574', origin: 'deployed', owner: 3, t0: 100, t1: 101, x: 1, y: 2 },
    // A sensor dropped on death: dropped object, until the end of the replay.
    { family: 'sensor', id: 'x', origin: 'dropped', owner: 3, t0: 401, t1: 402, x: 5, y: 5 },
    // A dropped grenade: never drawn.
    { family: 'grenade_frag', id: 'g', origin: 'dropped', owner: 3, t0: 401, t1: 402, x: 5, y: 5 },
    // An unidentified object: toggle off by default, nothing.
    { family: 'other', id: 'o', origin: 'deployed', owner: 3, t0: 10, t1: 20, x: 0, y: 0 },
    // A deployed seeker (legacy artifact): only its pulse, 400 ms.
    { family: 'threat_seeker', id: 's', origin: 'deployed', owner: 4, t0: 50, t1: 51, x: 3, y: 3 },
  ],
  riftPoses: [{ slot: 3, t: 200, t1: 260, x: 7, y: 7, z: 1 }],
  grappleLines: [
    { slot: 3, t0: 30, t1: 40, ax: 9, ay: 9, az: 2 },
    { slot: 4, t0: 50, t1: 50, ax: 9, ay: 9 },
  ],
  knockbacks: [
    { t: 120, slot: 4, by: 3, vx: 6, vy: 0, vz: 0 },
    { t: 130, slot: 4, by: 3, vx: 30, vy: 40, vz: 0 },
    { t: 140, slot: 4 },
  ],
})

const time = equipmentTime3d(doc)

describe('equipment3d — placements follow the 2D trace\'s gate', () => {
  const spans = placementSpans3d(doc, time)

  it('keeps only the wall panels, the dropped sensor and the seeker', () => {
    expect(spans.map((s) => [s.p.family, s.kind])).toEqual([
      ['wall', 'wall'],
      ['sensor', 'dropped'],
      ['threat_seeker', 'seeker'],
    ])
  })

  it('the wall holds its fallback duration (12.48 s) from its placement', () => {
    const wall = spans[0]
    expect(placementShownAt(wall, 99, time)).toBe(false)
    expect(placementShownAt(wall, 100, time)).toBe(true)
    expect(placementShownAt(wall, 100 + 12_480 / FRAME_MS, time)).toBe(true)
    expect(placementShownAt(wall, 101 + 12_480 / FRAME_MS, time)).toBe(false)
  })

  it('the dropped object stays until the end of the replay', () => {
    expect(placementShownAt(spans[1], 1999, time)).toBe(true)
  })

  it('the seeker only shows its pulse', () => {
    const seeker = spans[2]
    expect(placementShownAt(seeker, 50, time)).toBe(true)
    expect(placementShownAt(seeker, 53, time)).toBe(true)
    expect(placementShownAt(seeker, 54, time)).toBe(false)
  })
})

describe('equipment3d — rifts, cables and knockbacks', () => {
  it('the rift lives from its placement to its read end', () => {
    const stations = riftStations(doc)
    expect(riftStationsAt(stations, 199)).toEqual([])
    expect(riftStationsAt(stations, 200)).toHaveLength(1)
    expect(riftStationsAt(stations, 260)).toHaveLength(1)
    expect(riftStationsAt(stations, 261)).toEqual([])
  })

  it('the cable shows during the measured pull, never on an empty pull', () => {
    const [line, empty] = doc.grappleLines
    expect(grapplePhaseAt(line, 29, FRAME_MS)).toBeNull()
    expect(grapplePhaseAt(line, 30, FRAME_MS)).not.toBeNull()
    expect(grapplePhaseAt(line, 40, FRAME_MS)).not.toBeNull()
    expect(grapplePhaseAt(line, 41, FRAME_MS)).toBeNull()
    expect(grapplePhaseAt(empty, 50, FRAME_MS)).toBeNull()
  })

  it('the knockback lasts the 2D effect (520 ms)', () => {
    const k = doc.knockbacks[0]
    expect(knockbackShownAt(k, 119, time)).toBe(false)
    expect(knockbackShownAt(k, 120, time)).toBe(true)
    expect(knockbackShownAt(k, 125, time)).toBe(true)
    expect(knockbackShownAt(k, 125.3, time)).toBe(false)
  })

  it('the arrow follows the published speed, capped, and nothing without a pulse', () => {
    const slow = knockbackArrow(doc.knockbacks[0])
    expect(slow?.length).toBeCloseTo(1.2)
    expect(slow?.dir.toArray()).toEqual([1, 0, -0])
    expect(knockbackArrow(doc.knockbacks[1])?.length).toBe(1.5)
    expect(knockbackArrow(doc.knockbacks[2])).toBeNull()
  })

  it('placement shapes aid off: the drop wall, the shroud bubble, the sensor and the repair field stay, as in the game', () => {
    for (const kind of ['wall', 'shroud', 'sensor', 'field'] as const) expect(placementDrawn(kind, false)).toBe(true)
    for (const kind of ['rift', 'seeker', 'unnamed', 'dropped'] as const) {
      expect(placementDrawn(kind, false)).toBe(false)
      expect(placementDrawn(kind, true)).toBe(true)
    }
  })
})
