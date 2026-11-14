/**
 * scopeView3d.test.ts — LE CHAMP DE LA CAMÉRA côté scène : la base suit le réglage de champ du
 * jeu, et le zoom multiplie depuis la base courante, pas depuis l'ancienne.
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import { LUNETTE_PAR_DEFAUT, specLunette } from '../model/scopeLogic'
import { ScopeView3d } from './scopeView3d'

/** Un film où le joueur « A » vise au cran 1 sur toute sa vie. */
function docAvecCran(): ReplayDocumentReady {
  return {
    frameIntervalMs: 20,
    tracks: [
      {
        slot: 1,
        team: -1,
        xuid: 'A',
        startFrame: 0,
        endFrame: 1000,
        points: [{ t: 0, x: 0, y: 0, h: 0, s: 1 }],
      },
    ],
  } as ReplayDocumentReady
}

describe('ScopeView3d', () => {
  it('cache les bras et zoome avec le Bandit', () => {
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    const view = new ScopeView3d(55)
    expect(view.appliquer(camera, docAvecCran(), 'A', 6, specLunette('6acdc44d', null), [1.6])).toBe(true)
    expect(camera.fov).toBeCloseTo(2 * Math.atan(Math.tan(55 * Math.PI / 360) / 1.6) * 180 / Math.PI)
  })

  it('montee suit la pose : vraie quand la lunette masque les bras, repliée sinon', () => {
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    const view = new ScopeView3d(55)
    expect(view.montee).toBe(false)
    expect(view.appliquer(camera, docAvecCran(), 'A', 6, specLunette('6acdc44d', null), [1.6])).toBe(true)
    expect(view.montee).toBe(true)
    view.reposer(camera)
    expect(view.montee).toBe(false)
  })

  it('le lien intelligent zoome sans monter de lunette', () => {
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    const view = new ScopeView3d(55)
    view.appliquer(camera, docAvecCran(), 'A', 6, LUNETTE_PAR_DEFAUT, [1.4])
    expect(view.montee).toBe(false)
  })

  it('changerBase fait suivre la base au réglage du jeu', () => {
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    const view = new ScopeView3d(55)
    view.changerBase(camera, 67.5)
    expect(camera.fov).toBeCloseTo(67.5, 2)
    view.changerBase(camera, 75.5)
    expect(camera.fov).toBeCloseTo(75.5, 2)
  })

  it('reposer remet le champ de base après un changement', () => {
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    const view = new ScopeView3d(55)
    view.changerBase(camera, 75.5)
    expect(camera.fov).toBeCloseTo(75.5, 2)
    view.reposer(camera)
    expect(camera.fov).toBeCloseTo(75.5, 2)
  })

  it('le zoom multiplie depuis la base courante', () => {
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    const view = new ScopeView3d(55)
    view.changerBase(camera, 67.5)
    // Le zoom est lissé sur six images : à la sixième il est à pleine amplification.
    view.appliquer(camera, docAvecCran(), 'A', 6, LUNETTE_PAR_DEFAUT, [1.4])
    expect(camera.fov).toBeLessThan(67.5)
    expect(camera.fov).toBeGreaterThan(55 / 2)
  })
})
