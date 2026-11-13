import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { buildFilmAllegiance } from '@/lib/replay/filmAllegiance'
import type { ReplayPlayer } from '@/lib/replay/rosterLogic'

import type { ActionContext } from './actionScene3d'
import { BodyFx3d } from './bodyFx3d'
import type { BodyFxState } from './bodyShell3d'
import { FLARE_PX, maskDrawOf, Outline3d, OUTLINE_PX, projectedHeightPx, STAND_BELOW_PX } from './outline3d'
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
    ...over,
  }
}

describe('Outline3d — les joueurs tracés à une image', () => {
  it('chaque joueur avec un camp, à son camp ; ni sans camp ni sous le camouflage', () => {
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

  it('l éclat du bouclier épaissit la ligne : le plus fort du coup et de la rupture, borné à 1', () => {
    const o = new Outline3d(new THREE.PerspectiveCamera())
    const g = new THREE.Group()
    o.begin()
    o.add(g, fx(false, { shield: { ...NO_SHIELD_FX, hit: 0.3, broke: 0.8, breakAge: 0.05 } }))
    expect(o.subjectsOf()[0].flare).toBeCloseTo(0.8)
    o.begin()
    o.add(g, fx(false, { shield: { ...NO_SHIELD_FX, hit: 1.4 } }))
    expect(o.subjectsOf()[0].flare).toBe(1)
    expect(OUTLINE_PX).toBeGreaterThanOrEqual(1.5)
    expect(FLARE_PX).toBeGreaterThan(0)
    o.dispose()
  })
})

/** spartanAt : un groupe posé en `z` portant un squelette aux os de la silhouette en bâtons. */
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

describe('Outline3d — qui entre au masque, et comment', () => {
  it('hors du champ : rien ; loin : en bâtons s il a un squelette ; près : entier', () => {
    expect(maskDrawOf(false, 500, true)).toBe('skip')
    expect(maskDrawOf(true, STAND_BELOW_PX - 1, true)).toBe('stand')
    expect(maskDrawOf(true, STAND_BELOW_PX - 1, false)).toBe('whole')
    expect(maskDrawOf(true, STAND_BELOW_PX, true)).toBe('whole')
  })

  it('la hauteur à l écran décroît avec la distance, infinie derrière l œil', () => {
    const near = projectedHeightPx(2, 55, 440)
    expect(near).toBeGreaterThan(projectedHeightPx(4, 55, 440))
    expect(projectedHeightPx(4, 55, 440)).toBeCloseTo(near / 2)
    expect(projectedHeightPx(2, 55, 880)).toBeCloseTo(2 * near)
    expect(projectedHeightPx(0, 55, 440)).toBe(Infinity)
    // 0,69 u à 2 u sous 55 degrés sur 440 px : ~146 px.
    expect(near).toBeCloseTo(145.8, 0)
  })

  it('plan : derrière la caméra rien, près entier, loin en bâtons, sans squelette entier', () => {
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

describe('StandFigure — la silhouette en bâtons suit les os', () => {
  it('un segment par paire d os trouvée, centré entre eux et étiré le long d eux', () => {
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

  it('sans maillage à peau, pas de squelette', () => {
    expect(skeletonOf(new THREE.Group())).toBeNull()
  })
})

describe('BodyFx3d — le camp du contour est celui de la page, pas du joueur suivi', () => {
  const players = [
    { xuid: 'moi', team: 0 },
    { xuid: 'ami', team: 0 },
    { xuid: 'rival', team: 1 },
  ] as unknown as ReplayPlayer[]

  function bodyFxOf(colors: { ally: string; enemy: string }) {
    const inputs = {
      framesPerSecond: 10,
      // Le point de vue suivi est le rival : son allégeance retournerait les camps.
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

  it('suivre un adversaire ne retourne pas les couleurs ; changer la couleur des réglages la suit', () => {
    const body = bodyFxOf({ ally: 'lime', enemy: 'red' })
    expect(body.at('ami', 5).ally).toBe(true)
    const rival = body.at('rival', 5)
    expect(rival.ally).toBe(false)
    expect(rival.teamColor.toArray()).toEqual([1, 0, 0])
    const recolored = bodyFxOf({ ally: 'lime', enemy: 'blue' })
    expect(recolored.at('rival', 5).teamColor.toArray()).toEqual([0, 0, 1])
  })
})

it('prépare les deux chemins du masque et restaure les sujets même si le rendu échoue', () => {
  const o = new Outline3d(new THREE.PerspectiveCamera())
  const ancien = new THREE.Group()
  const prepare = spartanAt(1000)
  o.add(ancien, fx(false))
  o.maskPass.enabled = false
  expect(() => o.avecSujetsPrepares([prepare], (dessiner) => {
    expect(o.maskPass.enabled).toBe(true)
    dessiner('whole')
    expect(o.plan(1)).toEqual(['whole'])
    dessiner('stand')
    expect(o.plan(1)).toEqual(['stand'])
    throw new Error('rendu')
  })).toThrow('rendu')
  expect(o.subjectsOf()).toEqual([{ root: ancien, ally: false, flare: 0 }])
  expect(o.maskPass.enabled).toBe(false)
  o.dispose()
})
