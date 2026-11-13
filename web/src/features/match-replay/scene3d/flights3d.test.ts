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

function calque(rank: number): { layer: Flights3dLayer; root: THREE.Group } {
  const root = new THREE.Group()
  const inputs = {
    framesPerSecond: 60,
    inks: {
      fx: { tint: { plasma_cool: 'blue', blast: 'orange', neutral: 'orange' }, core: 'blanc' },
      grenade: 'info',
    },
    aids: { projectilePaths: false, blastRadius: false },
  } as unknown as Action3dInputs
  const ctx: ActionContext = {
    doc: documentGrenade(rank) as unknown as ReplayDocumentReady,
    tracks: {} as Tracks3d,
    ground: { floorY: () => 0 } as unknown as Ground,
    ink: { of: (css: string | null | undefined) => ENCRE[css ?? ''] ?? new THREE.Color(1, 1, 1) } as unknown as InkCache,
    root,
    originAboveFloor: 0,
    inputs: () => inputs,
    playerFeet: () => null,
    slotState: () => null,
    weaponModel: () => null,
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
