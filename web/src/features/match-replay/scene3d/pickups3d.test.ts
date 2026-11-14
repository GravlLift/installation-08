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
  padMountOf,
  padOutOfBounds,
  pickupFamilyOf,
  Pickups3dLayer,
  prepareWeaponPads,
  shownGroundWeapons,
  type GroundSources,
} from './pickups3d'
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
  type SurDoc = { weaponPads?: ReplayWeaponPadReady[] }
  function calque(
    montrer: Action3dShow,
    weaponModel: ActionContext['weaponModel'] = () => null,
    surDoc: SurDoc = {},
    sol: Pick<Ground, 'floorY'> = SOL_PLAT,
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
      ink: { of: () => new THREE.Color() } as unknown as InkCache,
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
