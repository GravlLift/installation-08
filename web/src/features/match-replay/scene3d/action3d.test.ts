// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import type { ReplayKill } from '../model/killFeedLogic'
import { testReplayDoc } from '../test/testDoc'
import type { Action3dInputs } from './action3dInputs'
import { firstFrom, type Ground, type InkCache } from './actionKit'
import type { ActionContext } from './actionScene3d'
import { FlashLights } from './flash3d'
import { buildDeaths3d, deathHoldFramesOf, deathText, lingeringRange } from './deaths3d'
import { heightsAlong } from './flights3d'
import { heldWeaponAt } from './heldWeapon3d'
import { buildTracks3d } from './tracks3d'

describe('firstFrom', () => {
  const items = [1, 3, 3, 7, 9]
  it('returns the first element at or after the given value', () => {
    expect(firstFrom(items, (v) => v, 3)).toBe(1)
    expect(firstFrom(items, (v) => v, 4)).toBe(3)
    expect(firstFrom(items, (v) => v, 0)).toBe(0)
    expect(firstFrom(items, (v) => v, 10)).toBe(5)
  })
})

describe('heightsAlong', () => {
  it('spreads the height over the distance traveled, not over the point count', () => {
    // Three steps: 0 -> 1 (1 u), 1 -> 4 (3 u); the height goes from 2 to 6.
    const pts = heightsAlong([[0, 0, 0], [1, 1, 0], [2, 4, 0]], 2, 6)
    expect(pts.map((p) => p.y)).toEqual([2, 3, 6])
    // three axes: (x, y) Halo -> (x, -y).
    expect(pts[2].x).toBe(4)
    expect(pts[2].z).toBeCloseTo(0)
  })
})

function track(slot: number, xuid: string, start: number, end: number, z = 0) {
  return { slot, team: 0, xuid, startFrame: start, endFrame: end, points: [{ t: start, x: 0, y: 0, z }, { t: end, x: 4, y: 0, z }] }
}

describe('heldWeaponAt', () => {
  const doc = (d?: number) =>
    testReplayDoc({
      tracks: [track(512, 'A', 0, 100)],
      loadouts: [{ t: 10, slot: 512, w: ['0xAAAA', '0xBBBB'] }],
      inventory: [{ t: 10, slot: 512, ...(d === undefined ? {} : { d }) }],
      weaponLabels: { '0xAAAA': { en: 'BR75', fr: 'BR75', tint: 'kinetic' } },
    })

  it('names the weapon the selector points at, with the tint of its shots', () => {
    expect(heldWeaponAt(doc(0), 512, 60, 'en')).toEqual({ id: '0xAAAA', name: 'BR75', tint: 'kinetic' })
  })

  it('a label missing from the catalog leaves the name empty, never the id', () => {
    expect(heldWeaponAt(doc(1), 512, 60, 'en')).toEqual({ id: '0xBBBB', name: '', tint: 'neutral' })
  })

  it('bare hands or an unread selector: nothing in hand', () => {
    expect(heldWeaponAt(doc(2), 512, 60, 'en')).toBeNull()
    expect(heldWeaponAt(doc(), 512, 60, 'en')).toBeNull()
  })
})

describe('buildDeaths3d', () => {
  // Victim V alive 0-50; killer K alive 0-120. The kill lands on frame 50.
  const doc = testReplayDoc({
    frameIntervalMs: 100,
    tracks: [track(1, 'V', 0, 50, 3), track(2, 'K', 0, 120, 3)],
  })
  const tracks = buildTracks3d(doc)
  const ground = { floorY: () => 0, hit: () => null } as unknown as Ground

  function ctxWith(seated: (xuid: string) => boolean): ActionContext {
    const inputs = { seatedOfXuid: seated } as unknown as Action3dInputs
    return {
      doc,
      tracks,
      ground,
      ink: {} as InkCache,
      root: new THREE.Group(),
      originAboveFloor: 0.5,
      inputs: () => inputs,
      playerFeet: (xuid, frame) => {
        const s = tracks.sample(xuid, frame)
        return s ? new THREE.Vector3(s.x, s.z - 0.5, -s.y) : null
      },
      slotState: (slot, frame) => tracks.sampleSlot(slot, frame),
      weaponModel: () => null,
      flagModel: () => null,
      grenadeModel: () => null,
      spartanModel: () => null,
      dressOf: () => null,
      drawnWeapon: () => null,
      firstPersonSlot: () => null,
      flashes: new FlashLights(new THREE.Scene()),
    }
  }
  const kill = (over: Partial<ReplayKill> = {}): ReplayKill =>
    ({ tMs: 0, replayMs: 5000, xuid: 'K', victimXuid: 'V', teamID: 0, weaponLabel: 'BR75', weaponKey: 'br', medals: [], ...over }) as ReplayKill

  it('puts the death at the victim\'s feet, the killer re-read, the weapon of the kill', () => {
    const [d] = buildDeaths3d(ctxWith(() => true), [kill()])
    expect(d.frame).toBe(50)
    expect(d.at.y).toBeCloseTo(2.5)
    expect(d.from).not.toBeNull()
    expect(d.weapon).toBe('BR75')
  })

  it('starts the body on the last frame alive, with no empty gap', () => {
    const [d] = buildDeaths3d(ctxWith(() => true), [kill()])
    expect(d.body?.start).toBe(50)
  })

  it('a killer with no record left draws no line', () => {
    const [d] = buildDeaths3d(ctxWith((x) => x !== 'K'), [kill()])
    expect(d.from).toBeNull()
  })

  it('the label reads like the feed', () => {
    expect(deathText('K', 'V', 'BR75')).toBe('K › V · BR75')
    expect(deathText('K', 'V', '')).toBe('K › V')
    expect(deathText('K', null, 'BR75')).toBe('K · BR75')
    expect(deathText(null, 'V', 'BR75')).toBeNull()
  })

  it('without a located victim, no cross', () => {
    expect(buildDeaths3d(ctxWith(() => true), [kill({ victimXuid: 'X' })])).toEqual([])
    expect(buildDeaths3d(ctxWith(() => true), [kill({ victimXuid: undefined })])).toEqual([])
  })

  describe('how long a death lingers (deathHoldMs)', () => {
    // 10 frames per second: the page's default hold is 1.4 s, 14 frames (MatchViewScreen).
    const defaultFrames = Math.round(1.4 * 10)
    const deaths = () => buildDeaths3d(ctxWith(() => true), [kill()])
    const present = (frame: number, scriptHoldMs: number | null) => {
      const ds = deaths()
      const [from, to] = lingeringRange(ds, frame, deathHoldFramesOf(defaultFrames, scriptHoldMs, doc))
      return ds.slice(from, to).some((d) => d.body && d.body.start <= frame)
    }

    it('a script hold of 2500 ms keeps the body at death + 2000 ms; the default does not', () => {
      const at = deaths()[0].frame + 20 // + 2000 ms
      expect(present(at, 2500)).toBe(true)
      expect(present(at, null)).toBe(false)
    })

    it('without a script hold, the page default exactly; never under one frame', () => {
      expect(deathHoldFramesOf(defaultFrames, null, doc)).toBe(14)
      expect(deathHoldFramesOf(defaultFrames, 2500, doc)).toBe(25)
      expect(deathHoldFramesOf(defaultFrames, 0, doc)).toBe(1)
    })

    it('a death lingers from its frame, never before it', () => {
      const d = deaths()[0]
      expect(present(d.frame - 1, 30000)).toBe(false)
      expect(present(d.frame, null)).toBe(true)
    })
  })
})
