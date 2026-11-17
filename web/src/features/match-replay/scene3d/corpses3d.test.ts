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

/** The game's skeleton and its test clips, set up the way the GLB load does. */
function animatedSource(): THREE.Group {
  const source = spartanSkeleton()
  registerSpartanClips(source, fixtureClips(source))
  return source
}

describe('Corpses3d', () => {
  const corpse: Corpse = { at: new THREE.Vector3(2, 1, 3), dir: new THREE.Vector3(0, 0, -1), h: 0, kind: 'shot' }

  it('prepares a hidden copy and reuses it for the first death', () => {
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

  it('a body upright at death ends up lying down via the game\'s ground landing, head along the impulse', () => {
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

  it('reuses its copies, hides the ones no death claims, releases everything with a new source', () => {
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

  describe('victim\'s outfit', () => {
    it.each([
      ['the fall through clips', null],
      ['the bake', idleBake()],
    ])('via %s: the default-armor copy gives way to the arrived outfit, released without touching the geometries', (_, bake) => {
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

      // Same outfit on the next frame: the same copy, nothing remade or released.
      frame(dress)
      expect(only(parent)).toBe(after)
      expect(released.skeleton).toHaveBeenCalledTimes(1)
      expect(shared).not.toHaveBeenCalled()
      pool.dispose()
    })

    it('no body of the same victim serves the old outfit: stale copies slid into place are released too', () => {
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
      // The next stale copy slides into the first one's place: it serves nothing, it is released.
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
 * skinnedSource: the test Spartan (game bones and clips) wearing a skinned default armor, bound
 * to a skeleton of all its bones; `armor` is its geometry, shared by every copy.
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

/** dressFor: a one-piece skinned outfit on `source`'s bones, with no paint. */
function dressFor(source: THREE.Object3D): Dress {
  const bones: string[] = []
  source.traverse((o) => o instanceof THREE.Bone && bones.push(o.name))
  const piece = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
  return { outfit: { bones, skinned: [piece], rigid: [], issues: [] }, coat: new Map() }
}

/** idleBake: a bake that drives no bone (only its spot and yaw matter here). */
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

/** watchRelease tracks the release of the materials and skeleton of the copy `holder` carries. */
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

/** watchGeometry: a witness called if any of the shared geometries is released. */
function watchGeometry(...geometries: THREE.BufferGeometry[]): ReturnType<typeof vi.fn> {
  const spy = vi.fn()
  for (const g of geometries) g.addEventListener('dispose', spy)
  return spy
}
