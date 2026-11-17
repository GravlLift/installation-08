// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * Tests — vehicles3d : LES VÉHICULES DE LA 3D SUIVENT LES RÈGLES DE LA 2D, AVEC LA HAUTEUR.
 *
 * CE QUE CE FICHIER VERROUILLE :
 *  - la position interpole x, y ET z, tient au travers d'un silence (`g > 0`), part de la
 *    naissance avant le premier échantillon et ne s'invente pas sans l'une ni l'autre ;
 *  - le gabarit se lit par famille de dessin (variante comprise), repli pour l'inconnu ;
 *  - la caisse ne s'enfonce pas dans le sol trouvé, et garde sa hauteur en vol ;
 *  - la place d'un occupant : conducteur au centre un peu en arrière, les autres par rangées,
 *    tournée par le cap ;
 *  - seuls les véhicules qui peuvent embarquer portent un joueur, dans leur fenêtre d'affichage ;
 *  - le calque saute ce que la 2D saute, et `riderAt` répond même interrupteur éteint.
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

function piste(over: Partial<ReplayVehicleTrackReady> = {}): ReplayVehicleTrackReady {
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

function ech(t: number, x: number, y: number, over: Partial<ReplayVehicleSample> = {}): ReplayVehicleSample {
  return { t, x, y, ...over }
}

function episode(over: Partial<ReplayVehicleRideReady> = {}): ReplayVehicleRideReady {
  return { t0: 0, t1: 100, slot: 1, src: 'event', aim: [], ...over }
}

describe('vehicleWorldAt', () => {
  const track = piste({
    spawn: { x: -1, y: -2, z: 3 },
    samples: [ech(10, 0, 0, { z: 1, h: 0 }), ech(20, 10, 20, { z: 3, h: 0 }), ech(40, 50, 50, { g: 5, h: 0 })],
  })

  it('interpole x, y et z entre deux échantillons', () => {
    expect(vehicleWorldAt(track, 15)).toEqual({ x: 5, y: 10, z: 2 })
  })

  it('tient la position au travers d’un silence, et lit un z omis comme zéro', () => {
    expect(vehicleWorldAt(track, 30)).toEqual({ x: 10, y: 20, z: 3 })
    expect(vehicleWorldAt(track, 40)).toEqual({ x: 50, y: 50, z: 0 })
    expect(vehicleWorldAt(track, 99)).toEqual({ x: 50, y: 50, z: 0 })
  })

  it('part de la naissance avant le premier échantillon, rien sans elle', () => {
    expect(vehicleWorldAt(track, 5)).toEqual({ x: -1, y: -2, z: 3 })
    expect(vehicleWorldAt(piste({ samples: [ech(10, 0, 0)] }), 5)).toBeNull()
    expect(vehicleWorldAt(piste(), 5)).toBeNull()
  })
})

describe('vehicleSize3d', () => {
  it('lit la famille de dessin, variante comprise, et replie l’inconnu', () => {
    expect(vehicleSize3d('mongoose')).toBe(VEHICLE_SIZE_3D.mongoose)
    expect(vehicleSize3d('gungoose')).toEqual(VEHICLE_SIZE_3D.mongoose)
    expect(vehicleSize3d(undefined)).toBe(VEHICLE_SIZE_UNKNOWN)
    expect(vehicleSize3d('inconnue')).toBe(VEHICLE_SIZE_UNKNOWN)
  })
})

describe('vehicleBottomY', () => {
  it('ne s’enfonce pas dans le sol, garde sa hauteur en vol ou sans sol', () => {
    expect(vehicleBottomY(0, 0)).toBe(VEHICLE_FLOOR_LIFT)
    expect(vehicleBottomY(4, 0)).toBe(4)
    expect(vehicleBottomY(2, null)).toBe(2)
  })
})

describe('seatOffset et rotateOffset', () => {
  const size = VEHICLE_SIZE_3D.warthog

  it('pose le conducteur au centre un peu en arrière, les autres par rangées de deux', () => {
    expect(seatOffset(0, size)).toEqual({ forward: -0.1 * size.length, left: 0 })
    const a = seatOffset(1, size)
    const b = seatOffset(2, size)
    expect(a.forward).toBeLessThan(seatOffset(0, size).forward)
    expect(a.forward).toBe(b.forward)
    expect(a.left).toBe(-b.left)
    expect(seatOffset(5, size).forward).toBeGreaterThanOrEqual(-0.45 * size.length)
  })

  it('tourne le décalage par le cap (0° = +X, 90° = +Y)', () => {
    const r = rotateOffset({ forward: 1, left: 0 }, 90)
    expect(r.dx).toBeCloseTo(0)
    expect(r.dy).toBeCloseTo(1)
  })
})

describe('buildRiderIndex et riderSeatAt', () => {
  const conducteur = episode({ xuid: 'A', seat: 0, t0: 10, t1: 50 })
  const passager = episode({ xuid: 'B', seat: 1, slot: 2, t0: 10, t1: 50 })
  const tracks = [
    piste({ rides: [passager, conducteur], t1max: 40 }),
    piste({ family: 'pelican', rides: [episode({ xuid: 'C' })] }),
    piste({ family: undefined, rides: [episode({ xuid: 'D' })] }),
    piste({ family: 'tourelle_auto_bannie', rides: [episode({ xuid: 'E' })] }),
  ]
  const kindOf = (f: string) => (f === 'tourelle_auto_bannie' ? 'map_element' : undefined)
  const index = buildRiderIndex(tracks, kindOf)

  it('n’indexe que les véhicules qui peuvent porter un joueur', () => {
    expect([...index.keys()].sort()).toEqual(['A', 'B'])
  })

  it('rend la monture et le rang parmi les occupants, dans la fenêtre d’affichage', () => {
    expect(riderSeatAt(index.get('A'), tracks, 20)).toEqual({ vehicle: 0, order: 0 })
    expect(riderSeatAt(index.get('B'), tracks, 20)).toEqual({ vehicle: 0, order: 1 })
    expect(riderSeatAt(index.get('A'), tracks, 5)).toBeNull()
    // Au-delà de `t1max`, le véhicule n'est plus affiché : personne n'y est assis.
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

  function calque(montrer: Action3dShow) {
    const samples = [ech(0, 10, 20, { z: 5, h: 0 }), ech(100, 10, 20, { z: 5, h: 0 })]
    const doc = {
      vehicles: [
        piste({ samples, rides: [episode({ xuid: 'A', seat: 0, t0: 10, t1: 50 })] }),
        piste({ samples, scenery: true }),
        piste({ samples, part: 'turret' }),
        piste({ samples, family: 'pelican' }),
        piste({ samples, family: 'tourelle_auto_bannie' }),
      ],
      vehicleLabels: { tourelle_auto_bannie: { kind: 'map_element' } },
    } as unknown as ReplayDocumentReady
    const root = new THREE.Group()
    const inputs = {
      show: montrer,
      inks: { neutral: 'n', zone: { fill: 'z', outline: 'o' } },
      colorOfSlot: () => null,
      colorOfXuid: () => 'equipe',
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
      weaponModel: () => null,
      flagModel: () => null,
      grenadeModel: () => null,
      spartanModel: () => null,
      dressOf: () => null,
      drawnWeapon: () => null,
      firstPersonSlot: () => null,
      flashes: new FlashLights(new THREE.Scene()),
    }
    const layer = new Vehicles3dLayer(ctx)
    // Ordre des lots : caisses, cônes.
    const counts = () => root.children.map((c) => (c as THREE.InstancedMesh).count)
    return { layer, counts }
  }

  it('saute le décor, le décor de carte et les pièces montées, garde l’élément de carte', () => {
    const { layer, counts } = calque(show)
    layer.update(20)
    expect(counts()).toEqual([2, 2])
    layer.update(150)
    expect(counts()).toEqual([0, 0])
    layer.dispose()
  })

  it('pose le conducteur sur sa caisse, même interrupteur éteint', () => {
    const { layer, counts } = calque({ ...show, vehicles: false })
    layer.update(20)
    expect(counts()).toEqual([0, 0])
    const feet = layer.riderAt('A', 20)
    expect(feet).not.toBeNull()
    expect(feet!.x).toBeCloseTo(10 - 0.1 * VEHICLE_SIZE_3D.warthog.length)
    expect(feet!.y).toBeCloseTo(5 + RIDER_ABOVE_BOTTOM)
    expect(feet!.z).toBeCloseTo(-20)
    expect(layer.riderAt('A', 60)).toBeNull()
    expect(layer.riderAt('inconnu', 20)).toBeNull()
    layer.dispose()
  })
})
