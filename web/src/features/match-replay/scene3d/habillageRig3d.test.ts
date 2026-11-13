import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import nyexc from './testdata/nyexc-arms.json'

import { type BrasIndex, type BrasPieces3d } from './brasPieces3d'
import type { SpartanArmory } from './armory3d'
import { HabillageRig3d } from './habillageRig3d'

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

/** La racine d'un rig : un os (cible de liaison) et le maillage de bras embarqué (matériau de bras). */
function rigRacine(osName = 'b_bracelette'): { root: THREE.Group; integre: THREE.Mesh } {
  const os = new THREE.Bone()
  os.name = osName
  const materiauBras = new THREE.MeshStandardMaterial()
  materiauBras.userData.surfaceBrute = {}
  const integre = new THREE.Mesh(new THREE.BoxGeometry(), materiauBras)
  const root = new THREE.Group()
  root.add(os)
  root.add(integre)
  return { root, integre }
}

/** La scène d'une pièce : un maillage à peau lié à un os du même nom que celui du rig. */
function scenePiece(osName: string): THREE.Object3D {
  const os = new THREE.Bone()
  os.name = osName
  const maillage = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
  maillage.bind(new THREE.Skeleton([os]))
  const scene = new THREE.Group()
  scene.add(os)
  scene.add(maillage)
  return scene
}

/** Le catalogue : une région, une pièce (permutation par défaut). */
function indexPiece(): BrasIndex {
  return {
    schema: 1,
    skeleton: { bones: ['b_bracelette'] },
    pieces: [{
      key: 'aaaaaaaa-11111111', region: 'aaaaaaaa', permutation: '11111111', file: 'piece.glb',
      triangles: 1, bbox: { min: [0, 0, 0], max: [1, 1, 1] }, bytes: 1,
    }],
    default: { aaaaaaaa: '11111111' },
    failures: [],
  }
}

function habillageDe(
  chargeur: { piece: (fichier: string) => Promise<THREE.Object3D | null> },
  invaliderPeinture: () => void,
): HabillageRig3d {
  const armurerie = { regions: () => null } as unknown as SpartanArmory
  return new HabillageRig3d({
    indexPieces: Promise.resolve(indexPiece()),
    chargeur: chargeur as unknown as BrasPieces3d,
    signal: new AbortController().signal,
    xuid: () => '1',
    armurerie: () => armurerie,
    materiauSource: (m) => m,
    invaliderPeinture,
  })
}

function piecesDe(root: THREE.Object3D): THREE.SkinnedMesh[] {
  return root.children.filter((c): c is THREE.SkinnedMesh => c instanceof THREE.SkinnedMesh)
}

