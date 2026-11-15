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

import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import type { Action3dInputs } from './action3dInputs'
import type { Ground, InkCache } from './actionKit'
import { Flights3dLayer } from './flights3d'
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