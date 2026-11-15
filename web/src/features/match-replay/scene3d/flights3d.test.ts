/**
 * Tests — flights3d : LE LOOK D'UNE GRENADE DANS LA SCÈNE SUIVANT SON RANG.
 *
 * CE QUE CE FICHIER VERROUILLE :
 *  - une grenade plasma montre son orbe (cœur et halo additifs), en vol comme posée, et ne pose
 *    plus la tête sombre ;
 *  - une frag garde son look : la tête, pas l'orbe ;
 *  - la détonation de la plasma est bleue, celle de la frag orangée.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { normalizeReplayDocument } from '@/lib/replay/replayNormalize'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import type { ReplayDocument } from '@/lib/api/types'

import type { Action3dInputs } from './action3dInputs'
import type { Ground, InkCache } from './actionKit'
import { Flights3dLayer, flightPointAt, publishedPoints } from './flights3d'
import { FlashLights } from './flash3d'
import type { ActionContext } from './actionScene3d'
import type { Tracks3d } from './tracks3d'

const ENCRE: Record<string, THREE.Color> = {
  blue: new THREE.Color(0, 0, 1),
  orange: new THREE.Color(1, 0.4, 0),
  blanc: new THREE.Color(1, 1, 1),
  info: new THREE.Color(0.2, 0.5, 1),
  vert: new THREE.Color(0, 1, 0),
}

/**
 * Un film d'une seule grenade du rang `rank` : le vol part à l'image 100, finit à 140, et la
 * détonation publiée est à 160 (la grenade est donc posée entre 140 et 160).
 */
function documentGrenade(rank: number): unknown {
  return {
    frameIntervalMs: 1000 / 60,
    projectiles: [{ t0: 100, p: [[0, 0, 0], [20, 2, 0], [40, 4, 0]], detoT: 160, detoX: 4, detoY: 0 }],
    grenades: [{ t: 90, slot: 1, i: 0, x: 0, y: 0, rank, s: 'projectile', proj: 0 }],
    shots: [],
    weaponLabels: undefined,
  }
}

/** A film of one weapon shot of label `key` whose projectile flies from frame 100 to 140. */
function documentTir(key: string, tint: string): unknown {
  return {
    frameIntervalMs: 1000 / 60,
    projectiles: [{ t0: 100, p: [[0, 0, 0], [20, 2, 0], [40, 4, 0]], detoT: 140, detoX: 4, detoY: 0, shot: 0 }],
    grenades: [],
    shots: [{ t: 100, slot: 1, x: 0, y: 0, w: '0xAAAA' }],
    weaponLabels: { '0xAAAA': { en: key, fr: key, key, tint } },
  }
}

function calque(rank: number, doc: unknown = documentGrenade(rank)): { layer: Flights3dLayer; root: THREE.Group } {
  const root = new THREE.Group()
  const inputs = {
    framesPerSecond: 60,
    inks: {
      fx: { tint: { plasma_cool: 'blue', plasma_green: 'vert', blast: 'orange', neutral: 'orange' }, core: 'blanc' },
      grenade: 'info',
    },
    aids: { projectilePaths: false, blastRadius: false },
  } as unknown as Action3dInputs
  const ctx: ActionContext = {
    doc: doc as unknown as ReplayDocumentReady,
    tracks: {} as Tracks3d,
    ground: { floorY: () => 0 } as unknown as Ground,
    ink: { of: (css: string | null | undefined) => ENCRE[css ?? ''] ?? new THREE.Color(1, 1, 1) } as unknown as InkCache,
    root,
    originAboveFloor: 0,
    inputs: () => inputs,
    playerFeet: () => null,
    slotState: () => null,
    weaponModel: () => null,
    flagModel: () => null,
    grenadeModel: () => null,
    spartanModel: () => null,
    dressOf: () => null,
    drawnWeapon: () => null,
    firstPersonSlot: () => null,
    flashes: new FlashLights(new THREE.Scene()),
  }
  return { layer: new Flights3dLayer(ctx), root }
}

/** Le nombre d'instances du lot `i` (ordre : traîne, tête, cœur d'orbe, halo d'orbe, ...). */
const compte = (root: THREE.Group, i: number): number => (root.children[i] as THREE.InstancedMesh).count

