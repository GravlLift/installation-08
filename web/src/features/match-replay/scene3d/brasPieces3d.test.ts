import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import nyexc from './testdata/nyexc-arms.json'
import { lierPiece, planBras, type BrasIndex, type BrasPiece } from './brasPieces3d'

function indexPieces(pieces: BrasPiece[], defaut: Record<string, string>): BrasIndex {
  return { schema: 2, skeleton: { bones: ['a', 'b'] }, pieces, default: defaut, failures: [] }
}

function piece(key: string, region: string, permutation: string): BrasPiece {
  return { key, region, permutation, file: `piece-${key}.glb`, triangles: 1, bbox: { min: [0,0,0], max: [1,1,1] }, bytes: 1 }
}

describe('planBras', () => {
  it('selects Nyexc’s live prosthetic arm pieces', () => {
    const pieces = planBras(nyexc.catalog, nyexc.player.regions)
    expect(pieces).toHaveLength(8)
    expect(pieces.map((p) => p.key)).toContain('3f91af6a-16a12dd4')
    expect(pieces.map((p) => p.key)).toContain('62059329-16a12dd4')
    expect(nyexc.player.regions.find((r) => r.region_key === '3f91af6a')?.source).toBe('prosthetic_left_arm')
  })

  it(`choisit la permutation du joueur quand la piece existe`, () => {
    const idx = indexPieces(
      [piece('r1-p1', 'r1', 'p1'), piece('r1-d', 'r1', 'd')],
      { r1: 'd' },
    )
    const regions = [{ region_key: 'r1', permutation_key: 'p1' }]
    const plan = planBras(idx, regions)
    expect(plan.map((p) => p.key)).toEqual(['r1-p1'])
  })

  it(`tombant sur la permutation par defaut quand celle du joueur n existe pas`, () => {
    const idx = indexPieces(
      [piece('r1-p1', 'r1', 'p1'), piece('r1-d', 'r1', 'd')],
      { r1: 'd' },
    )
    const regions = [{ region_key: 'r1', permutation_key: 'inconnue' }]
    const plan = planBras(idx, regions)
    expect(plan.map((p) => p.key)).toEqual(['r1-d'])
  })

  it(`saute une region quand ni la piece du joueur ni le defaut n existent`, () => {
    const idx = indexPieces(
      [piece('r2-d', 'r2', 'd')],
      { r1: 'x', r2: 'd' },
    )
    const regions = [{ region_key: 'r1', permutation_key: 'y' }]
    const plan = planBras(idx, regions)
    expect(plan.map((p) => p.region)).toEqual(['r2'])
  })

  it(`rend le jeu par defaut quand regions est null`, () => {
    const idx = indexPieces(
      [piece('r1-d', 'r1', 'd'), piece('r2-d', 'r2', 'd')],
      { r1: 'd', r2: 'd' },
    )
    const plan = planBras(idx, null)
    expect(plan.map((p) => p.key).sort()).toEqual(['r1-d', 'r2-d'])
  })

  it(`ignore les regions hors de l index`, () => {
    const idx = indexPieces(
      [piece('r1-d', 'r1', 'd')],
      { r1: 'd' },
    )
    const regions = [{ region_key: 'hors', permutation_key: 'x' }, { region_key: 'r1', permutation_key: 'p1' }]
    const plan = planBras(idx, regions)
    expect(plan.map((p) => p.region)).toEqual(['r1'])
  })
})

describe('lierPiece', () => {
  function pieceTest(boneNames: string[]): THREE.Object3D {
    const scene = new THREE.Group()
    const os = boneNames.map((n) => { const b = new THREE.Bone(); b.name = n; return b })
    scene.add(...os)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0,0,0, 1,0,0, 0,1,0]), 3))
    const mat = new THREE.MeshStandardMaterial()
    mat.userData.surfaceBrute = {}
    const mesh = new THREE.SkinnedMesh(geo, mat)
    const skel = new THREE.Skeleton(os)
    mesh.bind(skel)
    scene.add(mesh)
    return scene
  }

  function rigTest(boneNames: string[]): THREE.Object3D {
    const scene = new THREE.Group()
    for (const n of boneNames) { const b = new THREE.Bone(); b.name = n; scene.add(b) }
    return scene
  }

  it(`relient les os de la piece a ceux du rig dans lordre de la piece`, () => {
    const pieceScene = pieceTest(['a', 'b'])
    const rig = rigTest(['b', 'x', 'a'])
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = lierPiece(pieceScene, rig)
    expect(result).toHaveLength(1)
    const osRig = result[0].skeleton.bones
    expect(osRig[0].name).toBe('a')
    expect(osRig[1].name).toBe('b')
    expect(osRig[0]).toBe(rig.getObjectByName('a'))
    expect(osRig[1]).toBe(rig.getObjectByName('b'))
  })

  it(`sautent le maillage quand un os est manquant dans le rig`, () => {
    const pieceScene = pieceTest(['a', 'b'])
    const rig = rigTest(['x'])
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = lierPiece(pieceScene, rig)
    expect(result).toHaveLength(0)
  })
})
