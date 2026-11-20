// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { buildFilmAllegiance } from '@/lib/replay/filmAllegiance'
import type { ReplayPlayer } from '@/lib/replay/rosterLogic'

import type { ActionContext } from './actionScene3d'
import { scriptOutlines, type CameraScript } from './cameraScript3d'
import { BodyFx3d } from './bodyFx3d'
import type { BodyFxState } from './bodyShell3d'
import { FLARE_PX, maskDrawOf, Outline3d, OUTLINE_PX, projectedHeightPx, STAND_BELOW_PX } from './outline3d'
import { LINE_FRAGMENT, SUBJECT_FRAGMENT } from './outlineShaders3d'
import { skeletonOf, STAND_LIMBS, StandFigure } from './outlineStand3d'
import { NO_SHIELD_FX } from './shields3d'

const ALLY = new THREE.Color(0.1, 0.8, 0.2)
const ENEMY = new THREE.Color(0.9, 0.1, 0.1)

function fx(ally: boolean | null, over: Partial<BodyFxState> = {}): BodyFxState {
  return {
    shield: { ...NO_SHIELD_FX },
    equip: { camo: 0, overshield: 0 },
    phase: 0,
    ally,
    teamColor: (ally ? ALLY : ENEMY).clone(),
    overshieldColor: new THREE.Color(),
    camoColor: new THREE.Color(),
    shieldHit: null,
    impacts: [],
    ...over,
  }
}

describe('Outline3d — the players drawn in one frame', () => {
  it('every player with a team, at its team; neither with no team nor under camo', () => {
    const o = new Outline3d(new THREE.PerspectiveCamera())
    const [a, b, c, d] = [new THREE.Group(), new THREE.Group(), new THREE.Group(), new THREE.Group()]
    o.begin()
    o.add(a, fx(true))
    o.add(b, fx(false))
    o.add(c, fx(null))
    o.add(d, fx(false, { equip: { camo: 0.4, overshield: 0 } }))
    expect(o.subjectsOf()).toEqual([
      { root: a, ally: true, flare: 0 },
      { root: b, ally: false, flare: 0 },
    ])
    o.begin()
    expect(o.subjectsOf()).toEqual([])
    o.dispose()
  })

  it("the shield's flare thickens the line: the stronger of the hit and the break, capped at 1", () => {
    const o = new Outline3d(new THREE.PerspectiveCamera())
    const g = new THREE.Group()
    o.begin()
    o.add(g, fx(false, { shield: { ...NO_SHIELD_FX, hit: 0.3, broke: 0.8, breakAge: 0.05 } }))
    expect(o.subjectsOf()[0].flare).toBeCloseTo(0.8)
    o.begin()
    o.add(g, fx(false, { shield: { ...NO_SHIELD_FX, hit: 1.4 } }))
    expect(o.subjectsOf()[0].flare).toBe(1)
    expect(OUTLINE_PX).toBeGreaterThanOrEqual(1)
    expect(FLARE_PX).toBeGreaterThan(0)
    o.dispose()
  })
})

/** spartanAt: a group placed at `z` carrying a skeleton with the stick-figure silhouette's bones. */
function spartanAt(z: number): THREE.Group {
  const names = [...new Set(STAND_LIMBS.flatMap(([a, b]) => [a, b]))]
  const bones = names.map((name, i) => {
    const b = new THREE.Bone()
    b.name = name
    b.position.set(0.01 * i, 0.04 * i - 0.3, 0)
    return b
  })
  const root = new THREE.Bone()
  root.add(...bones)
  const skin = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
  skin.add(root)
  skin.bind(new THREE.Skeleton(bones))
  const g = new THREE.Group()
  g.add(skin)
  g.position.set(0, 0, z)
  g.updateMatrixWorld(true)
  return g
}

describe('Outline3d — who enters the mask, and how', () => {
  it('out of view: nothing; far: as sticks if it has a skeleton; near: whole', () => {
    expect(maskDrawOf(false, 500, true)).toBe('skip')
    expect(maskDrawOf(true, STAND_BELOW_PX - 1, true)).toBe('stand')
    expect(maskDrawOf(true, STAND_BELOW_PX - 1, false)).toBe('whole')
    expect(maskDrawOf(true, STAND_BELOW_PX, true)).toBe('whole')
  })

  it('the on-screen height decreases with distance, infinite behind the eye', () => {
    const near = projectedHeightPx(2, 55, 440)
    expect(near).toBeGreaterThan(projectedHeightPx(4, 55, 440))
    expect(projectedHeightPx(4, 55, 440)).toBeCloseTo(near / 2)
    expect(projectedHeightPx(2, 55, 880)).toBeCloseTo(2 * near)
    expect(projectedHeightPx(0, 55, 440)).toBe(Infinity)
    // 0.69 u at 2 u under 55 degrees on 440 px: ~146 px.
    expect(near).toBeCloseTo(145.8, 0)
  })

  it('plan: nothing behind the camera, whole near, sticks far, whole with no skeleton', () => {
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.02, 700)
    camera.updateMatrixWorld()
    const o = new Outline3d(camera)
    const behind = spartanAt(5)
    const near = spartanAt(-2)
    const far = spartanAt(-30)
    const capsule = new THREE.Group()
    capsule.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.45)))
    capsule.position.set(0, 0, -30)
    capsule.updateMatrixWorld(true)
    o.begin()
    for (const g of [behind, near, far, capsule]) o.add(g, fx(false))
    expect(o.plan(440)).toEqual(['skip', 'whole', 'stand', 'whole'])
    o.dispose()
  })
})

