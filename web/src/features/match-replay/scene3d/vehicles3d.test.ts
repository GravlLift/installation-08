// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * Tests — vehicles3d: THE 3D'S VEHICLES FOLLOW THE 2D'S RULES, WITH HEIGHT ADDED.
 *
 * WHAT THIS FILE LOCKS DOWN:
 *  - position interpolates x, y AND z, holds through a silence (`g > 0`), starts from the
 *    spawn before the first sample and invents nothing without either;
 *  - size is read by drawing family (variant included), with a fallback for the unknown;
 *  - the box does not sink into the found ground, and keeps its height in flight;
 *  - an occupant's spot: driver at the center slightly to the rear, the others in rows,
 *    rotated by the heading;
 *  - only vehicles that can carry a rider hold a player, within their display window;
 *  - the layer skips what the 2D skips, and `riderAt` answers even with the toggle off.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import type { ReplayVehicleSample } from '@/lib/api/types'
import type {
  ReplayDocumentReady,
  ReplayVehicleRideReady,
  ReplayVehicleTrackReady,
} from '@/lib/replay/replayNormalize'

import type { Action3dInputs, Action3dShow } from './action3dInputs'
import type { Ground, InkCache } from './actionKit'
import type { ActionContext } from './actionScene3d'
import { FlashLights } from './flash3d'
import type { Tracks3d } from './tracks3d'
import { Vehicles3dLayer } from './vehicles3d'
import {
  RIDER_ABOVE_BOTTOM,
  VEHICLE_FLOOR_LIFT,
  VEHICLE_SIZE_3D,
  VEHICLE_SIZE_UNKNOWN,
  buildRiderIndex,
  riderSeatAt,
  rotateOffset,
  seatOffset,
  vehicleBottomY,
  vehicleSize3d,
  vehicleWorldAt,
} from './vehicles3dModel'

function track_(over: Partial<ReplayVehicleTrackReady> = {}): ReplayVehicleTrackReady {
  return {
    slot: 700,
    gen: 1,
    t0: 0,
    t1: 100,
    t1max: 100,
    end: 'unknown',
    family: 'warthog',
    samples: [],
    rides: [],
    ...over,
  }
}

function sample_(t: number, x: number, y: number, over: Partial<ReplayVehicleSample> = {}): ReplayVehicleSample {
  return { t, x, y, ...over }
}

function ride_(over: Partial<ReplayVehicleRideReady> = {}): ReplayVehicleRideReady {
  return { t0: 0, t1: 100, slot: 1, src: 'event', aim: [], ...over }
}

describe('vehicleWorldAt', () => {
  const track = track_({
    spawn: { x: -1, y: -2, z: 3 },
    samples: [sample_(10, 0, 0, { z: 1, h: 0 }), sample_(20, 10, 20, { z: 3, h: 0 }), sample_(40, 50, 50, { g: 5, h: 0 })],
  })

  it('interpolates x, y and z between two samples', () => {
    expect(vehicleWorldAt(track, 15)).toEqual({ x: 5, y: 10, z: 2 })
  })

  it('holds position through a silence, and reads an omitted z as zero', () => {
    expect(vehicleWorldAt(track, 30)).toEqual({ x: 10, y: 20, z: 3 })
    expect(vehicleWorldAt(track, 40)).toEqual({ x: 50, y: 50, z: 0 })
    expect(vehicleWorldAt(track, 99)).toEqual({ x: 50, y: 50, z: 0 })
  })

  it('starts from the spawn before the first sample, nothing without it', () => {
    expect(vehicleWorldAt(track, 5)).toEqual({ x: -1, y: -2, z: 3 })
    expect(vehicleWorldAt(track_({ samples: [sample_(10, 0, 0)] }), 5)).toBeNull()
    expect(vehicleWorldAt(track_(), 5)).toBeNull()
  })
})

describe('vehicleSize3d', () => {
  it('reads the drawing family, variant included, and falls back for the unknown', () => {
    expect(vehicleSize3d('mongoose')).toBe(VEHICLE_SIZE_3D.mongoose)
    expect(vehicleSize3d('gungoose')).toEqual(VEHICLE_SIZE_3D.mongoose)
    expect(vehicleSize3d(undefined)).toBe(VEHICLE_SIZE_UNKNOWN)
    expect(vehicleSize3d('unknown')).toBe(VEHICLE_SIZE_UNKNOWN)
  })
})

describe('vehicleBottomY', () => {
  it('does not sink into the ground, keeps its height in flight or with no ground', () => {
    expect(vehicleBottomY(0, 0)).toBe(VEHICLE_FLOOR_LIFT)
    expect(vehicleBottomY(4, 0)).toBe(4)
    expect(vehicleBottomY(2, null)).toBe(2)
  })
})

describe('seatOffset and rotateOffset', () => {
  const size = VEHICLE_SIZE_3D.warthog

  it('places the driver at the center slightly to the rear, the others in rows of two', () => {
    expect(seatOffset(0, size)).toEqual({ forward: -0.1 * size.length, left: 0 })
    const a = seatOffset(1, size)
    const b = seatOffset(2, size)
    expect(a.forward).toBeLessThan(seatOffset(0, size).forward)
    expect(a.forward).toBe(b.forward)
    expect(a.left).toBe(-b.left)
    expect(seatOffset(5, size).forward).toBeGreaterThanOrEqual(-0.45 * size.length)
  })

  it('rotates the offset by the heading (0° = +X, 90° = +Y)', () => {
    const r = rotateOffset({ forward: 1, left: 0 }, 90)
    expect(r.dx).toBeCloseTo(0)
    expect(r.dy).toBeCloseTo(1)
  })
})

