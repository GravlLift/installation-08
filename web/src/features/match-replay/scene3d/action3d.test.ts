import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import type { ReplayKill } from '../model/killFeedLogic'
import { testReplayDoc } from '../test/testDoc'
import type { Action3dInputs } from './action3dInputs'
import { firstFrom, type Ground, type InkCache } from './actionKit'
import type { ActionContext } from './actionScene3d'
import { FlashLights } from './flash3d'
import { buildDeaths3d, deathText } from './deaths3d'
import { heightsAlong } from './flights3d'
import { heldWeaponAt } from './heldWeapon3d'
import { buildTracks3d } from './tracks3d'

describe('firstFrom', () => {
  const items = [1, 3, 3, 7, 9]
  it('rend le premier élément à partir de la valeur', () => {
    expect(firstFrom(items, (v) => v, 3)).toBe(1)
    expect(firstFrom(items, (v) => v, 4)).toBe(3)
    expect(firstFrom(items, (v) => v, 0)).toBe(0)
    expect(firstFrom(items, (v) => v, 10)).toBe(5)
  })
})

describe('heightsAlong', () => {
  it('répartit la hauteur sur la distance parcourue, pas sur le nombre de points', () => {
    // Trois pas : 0 -> 1 (1 u), 1 -> 4 (3 u) ; la hauteur passe de 2 à 6.
    const pts = heightsAlong([[0, 0, 0], [1, 1, 0], [2, 4, 0]], 2, 6)
    expect(pts.map((p) => p.y)).toEqual([2, 3, 6])
    // Axes three : (x, y) Halo -> (x, -y).
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

  it('nomme l’arme que le sélecteur désigne, avec la teinte de ses tirs', () => {
    expect(heldWeaponAt(doc(0), 512, 60, 'en')).toEqual({ id: '0xAAAA', name: 'BR75', tint: 'kinetic' })
  })

  it('un libellé absent du catalogue laisse le nom vide, jamais l’identifiant', () => {
    expect(heldWeaponAt(doc(1), 512, 60, 'en')).toEqual({ id: '0xBBBB', name: '', tint: 'neutral' })
  })

  it('mains nues ou sélecteur non lu : rien en main', () => {
    expect(heldWeaponAt(doc(2), 512, 60, 'en')).toBeNull()
    expect(heldWeaponAt(doc(), 512, 60, 'en')).toBeNull()
  })
})

describe('buildDeaths3d', () => {
  // Victime V en vie 0-50 ; tueur K en vie 0-120. Le kill tombe à l'image 50.
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

  it('pose la mort aux pieds de la victime, le tueur relu, l’arme du kill', () => {
    const [d] = buildDeaths3d(ctxWith(() => true), [kill()])
    expect(d.frame).toBe(50)
    expect(d.at.y).toBeCloseTo(2.5)
    expect(d.from).not.toBeNull()
    expect(d.weapon).toBe('BR75')
  })

  it('commence le corps à la dernière image de vie, sans intervalle vide', () => {
    const [d] = buildDeaths3d(ctxWith(() => true), [kill()])
    expect(d.body?.start).toBe(50)
  })

  it('un tueur qui ne tient plus de fiche ne tire pas de trait', () => {
    const [d] = buildDeaths3d(ctxWith((x) => x !== 'K'), [kill()])
    expect(d.from).toBeNull()
  })

  it('l’étiquette se lit comme le fil', () => {
    expect(deathText('K', 'V', 'BR75')).toBe('K › V · BR75')
    expect(deathText('K', 'V', '')).toBe('K › V')
    expect(deathText('K', null, 'BR75')).toBe('K · BR75')
    expect(deathText(null, 'V', 'BR75')).toBeNull()
  })

  it('sans victime localisée, aucune croix', () => {
    expect(buildDeaths3d(ctxWith(() => true), [kill({ victimXuid: 'X' })])).toEqual([])
    expect(buildDeaths3d(ctxWith(() => true), [kill({ victimXuid: undefined })])).toEqual([])
  })
})
