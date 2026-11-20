// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * Tests — flights3d: A GRENADE'S LOOK IN THE SCENE, BY ITS RANK.
 *
 * WHAT THIS FILE LOCKS DOWN:
 *  - a plasma grenade shows its orb (additive core and halo), in flight as much as at rest, and
 *    no longer places the dark head;
 *  - a frag keeps its own look: the head, not the orb;
 *  - the plasma's detonation is blue, the frag's orange.
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
import type { AttachBone } from './avatar3d'
import type { Tracks3d } from './tracks3d'

const INK: Record<string, THREE.Color> = {
  blue: new THREE.Color(0, 0, 1),
  orange: new THREE.Color(1, 0.4, 0),
  white: new THREE.Color(1, 1, 1),
  info: new THREE.Color(0.2, 0.5, 1),
  green: new THREE.Color(0, 1, 0),
}

/**
 * A film of a single grenade of rank `rank`: the flight leaves at frame 100, ends at 140, and
 * the published detonation is at 160 (so the grenade sits between 140 and 160).
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

function makeLayer(rank: number, doc: unknown = documentGrenade(rank), extra: Partial<ActionContext> = {}): { layer: Flights3dLayer; root: THREE.Group } {
  const root = new THREE.Group()
  const inputs = {
    framesPerSecond: 60,
    inks: {
      fx: { tint: { plasma_cool: 'blue', plasma_green: 'green', blast: 'orange', neutral: 'orange' }, core: 'white' },
      grenade: 'info',
    },
    aids: { projectilePaths: false, blastRadius: false },
  } as unknown as Action3dInputs
  const ctx: ActionContext = {
    doc: doc as unknown as ReplayDocumentReady,
    tracks: {} as Tracks3d,
    ground: { floorY: () => 0 } as unknown as Ground,
    ink: { of: (css: string | null | undefined) => INK[css ?? ''] ?? new THREE.Color(1, 1, 1) } as unknown as InkCache,
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
    ...extra,
  }
  return { layer: new Flights3dLayer(ctx), root }
}

/** The number of instances in pool `i` (order: trail, head, orb core, orb halo, ...). */
const countOf = (root: THREE.Group, i: number): number => (root.children[i] as THREE.InstancedMesh).count

