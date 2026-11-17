// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { fixtureClips } from '../test/spartanClips'
import { spartanSkeleton } from '../test/spartanSkeleton'
import type { Dress } from './armory3d'
import { registerSpartanClips } from './clips3d'
import { Corpses3d, type Corpse } from './corpses3d'
import { fallSeconds } from './fall3d'
import type { RagdollBake } from './ragdollBake3d'

const RED = new THREE.Color(1, 0, 0)

function headOf(root: THREE.Object3D): THREE.Vector3 {
  root.updateMatrixWorld(true)
  return (root.getObjectByName('b_head') as THREE.Bone).getWorldPosition(new THREE.Vector3())
}

/** Le squelette du jeu et ses clips de test, rangés comme le fait le chargement du GLB. */
function animatedSource(): THREE.Group {
  const source = spartanSkeleton()
  registerSpartanClips(source, fixtureClips(source))
  return source
}

describe('Corpses3d', () => {
  const corpse: Corpse = { at: new THREE.Vector3(2, 1, 3), dir: new THREE.Vector3(0, 0, -1), h: 0, kind: 'shot' }

  it('prépare une copie cachée et la ressert à la première mort', () => {
    const parent = new THREE.Group()
    const pool = new Corpses3d(parent)
    pool.begin(animatedSource())
    const prepared = pool.prepare('red', RED, null)
    expect(prepared?.visible).toBe(false)
    expect(pool.prepare('red', RED, null)).toBe(prepared)
    pool.add(corpse, 0, RED, 'red')
    expect(parent.children).toEqual([prepared])
    expect(prepared?.visible).toBe(true)
    pool.dispose()
  })

  it('le corps debout à la mort finit couché par l’arrivée au sol du jeu, tête le long de l’impulsion', () => {
    const parent = new THREE.Group()
    const pool = new Corpses3d(parent)
    const source = animatedSource()
    pool.begin(source)
    pool.add(corpse, 0, RED, 'red')
    pool.end()
    const upright = headOf(parent)
    expect(upright.y - corpse.at.y).toBeGreaterThan(0.5)
    pool.begin(source)
    pool.add(corpse, fallSeconds('shot') + 1, RED, 'red')
    pool.end()
    const flat = headOf(parent)
    expect(flat.y - corpse.at.y).toBeLessThan(0.15)
    expect(corpse.at.z - flat.z).toBeGreaterThan(0.15)
    expect(Math.abs(flat.x - corpse.at.x)).toBeLessThan(0.1)
  })

  it('resert ses copies, cache celles qu’aucune mort ne prend, libère tout avec une nouvelle source', () => {
    const parent = new THREE.Group()
    const pool = new Corpses3d(parent)
    const source = animatedSource()
    pool.begin(source)
    pool.add(corpse, 0.2, RED, 'red')
    pool.add(corpse, 0.3, RED, 'red')
    pool.end()
    expect(parent.children).toHaveLength(2)
    pool.begin(source)
    pool.add(corpse, 0.2, RED, 'red')
    pool.end()
    expect(parent.children).toHaveLength(2)
    expect(parent.children.filter((c) => c.visible)).toHaveLength(1)
    pool.begin(spartanSkeleton())
    expect(parent.children).toHaveLength(0)
    pool.begin(null)
    pool.add(corpse, 0.2, RED, 'red')
    expect(parent.children).toHaveLength(0)
    pool.dispose()
  })

  describe('habit de la victime', () => {
    it.each([
      ['la chute par les clips', null],
      ['la cuisson', idleBake()],
    ])('par %s : la copie en armure par défaut cède la place à l’habit arrivé, libérée sans toucher aux géométries', (_, bake) => {
      const { source, armor } = skinnedSource()
      const dress = dressFor(source)
      const parent = new THREE.Group()
      const pool = new Corpses3d(parent)
      const frame = (d: Dress | null) => {
        pool.begin(source)
        pool.add(corpse, 0.2, RED, 'red|v', d, bake)
        pool.end()
      }
      frame(null)
      const before = only(parent)
      expect(geometriesOf(before)).toEqual([armor])
      const released = watchRelease(before)
      const shared = watchGeometry(armor, dress.outfit.skinned[0].geometry)

      frame(dress)
      const after = only(parent)
      expect(after).not.toBe(before)
      expect(before.parent).toBeNull()
      expect(geometriesOf(after)).toEqual([dress.outfit.skinned[0].geometry])
      expect(released.materials()).toBe(true)
      expect(released.skeleton).toHaveBeenCalledTimes(1)

      // Même habit à l'image suivante : la même copie, rien de refait ni de libéré.
      frame(dress)
      expect(only(parent)).toBe(after)
      expect(released.skeleton).toHaveBeenCalledTimes(1)
      expect(shared).not.toHaveBeenCalled()
      pool.dispose()
    })

    it('aucun corps d’une même victime ne sert l’ancien habit : les copies périmées glissées à la place sont libérées aussi', () => {
      const { source } = skinnedSource()
      const dress = dressFor(source)
      const parent = new THREE.Group()
      const pool = new Corpses3d(parent)
      pool.begin(source)
      pool.add(corpse, 0.2, RED, 'red|v')
      pool.add(corpse, 0.4, RED, 'red|v')
      pool.end()
      const [a, b] = parent.children
      pool.begin(source)
      pool.add(corpse, 0.2, RED, 'red|v', dress)
      pool.end()
      // La copie périmée suivante glisse à la place de la première : elle ne sert pas, elle est libérée.
      expect(a.parent).toBeNull()
      expect(b.parent).toBeNull()
      expect(geometriesOf(only(parent))).toEqual([dress.outfit.skinned[0].geometry])
      pool.begin(source)
      pool.add(corpse, 0.2, RED, 'red|v', dress)
      pool.add(corpse, 0.4, RED, 'red|v', dress)
      pool.end()
      expect(parent.children).toHaveLength(2)
      for (const c of parent.children) expect(geometriesOf(c)).toEqual([dress.outfit.skinned[0].geometry])
      pool.dispose()
    })
  })
})