describe('Flights3dLayer — le look d une grenade', () => {
  it('la plasma montre son orbe en vol, pas la tête sombre', () => {
    const { layer, root } = calque(1)
    layer.update(120)
    expect([compte(root, 0), compte(root, 1), compte(root, 2), compte(root, 3)]).toEqual([0, 0, 1, 1])
    layer.dispose()
  })

  it('la plasma posée garde son orbe jusqu à la détonation', () => {
    const { layer, root } = calque(1)
    layer.update(150)
    expect([compte(root, 1), compte(root, 2), compte(root, 3)]).toEqual([0, 1, 1])
    layer.dispose()
  })

  it('la frag garde son look : la tête, pas l orbe', () => {
    const { layer, root } = calque(0)
    layer.update(120)
    expect([compte(root, 1), compte(root, 2), compte(root, 3)]).toEqual([1, 0, 0])
    layer.dispose()
  })

  it('la détonation de la plasma est bleue, celle de la frag orangée', () => {
    for (const [rank, bleue] of [[1, true], [0, false]] as const) {
      const { layer, root } = calque(rank)
      layer.update(169)
      const points = root.children[7] as THREE.Points
      const n = points.geometry.drawRange.count
      expect(n).toBeGreaterThan(0)
      const couleur = points.geometry.getAttribute('aColor') as THREE.BufferAttribute
      let r = 0
      let b = 0
      for (let i = 0; i < n; i++) {
        r += couleur.getX(i)
        b += couleur.getZ(i)
      }
      if (bleue) expect(b).toBeGreaterThan(r)
      else expect(r).toBeGreaterThan(b)
      layer.dispose()
    }
  })
})

/**
 * A frag thrown at frame 100 that falls, BOUNCES off the floor (z = 0) at frame 104, rises, and
 * rolls to rest at frame 112: the published heights of schema 126.
 */
function documentRebond(withZ: boolean): unknown {
  const p = [[0, 0, 0], [2, 1, 0], [4, 2, 0], [6, 3, 0], [8, 3.5, 0], [10, 3.8, 0], [12, 4, 0]]
  const z = [1.2, 0.6, 0.05, 0.4, 0.3, 0.06, 0.05]
  return { ...(documentGrenade(0) as object), projectiles: [{ t0: 100, p, ...(withZ ? { z } : {}), detoT: 160, detoX: 4, detoY: 0 }] }
}

/** The position of the first instance of batch `i` (the head is batch 1). */
function premiere(root: THREE.Group, i: number): THREE.Vector3 {
  const m = new THREE.Matrix4()
  ;(root.children[i] as THREE.InstancedMesh).getMatrixAt(0, m)
  return new THREE.Vector3().setFromMatrixPosition(m)
}

describe('flightPointAt — a flight through its published points', () => {
  const at = [100, 102, 104, 106]
  const pts = publishedPoints([[0, 0, 0], [2, 1, 0], [4, 2, 0], [6, 3, 0]], [1.2, 0.6, 0.05, 0.4])

  it('lands exactly on each published point, the bounce point included', () => {
    for (let k = 0; k < at.length; k++) expect(flightPointAt(at, pts, at[k], new THREE.Vector3()).toArray()).toEqual(pts[k].toArray())
  })

  it('moves in a straight line between two points: no smoothing across the bounce, never below it', () => {
    const v = flightPointAt(at, pts, 103, new THREE.Vector3())
    expect(v.y).toBeCloseTo((0.6 + 0.05) / 2, 6)
    expect(v.x).toBeCloseTo(1.5, 6)
    for (let f = 103; f <= 105; f += 0.25) expect(flightPointAt(at, pts, f, new THREE.Vector3()).y).toBeGreaterThanOrEqual(0.05)
  })

  it('stays at the first and last points outside the flight', () => {
    expect(flightPointAt(at, pts, 90, new THREE.Vector3()).toArray()).toEqual(pts[0].toArray())
    expect(flightPointAt(at, pts, 200, new THREE.Vector3()).toArray()).toEqual(pts[3].toArray())
  })
})