describe("Flights3dLayer — a grenade's look", () => {
  it('plasma shows its orb in flight, not the dark head', () => {
    const { layer, root } = makeLayer(1)
    layer.update(120)
    expect([countOf(root, 0), countOf(root, 1), countOf(root, 2), countOf(root, 3)]).toEqual([0, 0, 1, 1])
    layer.dispose()
  })

  it('a plasma at rest keeps its orb until the detonation', () => {
    const { layer, root } = makeLayer(1)
    layer.update(150)
    expect([countOf(root, 1), countOf(root, 2), countOf(root, 3)]).toEqual([0, 1, 1])
    layer.dispose()
  })

  it('a frag keeps its own look: the head, not the orb', () => {
    const { layer, root } = makeLayer(0)
    layer.update(120)
    expect([countOf(root, 1), countOf(root, 2), countOf(root, 3)]).toEqual([1, 0, 0])
    layer.dispose()
  })

  it("the plasma's detonation is blue, the frag's orange", () => {
    for (const [rank, blue] of [[1, true], [0, false]] as const) {
      const { layer, root } = makeLayer(rank)
      layer.update(169)
      const points = root.children[7] as THREE.Points
      const n = points.geometry.drawRange.count
      expect(n).toBeGreaterThan(0)
      const color = points.geometry.getAttribute('aColor') as THREE.BufferAttribute
      let r = 0
      let b = 0
      for (let i = 0; i < n; i++) {
        r += color.getX(i)
        b += color.getZ(i)
      }
      if (blue) expect(b).toBeGreaterThan(r)
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
function firstPosition(root: THREE.Group, i: number): THREE.Vector3 {
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
    const { layer, root } = makeLayer(0, documentRebond(true))
    layer.update(104)
    expect(firstPosition(root, 1).y).toBeCloseTo(0.05, 6)
    layer.update(106)
    expect(firstPosition(root, 1).y).toBeCloseTo(0.4, 6)
    expect(firstPosition(root, 1).x).toBeCloseTo(3, 6)
    expect(firstPosition(root, 1).z).toBeCloseTo(0, 6)
    layer.dispose()
  })

  it('a seek lands where playing forward does', () => {
    const frames = [100, 100.5, 101, 103.25, 104, 105.7, 108, 111.9, 112]
    const forward = makeLayer(0, documentRebond(true))
    const played = frames.map((f) => {
      forward.layer.update(f)
      return firstPosition(forward.root, 1).toArray()
    })
    const seek = makeLayer(0, documentRebond(true))
    for (const k of [6, 0, 8, 3, 1, 7, 2, 5, 4]) {
      seek.layer.update(160)
      seek.layer.update(frames[k])
      expect(firstPosition(seek.root, 1).toArray()).toEqual(played[k])
    }
    forward.layer.dispose()
    seek.layer.dispose()
  })

  it('an artifact without heights keeps the interpolated slide (no regression on old documents)', () => {
    const { layer, root } = makeLayer(0, documentRebond(false))
    layer.update(106)
    const y = firstPosition(root, 1).y
    expect(Number.isFinite(y)).toBe(true)
    expect(y).not.toBeCloseTo(0.4, 2)
    layer.dispose()
  })
})

describe('Flights3dLayer — the fuel rod', () => {
  it('flies as a large green orb, and leaves nothing behind once its flight ends', () => {
    const { layer, root } = makeLayer(0, documentTir('hinf_fuel_rod_spnkr', 'plasma_green'))
    layer.update(120)
    expect([countOf(root, 1), countOf(root, 2), countOf(root, 3)]).toEqual([0, 1, 1])
    const core = root.children[2] as THREE.InstancedMesh
    const m = new THREE.Matrix4()
    core.getMatrixAt(0, m)
    expect(new THREE.Vector3().setFromMatrixScale(m).x).toBeGreaterThan(0.04)
    const c = new THREE.Color()
    core.getColorAt(0, c)
    expect(c.g).toBeGreaterThan(c.b)
    layer.update(143)
    expect([countOf(root, 2), countOf(root, 3)]).toEqual([0, 0])
    layer.dispose()
  })

  it('keeps the small head for a rocket of the regular SPNKr', () => {
    const { layer, root } = makeLayer(0, documentTir('hinf_m41_spnkr', 'blast'))
    layer.update(120)
    expect([countOf(root, 1), countOf(root, 2), countOf(root, 3)]).toEqual([1, 0, 0])
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
    return makeLayer(0, normalizeReplayDocument(raw as unknown as ReplayDocument))
  }

  it('the head at the frame of the first native sample is exactly that sample (no double decode)', () => {
    const { layer, root } = layerNative(true)
    // The first sample is ABSOLUTE frame 100 (t0) at (0, 0, 1.0). A double decode of the
    // differential columns over the already-decoded values would place it far away.
    layer.update(100)
    const head = firstPosition(root, 1)
    expect(head.x).toBeCloseTo(decX[0], 6)
    expect(head.y).toBeCloseTo(decZ[0], 6)
    expect(head.z).toBeCloseTo(-decY[0], 6)
    // ... and at every native sample's frame the head is exactly that sample.
    for (let k = 1; k < decX.length; k++) {
      layer.update(Math.round((100 + k) * frameMs) / frameMs)
      const h = firstPosition(root, 1)
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
    const head = firstPosition(root, 1)
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
    const head = firstPosition(root, 1)
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
    const head = firstPosition(root, 1)
    expect(head.x).toBeCloseTo(0.5, 4)
    expect(head.y).toBeCloseTo(0.75, 4)
    expect(head.z).toBeCloseTo(0, 4)
    layer.dispose()
  })
})

/**
 * A plasma grenade (rank 1) that flies from frame 100 to 140, sticks at 130 to node 22 of the biped
 * of slot 561 at pose (0.1, 0.2, 0.3) (Halo axes of that node), and explodes at 160.
 */
function documentCollee(): unknown {
  const doc = documentGrenade(1) as { projectiles: Record<string, unknown>[] }
  doc.projectiles[0].attach = { fromFrame: 130, parentSlot: 561, node: 22, pose: [0.1, 0.2, 0.3] }
  return doc
}

describe('Flights3dLayer — a grenade stuck to a player (schema 128)', () => {
  /** A bone the scene "draws" at `at` (no rotation), and the questions asked of it. */
  function os(answer: AttachBone = 'drawn') {
    const at = new THREE.Vector3(5, 1, 2)
    const asked: [number, number][] = []
    const attachBone = (slot: number, node: number, out: THREE.Matrix4): AttachBone => {
      asked.push([slot, node])
      out.makeTranslation(at.x, at.y, at.z)
      return answer
    }
    return { at, asked, attachBone }
  }

  it('rides the bone the film names, at the pose in its frame, from the attach to the explosion', () => {
    const bone = os()
    const { layer, root } = makeLayer(1, documentCollee(), { attachBone: bone.attachBone })
    layer.update(150)
    expect(bone.asked).toEqual([[561, 22]])
    // Halo (0.1, 0.2, 0.3) in the bone's frame is three (0.1, 0.3, -0.2).
    const p = firstPosition(root, 2)
    expect([p.x, p.y, p.z].map((v) => +v.toFixed(6))).toEqual([5.1, 1.3, 1.8])
    bone.at.set(6, 0.5, 2) // the foot moves: the grenade with it
    layer.update(155)
    const q = firstPosition(root, 2)
    expect([q.x, q.y, q.z].map((v) => +v.toFixed(6))).toEqual([6.1, 0.8, 1.8])
    layer.update(161)
    expect(countOf(root, 2)).toBe(0)
    layer.dispose()
  })

  it('turns with the bone', () => {
    const attachBone = (_slot: number, _node: number, out: THREE.Matrix4): AttachBone => {
      out.makeRotationY(Math.PI / 2).setPosition(5, 1, 2)
      return 'drawn'
    }
    const { layer, root } = makeLayer(1, documentCollee(), { attachBone })
    layer.update(150)
    // three (0.1, 0.3, -0.2) turned a quarter about Y is (-0.2, 0.3, -0.1).
    const p = firstPosition(root, 2)
    expect([p.x, p.y, p.z].map((v) => +v.toFixed(6))).toEqual([4.8, 1.3, 1.9])
    layer.dispose()
  })

  it('flies as before until the attach frame', () => {
    const bone = os()
    const stuck = makeLayer(1, documentCollee(), { attachBone: bone.attachBone })
    const plain = makeLayer(1)
    stuck.layer.update(120)
    plain.layer.update(120)
    expect(bone.asked).toEqual([])
    expect(firstPosition(stuck.root, 2)).toEqual(firstPosition(plain.root, 2))
    stuck.layer.dispose()
    plain.layer.dispose()
  })

  it('keeps the end of its flight when no body is drawn for the parent', () => {
    const stuck = makeLayer(1, documentCollee(), { attachBone: os('none').attachBone })
    const plain = makeLayer(1)
    stuck.layer.update(150)
    plain.layer.update(150)
    expect(countOf(stuck.root, 2)).toBe(1)
    expect(firstPosition(stuck.root, 2)).toEqual(firstPosition(plain.root, 2))
    stuck.layer.dispose()
    plain.layer.dispose()
  })

  it('draws nothing in first person on a bone the arms rig does not carry', () => {
    const { layer, root } = makeLayer(1, documentCollee(), { attachBone: os('hidden').attachBone })
    layer.update(150)
    expect([countOf(root, 1), countOf(root, 2), countOf(root, 3)]).toEqual([0, 0, 0])
    layer.dispose()
  })
})

/**
 * A plasma thrown POINT-BLANK (schema 129): it sticks before replicating a flight, so the document has
 * no projectile for it and the throw has no `proj`; its explosion is the throw's own `deto`, the film's
 * detonation of the projectile the throw created (match 9220185c, the game-winning stick on BC0R).
 */
function documentCollageABoutPortant(withDeto: boolean): ReplayDocumentReady {
  return normalizeReplayDocument({
    frameIntervalMs: 1000 / 60,
    projectiles: [],
    grenades: [{ t: 90, slot: 1, i: 0, x: 0, y: 0, rank: 1, s: 'biped', ...(withDeto ? { deto: { t: 160, x: 4, y: 1, z: 1.5 } } : {}) }],
    shots: [],
    weaponLabels: undefined,
  } as unknown as ReplayDocument)
}

/** The explosion's point cloud (pool 7): how many points, and their mean position. */
function blastPoints(root: THREE.Group): { n: number; mean: THREE.Vector3; snapshot: number[] } {
  const points = root.children[7] as THREE.Points
  const n = points.geometry.drawRange.count
  const pos = points.geometry.getAttribute('position') as THREE.BufferAttribute
  const mean = new THREE.Vector3()
  const snapshot: number[] = []
  for (let i = 0; i < n; i++) {
    mean.x += pos.getX(i) / n
    mean.y += pos.getY(i) / n
    mean.z += pos.getZ(i) / n
    snapshot.push(pos.getX(i), pos.getY(i), pos.getZ(i))
  }
  return { n, mean, snapshot }
}

describe('Flights3dLayer — a stick without a flight explodes at its published detonation (schema 129)', () => {
  it('detonates at the deto frame, at the published position and height, not on the floor', () => {
    const { layer, root } = makeLayer(1, documentCollageABoutPortant(true))
    layer.update(159)
    expect(blastPoints(root).n).toBe(0)
    layer.update(165)
    const { n, mean } = blastPoints(root)
    expect(n).toBeGreaterThan(0)
    // Halo (4, 1, 1.5) is three (4, 1.5, -1): the blast is on the body, well above the floor (0).
    expect(Math.abs(mean.x - 4)).toBeLessThan(1)
    expect(Math.abs(mean.z + 1)).toBeLessThan(1)
    expect(mean.y).toBeGreaterThan(1)
    layer.dispose()
  })

  it('a throw without a flight and without deto (an older artifact) draws nothing, as before', () => {
    const { layer, root } = makeLayer(1, documentCollageABoutPortant(false))
    layer.update(165)
    expect(blastPoints(root).n).toBe(0)
    layer.dispose()
  })

  it('plays out over DOCUMENT time: slowed frames advance it, a frozen frame holds it', () => {
    const { layer, root } = makeLayer(1, documentCollageABoutPortant(true))
    // A slowed script clock samples fractional frames between two film frames.
    layer.update(162.25)
    const a = blastPoints(root).snapshot
    layer.update(162.5)
    const b = blastPoints(root).snapshot
    expect(b).not.toEqual(a)
    // A freeze (rate 0) renders the same instant again and again: the same state each time.
    layer.update(162.5)
    expect(blastPoints(root).snapshot).toEqual(b)
    // And a seek back lands where playing forward did.
    layer.update(162.25)
    expect(blastPoints(root).snapshot).toEqual(a)
    layer.dispose()
  })
})