describe('the X-ray outline — it passes through the map', () => {
  it('the mask keeps the hidden player: no scene depth sample, no pixel discarded', () => {
    expect(SUBJECT_FRAGMENT).not.toContain('tDepth')
    expect(SUBJECT_FRAGMENT).not.toContain('discard')
  })

  it('the line ignores scene depth, a wall in front included', () => {
    expect(LINE_FRAGMENT).not.toContain('tDepth')
    expect(LINE_FRAGMENT).not.toContain('inFront')
  })
})

describe('StandFigure — the stick-figure silhouette follows the bones', () => {
  it('one segment per found bone pair, centered between them and stretched along them', () => {
    const g = spartanAt(0)
    const skeleton = skeletonOf(g) as THREE.Skeleton
    expect(skeleton).not.toBeNull()
    const figure = new StandFigure()
    figure.pose(skeleton)
    expect(figure.mesh.count).toBe(STAND_LIMBS.length)
    const [from, to, r] = STAND_LIMBS[0]
    const at = (name: string) => new THREE.Vector3().setFromMatrixPosition((skeleton.getBoneByName(name) as THREE.Bone).matrixWorld)
    const m = new THREE.Matrix4()
    figure.mesh.getMatrixAt(0, m)
    const center = new THREE.Vector3()
    const scale = new THREE.Vector3()
    m.decompose(center, new THREE.Quaternion(), scale)
    const a = at(from)
    const b = at(to)
    expect(center.distanceTo(a.clone().add(b).multiplyScalar(0.5))).toBeLessThan(1e-6)
    expect(scale.y).toBeCloseTo(a.distanceTo(b) / 2 + r)
    expect(scale.x).toBeCloseTo(r)
    figure.mesh.dispose()
  })

  it('with no skinned mesh, no skeleton', () => {
    expect(skeletonOf(new THREE.Group())).toBeNull()
  })
})

describe("BodyFx3d — the outline's team is the page's, not the tracked player's", () => {
  const players = [
    { xuid: 'moi', team: 0 },
    { xuid: 'ami', team: 0 },
    { xuid: 'rival', team: 1 },
  ] as unknown as ReplayPlayer[]

  function bodyFxOf(colors: { ally: string; enemy: string }) {
    const inputs = {
      framesPerSecond: 10,
      // The tracked viewpoint is the rival: its allegiance would flip the teams.
      allegiance: buildFilmAllegiance(players, 'rival'),
      pageAllegiance: buildFilmAllegiance(players, 'moi'),
      inks: { teamColorOf: (ally: boolean) => (ally ? colors.ally : colors.enemy), fx: { core: 'white' }, body: { overshield: 'lime' } },
    }
    const ctx = {
      inputs: () => inputs,
      tracks: { shield: () => undefined, sample: () => null },
      doc: { equipmentEpisodes: [] },
      ink: { of: (css: string) => new THREE.Color(css) },
    } as unknown as ActionContext
    return new BodyFx3d(ctx)
  }

  it('tracking an opponent does not flip the colors; changing the settings color follows it', () => {
    const body = bodyFxOf({ ally: 'lime', enemy: 'red' })
    expect(body.at('ami', 5).ally).toBe(true)
    const rival = body.at('rival', 5)
    expect(rival.ally).toBe(false)
    expect(rival.teamColor.toArray()).toEqual([1, 0, 0])
    const recolored = bodyFxOf({ ally: 'lime', enemy: 'blue' })
    expect(recolored.at('rival', 5).teamColor.toArray()).toEqual([0, 0, 1])
  })
})

it('prepares both mask paths and restores the subjects even if the render fails', () => {
  const o = new Outline3d(new THREE.PerspectiveCamera())
  const previous = new THREE.Group()
  const prepare = spartanAt(1000)
  o.add(previous, fx(false))
  o.maskPass.enabled = false
  expect(() => o.withPreparedSubjects([prepare], (draw) => {
    expect(o.maskPass.enabled).toBe(true)
    draw('whole')
    expect(o.plan(1)).toEqual(['whole'])
    draw('stand')
    expect(o.plan(1)).toEqual(['stand'])
    throw new Error('render')
  })).toThrow('render')
  expect(o.subjectsOf()).toEqual([{ root: previous, ally: false, flare: 0 }])
  expect(o.maskPass.enabled).toBe(false)
  o.dispose()
})

it("setDrawn takes both passes out and puts them back; a script's outlines:false only adds to the knob", () => {
  const o = new Outline3d(new THREE.PerspectiveCamera())
  expect(o.drawn).toBe(true)
  // The scene's rule (`replayScene3d.applyOutline`): the knob, and the playing script's switch.
  const apply = (knob: boolean, script: CameraScript | null) => o.setDrawn(knob && scriptOutlines(script))
  const base = { version: 1 as const, matchId: 'm', name: 's', keys: [] }
  apply(true, { ...base, outlines: false })
  expect(o.maskPass.enabled).toBe(false)
  expect(o.linePass.enabled).toBe(false)
  expect(o.drawn).toBe(false)
  apply(true, null) // the script stops: the knob's state returns
  expect(o.maskPass.enabled).toBe(true)
  expect(o.linePass.enabled).toBe(true)
  apply(true, { ...base, outlines: true })
  expect(o.drawn).toBe(true)
  apply(true, base) // absent: drawn
  expect(o.drawn).toBe(true)
  apply(false, base) // the user's knob off: a script never turns it back on
  expect(o.drawn).toBe(false)
  apply(false, null)
  expect(o.drawn).toBe(false)
  o.dispose()
})