describe('Flights3dLayer — the published height of a flight', () => {
  it('draws the head at the published heights: down to the floor, back up after the bounce', () => {
    const { layer, root } = calque(0, documentRebond(true))
    layer.update(104)
    expect(premiere(root, 1).y).toBeCloseTo(0.05, 6)
    layer.update(106)
    expect(premiere(root, 1).y).toBeCloseTo(0.4, 6)
    expect(premiere(root, 1).x).toBeCloseTo(3, 6)
    expect(premiere(root, 1).z).toBeCloseTo(0, 6)
    layer.dispose()
  })

  it('a seek lands where playing forward does', () => {
    const frames = [100, 100.5, 101, 103.25, 104, 105.7, 108, 111.9, 112]
    const forward = calque(0, documentRebond(true))
    const played = frames.map((f) => {
      forward.layer.update(f)
      return premiere(forward.root, 1).toArray()
    })
    const seek = calque(0, documentRebond(true))
    for (const k of [6, 0, 8, 3, 1, 7, 2, 5, 4]) {
      seek.layer.update(160)
      seek.layer.update(frames[k])
      expect(premiere(seek.root, 1).toArray()).toEqual(played[k])
    }
    forward.layer.dispose()
    seek.layer.dispose()
  })

  it('an artifact without heights keeps the interpolated slide (no regression on old documents)', () => {
    const { layer, root } = calque(0, documentRebond(false))
    layer.update(106)
    const y = premiere(root, 1).y
    expect(Number.isFinite(y)).toBe(true)
    expect(y).not.toBeCloseTo(0.4, 2)
    layer.dispose()
  })
})

describe('Flights3dLayer — the fuel rod', () => {
  it('flies as a large green orb, and leaves nothing behind once its flight ends', () => {
    const { layer, root } = calque(0, documentTir('hinf_fuel_rod_spnkr', 'plasma_green'))
    layer.update(120)
    expect([compte(root, 1), compte(root, 2), compte(root, 3)]).toEqual([0, 1, 1])
    const core = root.children[2] as THREE.InstancedMesh
    const m = new THREE.Matrix4()
    core.getMatrixAt(0, m)
    expect(new THREE.Vector3().setFromMatrixScale(m).x).toBeGreaterThan(0.04)
    const c = new THREE.Color()
    core.getColorAt(0, c)
    expect(c.g).toBeGreaterThan(c.b)
    layer.update(143)
    expect([compte(root, 2), compte(root, 3)]).toEqual([0, 0])
    layer.dispose()
  })

  it('keeps the small head for a rocket of the regular SPNKr', () => {
    const { layer, root } = calque(0, documentTir('hinf_m41_spnkr', 'blast'))
    layer.update(120)
    expect([compte(root, 1), compte(root, 2), compte(root, 3)]).toEqual([1, 0, 0])
    layer.dispose()
  })
})

/**
 * THE FLIGHT AT THE FILM'S RATE (schema 127): the native series is preferred when present, and
 * the grid points remain the fallback for artifacts before 127.
 *
 * The fixtures go through the SAME PATH as real data: a raw document with a DIFFERENTIAL
 * `fullRate` (the document's shape: each column's first value is absolute, each following one
 * the gap from the previous) is run through `normalizeReplayDocument`, which decodes it ONCE at
 * the boundary. `t` is milliseconds since the GRID ORIGIN (absolute, the same axis as the grid
 * path's `pr.t0 + st[0]`): the flight starts at t0 = 100, so its first sample sits at absolute
 * frame 100.
 */
