// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import nyexc from './testdata/nyexc-arms.json'

import { type BrasIndex, type BrasPieces3d } from './brasPieces3d'
import type { SpartanArmory } from './armory3d'
import { HabillageRig3d } from './habillageRig3d'

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

/** A rig's root: a bone (bind target) and the default arm mesh (arm material). */
function rigRoot(boneName = 'b_bracelette'): { root: THREE.Group; builtin: THREE.Mesh } {
  const bone = new THREE.Bone()
  bone.name = boneName
  const armMaterial = new THREE.MeshStandardMaterial()
  armMaterial.userData.surfaceBrute = {}
  const builtin = new THREE.Mesh(new THREE.BoxGeometry(), armMaterial)
  const root = new THREE.Group()
  root.add(bone)
  root.add(builtin)
  return { root, builtin }
}

/** A piece's scene: a skinned mesh bound to a bone of the same name as the rig's. */
function pieceScene(boneName: string): THREE.Object3D {
  const bone = new THREE.Bone()
  bone.name = boneName
  const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
  mesh.bind(new THREE.Skeleton([bone]))
  const scene = new THREE.Group()
  scene.add(bone)
  scene.add(mesh)
  return scene
}

/** The catalog: one region, one piece (default permutation). */
function pieceIndex(): BrasIndex {
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

function makeDressing(
  loader: { piece: (fichier: string) => Promise<THREE.Object3D | null> },
  invaliderPeinture: () => void,
): HabillageRig3d {
  const armory = { regions: () => null } as unknown as SpartanArmory
  return new HabillageRig3d({
    indexPieces: Promise.resolve(pieceIndex()),
    chargeur: loader as unknown as BrasPieces3d,
    signal: new AbortController().signal,
    xuid: () => '1',
    armurerie: () => armory,
    materiauSource: (m) => m,
    invaliderPeinture,
  })
}

function piecesOf(root: THREE.Object3D): THREE.SkinnedMesh[] {
  return root.children.filter((c): c is THREE.SkinnedMesh => c instanceof THREE.SkinnedMesh)
}

describe('HabillageRig3d', () => {
  it('dresses a rig with the selected Nyexc arm pieces', async () => {
    const { root, builtin } = rigRoot('b_l_forearm')
    const loader = { piece: vi.fn(async () => pieceScene('b_l_forearm')) }
    const armory = { regions: () => nyexc.player.regions } as unknown as SpartanArmory
    const dressing = new HabillageRig3d({
      indexPieces: Promise.resolve(nyexc.catalog),
      chargeur: loader as unknown as BrasPieces3d,
      signal: new AbortController().signal,
      xuid: () => nyexc.player.xuid,
      armurerie: () => armory,
      materiauSource: (m) => m,
      invaliderPeinture: vi.fn(),
    })
    dressing.actualiser('rig', root)
    await tick()
    expect(loader.piece).toHaveBeenCalledWith('piece-3f91af6a-16a12dd4.glb')
    expect(piecesOf(root)).toHaveLength(8)
    expect(builtin.visible).toBe(false)
    dressing.changerJoueur()
  })

  it('keeps two rigs their own pieces until the player changes', async () => {
    const a = rigRoot(), b = rigRoot()
    const scene = pieceScene('b_bracelette')
    const loader = { piece: vi.fn(() => Promise.resolve(scene)) }
    const dressing = makeDressing(loader, () => {})
    dressing.actualiser('a', a.root)
    await tick()
    const piece = piecesOf(a.root)[0]
    const dispose = vi.spyOn(piece.skeleton, 'dispose')
    dressing.actualiser('b', b.root)
    await tick()
    expect(piecesOf(a.root)).toEqual([piece])
    expect(dispose).not.toHaveBeenCalled()
    expect(piecesOf(b.root)[0].geometry).toBe(piece.geometry)
    dressing.actualiser('a', a.root)
    expect(loader.piece).toHaveBeenCalledTimes(2)
    dressing.changerJoueur()
    expect(piecesOf(a.root)).toHaveLength(0)
    expect(piecesOf(b.root)).toHaveLength(0)
    expect(a.builtin.visible && b.builtin.visible).toBe(true)
  })
  it('places the piece on its arrival, invalidates the paint, and hides the default arm', async () => {
    const { root, builtin } = rigRoot()
    const loader = { piece: vi.fn(() => Promise.resolve(pieceScene('b_bracelette'))) }
    const invalidate = vi.fn()
    const dressing = makeDressing(loader, invalidate)
    dressing.actualiser('rig1', root)
    expect(dressing.enCours()).toBe(true)
    await tick()
    expect(dressing.enCours()).toBe(false)
    expect(piecesOf(root)).toHaveLength(1)
    expect(builtin.visible).toBe(false)
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it('re-places nothing while the key (rig, player, manifest) stays the same', async () => {
    const { root } = rigRoot()
    const loader = { piece: vi.fn(() => Promise.resolve(pieceScene('b_bracelette'))) }
    const dressing = makeDressing(loader, () => {})
    dressing.actualiser('rig1', root)
    await tick()
    dressing.actualiser('rig1', root)
    expect(loader.piece).toHaveBeenCalledTimes(1)
    expect(piecesOf(root)).toHaveLength(1)
  })

  it('abandons a late load when the player changes', async () => {
    const { root } = rigRoot()
    let resolvePiece!: (scene: THREE.Object3D) => void
    const pendingPiece = new Promise<THREE.Object3D>((r) => { resolvePiece = r })
    const loader = { piece: vi.fn(() => pendingPiece) }
    const invalidate = vi.fn()
    const dressing = makeDressing(loader, invalidate)
    dressing.actualiser('rig1', root)
    await tick()
    dressing.changerJoueur()
    resolvePiece(pieceScene('b_bracelette'))
    await tick()
    expect(dressing.enCours()).toBe(false)
    expect(piecesOf(root)).toHaveLength(0)
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('loads two rigs independently', async () => {
    const { root } = rigRoot()
    const other = rigRoot().root
    let resolvePrevious!: (scene: THREE.Object3D) => void
    let calls = 0
    const loader = {
      piece: vi.fn(() => {
        calls++
        if (calls === 1) return new Promise<THREE.Object3D>((r) => { resolvePrevious = r })
        return Promise.resolve(pieceScene('b_bracelette'))
      }),
    }
    const invalidate = vi.fn()
    const dressing = makeDressing(loader, invalidate)
    // The catalog carries only one piece: the first rig waits for it, the second gets the same one.
    dressing.actualiser('rigA', root)
    await tick()
    dressing.actualiser('rigB', other)
    await tick()
    resolvePrevious(pieceScene('b_bracelette'))
    await tick()
    expect(dressing.enCours()).toBe(false)
    expect(piecesOf(root)).toHaveLength(1)
    expect(piecesOf(other)).toHaveLength(1)
    expect(invalidate).toHaveBeenCalledTimes(2)
  })
})
