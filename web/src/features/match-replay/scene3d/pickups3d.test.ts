// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * Tests — pickups3d: 3D's PADS AND GROUND WEAPONS FOLLOW 2D's RULES.
 *
 * WHAT THIS FILE LOCKS DOWN:
 *  - pad preparation goes through the crossing with the map;
 *  - a weapon's nature is read under its normalized key, pad as ground;
 *  - the drawer's filters (special only, starting weapons) are 2D's own;
 *  - full = solid box, uncertain = ghost box, empty = disc alone;
 *  - a ground weapon in undated vanishing moves to the ghost pool, then disappears;
 *  - snapping to the floor does not move a wall rack;
 *  - a pad is WALL-MOUNTED when it overhangs the floor by more than 0.25 u: it has neither disc
 *    nor pad;
 *  - a pad outside the map's bounds (5 u margin) is not drawn;
 *  - toggle off: the pools stay empty.
 */
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import type { ReplayGroundWeapon } from '@/lib/api/types'
import type { ReplayDocumentReady, ReplayWeaponPadReady } from '@/lib/replay/replayNormalize'

import type { Action3dInputs, Action3dShow } from './action3dInputs'
import type { Ground, InkCache } from './actionKit'
import type { ActionContext } from './actionScene3d'
import type { Coat } from './armorCoat3d'
import { FlashLights } from './flash3d'
import {
  floorUnder,
  GLOW_EMISSIVE,
  glowMaterialOf,
  groundBoxLook,
  padBoxLook,
  padMountOf,
  padOutOfBounds,
  pickupFamilyOf,
  Pickups3dLayer,
  prepareWeaponPads,
  rackMountsOf,
  RACK_WEAPON_MOUNT,
  rackWeaponOffset,
  rackWeaponRotation,
  placedWeaponRotation,
  shownGroundWeapons,
  type GroundSources,
} from './pickups3d'
import { standingItemCorrection } from './groundWeaponPose3d'
import { toThree, type Tracks3d } from './tracks3d'

const SNIPER = '0x00000001'
const RIFLE = '0x00000002'

const LABELS = {
  [SNIPER]: { fr: 'Sniper', en: 'Sniper', key: 'hinf_s7_sniper', role: 'sniper' },
  [RIFLE]: { fr: 'Fusil', en: 'Rifle', key: 'hinf_ma40', role: 'rifle' },
} as ReplayDocumentReady['weaponLabels']

/** A pad: full from 10 to 20, uncertain from 20 to 30, empty after. */
function padFixture(over: Partial<ReplayWeaponPadReady> = {}): ReplayWeaponPadReady {
  return {
    weapon: SNIPER,
    x: 1,
    y: 2,
    z: 0.1,
    spawns: [10],
    presence: [{ t0: 10, tLow: 20, tHigh: 30 }],
    ...over,
  }
}

function groundWeapon(over: Partial<ReplayGroundWeapon> = {}): ReplayGroundWeapon {
  return {
    t0: 10,
    t1: 40,
    t1max: 50,
    x: 5,
    y: 5,
    z: 0,
    w: '00000002',
    origin: 'dropped',
    dropper: 3,
    end: 'seen',
    picker: -1,
    ...over,
  }
}

/** A flat floor at z = 0 under every point. */
const FLAT_FLOOR: Pick<Ground, 'floorY'> = { floorY: () => 0 }

describe('placedWeaponRotation', () => {
  it('maps the model forward and up to the Forge object axes', () => {
    const q = placedWeaponRotation({ forward: [0, 0, 1], up: [-1, 0, 0] })
    expect(new THREE.Vector3(1, 0, 0).applyQuaternion(q).distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-6)
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(q).distanceTo(new THREE.Vector3(-1, 0, 0))).toBeLessThan(1e-6)
  })
})

describe('prepareWeaponPads', () => {
  it('places the pad at the map\'s slot when the server crossed them', () => {
    const [pad] = prepareWeaponPads({
      weaponPads: [padFixture()],
      mapWeaponPads: { catalogN: 1, pads: [{ pad: 0, family: SNIPER, x: 7, y: 8, z: 9 }] },
      padPickups: [],
      tracks: [],
    })
    expect([pad.x, pad.y, pad.z]).toEqual([7, 8, 9])
    expect(pad.presence).toEqual(padFixture().presence)
  })
})

describe('pickupFamilyOf', () => {
  it('reads a pad\'s key and a ground weapon\'s written in lowercase', () => {
    expect(pickupFamilyOf(SNIPER, LABELS)).toBe('power')
    expect(pickupFamilyOf('00000001', LABELS)).toBe('power')
    expect(pickupFamilyOf(RIFLE, LABELS)).toBe('classic')
    expect(pickupFamilyOf('powerup_overshield', LABELS)).toBe('powerup')
    expect(pickupFamilyOf('0xDEADBEEF', undefined)).toBe('classic')
  })
})

describe('shownGroundWeapons', () => {
  const sniperOnGround = groundWeapon({ w: '00000001' })
  const startingRifle = groundWeapon({ w: '00000002' })
  const mapRifle = groundWeapon({ w: '00000002', origin: 'spawned' })
  const doc: GroundSources = {
    groundWeapons: [sniperOnGround, startingRifle, mapRifle],
    weaponLabels: LABELS,
    loadouts: [{ src: 'birth', w: [RIFLE] }] as ReplayDocumentReady['loadouts'],
  }

  it('hides dropped starting weapons by default, never map ones', () => {
    expect(shownGroundWeapons(doc, false, false)).toEqual([sniperOnGround, mapRifle])
    expect(shownGroundWeapons(doc, false, true)).toEqual([sniperOnGround, startingRifle, mapRifle])
  })

  it('keeps only special weapons when the filter is on', () => {
    expect(shownGroundWeapons(doc, true, true)).toEqual([sniperOnGround])
  })
})

