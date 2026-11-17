/**
 * Tests: the held weapons' idle effects layer — drawn on the holder's drawn weapon in third person,
 * on the rig's marker in first person, each system in its own view, off with the Shots switch,
 * while reloading and while scoped (first-person systems).
 */
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import { testReplayDoc } from '../test/testDoc'
import type { Action3dInputs } from './action3dInputs'
import type { ActionContext } from './actionScene3d'
import { particleMesh, smoothNormals, WeaponIdleEffects3dLayer } from './weaponIdleEffects3d'
import {
  CAMERA_FIRST_PERSON,
  CAMERA_THIRD_PERSON,
  FN_CONSTANT,
  SYSTEM_NO_ADS,
  type IdleSystem,
} from './weaponIdleEffects3dModel'

const TEXTURES = [
  { name: 'baseTexture', file: 'fx-a119e9dd.png', layers: 4, srgb: true, signed: false },
  { name: 'alphaMap', file: 'fx-a119e9dd.png', layers: 4, srgb: true, signed: false },
  { name: 'paletteTexture', file: 'fx-b5c0b591.png', layers: 1, srgb: true, signed: false },
]

/** A sprite system: three particles living the whole event, perpendicular to the barrel. */
function system(cameraMode: number, flags: number): IdleSystem {
  const k = (v: number) => ({ type: FN_CONSTANT, input: 1, rangeInput: 3, min: v, max: v })
  return {
    location: '55990be4', event: 0, eventFlags: 0, eventDuration: [1, 1], coordinateSystem: 1, cameraMode, flags,
    sizeScale: 1, particle: cameraMode === CAMERA_FIRST_PERSON ? 'fp' : 'tp',
    emitter: {
      flags: 0, appearance: 0, particleFlags: 0, shape: 10, axisScale: [0.045, 0, 1], direction: [1, 0, 0],
      startingInterpolant: [0, 0, 0], billboard: 3,
      properties: { startingCount: k(3), lifespan: k(1), size: k(0.02), intensity: k(200), tint: { ...k(0), color: [1, 1, 1] } },
    },
    render: { appearance: 0, blendMode: 9, shader: '9b1c511e', textures: TEXTURES, constants: { baseTexture_texture_frameCount: [4], useAlphaMapRed: [1] } },
  }
}

const INDEX = {
  idle_effects: {
    '1a22fee6': [{
      effect: '1e471031', scaleA: 'fx_ready', scaleB: '#118a9c27',
      functions: [
        { import: 'ready', default: 1, export: 'fx_ready', turnOffWith: 'fx_reloading' },
        { import: 'is_reloading', default: 1, export: 'fx_reloading', turnOffWith: 'fx_ammo', invert: true },
        { import: 'primary_ammunition', default: 1, export: 'fx_ammo' },
        { import: 'camo', default: 1, export: '#118a9c27', invert: true },
      ],
      markers: { '55990be4': [[0.306, 0.044, 0]] },
      systems: [system(CAMERA_FIRST_PERSON, SYSTEM_NO_ADS), system(CAMERA_THIRD_PERSON, 0)],
    }],
  },
}

function track(slot: number, xuid: string) {
  return { slot, team: 0, xuid, startFrame: 0, endFrame: 1000, points: [{ t: 0, x: 0, y: 0, z: 0 }, { t: 1000, x: 4, y: 0, z: 0 }] }
}

/** A (slot 512) holds a Shock Rifle, B (slot 513) another weapon, from birth loadouts. */
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

interface Setup {
  doc?: ReplayDocumentReady
  shots?: boolean
  firstPerson?: boolean
  scoped?: boolean
  anchor?: boolean
}

async function layerFor(o: Setup = {}) {
  const root = new THREE.Group()
  const model = new THREE.Object3D()
  model.position.set(10, 2, 3)
  const drawn = vi.fn((xuid: string) => (xuid === 'A' || xuid === 'B' ? { model, source: model } : null))
  const anchor = vi.fn((_key: string, _marker: string, out: THREE.Matrix4) => {
    out.makeTranslation(1, 1, 1)
    return o.anchor ?? true
  })
  const ctx = {
    doc: o.doc ?? shockDoc(),
    root,
    inputs: () => ({ show: { shots: o.shots ?? true }, framesPerSecond: 10, locale: 'en' } as unknown as Action3dInputs),
    drawnWeapon: drawn,
    firstPersonSlot: () => (o.firstPerson ? 512 : null),
    scopeMounted: () => o.scoped ?? false,
    weaponLibrary: () => '/api/weapons',
    firstPersonEffectAnchor: anchor,
    weaponClipSeconds: (_key: string, action: string) => (action === 'reload_full' ? 2 : action === 'ready' ? 0.5 : null),
  } as unknown as ActionContext
  const layer = new WeaponIdleEffects3dLayer(ctx, () => Promise.resolve<unknown>(INDEX))
  layer.update(50) // starts the index read
  await Promise.resolve()
  await Promise.resolve()
  const pools = () => root.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh)
  const drawnCount = (name: string) => pools().filter((p) => p.name === `weapon-idle-effect:${name}`).reduce((n, p) => n + (p.visible ? p.count : 0), 0)
  return { layer, drawn, anchor, pools, drawnCount }
}