/**
 * skinnedSource : le Spartan de test (os et clips du jeu) portant une armure par défaut à peau, liée
 * à un squelette de tous ses os ; `armor` est sa géométrie, partagée par chaque copie.
 */
function skinnedSource(): { source: THREE.Group; armor: THREE.BufferGeometry } {
  const source = animatedSource()
  const bones: THREE.Bone[] = []
  source.traverse((o) => o instanceof THREE.Bone && bones.push(o))
  const armor = new THREE.BoxGeometry()
  const mesh = new THREE.SkinnedMesh(armor, new THREE.MeshStandardMaterial())
  source.add(mesh)
  mesh.bind(new THREE.Skeleton(bones))
  return { source, armor }
}

/** dressFor : un habit d'une pièce à peau sur les os de `source`, sans peinture. */
function dressFor(source: THREE.Object3D): Dress {
  const bones: string[] = []
  source.traverse((o) => o instanceof THREE.Bone && bones.push(o.name))
  const piece = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
  return { outfit: { bones, skinned: [piece], rigid: [], issues: [] }, coat: new Map() }
}

/** idleBake : une cuisson qui ne conduit aucun os (seules sa place et son lacet comptent ici). */
function idleBake(): RagdollBake {
  return {
    names: [], base: new Float32Array(0), index: new Int16Array(64).fill(-1), count: 1, rot: new Int16Array(0),
    pelvis: new Float32Array(3), feet: new THREE.Vector3(2, 1, 3), yaw: 0.5, seconds: 1, rested: true,
    stats: { ms: 0, patches: 0, triangles: 0 },
  }
}

function only(parent: THREE.Object3D): THREE.Object3D {
  expect(parent.children).toHaveLength(1)
  return parent.children[0]
}

function geometriesOf(holder: THREE.Object3D): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = []
  holder.traverse((o) => o instanceof THREE.Mesh && out.push(o.geometry))
  return out
}

/** watchRelease suit la libération des matériaux et du squelette de la copie que porte `holder`. */
function watchRelease(holder: THREE.Object3D): { materials: () => boolean; skeleton: ReturnType<typeof vi.fn> } {
  const disposed = new Set<THREE.Material>()
  const materials = new Set<THREE.Material>()
  let skeleton: THREE.Skeleton | null = null
  holder.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh)) return
    const m = o.material as THREE.Material
    materials.add(m)
    m.addEventListener('dispose', () => disposed.add(m))
    skeleton = o.skeleton
  })
  const spy = vi.fn()
  if (skeleton) (skeleton as THREE.Skeleton).dispose = spy
  return { materials: () => materials.size > 0 && [...materials].every((m) => disposed.has(m)), skeleton: spy }
}

/** watchGeometry : un témoin appelé si l'une des géométries partagées est libérée. */
function watchGeometry(...geometries: THREE.BufferGeometry[]): ReturnType<typeof vi.fn> {
  const spy = vi.fn()
  for (const g of geometries) g.addEventListener('dispose', spy)
  return spy
}