describe('HabillageRig3d', () => {
  it('dresses a rig with the selected Nyexc arm pieces', async () => {
    const { root, integre } = rigRacine('b_l_forearm')
    const chargeur = { piece: vi.fn(async () => scenePiece('b_l_forearm')) }
    const armory = { regions: () => nyexc.player.regions } as unknown as SpartanArmory
    const habillage = new HabillageRig3d({
      indexPieces: Promise.resolve(nyexc.catalog),
      chargeur: chargeur as unknown as BrasPieces3d,
      signal: new AbortController().signal,
      xuid: () => nyexc.player.xuid,
      armurerie: () => armory,
      materiauSource: (m) => m,
      invaliderPeinture: vi.fn(),
    })
    habillage.actualiser('rig', root)
    await tick()
    expect(chargeur.piece).toHaveBeenCalledWith('piece-3f91af6a-16a12dd4.glb')
    expect(piecesDe(root)).toHaveLength(8)
    expect(integre.visible).toBe(false)
    habillage.changerJoueur()
  })

  it('conserve les pièces de deux rigs jusqu’au changement de joueur', async () => {
    const a = rigRacine(), b = rigRacine()
    const scene = scenePiece('b_bracelette')
    const chargeur = { piece: vi.fn(() => Promise.resolve(scene)) }
    const habillage = habillageDe(chargeur, () => {})
    habillage.actualiser('a', a.root)
    await tick()
    const piece = piecesDe(a.root)[0]
    const dispose = vi.spyOn(piece.skeleton, 'dispose')
    habillage.actualiser('b', b.root)
    await tick()
    expect(piecesDe(a.root)).toEqual([piece])
    expect(dispose).not.toHaveBeenCalled()
    expect(piecesDe(b.root)[0].geometry).toBe(piece.geometry)
    habillage.actualiser('a', a.root)
    expect(chargeur.piece).toHaveBeenCalledTimes(2)
    habillage.changerJoueur()
    expect(piecesDe(a.root)).toHaveLength(0)
    expect(piecesDe(b.root)).toHaveLength(0)
    expect(a.integre.visible && b.integre.visible).toBe(true)
  })
  it('pose la pièce à son arrivée, invalide la peinture et cache le bras embarqué', async () => {
    const { root, integre } = rigRacine()
    const chargeur = { piece: vi.fn(() => Promise.resolve(scenePiece('b_bracelette'))) }
    const invalider = vi.fn()
    const habillage = habillageDe(chargeur, invalider)
    habillage.actualiser('rig1', root)
    expect(habillage.enCours()).toBe(true)
    await tick()
    expect(habillage.enCours()).toBe(false)
    expect(piecesDe(root)).toHaveLength(1)
    expect(integre.visible).toBe(false)
    expect(invalider).toHaveBeenCalledTimes(1)
  })

  it('ne repose rien tant que la clé (rig, joueur, manifeste) est la même', async () => {
    const { root } = rigRacine()
    const chargeur = { piece: vi.fn(() => Promise.resolve(scenePiece('b_bracelette'))) }
    const habillage = habillageDe(chargeur, () => {})
    habillage.actualiser('rig1', root)
    await tick()
    habillage.actualiser('rig1', root)
    expect(chargeur.piece).toHaveBeenCalledTimes(1)
    expect(piecesDe(root)).toHaveLength(1)
  })

  it('abandonne la charge en retard quand le joueur change', async () => {
    const { root } = rigRacine()
    let resoudrePiece!: (scene: THREE.Object3D) => void
    const pieceEnAttente = new Promise<THREE.Object3D>((r) => { resoudrePiece = r })
    const chargeur = { piece: vi.fn(() => pieceEnAttente) }
    const invalider = vi.fn()
    const habillage = habillageDe(chargeur, invalider)
    habillage.actualiser('rig1', root)
    await tick()
    habillage.changerJoueur()
    resoudrePiece(scenePiece('b_bracelette'))
    await tick()
    expect(habillage.enCours()).toBe(false)
    expect(piecesDe(root)).toHaveLength(0)
    expect(invalider).not.toHaveBeenCalled()
  })

  it('charge deux rigs indépendamment', async () => {
    const { root } = rigRacine()
    const autre = rigRacine().root
    let resoudrePrecédent!: (scene: THREE.Object3D) => void
    let appels = 0
    const chargeur = {
      piece: vi.fn(() => {
        appels++
        if (appels === 1) return new Promise<THREE.Object3D>((r) => { resoudrePrecédent = r })
        return Promise.resolve(scenePiece('b_bracelette'))
      }),
    }
    const invalider = vi.fn()
    const habillage = habillageDe(chargeur, invalider)
    // Le catalogue ne porte qu'une pièce : le premier rig l'attend, le second reçoit la même.
    habillage.actualiser('rigA', root)
    await tick()
    habillage.actualiser('rigB', autre)
    await tick()
    resoudrePrecédent(scenePiece('b_bracelette'))
    await tick()
    expect(habillage.enCours()).toBe(false)
    expect(piecesDe(root)).toHaveLength(1)
    expect(piecesDe(autre)).toHaveLength(1)
    expect(invalider).toHaveBeenCalledTimes(2)
  })
})
