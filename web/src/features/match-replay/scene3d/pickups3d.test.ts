/**
 * Tests — pickups3d : LES SOCLES ET LES ARMES AU SOL DE LA 3D SUIVENT LES RÈGLES DE LA 2D.
 *
 * CE QUE CE FICHIER VERROUILLE :
 *  - la préparation des socles passe par le croisement avec la carte ;
 *  - la nature d'une arme se lit sous sa clé normalisée, socle comme sol ;
 *  - les filtres du tiroir (spéciales seulement, armes de départ) sont ceux de la 2D ;
 *  - plein = boîte pleine, incertain = boîte fantôme, vide = disque seul ;
 *  - une arme au sol en disparition non datée passe au lot fantôme, puis disparaît ;
 *  - le recalage au sol ne déplace pas un râtelier mural ;
 *  - un socle est MURAL quand il surplombe le sol de plus de 0,25 u : il n'a ni disque ni socle ;
 *  - un socle hors des bornes de la carte (marge de 5 u) n'est pas dessiné ;
 *  - interrupteur éteint : les lots restent vides.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import type { ReplayGroundWeapon } from '@/lib/api/types'
import type { ReplayDocumentReady, ReplayWeaponPadReady } from '@/lib/replay/replayNormalize'

import type { Action3dInputs, Action3dShow } from './action3dInputs'
import type { Ground, InkCache } from './actionKit'
import type { ActionContext } from './actionScene3d'
import { FlashLights } from './flash3d'
import {
  floorUnder,
  groundBoxLook,
  padBoxLook,
  padItemCentered,
  padMountOf,
  padOutOfBounds,
  pickupFamilyOf,
  Pickups3dLayer,
  prepareWeaponPads,
  rackMountsOf,
  rackWeaponRotation,
  shownGroundWeapons,
  type GroundSources,
} from './pickups3d'
import { standingItemCorrection } from './groundWeaponPose3d'
import type { Tracks3d } from './tracks3d'

const SNIPER = '0x00000001'
const FUSIL = '0x00000002'

const LABELS = {
  [SNIPER]: { fr: 'Sniper', en: 'Sniper', key: 'hinf_s7_sniper', role: 'sniper' },
  [FUSIL]: { fr: 'Fusil', en: 'Rifle', key: 'hinf_ma40', role: 'rifle' },
} as ReplayDocumentReady['weaponLabels']

/** Un socle : plein de 10 à 20, incertain de 20 à 30, vide ensuite. */
function socle(over: Partial<ReplayWeaponPadReady> = {}): ReplayWeaponPadReady {
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

function arme(over: Partial<ReplayGroundWeapon> = {}): ReplayGroundWeapon {
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

/** Un sol plat à z = 0 sous tout point. */
const SOL_PLAT: Pick<Ground, 'floorY'> = { floorY: () => 0 }

describe('prepareWeaponPads', () => {
  it('pose le socle à l’emplacement de la carte quand le serveur les a croisés', () => {
    const [pad] = prepareWeaponPads({
      weaponPads: [socle()],
      mapWeaponPads: { catalogN: 1, pads: [{ pad: 0, family: SNIPER, x: 7, y: 8, z: 9 }] },
      padPickups: [],
      tracks: [],
    })
    expect([pad.x, pad.y, pad.z]).toEqual([7, 8, 9])
    expect(pad.presence).toEqual(socle().presence)
  })
})

describe('pickupFamilyOf', () => {
  it('lit la clé d’un socle et celle d’une arme au sol écrite en minuscules', () => {
    expect(pickupFamilyOf(SNIPER, LABELS)).toBe('power')
    expect(pickupFamilyOf('00000001', LABELS)).toBe('power')
    expect(pickupFamilyOf(FUSIL, LABELS)).toBe('classic')
    expect(pickupFamilyOf('powerup_overshield', LABELS)).toBe('powerup')
    expect(pickupFamilyOf('0xDEADBEEF', undefined)).toBe('classic')
  })
})

describe('shownGroundWeapons', () => {
  const sniperAuSol = arme({ w: '00000001' })
  const fusilDeDepart = arme({ w: '00000002' })
  const fusilDeCarte = arme({ w: '00000002', origin: 'spawned' })
  const doc: GroundSources = {
    groundWeapons: [sniperAuSol, fusilDeDepart, fusilDeCarte],
    weaponLabels: LABELS,
    loadouts: [{ src: 'birth', w: [FUSIL] }] as ReplayDocumentReady['loadouts'],
  }

  it('masque par défaut les armes de départ lâchées, jamais celles de la carte', () => {
    expect(shownGroundWeapons(doc, false, false)).toEqual([sniperAuSol, fusilDeCarte])
    expect(shownGroundWeapons(doc, false, true)).toEqual([sniperAuSol, fusilDeDepart, fusilDeCarte])
  })

  it('ne garde que les armes spéciales quand le filtre est allumé', () => {
    expect(shownGroundWeapons(doc, true, true)).toEqual([sniperAuSol])
  })
})

describe('padBoxLook et groundBoxLook', () => {
  it('plein, incertain, vide', () => {
    expect(padBoxLook('full')).toBe('solid')
    expect(padBoxLook('uncertain')).toBe('ghost')
    expect(padBoxLook('empty')).toBeNull()
  })

  it('une arme au sol : rien, pleine, fantôme, rien', () => {
    expect(groundBoxLook(arme(), 9)).toBeNull()
    expect(groundBoxLook(arme(), 40)).toBe('solid')
    expect(groundBoxLook(arme(), 45)).toBe('ghost')
    expect(groundBoxLook(arme(), 51)).toBeNull()
  })
})

describe('floorUnder', () => {
  it('cherche le sol sous le plafond sans z publié', () => {
    expect(floorUnder(SOL_PLAT, 0, 0, undefined)).toBe(0)
  })

  it('recale un objet proche du sol, garde le z d’un râtelier mural', () => {
    expect(floorUnder(SOL_PLAT, 0, 0, 0.1)).toBe(0)
    expect(floorUnder(SOL_PLAT, 0, 0, 1.5)).toBe(1.5)
  })
})

describe('padMountOf', () => {
  it('monte un socle qui surplombe le sol de plus de 0,25 u, laisse le reste au sol', () => {
    // Les quatre socles de la salle de Recharge, avec la hauteur de sol lue sous chacun.
    expect(padMountOf(4.936, 4.4)).toBe('mounted') // râtelier mural, 0,54 u au-dessus du sol
    expect(padMountOf(0.0076, 0.0)).toBe('floor') // power-up posé au sol
    expect(padMountOf(4.494, 4.4)).toBe('floor') // 0,09 u au-dessus du sol : socle au sol
    expect(padMountOf(2.769, 2.2)).toBe('mounted') // 0,57 u au-dessus du sol : râtelier mural
  })

  it('traite au sol un socle sans z publié ni sol connu', () => {
    expect(padMountOf(undefined, 4.4)).toBe('floor')
    expect(padMountOf(4.936, null)).toBe('floor')
  })
})

describe('padOutOfBounds', () => {
  const bornes = { minX: 0, maxX: 40, minY: 0, maxY: 40 }

  it('exclut un socle hors de la marge de la carte, garde celui dedans', () => {
    expect(padOutOfBounds(bornes, -240.3, 381.8)).toBe(true) // loin hors de la carte
    expect(padOutOfBounds(bornes, 13.537, 1.526)).toBe(false) // dans la salle
  })

  it('n’exclut rien sans bornes', () => {
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

  it('stands the weapon muzzle up with its side facing out along the rack forward', () => {
    // Game forward -Y is three +Z (toThree(x, y, z) = [x, z, -y]).
    const q = rackWeaponRotation({ forward: [0, -1, 0], up: [0, 0, 1] })
    expect(axis(q, 1, 0, 0).distanceTo(new THREE.Vector3(0, 1, 0))).toBeCloseTo(0)
    expect(axis(q, 0, 0, 1).distanceTo(new THREE.Vector3(0, 0, 1))).toBeCloseTo(0)
  })

  it('follows a diagonal rack and squares a tilted forward against up', () => {
    const q = rackWeaponRotation({ forward: [0.71, -0.71, 0.2], up: [0, 0, 1] })
    const side = axis(q, 0, 0, 1)
    expect(side.y).toBeCloseTo(0)
    expect(side.distanceTo(new THREE.Vector3(1, 0, 1).normalize())).toBeCloseTo(0)
  })

  it('stays upright facing +X without published axes', () => {
    const q = rackWeaponRotation({ forward: undefined, up: null })
    expect(axis(q, 1, 0, 0).distanceTo(new THREE.Vector3(0, 1, 0))).toBeCloseTo(0)
    expect(axis(q, 0, 0, 1).distanceTo(new THREE.Vector3(1, 0, 0))).toBeCloseTo(0)
  })
})

describe('padItemCentered', () => {
  it('centers an item named by equipment family, never a weapon', () => {
    for (const family of ['wall', 'grapple', 'sensor', 'thruster', 'repulsor', 'powerup_camo']) {
      expect(padItemCentered(family)).toBe(true)
    }
    expect(padItemCentered(SNIPER)).toBe(false)
    expect(padItemCentered('00000002')).toBe(false)
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

  /** Le sol par défaut est plat ; un test passe le sien pour placer un râtelier mural. */
  type SurDoc = { weaponPads?: ReplayWeaponPadReady[]; mapWeaponPads?: ReplayDocumentReady['mapWeaponPads'] }
  function calque(
    montrer: Action3dShow,
    weaponModel: ActionContext['weaponModel'] = () => null,
    surDoc: SurDoc = {},
    sol: Pick<Ground, 'floorY'> = SOL_PLAT,
    encre: THREE.Color = new THREE.Color(0xff8c1a),
  ): { layer: Pickups3dLayer; counts: () => number[]; root: THREE.Group } {
    const root = new THREE.Group()
    const doc = {
      weaponPads: [socle()],
      mapWeaponPads: undefined,
      padPickups: [],
      tracks: [],
      groundWeapons: [arme()],
      weaponLabels: LABELS,
      loadouts: [],
      ...surDoc,
    } as unknown as ReplayDocumentReady
    const inputs = {
      show: montrer,
      inks: { pad: { powerup: 'a', power: 'b', classic: 'c' } },
    } as unknown as Action3dInputs
    const ctx: ActionContext = {
      doc,
      tracks: {} as Tracks3d,
      ground: sol as Ground,
      ink: { of: () => encre } as unknown as InkCache,
      root,
      originAboveFloor: 0,
      inputs: () => inputs,
      playerFeet: () => null,
      slotState: () => null,
      weaponModel,
      flagModel: () => null,
      grenadeModel: () => null,
      spartanModel: () => null,
      dressOf: () => null,
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
    const { layer, counts, root } = calque(show)
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
    const { layer, counts, root } = calque(
      show,
      () => new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 0.2)),
      { weaponPads: [socle({ x: 13.537, y: 1.526, z: 4.936 })] },
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

  it('hangs a rack weapon still on the front of the rack, upright, by the pad state', () => {
    const model = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.02))
    const { layer, counts, root } = calque(
      { ...show, groundWeapons: false },
      () => model,
      { weaponPads: [socle(RACK_AT)], mapWeaponPads: rackCross('rack') },
      { floorY: () => 4.7 },
    )
    layer.update(15)
    const copie = root.children[2]
    expect(copie).toBeDefined()
    const pose = { p: copie.position.clone(), q: copie.quaternion.clone() }
    // At the spawner's height, not lifted off the floor under the rack; out in front of the shut
    // doors (+0.068 u) along the rack forward (game -Y, three +Z): its back 0.073 u out, and its
    // origin half its 0.02 u thickness further.
    const spawner = new THREE.Vector3(RACK_AT.x, RACK_AT.z, -RACK_AT.y)
    expect(pose.p.distanceTo(spawner.clone().add(new THREE.Vector3(0, 0, 0.073 + 0.01)))).toBeCloseTo(0, 5)
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
    const { layer, root } = calque(
      { ...show, groundWeapons: false },
      () => model,
      { weaponPads: [socle(RACK_AT)], mapWeaponPads: rackCross('power') },
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
    const { layer, root } = calque(
      { ...show, groundWeapons: false },
      () => model,
      { weaponPads: [socle(RACK_AT)], mapWeaponPads: rackCross('power') },
      { floorY: () => RACK_AT.z - 4 },
    )
    layer.update(15)
    const copie = root.children[2]
    expect(copie.position.y).toBeCloseTo(RACK_AT.z + 0.28 + 0.04)
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
    const { layer, counts, root } = calque(
      { ...show, groundWeapons: false },
      (id) => {
        ids.push(id)
        return id === 'repulsor' ? model : null
      },
      { weaponPads: [socle({ weapon: 'repulsor', x: 6.815, y: 35.867, z: -0.995 })], mapWeaponPads: equipmentCross },
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
    const { layer, root } = calque(
      { ...show, groundWeapons: false },
      (id) => (id === 'wall' ? model : null),
      { weaponPads: [socle({ weapon: 'wall', x: 6.815, y: 35.867, z: -0.995 })], mapWeaponPads: equipmentCross },
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
    const { layer, root } = calque(
      { ...show, groundWeapons: false },
      () => model,
      { weaponPads: [socle({ weapon: 'repulsor', x: 6.815, y: 35.867, z: -0.995 })], mapWeaponPads: equipmentCross },
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
    const { layer, root } = calque(
      { ...show, groundWeapons: false },
      () => model,
      {
        weaponPads: [socle({ weapon: 'repulsor', x: 6.815, y: 35.867, z: -0.995 }), socle(RACK_AT)],
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

  it('answers window.__it3dPickups with what each pad drew, until disposed', () => {
    const model = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.02))
    const { layer } = calque(
      { ...show, groundWeapons: false },
      () => model,
      { weaponPads: [socle(RACK_AT)], mapWeaponPads: rackCross('rack') },
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

  it('utilise l’identifiant publié de l’arme au sol et réutilise sa copie', () => {
    const model = new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 0.2))
    const ids: string[] = []
    const { layer, root } = calque({ ...show, weaponPads: false }, (id) => {
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

  it('laisse les lots vides quand les interrupteurs sont éteints', () => {
    const { layer, counts } = calque({ ...show, weaponPads: false, groundWeapons: false })
    layer.update(15)
    expect(counts()).toEqual([0, 0])
    layer.dispose()
  })
})