describe('padBoxLook and groundBoxLook', () => {
  it('full, uncertain, empty', () => {
    expect(padBoxLook('full')).toBe('solid')
    expect(padBoxLook('uncertain')).toBe('ghost')
    expect(padBoxLook('empty')).toBeNull()
  })

  it('a ground weapon: nothing, solid, ghost, nothing', () => {
    expect(groundBoxLook(groundWeapon(), 9)).toBeNull()
    expect(groundBoxLook(groundWeapon(), 40)).toBe('solid')
    expect(groundBoxLook(groundWeapon(), 45)).toBe('ghost')
    expect(groundBoxLook(groundWeapon(), 51)).toBeNull()
  })
})

describe('floorUnder', () => {
  it('searches for the floor under the ceiling without a published z', () => {
    expect(floorUnder(FLAT_FLOOR, 0, 0, undefined)).toBe(0)
  })

  it('snaps an object near the floor, keeps a wall rack\'s z', () => {
    expect(floorUnder(FLAT_FLOOR, 0, 0, 0.1)).toBe(0)
    expect(floorUnder(FLAT_FLOOR, 0, 0, 1.5)).toBe(1.5)
  })
})

describe('padMountOf', () => {
  it('mounts a pad that overhangs the floor by more than 0.25 u, leaves the rest on the floor', () => {
    // The four pads of Recharge's room, with the floor height read under each.
    expect(padMountOf(4.936, 4.4)).toBe('mounted') // wall rack, 0.54 u above the floor
    expect(padMountOf(0.0076, 0.0)).toBe('floor') // power-up resting on the floor
    expect(padMountOf(4.494, 4.4)).toBe('floor') // 0.09 u above the floor: floor pad
    expect(padMountOf(2.769, 2.2)).toBe('mounted') // 0.57 u above the floor: wall rack
  })

  it('treats a pad with no published z and no known floor as on the floor', () => {
    expect(padMountOf(undefined, 4.4)).toBe('floor')
    expect(padMountOf(4.936, null)).toBe('floor')
  })
})

describe('padOutOfBounds', () => {
  const bounds = { minX: 0, maxX: 40, minY: 0, maxY: 40 }

  it('excludes a pad outside the map\'s margin, keeps one inside', () => {
    expect(padOutOfBounds(bounds, -240.3, 381.8)).toBe(true) // far outside the map
    expect(padOutOfBounds(bounds, 13.537, 1.526)).toBe(false) // inside the room
  })

  it('excludes nothing without bounds', () => {
    expect(padOutOfBounds(undefined, -240.3, 381.8)).toBe(false)
  })
})

describe('rackMountsOf', () => {
  it('keeps only the rack spawners, first citation of a pad wins', () => {
    const cross = {
      catalogN: 4,
      pads: [
        { x: 0, y: 0, pad: 0, family: 'rack', forward: [1, 0, 0], up: [0, 0, 1] },
        { x: 0, y: 0, pad: 1, family: 'power' },
        { x: 0, y: 0, pad: 2, family: 'powerup' },
        { x: 0, y: 0, pad: 1, family: 'rack' },
      ],
    } as ReplayDocumentReady['mapWeaponPads']
    const mounts = rackMountsOf(cross)
    expect([...mounts.keys()]).toEqual([0])
    expect(mounts.get(0)).toEqual({ forward: [1, 0, 0], up: [0, 0, 1] })
  })

  it('names no rack without a crossing', () => {
    expect(rackMountsOf(undefined).size).toBe(0)
  })
})

describe('rackWeaponRotation', () => {
  const axis = (q: THREE.Quaternion, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(q)

  it('poses the weapon as the rack marker 630cde8c does: muzzle up, left side out, top to the rack left', () => {
    // Game forward -Y is three +Z (toThree(x, y, z) = [x, z, -y]).
    const q = rackWeaponRotation({ forward: [0, -1, 0], up: [0, 0, 1] })
    expect(axis(q, 1, 0, 0).distanceTo(new THREE.Vector3(0, 1, 0))).toBeCloseTo(0)
    // Model Z is the weapon's right: it faces into the rack, so its left faces out (+Z).
    expect(axis(q, 0, 0, 1).distanceTo(new THREE.Vector3(0, 0, -1))).toBeCloseTo(0)
    // The rack's left, game (forward x up) rotated: facing game -Y, left is game +X = three +X.
    expect(axis(q, 0, 1, 0).distanceTo(new THREE.Vector3(1, 0, 0))).toBeCloseTo(0)
  })

  it('matches the marker quaternion (-0.5, -0.5, -0.5, 0.5) on a rack facing game +X', () => {
    const q = rackWeaponRotation({ forward: [1, 0, 0], up: [0, 0, 1] })
    // The marker in game axes: weapon x -> rack up, y -> rack forward, z -> rack left.
    const marker = new THREE.Quaternion(-0.5, -0.5, -0.5, 0.5)
    const game = (v: THREE.Vector3) => new THREE.Vector3(...toThree(v.x, v.y, v.z))
    for (const v of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]) {
      // A game-frame weapon axis, through the marker, then to three; vs the same axis in three, through q.
      const expected = game(v.clone().applyQuaternion(marker))
      const got = game(v).applyQuaternion(q)
      expect(got.distanceTo(expected)).toBeCloseTo(0)
    }
  })

  it('follows a diagonal rack and squares a tilted forward against up', () => {
    const q = rackWeaponRotation({ forward: [0.71, -0.71, 0.2], up: [0, 0, 1] })
    const side = axis(q, 0, 0, 1)
    expect(side.y).toBeCloseTo(0)
    expect(side.distanceTo(new THREE.Vector3(-1, 0, -1).normalize())).toBeCloseTo(0)
  })

  it('stays upright facing +X without published axes', () => {
    const q = rackWeaponRotation({ forward: undefined, up: null })
    expect(axis(q, 1, 0, 0).distanceTo(new THREE.Vector3(0, 1, 0))).toBeCloseTo(0)
    expect(axis(q, 0, 0, 1).distanceTo(new THREE.Vector3(-1, 0, 0))).toBeCloseTo(0)
  })
})

