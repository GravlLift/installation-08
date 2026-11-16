/**
 * Tests: the shock rifle's shroud arcs — shock families only, deterministic in (match time,
 * player), re-seeded per time bucket, and gone when the weapon is not drawn.
 */
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import { testReplayDoc } from '../test/testDoc'
import type { Action3dInputs } from './action3dInputs'
import type { DrawnWeapon } from './avatar3d'
import type { ActionContext } from './actionScene3d'
import {
  SHOCK_ARC_COUNT,
  SHOCK_ARC_SEGMENTS,
  SHROUD_ANCHORS,
  ShockArcs3dLayer,
  isShockFamily,
  shockArcFlicker,
  shockArcsFor,
} from './shockArcs3d'

const flat = (pts: readonly THREE.Vector3[]) => pts.map((p) => [p.x, p.y, p.z])
const anchorOf = (p: THREE.Vector3) => SHROUD_ANCHORS.find((a) => flat([a]).every((v, i) => Math.abs(v[0] - p.toArray()[i]) < 1e-9))

describe('isShockFamily', () => {
  it('ne connaît que les deux familles du fusil de choc', () => {
    expect(isShockFamily('1a22fee6')).toBe(true)
    expect(isShockFamily('9387a8b9')).toBe(true)
    expect(isShockFamily('00000051')).toBe(false)
    expect(isShockFamily('1a22fee')).toBe(false)
    expect(isShockFamily(null)).toBe(false)
  })
})

describe('shockArcsFor', () => {
  const out: THREE.Vector3[][] = []

  it('pose SHOCK_ARC_COUNT arcs entre des repères de la cagoule, bouts tenus au repère', () => {
    const arcs = shockArcsFor(0.31, 3, out)
    expect(arcs).toHaveLength(SHOCK_ARC_COUNT)
    for (const arc of arcs) {
      expect(arc).toHaveLength(SHOCK_ARC_SEGMENTS + 1)
      expect(anchorOf(arc[0])).toBeTruthy()
      expect(anchorOf(arc[arc.length - 1])).toBeTruthy()
    }
  })

  it('le même temps de partie et le même joueur dessinent les mêmes arcs', () => {
    const a = shockArcsFor(0.31, 3, out).map(flat)
    const b = shockArcsFor(0.31, 3, out).map(flat)
    expect(b).toEqual(a)
  })

  it('les arcs changent au franchissement d un palier du temps', () => {
    const a = shockArcsFor(0.04, 3, out).map(flat)
    const b = shockArcsFor(0.06, 3, out).map(flat)
    expect(b).not.toEqual(a)
  })

  it('deux joueurs (deux seeds) ne partagent pas leurs arcs', () => {
    const a = shockArcsFor(0.04, 3, out).map(flat)
    const b = shockArcsFor(0.04, 4, out).map(flat)
    expect(b).not.toEqual(a)
  })

  it('le scintillement reste dans sa fourchette et bouge entre paliers', () => {
    for (let bucket = 0; bucket < 40; bucket++) {
      const f = shockArcFlicker(3, bucket)
      expect(f).toBeGreaterThanOrEqual(0.55)
      expect(f).toBeLessThanOrEqual(1)
    }
    expect(shockArcFlicker(3, 0)).not.toBe(shockArcFlicker(3, 1))
  })
})

// --- The layer, on a two-player film.

function track(slot: number, xuid: string) {
  return { slot, team: 0, xuid, startFrame: 0, endFrame: 100, points: [{ t: 0, x: 0, y: 0, z: 0 }, { t: 100, x: 4, y: 0, z: 0 }] }
}

/** A (slot 512) holds a shock rifle, B (slot 513) a non-shock one, from birth loadouts. */
function shockDoc(over: Parameters<typeof testReplayDoc>[0] = {}): ReplayDocumentReady {
  return testReplayDoc({
    frameIntervalMs: 100,
    tracks: [track(512, 'A'), track(513, 'B')],
    loadouts: [
      { t: 0, slot: 512, w: ['0x1A22FEE6', '0xBBBB'], src: 'birth', k: [0, 1] },
      { t: 0, slot: 513, w: ['0xAAAA', '0xBBBB'], src: 'birth', k: [0, 1] },
    ],
    ...over,
  })
}

function layerFor(
  doc: ReplayDocumentReady,
  drawnWeapon: (xuid: string) => DrawnWeapon | null,
  show: { shots: boolean },
): { layer: ShockArcs3dLayer; root: THREE.Group; pools: THREE.InstancedMesh[] } {
  const root = new THREE.Group()
  const ctx = {
    doc,
    root,
    inputs: () => ({ show, framesPerSecond: 30, locale: 'en' } as unknown as Action3dInputs),
    drawnWeapon,
  } as unknown as ActionContext
  const layer = new ShockArcs3dLayer(ctx)
  return { layer, root, pools: root.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh) }
}

const SEGMENTS_PER_RIFLE = SHOCK_ARC_COUNT * SHOCK_ARC_SEGMENTS

describe('ShockArcs3dLayer', () => {
  it('ne pose des arcs que pour le porteur du fusil de choc, jamais pour l autre arme', () => {
    const drawn = vi.fn((xuid: string) =>
      xuid === 'A' || xuid === 'B' ? { model: new THREE.Object3D(), source: new THREE.Object3D() } : null)
    const { layer, pools } = layerFor(shockDoc(), drawn, { shots: true })
    layer.update(3)
    expect(pools).toHaveLength(2)
    for (const pool of pools) expect(pool.count).toBe(SEGMENTS_PER_RIFLE)
    // The non-shock holder is never even asked for a drawn weapon.
    expect(drawn).toHaveBeenCalledTimes(1)
    expect(drawn).toHaveBeenCalledWith('A')
    layer.dispose()
  })

  it('sans arme dessinée, pas d arcs (le porteur du choc peut exister sans son modèle)', () => {
    const { layer, pools } = layerFor(shockDoc(), () => null, { shots: true })
    layer.update(3)
    for (const pool of pools) expect(pool.count).toBe(0)
    layer.dispose()
  })

  it('le tiroir des tirs éteint aussi les arcs', () => {
    const drawn = vi.fn(() => ({ model: new THREE.Object3D(), source: new THREE.Object3D() }))
    const { layer, pools } = layerFor(shockDoc(), drawn, { shots: false })
    layer.update(3)
    for (const pool of pools) expect(pool.count).toBe(0)
    expect(drawn).not.toHaveBeenCalled()
    layer.dispose()
  })

  it('la même image donne la même pose d arcs, et elle change de palier en palier', () => {
    const drawn = vi.fn(() => ({ model: new THREE.Object3D(), source: new THREE.Object3D() }))
    const { layer, pools } = layerFor(shockDoc(), drawn, { shots: true })
    layer.update(3)
    const first = pools.map((p) => Array.from(p.instanceMatrix.array))
    layer.update(3)
    expect(pools.map((p) => Array.from(p.instanceMatrix.array))).toEqual(first)
    // Frame 3 is t = 0.1 s (bucket 2); frame 0 is bucket 0: the arcs re-seed between them.
    layer.update(0)
    expect(pools.map((p) => Array.from(p.instanceMatrix.array))).not.toEqual(first)
    layer.dispose()
  })
})