describe('WeaponIdleEffects3dLayer', () => {
  it('draws the third-person systems on the drawn rifle, at its marker, and asks nothing of other weapons', async () => {
    const { layer, drawn, drawnCount, pools } = await layerFor()
    layer.update(50)
    expect(drawnCount('tp')).toBe(3)
    expect(drawnCount('fp')).toBe(0)
    expect(drawn).not.toHaveBeenCalledWith('B')
    // In world space: the model's position plus the marker, plus the particle's spread along the barrel.
    const m = new THREE.Matrix4()
    const tp = pools().find((p) => p.name === 'weapon-idle-effect:tp')!
    tp.getMatrixAt(0, m)
    const at = new THREE.Vector3().setFromMatrixPosition(m)
    expect(at.x).toBeGreaterThanOrEqual(10.306)
    expect(at.x).toBeLessThanOrEqual(10.306 + 0.045 + 1e-6)
    expect(at.y).toBeCloseTo(2.044)
    expect(at.z).toBeCloseTo(3)
    layer.dispose()
  })

  it('draws the first-person systems on the rig marker instead, and none while scoped', async () => {
    const fp = await layerFor({ firstPerson: true })
    fp.layer.update(50)
    expect(fp.drawnCount('fp')).toBe(3)
    expect(fp.drawnCount('tp')).toBe(0)
    expect(fp.anchor).toHaveBeenCalledWith('1a22fee6', '55990be4', expect.any(THREE.Matrix4), 0)
    fp.layer.dispose()
    const scoped = await layerFor({ firstPerson: true, scoped: true })
    scoped.layer.update(50)
    expect(scoped.drawnCount('fp')).toBe(0)
    scoped.layer.dispose()
    const hidden = await layerFor({ firstPerson: true, anchor: false })
    hidden.layer.update(50)
    expect(hidden.drawnCount('fp')).toBe(0)
    // The console hook lists the system with no particles, and its holder.
    const rows = (window as unknown as { __it3dIdleEffects?: { key: string; slot: number; particles: number }[] }).__it3dIdleEffects ?? []
    expect(rows).toContainEqual(expect.objectContaining({ key: '1a22fee6:1e471031:0', slot: 512, particles: -1 }))
    hidden.layer.dispose()
  })

  it('is off with the Shots switch', async () => {
    const { layer, drawnCount } = await layerFor({ shots: false })
    layer.update(50)
    expect(drawnCount('tp')).toBe(0)
    layer.dispose()
  })

  it('is off while reloading (the reload clip length from its start), on again after', async () => {
    const doc = shockDoc({ actions: [{ t: 40, ms: 4000, slot: 512, kind: 'reload' }] } as Parameters<typeof testReplayDoc>[0])
    const { layer, drawnCount } = await layerFor({ doc })
    layer.update(50)
    expect(drawnCount('tp')).toBe(0)
    layer.update(61)
    expect(drawnCount('tp')).toBe(3)
    layer.dispose()
  })

  it('is deterministic: the same frame draws the same particles', async () => {
    const a = await layerFor()
    a.layer.update(77)
    const b = await layerFor()
    b.layer.update(12)
    b.layer.update(77)
    const at = (pools: THREE.InstancedMesh[]) => {
      const m = new THREE.Matrix4()
      const p = pools.find((x) => x.name === 'weapon-idle-effect:tp')!
      return Array.from({ length: p.count }, (_, i) => (p.getMatrixAt(i, m), m.elements.slice()))
    }
    expect(at(b.pools())).toEqual(at(a.pools()))
    a.layer.dispose()
    b.layer.dispose()
  })
})

describe('particle meshes', () => {
  it('reads the library records and smooths normals across shared positions', () => {
    // Two triangles of a bent strip sharing an edge: the shared vertices get the mean normal.
    const rec = new Float32Array([
      0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
      0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1, -1, 1, 1,
    ])
    const g = particleMesh(rec)
    expect(g.getAttribute('position').count).toBe(6)
    expect(g.getAttribute('uv').getX(1)).toBe(1)
    const n = smoothNormals(g.getAttribute('position').array as Float32Array)
    expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1)
  })
})