describe('rackWeaponOffset', () => {
  it('holds the weapon at the open tray marker, 0.0516 u along the rack forward, inside its 0.065 u front', () => {
    expect(RACK_WEAPON_MOUNT).toBeCloseTo(0.0516)
    const o = rackWeaponOffset({ forward: [0, -1, 0], up: [0, 0, 1] })
    expect(o.distanceTo(new THREE.Vector3(0, 0, RACK_WEAPON_MOUNT))).toBeCloseTo(0, 6)
  })
})

describe('glowMaterialOf', () => {
  it('keeps the base color map, color and shared references, with a faint emissive', () => {
    const map = new THREE.Texture()
    const mask = new THREE.Texture()
    const hook = () => {}
    const source = new THREE.MeshStandardMaterial({ map, color: 0x6c6f76 })
    source.userData.armorMaps = { asg: mask, mask0: null, mask1: null }
    source.onBeforeCompile = hook
    const glow = glowMaterialOf(source, new THREE.Color(0x9ca3af)) as THREE.MeshStandardMaterial
    expect(glow).not.toBe(source)
    expect(glow.map).toBe(map)
    expect(glow.color.getHex()).toBe(0x6c6f76)
    // The tint follows the texture instead of a flat wash over it, and stays faint.
    expect(glow.emissiveMap).toBe(map)
    expect(glow.emissive.getHex()).toBe(0x9ca3af)
    expect(glow.emissiveIntensity).toBe(GLOW_EMISSIVE)
    expect(GLOW_EMISSIVE).toBeLessThanOrEqual(0.15)
    // `clone` alone would turn the coating masks into plain JSON objects and drop the hook.
    expect(glow.userData.armorMaps.asg).toBe(mask)
    expect(glow.onBeforeCompile).toBe(hook)
    // The source is untouched.
    expect(source.emissive.getHex()).toBe(0)
    expect(source.emissiveMap).toBeNull()
    expect(source.userData.armorMaps.asg).toBe(mask)
  })

  it('leaves a self-lit surface its own light', () => {
    const emissiveMap = new THREE.Texture()
    const source = new THREE.MeshStandardMaterial({ emissive: new THREE.Color(0, 0.178, 1), emissiveIntensity: 5, emissiveMap })
    source.userData.selfLit = true
    const glow = glowMaterialOf(source, new THREE.Color(0x9ca3af)) as THREE.MeshStandardMaterial
    expect(glow.emissive.b).toBe(1)
    expect(glow.emissiveIntensity).toBe(5)
    expect(glow.emissiveMap).toBe(emissiveMap)
  })
})

describe('standingItemCorrection', () => {
  const axis = (q: THREE.Quaternion, v: THREE.Vector3) => v.clone().applyQuaternion(q)

  it('stands a disc on its edge: the thin axis (up) goes horizontal', () => {
    const disc = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.3))
    const { rotation } = standingItemCorrection(disc)
    const thin = axis(rotation, new THREE.Vector3(0, 1, 0))
    expect(thin.y).toBeCloseTo(0)
    expect(Math.abs(thin.x)).toBeCloseTo(1)
  })

  it('keeps the tallest remaining axis up for a tall item thin in Z', () => {
    const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.8, 0.1))
    const { rotation } = standingItemCorrection(beacon)
    expect(axis(rotation, new THREE.Vector3(0, 1, 0)).y).toBeCloseTo(1)
    expect(axis(rotation, new THREE.Vector3(0, 0, 1)).y).toBeCloseTo(0)
  })

  it('is a proper rotation and reports the model-space center', () => {
    const disc = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.3))
    const { rotation, center } = standingItemCorrection(disc)
    expect(center).toEqual(new THREE.Vector3(0, 0, 0))
    expect(new THREE.Matrix4().makeRotationFromQuaternion(rotation).determinant()).toBeCloseTo(1)
  })
})