describe('buildRiderIndex and riderSeatAt', () => {
  const driver = ride_({ xuid: 'A', seat: 0, t0: 10, t1: 50 })
  const passenger = ride_({ xuid: 'B', seat: 1, slot: 2, t0: 10, t1: 50 })
  const tracks = [
    track_({ rides: [passenger, driver], t1max: 40 }),
    track_({ family: 'pelican', rides: [ride_({ xuid: 'C' })] }),
    track_({ family: undefined, rides: [ride_({ xuid: 'D' })] }),
    track_({ family: 'tourelle_auto_bannie', rides: [ride_({ xuid: 'E' })] }),
  ]
  const kindOf = (f: string) => (f === 'tourelle_auto_bannie' ? 'map_element' : undefined)
  const index = buildRiderIndex(tracks, kindOf)

  it('indexes only vehicles that can carry a player', () => {
    expect([...index.keys()].sort()).toEqual(['A', 'B'])
  })

  it('returns the mount and the rank among occupants, within the display window', () => {
    expect(riderSeatAt(index.get('A'), tracks, 20)).toEqual({ vehicle: 0, order: 0 })
    expect(riderSeatAt(index.get('B'), tracks, 20)).toEqual({ vehicle: 0, order: 1 })
    expect(riderSeatAt(index.get('A'), tracks, 5)).toBeNull()
    // Past `t1max`, the vehicle is no longer displayed: no one is seated in it.
    expect(riderSeatAt(index.get('A'), tracks, 45)).toBeNull()
    expect(riderSeatAt(undefined, tracks, 20)).toBeNull()
  })
})

describe('Vehicles3dLayer', () => {
  const show: Action3dShow = {
    shots: true, kills: true, weaponPads: true, groundWeapons: true, groundWeaponsSpecialOnly: false,
    groundWeaponsStarting: true, placements: true, vehicles: true, objectives: true,
    flags: true, vipCrown: true, bombCarrier: true,
  }

  function makeLayer(shown: Action3dShow, model: THREE.Object3D | null = null) {
    const samples = [sample_(0, 10, 20, { z: 5, h: 0 }), sample_(100, 10, 20, { z: 5, h: 0 })]
    const doc = {
      vehicles: [
        track_({ samples, rides: [ride_({ xuid: 'A', seat: 0, t0: 10, t1: 50 })] }),
        track_({ samples, scenery: true }),
        track_({ samples, part: 'turret' }),
        track_({ samples, family: 'pelican' }),
        track_({ samples, family: 'tourelle_auto_bannie' }),
      ],
      vehicleLabels: { tourelle_auto_bannie: { kind: 'map_element' } },
    } as unknown as ReplayDocumentReady
    const root = new THREE.Group()
    const inputs = {
      show: shown,
      inks: { neutral: 'n', zone: { fill: 'z', outline: 'o' } },
      colorOfSlot: () => null,
      colorOfXuid: () => 'team',
    } as unknown as Action3dInputs
    const ctx: ActionContext = {
      doc,
      tracks: {} as Tracks3d,
      ground: { floorY: () => 0 } as unknown as Ground,
      ink: { of: () => new THREE.Color() } as unknown as InkCache,
      root,
      originAboveFloor: 0,
      inputs: () => inputs,
      playerFeet: () => null,
      slotState: () => null,
      weaponModel: () => model,
      flagModel: () => null,
      grenadeModel: () => null,
      spartanModel: () => null,
      dressOf: () => null,
      drawnWeapon: () => null,
      firstPersonSlot: () => null,
      flashes: new FlashLights(new THREE.Scene()),
    }
    const layer = new Vehicles3dLayer(ctx)
    // Batch order: boxes, cones.
    const counts = () => root.children.map((c) => (c as THREE.InstancedMesh).count)
    return { layer, counts, root }
  }

  it('draws an available vehicle model instead of its box and cone', () => {
    const model = new THREE.Group()
    model.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()))
    const { layer, root } = makeLayer(show, model)
    layer.update(20)
    expect(root.children.some((child) => child.userData.source === model && child.visible)).toBe(true)
    expect((root.children[0] as THREE.InstancedMesh).count).toBe(1)
    layer.dispose()
  })

  it('places a driver at the model seat marker', () => {
    const model = new THREE.Group()
    model.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()))
    model.userData.vehicleSeats = { 0: [-0.06, 0.166, 0.405] }
    const { layer } = makeLayer(show, model)
    const feet = layer.riderAt('A', 20)
    expect(feet?.x).toBeCloseTo(10.06)
    expect(feet?.y).toBeCloseTo(5.905)
    expect(feet?.z).toBeCloseTo(-19.834)
    layer.dispose()
  })

  it('skips decor, map decor and mounted turrets, keeps the map element', () => {
    const { layer, counts } = makeLayer(show)
    layer.update(20)
    expect(counts()).toEqual([2, 2])
    layer.update(150)
    expect(counts()).toEqual([0, 0])
    layer.dispose()
  })

  it('places the driver on their box, even with the toggle off', () => {
    const { layer, counts } = makeLayer({ ...show, vehicles: false })
    layer.update(20)
    expect(counts()).toEqual([0, 0])
    const feet = layer.riderAt('A', 20)
    expect(layer.riderClipAt('A', 20)).toBe('warthog_d:idle')
    expect(feet).not.toBeNull()
    expect(feet!.x).toBeCloseTo(10 - 0.1 * VEHICLE_SIZE_3D.warthog.length)
    expect(feet!.y).toBeCloseTo(5 + RIDER_ABOVE_BOTTOM)
    expect(feet!.z).toBeCloseTo(-20)
    expect(layer.riderAt('A', 60)).toBeNull()
    expect(layer.riderAt('unknown', 20)).toBeNull()
    layer.dispose()
  })
})