describe('Flights3dLayer — the flight at the film rate (schema 127)', () => {
  const frameMs = 100
  // A flight with 4 grid points (one per frame, 2 frames apart) and 7 native samples (one per
  // film record, 1 frame apart). The native series carries finer x values that the grid does not.
  const p = [[0, 0, 0], [2, 1, 0], [4, 2, 0], [6, 3, 0]]
  const z = [1.0, 0.5, 0.2, 0.1]
  // The samples in ABSOLUTE film units: t in ms = [10000, 10100, ...] (frame 100+k at 100 ms/frame),
  // x/y in centi-units, z in centi-units. Differential columns for the raw document:
  const fullRate = {
    t: [10000, 100, 100, 100, 100, 100, 100],
    x: [0, 100, 100, 100, 100, 100, 100],
    y: [0, 30, 40, 30, 30, 40, 30],
    z: [100, -15, -15, -15, -15, -15, -15],
  }
  // The decoded (cumulative) values, in world units, for the assertions:
  const decX = [0, 1, 2, 3, 4, 5, 6]
  const decY = [0, 0.3, 0.7, 1, 1.3, 1.7, 2]
  const decZ = [1.0, 0.85, 0.7, 0.55, 0.4, 0.25, 0.1]

  function layerNative(withFullRate: boolean): { layer: Flights3dLayer; root: THREE.Group } {
    const raw = {
      frameIntervalMs: frameMs,
      bounds: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
      projectiles: [{ t0: 100, p, z, ...(withFullRate ? { fullRate } : {}), detoT: 160, detoX: 4, detoY: 0 }],
      grenades: [{ t: 90, slot: 1, i: 0, x: 0, y: 0, rank: 0, s: 'projectile', proj: 0 }],
      shots: [],
      weaponLabels: undefined,
    }
    return calque(0, normalizeReplayDocument(raw as unknown as ReplayDocument))
  }

  it('the head at the frame of the first native sample is exactly that sample (no double decode)', () => {
    const { layer, root } = layerNative(true)
    // The first sample is ABSOLUTE frame 100 (t0) at (0, 0, 1.0). A double decode of the
    // differential columns over the already-decoded values would place it far away.
    layer.update(100)
    const head = premiere(root, 1)
    expect(head.x).toBeCloseTo(decX[0], 6)
    expect(head.y).toBeCloseTo(decZ[0], 6)
    expect(head.z).toBeCloseTo(-decY[0], 6)
    // ... and at every native sample's frame the head is exactly that sample.
    for (let k = 1; k < decX.length; k++) {
      layer.update(Math.round((100 + k) * frameMs) / frameMs)
      const h = premiere(root, 1)
      expect(h.x).toBeCloseTo(decX[k], 4)
      expect(h.y).toBeCloseTo(decZ[k], 4)
      expect(h.z).toBeCloseTo(-decY[k], 4)
    }
    layer.dispose()
  })

  it('the first sample is at frame 100, not 200 (no double t0 offset)', () => {
    const { layer, root } = layerNative(true)
    // With t0 = 100 and a first sample at absolute frame 100.0, adding t0 again would push the
    // flight to frame 200: at 100.01 the old head would sit at the start, untouched by the
    // flight (x = 0, y = 1.0). The fixed head is just past sample 0 toward sample 1 (x = 0.01),
    // which distinguishes it at two decimals.
    layer.update(100.01)
    const head = premiere(root, 1)
    expect(head.x).toBeCloseTo(0.01, 2)
    expect(head.y).toBeCloseTo(0.9985, 2)
    expect(head.z).toBeCloseTo(-0.003, 2)
    layer.dispose()
  })

  it('interpolates halfway between two native samples', () => {
    const { layer, root } = layerNative(true)
    // Halfway between samples 0 (frame ~100.0) and 1 (frame ~101.0), straight between the two
    // points: x = 0.5, y = 0.925, z = -0.15. toThree(x,y,z) = [x, z, -y].
    layer.update(100.5)
    const head = premiere(root, 1)
    expect(head.x).toBeCloseTo(0.5, 4)
    expect(head.y).toBeCloseTo(0.925, 4)
    expect(head.z).toBeCloseTo(-0.15, 4)
    layer.dispose()
  })

  it('falls back to the grid points when fullRate is absent (no regression on old documents)', () => {
    const { layer, root } = layerNative(false)
    // At frame 101, with no native series, the head is interpolated between grid points 0 and 1
    // (frames 100 and 102): x = (0+1)/2 = 0.5, y = (1.0+0.5)/2 = 0.75, z = 0 (both grid points
    // have y=0, so toThree gives z=0).
    layer.update(101)
    const head = premiere(root, 1)
    expect(head.x).toBeCloseTo(0.5, 4)
    expect(head.y).toBeCloseTo(0.75, 4)
    expect(head.z).toBeCloseTo(0, 4)
    layer.dispose()
  })
})