describe('Pickups3dLayer', () => {
  const show: Action3dShow = {
    shots: false,
    kills: false,
    weaponPads: true,
    groundWeapons: true,
    groundWeaponsSpecialOnly: false,
    groundWeaponsStarting: true,
    placements: false,
    vehicles: false,
    objectives: false,
    flags: false,
    vipCrown: false,
    bombCarrier: false,
  }

  /** The default floor is flat; a test passes its own to place a wall rack. */
  type DocOverrides = { weaponPads?: ReplayWeaponPadReady[]; mapWeaponPads?: ReplayDocumentReady['mapWeaponPads']; groundWeapons?: ReplayDocumentReady['groundWeapons'] }
  function buildLayer(
    shown: Action3dShow,
    weaponModel: ActionContext['weaponModel'] = () => null,
    docOverrides: DocOverrides = {},
    floor: Pick<Ground, 'floorY'> = FLAT_FLOOR,
    ink: THREE.Color = new THREE.Color(0xff8c1a),
    armory: ActionContext['armory'] = () => null,
    groundScale = 1,
  ): { layer: Pickups3dLayer; counts: () => number[]; root: THREE.Group } {
    const root = new THREE.Group()
    const doc = {
      weaponPads: [padFixture()],
      mapWeaponPads: undefined,
      padPickups: [],
      tracks: [],
      groundWeapons: [groundWeapon()],
      weaponLabels: LABELS,
      loadouts: [],
      ...docOverrides,
    } as unknown as ReplayDocumentReady
    const inputs = {
      show: shown,
      inks: { pad: { powerup: 'a', power: 'b', classic: 'c' } },
    } as unknown as Action3dInputs
    const ctx: ActionContext = {
      doc,
      tracks: {} as Tracks3d,
      ground: floor as Ground,
      ink: { of: () => ink } as unknown as InkCache,
      root,
      originAboveFloor: 0,
      inputs: () => inputs,
      playerFeet: () => null,
      slotState: () => null,
      weaponModel,
      weaponGroundScale: () => groundScale,
      flagModel: () => null,
      grenadeModel: () => null,
      spartanModel: () => null,
      dressOf: () => null,
      armory,
      drawnWeapon: () => null,
      firstPersonSlot: () => null,
      flashes: new FlashLights(new THREE.Scene()),
    }
    const layer = new Pickups3dLayer(ctx)
    // Pool order: solid boxes, ghost boxes (model copies come after).
    const counts = () => root.children.slice(0, 2).map((c) => (c as THREE.InstancedMesh).count)
    return { layer, counts, root }
  }

  it('paints only the weapon box by pad and ground-weapon state, never a stand-in pad', () => {
    const { layer, counts, root } = buildLayer(show)
    expect(root.children.filter((c) => (c as THREE.Mesh).geometry instanceof THREE.CylinderGeometry)).toEqual([])
    layer.update(15)
    expect(counts()).toEqual([2, 0])
    layer.update(25)
    expect(counts()).toEqual([1, 1])
    layer.update(45)
    expect(counts()).toEqual([0, 1])
    layer.update(60)
    expect(counts()).toEqual([0, 0])
    layer.dispose()
  })

  it('poses only the weapon model at its height on a wall rack', () => {
    const solSalle = { floorY: () => 4.4 }
    const { layer, counts, root } = buildLayer(
      show,
      () => new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 0.2)),
      { weaponPads: [padFixture({ x: 13.537, y: 1.526, z: 4.936 })] },
      solSalle,
    )
    layer.update(15)
    expect(counts()).toEqual([0, 0])
    const copie = root.children[2]
    expect(copie).toBeDefined()
    expect(copie.position.y).toBeCloseTo(4.936)
    layer.dispose()
  })

  // Recharge's rack at (20, -12.03, 4.92), forward -Y: the kit stands on the floor at 4.70, so the
  // floor-pad branch used to lift the weapon over the rack top and spin it.
  const RACK_AT = { x: 20, y: -12.03, z: 4.92 }
  const rackCross = (family: string) =>
    ({ catalogN: 1, pads: [{ ...RACK_AT, pad: 0, family, forward: [0, -1, 0], up: [0, 0, 1] }] }) as ReplayDocumentReady['mapWeaponPads']

  it('draws a placed weapon at its film origin with its Forge axes and scale', () => {
    const model = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
    const mapWeaponPads = { catalogN: 0, pads: [{ ...RACK_AT, pad: 0, family: 'placed', forward: [1, 0, 0], up: [0, 0, 1], scale: [2, 3, 4] }] }
    const { layer, root } = buildLayer({ ...show, groundWeapons: false }, () => model,
      { weaponPads: [padFixture(RACK_AT)], mapWeaponPads }, FLAT_FLOOR, undefined, undefined, 1.5)
    layer.update(15)
    const copy = root.children[2]
    expect(copy.position.toArray()).toEqual([20, 4.92, 12.03])
    expect(copy.scale.toArray()).toEqual([3, 6, 4.5])
    expect(new THREE.Vector3(1, 0, 0).applyQuaternion(copy.quaternion).distanceTo(new THREE.Vector3(1, 0, 0))).toBeLessThan(1e-6)
    const rotation = copy.quaternion.clone()
    layer.update(19)
    expect(copy.quaternion.angleTo(rotation)).toBeCloseTo(0)
    layer.update(60)
    expect(copy.visible).toBe(false)
    layer.dispose()
  })

  it('holds a rack weapon still inside the rack at its mount marker, upright, by the pad state', () => {
    const model = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.02))
    const { layer, counts, root } = buildLayer(
      { ...show, groundWeapons: false },
      () => model,
      { weaponPads: [padFixture(RACK_AT)], mapWeaponPads: rackCross('rack') },
      { floorY: () => 4.7 },
    )
    layer.update(15)
    const copie = root.children[2]
    expect(copie).toBeDefined()
    const pose = { p: copie.position.clone(), q: copie.quaternion.clone() }
    // At the spawner's height, not lifted off the floor under the rack; its origin on the open
    // tray's marker, 0.0516 u along the rack forward (game -Y, three +Z), inside the rack.
    const spawner = new THREE.Vector3(RACK_AT.x, RACK_AT.z, -RACK_AT.y)
    expect(pose.p.distanceTo(spawner.clone().add(new THREE.Vector3(0, 0, RACK_WEAPON_MOUNT)))).toBeCloseTo(0, 5)
    // Upright: the muzzle (model X) runs along world up.
    expect(new THREE.Vector3(1, 0, 0).applyQuaternion(pose.q).y).toBeCloseTo(1)
    layer.update(19)
    expect(root.children[2]).toBe(copie)
    expect(copie.visible).toBe(true)
    expect(copie.position.equals(pose.p)).toBe(true)
    expect(copie.quaternion.angleTo(pose.q)).toBeCloseTo(0)
    // Uncertain: a still ghost box at the spawner; empty: nothing.
    layer.update(25)
    expect(counts()).toEqual([0, 1])
    layer.update(60)
    expect(counts()).toEqual([0, 0])
    expect(copie.visible).toBe(false)
    layer.dispose()
  })

  it('keeps a power pad floating and turning', () => {
    const model = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.02))
    const { layer, root } = buildLayer(
      { ...show, groundWeapons: false },
      () => model,
      { weaponPads: [padFixture(RACK_AT)], mapWeaponPads: rackCross('power') },
      { floorY: () => 4.7 },
    )
    layer.update(15)
    const copie = root.children[2]
    const q = copie.quaternion.clone()
    expect(copie.position.y).toBeGreaterThan(4.7 + 0.28)
    layer.update(19)
    expect(copie.quaternion.angleTo(q)).toBeGreaterThan(0.01)
    layer.dispose()
  })

  it('floats a crossed pad over its spawner even when the floor ray misses its kit', () => {
    // A Forge map at construction: the variant layer (its floors, the pad kit) is not posed yet and
    // the only floor under the spawner is the canvas, 4 u down. The pad used to read as a wall rack
    // and pose its weapon at the spawner, inside the pad kit.
    const model = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.02))
    const { layer, root } = buildLayer(
      { ...show, groundWeapons: false },
      () => model,
      { weaponPads: [padFixture(RACK_AT)], mapWeaponPads: rackCross('power') },
      { floorY: () => RACK_AT.z - 4 },
    )
    layer.update(15)
    const copie = root.children[2]
    expect(copie.position.y).toBeCloseTo(RACK_AT.z + 0.28 + 0.04)
    layer.dispose()
  })

  it('keeps a power pad beside a rack floating and turning, never in the rack pose', () => {
    // Fortress: the S7 power pads stand a few meters from the Commando rack; each pad keeps the
    // pose of its own spawner kind.
    const model = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.02))
    const POWER_AT = { x: RACK_AT.x + 0.6, y: RACK_AT.y + 0.3, z: RACK_AT.z - 0.2 }
    const cross = {
      catalogN: 2,
      pads: [
        { ...RACK_AT, pad: 0, family: 'rack', forward: [0, -1, 0], up: [0, 0, 1] },
        { ...POWER_AT, pad: 1, family: 'power', forward: [0, -1, 0], up: [0, 0, 1] },
      ],
    } as ReplayDocumentReady['mapWeaponPads']
    const { layer, root } = buildLayer(
      { ...show, groundWeapons: false },
      () => model,
      { weaponPads: [padFixture(RACK_AT), padFixture(POWER_AT)], mapWeaponPads: cross },
      { floorY: () => 4.7 },
    )
    layer.update(15)
    // Copies in paint order: the rack weapon, then the power pad item.
    const rackCopy = root.children[2]
    const padCopy = root.children[3]
    expect(new THREE.Vector3(1, 0, 0).applyQuaternion(rackCopy.quaternion).y).toBeCloseTo(1)
    // Lying level (muzzle horizontal), over its own spawner, lifted off it.
    expect(new THREE.Vector3(1, 0, 0).applyQuaternion(padCopy.quaternion).y).toBeCloseTo(0)
    expect(padCopy.position.x).toBeCloseTo(POWER_AT.x)
    expect(padCopy.position.z).toBeCloseTo(-POWER_AT.y)
    expect(padCopy.position.y).toBeCloseTo(POWER_AT.z + 0.28 + 0.04)
    const q = padCopy.quaternion.clone()
    layer.update(19)
    expect(padCopy.quaternion.angleTo(q)).toBeGreaterThan(0.01)
    layer.dispose()
  })

  it('turns a weapon pad item about its model center, over the pad spawner, not about its grip', () => {
    // A weapon's origin is its grip: the S7's barrel runs 0.4 u forward of it. Turned about the
    // grip, the barrel swept past the pad's rim.
    const model = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.04))
    body.position.set(0.15, 0.02, 0)
    model.add(body)
    const SPAWNER = { x: 56.85, y: -115.2, z: 72.206 }
    const { layer, root } = buildLayer(
      { ...show, groundWeapons: false },
      () => model,
      {
        // The film's pad reading is a few centimeters off the spawner; the spawner wins.
        weaponPads: [padFixture({ x: 56.8545, y: -115.1982, z: 72.2092 })],
        mapWeaponPads: { catalogN: 1, pads: [{ ...SPAWNER, pad: 0, family: 'power', forward: [0, -1, 0], up: [0, 0, 1] }] },
      },
      { floorY: () => SPAWNER.z + 0.05 },
    )
    for (const frame of [11, 15, 18]) {
      layer.update(frame)
      const copie = root.children[2]
      copie.updateMatrixWorld(true)
      const c = new THREE.Box3().setFromObject(copie).getCenter(new THREE.Vector3())
      expect(c.x).toBeCloseTo(SPAWNER.x)
      expect(c.z).toBeCloseTo(-SPAWNER.y)
      expect(c.y).toBeCloseTo(SPAWNER.z + 0.28 + 0.04)
    }
    layer.dispose()
  })

  // Live Fire's Repulsor pad: the map's equipment spawn point the server crossed the film pad with.
  const REPULSOR_AT = { x: 6.82, y: 35.87, z: -0.99 }
  const equipmentCross = {
    catalogN: 0,
    pads: [{ ...REPULSOR_AT, pad: 0, family: 'equipment' }],
  } as ReplayDocumentReady['mapWeaponPads']

  it('floats and turns an equipment pad item over its spawner, hidden once taken', () => {
    const model = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.1))
    const ids: string[] = []
    const { layer, counts, root } = buildLayer(
      { ...show, groundWeapons: false },
      (id) => {
        ids.push(id)
        return id === 'repulsor' ? model : null
      },
      { weaponPads: [padFixture({ weapon: 'repulsor', x: 6.815, y: 35.867, z: -0.995 })], mapWeaponPads: equipmentCross },
      { floorY: () => REPULSOR_AT.z },
    )
    const read = () => (window as unknown as { __it3dPickups?: unknown }).__it3dPickups
    layer.update(15)
    const copie = root.children[2]
    expect(copie).toBeDefined()
    expect(ids).toContain('repulsor')
    // At the spawner (not the film's centroid), lifted like any floor pad item.
    expect(copie.position.x).toBeCloseTo(REPULSOR_AT.x)
    expect(copie.position.z).toBeCloseTo(-REPULSOR_AT.y)
    expect(copie.position.y).toBeCloseTo(REPULSOR_AT.z + 0.28 + 0.04)
    expect(read()).toEqual([
      expect.objectContaining({ pad: 0, family: 'equipment', weaponKey: 'repulsor', state: 'full', visible: true, drawn: 'model', modelLoaded: true }),
    ])
    const q = copie.quaternion.clone()
    layer.update(19)
    expect(copie.quaternion.angleTo(q)).toBeGreaterThan(0.01)
    // Uncertain: a ghost box; taken: nothing.
    layer.update(25)
    expect(counts()).toEqual([0, 1])
    layer.update(60)
    expect(counts()).toEqual([0, 0])
    expect(copie.visible).toBe(false)
    expect(read()).toEqual([expect.objectContaining({ family: 'equipment', state: 'empty', visible: false, drawn: null })])
    layer.dispose()
  })

  it('turns an equipment item whose model is off its origin about the model center (the Drop Wall)', () => {
    // The Drop Wall pickup's mesh sits about 0.4 u above its origin and off to one side.
    const model = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 0.07))
    mesh.position.set(-0.045, 0.4, 0.08)
    model.add(mesh)
    const { layer, root } = buildLayer(
      { ...show, groundWeapons: false },
      (id) => (id === 'wall' ? model : null),
      { weaponPads: [padFixture({ weapon: 'wall', x: 6.815, y: 35.867, z: -0.995 })], mapWeaponPads: equipmentCross },
      { floorY: () => REPULSOR_AT.z },
    )
    const center = (frame: number) => {
      layer.update(frame)
      const copie = root.children[2]
      copie.updateMatrixWorld(true)
      return new THREE.Box3().setFromObject(copie).getCenter(new THREE.Vector3())
    }
    for (const frame of [15, 18]) {
      const c = center(frame)
      expect(c.x).toBeCloseTo(REPULSOR_AT.x)
      expect(c.z).toBeCloseTo(-REPULSOR_AT.y)
      expect(c.y).toBeCloseTo(REPULSOR_AT.z + 0.28 + 0.04)
    }
    layer.dispose()
  })

  it('stands an equipment item on its thinnest edge and spins it about world up', () => {
    const model = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.3))
    const { layer, root } = buildLayer(
      { ...show, groundWeapons: false },
      () => model,
      { weaponPads: [padFixture({ weapon: 'repulsor', x: 6.815, y: 35.867, z: -0.995 })], mapWeaponPads: equipmentCross },
      { floorY: () => REPULSOR_AT.z },
    )
    layer.update(11)
    const copie = root.children[2]
    // The disc's thin axis (model Y) lies in the horizontal plane: it stands on its edge.
    const thin = new THREE.Vector3(0, 1, 0).applyQuaternion(copie.quaternion)
    expect(thin.y).toBeCloseTo(0)
    layer.update(19)
    // The spin keeps it horizontal and turns it in place about world up.
    const thin2 = new THREE.Vector3(0, 1, 0).applyQuaternion(copie.quaternion)
    expect(thin2.y).toBeCloseTo(0)
    expect(thin2.angleTo(thin)).toBeGreaterThan(0.1)
    layer.dispose()
  })

  it('glows a floating pad item in its family ink and leaves a rack weapon bare', () => {
    const mat = new THREE.MeshStandardMaterial()
    const model = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.3), mat)
    const cross = {
      catalogN: 0,
      pads: [
        { ...REPULSOR_AT, pad: 0, family: 'equipment' },
        { ...RACK_AT, pad: 1, family: 'rack', forward: [0, -1, 0], up: [0, 0, 1] },
      ],
    } as ReplayDocumentReady['mapWeaponPads']
    const { layer, root } = buildLayer(
      { ...show, groundWeapons: false },
      () => model,
      {
        weaponPads: [padFixture({ weapon: 'repulsor', x: 6.815, y: 35.867, z: -0.995 }), padFixture(RACK_AT)],
        mapWeaponPads: cross,
      },
    )
    layer.update(15)
    // Copies come after the box pools, in paint order: the floating equipment item, then the rack.
    const floating = root.children[2] as THREE.Mesh
    const rackCopy = root.children[3] as THREE.Mesh
    expect(floating.material).not.toBe(mat)
    expect((floating.material as THREE.MeshStandardMaterial).emissive.getHex()).not.toBe(0)
    expect(mat.emissive.getHex()).toBe(0) // the source keeps its own material
    expect(rackCopy.material).toBe(mat) // a rack weapon is bare
    layer.dispose()
  })

  /** The fake armory: the default-style coat of `key` (its painted materials) once the coat is ready. */
  function fakeArmory(mat: THREE.MeshStandardMaterial, key = '00000001') {
    // A painted material, as `armorMaterial` builds it: the raw masks by reference and the
    // shader hook the glow copy must keep.
    const uniforms: Record<string, unknown> = {}
    const painted: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial()
    painted.userData = { ...mat.userData, armorUniforms: uniforms }
    painted.onBeforeCompile = (shader: { uniforms: Record<string, unknown> }) => {
      Object.assign(shader.uniforms, uniforms)
    }
    const paint = {
      maps: { asg: null, mask0: null, mask1: null },
      paint: { data: new Float32Array(8 * 6 * 4), globals: [0, 0, 1, 1] as [number, number, number, number], offset: [0, 0] as [number, number] },
      gradients: { value: new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1) },
    }
    let promise: Promise<Coat | null> | null = null
    let resolveCoat: (c: Coat | null) => void = () => {}
    let ready = false
    const coat = new Map<THREE.Material, typeof paint>([[mat, paint]])
    return {
      // The coat stays pending until `ready` is called: the items are drawn bare in between.
      ready: () => { ready = true; resolveCoat(coat) },
      painted,
      paintObject: vi.fn((k: string, _model: THREE.Object3D) => {
        if (k !== key) return Promise.resolve(null)
        if (!promise) promise = new Promise<Coat | null>((resolve) => { resolveCoat = resolve })
        return promise
      }),
      objectCoat: (k: string, _model: THREE.Object3D): Coat | null => {
        if (k !== key || !ready) return null
        const mats = new Set<THREE.Material>()
        _model.traverse((o) => { if (o instanceof THREE.Mesh && (o.material as THREE.Material).userData.armorMaps) mats.add(o.material as THREE.Material) })
        return [...mats].every((m) => m === mat) ? coat : null
      },
    }
  }

  it('pads and ground weapons wear their default-style paint: one coat per model key, glow keeps it', async () => {
    // A model whose painted materials (raw masks + style) the armory knows.
    const mat = new THREE.MeshStandardMaterial({ color: 0x6c6f76 })
    mat.userData.armorMaps = { asg: null, mask0: null, mask1: null }
    mat.userData.style = { stylelist: 'f00dface', region: '0b7e328b', intentions: ['229d91fa'], layers: 1, texel_density: [1, 1], offset: [0, 0] }
    const model = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.02), mat)
    const fake = fakeArmory(mat)
    expect(fake.painted.onBeforeCompile).toBeInstanceOf(Function)
    const cross = {
      catalogN: 0,
      pads: [
        { ...RACK_AT, pad: 0, family: 'power', forward: [0, -1, 0], up: [0, 0, 1] },
      ],
    } as ReplayDocumentReady['mapWeaponPads']
    // The pad holds a hex weapon whose family key is `00000001`, the same key the ground weapon
    // carries: one coat per model key, shared between the pad and the ground.
    const hexSniper = '0x00000001'
    const { layer, root } = buildLayer(
      show,
      () => model,
      {
        weaponPads: [padFixture({ ...RACK_AT, weapon: hexSniper })],
        mapWeaponPads: cross,
        groundWeapons: [groundWeapon({ w: SNIPER })],
      },
      { floorY: () => 4.7 },
      new THREE.Color(0xff8c1a),
      () => fake as unknown as import('./armory3d').SpartanArmory,
    )
    // The pad and the ground weapon name the same model key: ONE request for the default-style
    // coat (ten pads of the same weapon paint once).
    layer.update(15)
    expect(fake.paintObject).toHaveBeenCalledTimes(1)
    expect(fake.paintObject.mock.calls[0][0]).toBe('00000001')
    // While the coat is pending the items are drawn from the bare model: the ground weapon wears
    // its source material, and the pad's glow copy tints that same bare material (the pad item is
    // always a glow copy, so its material is a glow tint, not the source).
    const barePad = root.children[2] as THREE.Mesh
    const bareGround = root.children[3] as THREE.Mesh
    expect(bareGround.material).toBe(mat) // the ground weapon is bare (no glow on the ground)
    const barePadGlow = barePad.material as THREE.MeshStandardMaterial
    expect(barePadGlow.emissiveIntensity).toBe(GLOW_EMISSIVE) // the pad item is the glow copy
    // Unpainted: the glow tint is over the bare material (not a paint material, no armor uniforms).
    expect(barePadGlow).not.toBe(mat)
    expect(barePadGlow.userData.armorUniforms).toBeUndefined()
    await new Promise((r) => setTimeout(r, 5))
    fake.ready()
    // The painted model is swapped in: the layer caches one painted copy per source model, so the
    // item objects are stable and the swap is their material (no flicker loop: one request per
    // model key). The ground weapon wears the painted material directly; the pad's glow tints it.
    layer.update(19)
    expect(fake.paintObject).toHaveBeenCalledTimes(1)
    // The painted copies are swapped in: the ground weapon wears the painted material directly,
    // and the pad's glow tints it. Select the painted items by their coat (armor uniforms), not
    // by index (the pool reuses hidden bare objects, so the painted copies sit at fresh indices).
    const painted = root.children.filter((c) => {
      const m = (c as THREE.Mesh).material as THREE.Material | undefined
      return m && !!(m.userData as { armorUniforms?: unknown }).armorUniforms
    }) as THREE.Mesh[]
    const ground = painted.find((c) => (c.material as THREE.MeshStandardMaterial).emissiveIntensity !== GLOW_EMISSIVE)
    const glow = painted.find((c) => (c.material as THREE.MeshStandardMaterial).emissiveIntensity === GLOW_EMISSIVE)
    expect(ground).toBeDefined() // the ground weapon wears the painted material
    expect((ground!.material as THREE.Material).userData.armorUniforms).toBeDefined()
    expect((ground!.material as THREE.Material).userData.armorMaps).toBeDefined()
    expect(glow).toBeDefined() // the pad's glow tints the painted material
    expect((glow!.material as THREE.Material).userData.armorUniforms).toBeDefined()
    expect((glow!.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(GLOW_EMISSIVE)
    layer.dispose()
  })

  it('a pad item and its glow cast no shadow, a rack weapon either (the camera light cast a dark copy on the floor behind them)', () => {
    const mat = new THREE.MeshStandardMaterial()
    const model = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.02), mat)
    model.castShadow = true // the game's GLB casts; the layer must switch it off
    const cross = {
      catalogN: 0,
      pads: [
        { ...RACK_AT, pad: 0, family: 'equipment', forward: [0, -1, 0], up: [0, 0, 1] },
        { ...RACK_AT, family: 'rack', forward: [0, -1, 0], up: [0, 0, 1] },
      ],
    } as ReplayDocumentReady['mapWeaponPads']
    const { layer, root } = buildLayer(
      { ...show, groundWeapons: false },
      () => model,
      {
        weaponPads: [
          padFixture({ weapon: 'repulsor', x: 6.815, y: 35.867, z: -0.995 }),
          padFixture(RACK_AT),
        ],
        mapWeaponPads: cross,
      },
    )
    layer.update(15)
    // Copies come after the box pools, in paint order: the floating equipment item (a glow copy),
    // then the rack weapon (bare).
    for (const child of root.children.slice(2)) {
      const meshes: THREE.Mesh[] = []
      child.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o) })
      expect(meshes.length).toBeGreaterThan(0)
      for (const mesh of meshes) expect(mesh.castShadow).toBe(false)
    }
    // The glow copy never casts either.
    const floating = root.children[2] as THREE.Mesh
    expect(floating.castShadow).toBe(false)
    expect((floating.material as THREE.MeshStandardMaterial).emissive.getHex()).not.toBe(0)
    layer.dispose()
  })

  it('answers window.__it3dPickups with what each pad drew, until disposed', () => {
    const model = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.02))
    const { layer } = buildLayer(
      { ...show, groundWeapons: false },
      () => model,
      { weaponPads: [padFixture(RACK_AT)], mapWeaponPads: rackCross('rack') },
    )
    const read = () => (window as unknown as { __it3dPickups?: unknown }).__it3dPickups
    layer.update(15)
    expect(read()).toEqual([
      expect.objectContaining({ pad: 0, family: 'rack', weaponKey: '00000001', state: 'full', visible: true, drawn: 'model', modelLoaded: true }),
    ])
    layer.update(60)
    expect(read()).toEqual([expect.objectContaining({ state: 'empty', visible: false, drawn: null })])
    layer.dispose()
    expect(read()).toBeUndefined()
  })

  it('uses the published id of the ground weapon and reuses its copy', () => {
    const model = new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 0.2))
    const ids: string[] = []
    const { layer, root } = buildLayer({ ...show, weaponPads: false }, (id) => {
      ids.push(id)
      return model
    })
    layer.update(15)
    expect(ids).toEqual(['00000002'])
    const copy = root.children[2]
    expect(copy).toBeDefined()
    expect(new THREE.Box3().setFromObject(copy).min.y).toBeCloseTo(0)
    layer.update(16)
    expect(root.children[2]).toBe(copy)
    layer.update(60)
    expect(copy.visible).toBe(false)
    layer.dispose()
  })

  it('leaves the pools empty when the toggles are off', () => {
    const { layer, counts } = buildLayer({ ...show, weaponPads: false, groundWeapons: false })
    layer.update(15)
    expect(counts()).toEqual([0, 0])
    layer.dispose()
  })
})
