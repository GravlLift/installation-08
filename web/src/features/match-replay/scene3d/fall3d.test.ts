// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { fakeCatalog, fakeClip } from '../test/spartanClips'
import { newClipMix } from './clipSample3d'
import {
  DEATH_CLIPS,
  deathMix,
  fallKindOf,
  fallPlacement,
  fallPose,
  fallSeconds,
  fallHeading,
  fallsBackward,
  type FallKind,
  type FallPose,
} from './fall3d'
import { aimDirThree } from './tracks3d'

const KINDS: FallKind[] = ['shot', 'headshot', 'melee', 'blast', 'splatter']
const fresh = (): FallPose => ({ u: 0, slide: 0, lift: 0 })
const sprite = (n: number) => `/assets/killfeed/killfeed-${n}.png?v=2`
const CATALOG = fakeCatalog(Object.values(DEATH_CLIPS).map((name) => fakeClip(name, 30)))

describe('fallPose', () => {
  it('nothing at death, fall complete at the end of its duration and after, resting on the ground', () => {
    for (const kind of KINDS) {
      expect(fallPose(0, kind, fresh())).toEqual({ u: 0, slide: 0, lift: 0 })
      for (const t of [fallSeconds(kind), fallSeconds(kind) + 3]) {
        const p = fallPose(t, kind, fresh())
        expect(p.u).toBe(1)
        expect(p.lift).toBeCloseTo(0)
      }
    }
  })

  it('the slide never goes backward; an explosion throws farther than a bullet', () => {
    for (const kind of KINDS) {
      let prev = fallPose(0, kind, fresh())
      for (let t = 0.02; t <= fallSeconds(kind) + 0.1; t += 0.02) {
        const p = fallPose(t, kind, fresh())
        expect(p.slide).toBeGreaterThanOrEqual(prev.slide)
        prev = p
      }
    }
    const end = (kind: FallKind) => fallPose(fallSeconds(kind), kind, fresh()).slide
    expect(end('blast')).toBeGreaterThan(end('melee'))
    expect(end('melee')).toBeGreaterThan(end('shot'))
    expect(end('splatter')).toBeGreaterThan(end('blast'))
  })

  it('same instant, same pose, in any order', () => {
    const seen = [0.5, 0.1, 0.3, 0.1, 0.5].map((t) => ({ ...fallPose(t, 'melee', fresh()) }))
    expect(seen[1]).toEqual(seen[3])
    expect(seen[0]).toEqual(seen[4])
  })
})

describe('fallPlacement', () => {
  it('slides the root along the impulse and raises it by the launch', () => {
    const at = new THREE.Vector3(2, 1, 3)
    const dir = new THREE.Vector3(-0.6, 0, 0.8)
    const pos = new THREE.Vector3()
    fallPlacement(at, dir, { u: 0.5, slide: 0.4, lift: 0.1 }, pos)
    expect(pos.distanceTo(new THREE.Vector3(2 - 0.24, 1.1, 3 + 0.32))).toBeLessThan(1e-9)
  })
})

describe('fallsBackward', () => {
  it('backward when the impulse goes toward the victim\'s back', () => {
    const facing = new THREE.Vector3(1, 0, 0)
    expect(fallsBackward(new THREE.Vector3(-1, 0, 0.2), facing)).toBe(true)
    expect(fallsBackward(new THREE.Vector3(0.3, 0, -1), facing)).toBe(false)
  })
})

describe('fallHeading', () => {
  const face = (h: number) => {
    const [x, , z] = aimDirThree(h, 0)
    return new THREE.Vector3(x, 0, z)
  }

  it('starts from the victim\'s heading and ends facing the impulse (front) or back to it (backward)', () => {
    const dir = new THREE.Vector3(0, 0, -1)
    expect(fallHeading(30, dir, false, 0)).toBeCloseTo(30)
    expect(face(fallHeading(30, dir, false, 1)).distanceTo(dir)).toBeLessThan(1e-9)
    expect(face(fallHeading(200, dir, true, 1)).distanceTo(dir.clone().negate())).toBeLessThan(1e-9)
    // The shortest path: never more than a half turn.
    expect(Math.abs(fallHeading(30, dir, false, 1) - 30)).toBeLessThanOrEqual(180)
  })
})

describe('deathMix', () => {
  const at = (t: number, kind: FallKind, back = false) => {
    const mix = deathMix(t, kind, back, CATALOG, newClipMix(4, 0))
    return mix.base.slice(0, mix.baseCount).map((l) => ({ name: l.clip?.name, time: l.time, weight: l.weight }))
  }

  it('starts standing and ends on the ground landing, weights summing to 1, played from the end of the fall', () => {
    expect(at(0, 'shot')).toEqual([{ name: DEATH_CLIPS.standing, time: 0, weight: 1 }])
    const mid = at(fallSeconds('shot') / 2, 'shot')
    expect(mid.map((l) => l.name)).toEqual([DEATH_CLIPS.standing, DEATH_CLIPS.landing])
    expect(mid[0].weight + mid[1].weight).toBeCloseTo(1)
    expect(mid[1].time).toBe(0)
    const late = at(fallSeconds('shot') + 0.4, 'shot')
    expect(late).toEqual([{ name: DEATH_CLIPS.landing, time: expect.closeTo(0.4, 9), weight: 1 }])
  })

  it('a thrown kill starts from the airborne fall; backward, the back clips', () => {
    expect(at(0.1, 'blast')[0].name).toBe(DEATH_CLIPS.airborne)
    expect(at(0.1, 'blast')[0].time).toBeCloseTo(0.1)
    expect(at(0.1, 'blast', true)[0].name).toBe(DEATH_CLIPS.airborneBack)
    expect(at(5, 'shot', true)[0].name).toBe(DEATH_CLIPS.landingBack)
  })

  it('with no death clips, no clip', () => {
    expect(deathMix(0.3, 'shot', false, fakeCatalog([]), newClipMix(4, 0)).baseCount).toBe(0)
  })
})

describe('fallKindOf', () => {
  it('reads the kill\'s source: splatter, melee, grenade, launcher, family, headshot', () => {
    expect(fallKindOf({ weaponImageUrl: sprite(60), headshot: false }, 'plain')).toBe('splatter')
    expect(fallKindOf({ weaponImageUrl: sprite(65), headshot: undefined }, 'plain')).toBe('melee')
    expect(fallKindOf({ weaponImageUrl: '', headshot: false }, 'melee')).toBe('melee')
    expect(fallKindOf({ weaponImageUrl: sprite(46), headshot: false }, 'plain')).toBe('blast')
    expect(fallKindOf({ weaponImageUrl: sprite(43), headshot: false }, 'plain')).toBe('blast')
    expect(fallKindOf({ weaponImageUrl: '', headshot: false }, 'explosive')).toBe('blast')
    expect(fallKindOf({ weaponImageUrl: '', headshot: true }, 'ballistic')).toBe('headshot')
    expect(fallKindOf({ weaponImageUrl: '', headshot: undefined }, 'ballistic')).toBe('shot')
  })
})
