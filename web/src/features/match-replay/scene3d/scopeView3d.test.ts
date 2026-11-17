// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * scopeView3d.test.ts — THE CAMERA'S FIELD OF VIEW on the scene side: the base follows the
 * game's FOV setting, and the zoom multiplies from the current base, not the old one.
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import { LUNETTE_PAR_DEFAUT, specLunette } from '../model/scopeLogic'
import { ScopeView3d } from './scopeView3d'

/** A film where player "A" aims at notch 1 for their whole life. */
function docWithNotch(): ReplayDocumentReady {
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
  it('hides the arms and zooms with the Bandit', () => {
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    const view = new ScopeView3d(55)
    expect(view.appliquer(camera, docWithNotch(), 'A', 6, specLunette('6acdc44d', null), [1.6])).toBe(true)
    expect(camera.fov).toBeCloseTo(2 * Math.atan(Math.tan(55 * Math.PI / 360) / 1.6) * 180 / Math.PI)
  })

  it('montee follows the pose: true when the scope hides the arms, folded otherwise', () => {
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    const view = new ScopeView3d(55)
    expect(view.montee).toBe(false)
    expect(view.appliquer(camera, docWithNotch(), 'A', 6, specLunette('6acdc44d', null), [1.6])).toBe(true)
    expect(view.montee).toBe(true)
    view.reposer(camera)
    expect(view.montee).toBe(false)
  })

  it('the smart-link zooms without mounting a scope', () => {
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    const view = new ScopeView3d(55)
    view.appliquer(camera, docWithNotch(), 'A', 6, LUNETTE_PAR_DEFAUT, [1.4])
    expect(view.montee).toBe(false)
  })

  it('the Skewer hides the arms when zoomed, like a scoped rifle', () => {
    // The Skewer resolves through the label table to a `scope` kind, so a zoom mounts it and the
    // first-person weapon and arms leave the screen (the overlay's red haze stands for the defocused gun).
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    const view = new ScopeView3d(55)
    expect(view.montee).toBe(false)
    expect(view.appliquer(camera, docWithNotch(), 'A', 6, specLunette('0d20c469', 'hinf_skewer'), [1.4])).toBe(true)
    expect(view.montee).toBe(true)
  })

  it("changerBase makes the base follow the game's setting", () => {
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    const view = new ScopeView3d(55)
    view.changerBase(camera, 67.5)
    expect(camera.fov).toBeCloseTo(67.5, 2)
    view.changerBase(camera, 75.5)
    expect(camera.fov).toBeCloseTo(75.5, 2)
  })

  it('reposer restores the base field of view after a change', () => {
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    const view = new ScopeView3d(55)
    view.changerBase(camera, 75.5)
    expect(camera.fov).toBeCloseTo(75.5, 2)
    view.reposer(camera)
    expect(camera.fov).toBeCloseTo(75.5, 2)
  })

  it('the zoom multiplies from the current base', () => {
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    const view = new ScopeView3d(55)
    view.changerBase(camera, 67.5)
    // The zoom is smoothed over six frames: by the sixth it's at full magnification.
    view.appliquer(camera, docWithNotch(), 'A', 6, LUNETTE_PAR_DEFAUT, [1.4])
    expect(camera.fov).toBeLessThan(67.5)
    expect(camera.fov).toBeGreaterThan(55 / 2)
  })
})
