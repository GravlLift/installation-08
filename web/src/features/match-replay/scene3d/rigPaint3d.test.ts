// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

import type { Dress, SpartanArmory } from './armory3d'
import type { Coat } from './armorCoat3d'
import type { RigPreparation3d } from './rigPreparation3d'
import { RigPaint3d } from './rigPaint3d'

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

/** A paintable arm material (raw masks and style) on a mesh of the rig's root. */
function armRig(): { root: THREE.Group; material: THREE.MeshStandardMaterial } {
  const material = new THREE.MeshStandardMaterial()
  material.userData.surfaceBrute = {}
  material.userData.style = {}
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material)
  const root = new THREE.Group()
  root.add(mesh)
  return { root, material }
}

/** A material's coating, with no texture (null masks). */
function coatFor(material: THREE.Material): Coat {
  const paint = {
    maps: { asg: null, mask0: null, mask1: null },
    paint: { data: new Float32Array(4), globals: [0, 0, 0, 0] as [number, number, number, number], offset: [0, 0] as [number, number] },
    gradients: { value: null } as unknown as THREE.IUniform<THREE.Texture>,
  }
  return new Map([[material, paint]])
}

/** The player's armory: the outfit and the paint computation (one promise per call). */
function armoryFor(outfit: Dress | null) {
  let resolveInner: (coat: Coat | null) => void = () => {}
  const paintArms = vi.fn(() => new Promise<Coat | null>((r) => { resolveInner = r }))
  const armory = { dress: () => outfit, paintArms } as unknown as SpartanArmory
  return {
    armory,
    paintArms,
    resolve: (coat: Coat | null) => resolveInner(coat),
  }
}

function preparationFor(coat: Coat | null): RigPreparation3d {
  return { coat: () => coat } as unknown as RigPreparation3d
}

function paintFor(_root: THREE.Object3D, armory: SpartanArmory, preparation: RigPreparation3d, weaponKeyFor: (file: string) => string | null = () => null): RigPaint3d {
  return new RigPaint3d({
    xuid: () => '1',
    armory: () => armory,
    preparation,
    weaponKeyFor,
  })
}

describe('RigPaint3d', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('keeps each copy, invalidates only one rig, and restores both on a player change', () => {
    const a = armRig(), b = armRig()
    const armory = armoryFor({} as Dress)
    const coats = new Map([['a', coatFor(a.material)], ['b', coatFor(b.material)]])
    const paint = paintFor(a.root, armory.armory, { coat: (f: string) => coats.get(f) } as unknown as RigPreparation3d)
    paint.refresh('a', a.root)
    const copyA = (a.root.children[0] as THREE.Mesh).material as THREE.Material
    const disposeA = vi.spyOn(copyA, 'dispose')
    paint.refresh('b', b.root)
    const copyB = (b.root.children[0] as THREE.Mesh).material as THREE.Material
    const disposeB = vi.spyOn(copyB, 'dispose')
    expect(paint.sourceMaterial(copyA)).toBe(a.material)
    expect(paint.sourceMaterial(copyB)).toBe(b.material)
    expect(disposeA).not.toHaveBeenCalled()
    paint.refresh('a', a.root)
    expect(paint.busy('a')).toBe(false)
    expect(armory.paintArms).not.toHaveBeenCalled()
    paint.invalidate('a')
    paint.refresh('a', a.root)
    expect(disposeA).toHaveBeenCalledOnce()
    expect(disposeB).not.toHaveBeenCalled()
    expect((b.root.children[0] as THREE.Mesh).material).toBe(copyB)
    paint.changePlayer()
    expect(disposeB).toHaveBeenCalledOnce()
    expect((a.root.children[0] as THREE.Mesh).material).toBe(a.material)
    expect((b.root.children[0] as THREE.Mesh).material).toBe(b.material)
  })

  it('rejects a prepared coating that does not cover the rig\'s pieces', async () => {
    const a = armRig(), piece = armRig(), b = armRig()
    a.root.add(piece.root.children[0])
    const armory = armoryFor({} as Dress)
    const coats = new Map([['a', coatFor(a.material)], ['b', coatFor(b.material)]])
    const preparation = { coat: (f: string) => coats.get(f), abandon: vi.fn() } as unknown as RigPreparation3d
    const paint = paintFor(a.root, armory.armory, preparation, () => 'key-a')
    paint.refresh('a', a.root)
    paint.refresh('b', b.root)
    expect(paint.busy('a')).toBe(true)
    expect(paint.busy('b')).toBe(false)
    expect(armory.paintArms).toHaveBeenCalledWith('1', expect.anything(), [a.material, piece.material], 'key-a')
    armory.resolve(new Map([...coatFor(a.material), ...coatFor(piece.material)]))
    await tick()
    expect(paint.sourceMaterial((a.root.children[1] as THREE.Mesh).material as THREE.Material)).toBe(piece.material)
  })

  it('abandons an invalidated paint without interrupting another rig', async () => {
    const a = armRig(), b = armRig(), piece = armRig()
    const pending: Array<(coat: Coat | null) => void> = []
    const armory = { dress: () => outfit, paintArms: () => new Promise<Coat | null>((r) => pending.push(r)) } as unknown as SpartanArmory
    const outfit = {} as Dress
    const paint = paintFor(a.root, armory, preparationFor(null))
    paint.refresh('a', a.root)
    paint.refresh('b', b.root)
    a.root.add(piece.root.children[0]) // the piece lands while the coat is in flight
    paint.invalidate('a')
    pending[0](coatFor(a.material)) // computed on the undressed rig: it no longer covers
    pending[1](coatFor(b.material))
    await tick()
    expect((a.root.children[0] as THREE.Mesh).material).toBe(a.material)
    expect((b.root.children[0] as THREE.Mesh).material).not.toBe(b.material)
    expect(paint.busy('a')).toBe(false)
    expect(paint.busy('b')).toBe(false)
  })

  it('scope then reload of a coated weapon: the weapon is never shown uncoated', async () => {
    // The painted weapon is scoped out, and while the rig is hidden a late arm piece lands:
    // invalidation starts a repaint. The scope is left (the rig shown again) while the repaint
    // is in flight: no frame shows the weapon with its neutral material. The fresh coat lands
    // on the dressed rig and replaces the kept copies.
    const { root, material } = armRig()
    const weapon = new THREE.MeshStandardMaterial()
    weapon.userData.surfaceBrute = {}
    weapon.userData.style = {}
    weapon.userData.rigWeapon = true
    const weaponMesh = new THREE.Mesh(new THREE.BoxGeometry(), weapon)
    root.add(weaponMesh)
    const armory = armoryFor({} as Dress)
    const paint = paintFor(root, armory.armory, preparationFor(null))
    paint.refresh('rig1', root)
    armory.resolve(new Map([...coatFor(material), ...coatFor(weapon)]))
    await tick()
    expect(paint.busy('rig1')).toBe(false)
    const weaponCopy = weaponMesh.material as THREE.Material
    expect(weaponCopy).not.toBe(weapon)
    const disposeWeaponCopy = vi.spyOn(weaponCopy, 'dispose')
    // Scope: the rig is hidden. While hidden, the late piece lands: invalidation + repaint.
    root.visible = false
    const piece = armRig()
    root.add(piece.root.children[0])
    paint.invalidate('rig1')
    paint.refresh('rig1', root) // `done`, on the piece landing
    expect(paint.busy('rig1')).toBe(true)
    // Scope left, the rig is shown again, the repaint is still in flight: the weapon keeps its
    // painted copy (before the fix it was the neutral material here).
    root.visible = true
    expect(weaponMesh.material).toBe(weaponCopy)
    expect(disposeWeaponCopy).not.toHaveBeenCalled()
    // The fresh coat, computed on the dressed rig, lands and replaces the kept copies.
    armory.resolve(new Map([...coatFor(material), ...coatFor(weapon), ...coatFor(piece.material)]))
    await tick()
    expect(paint.busy('rig1')).toBe(false)
    expect(weaponMesh.material).not.toBe(weapon)
    expect(weaponMesh.material).not.toBe(weaponCopy)
    expect((root.children[2] as THREE.Mesh).material).not.toBe(piece.material)
    expect(disposeWeaponCopy).toHaveBeenCalledOnce()
    paint.changePlayer()
  })

  it('applies the prepared coating with no wait, and keeps the (file, outfit) pair', () => {
    const { root, material } = armRig()
    const armory = armoryFor({} as Dress)
    const paint = paintFor(root, armory.armory, preparationFor(coatFor(material)))
    paint.refresh('rig1', root)
    const copy = (root.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial
    expect(copy).not.toBe(material)
    expect(paint.sourceMaterial(copy)).toBe(material)
    expect(paint.busy()).toBe(false)
    paint.refresh('rig1', root)
    expect((root.children[0] as THREE.Mesh).material).toBe(copy)
    paint.changePlayer()
    expect((root.children[0] as THREE.Mesh).material).toBe(material)
  })

  it('paints nothing with no outfit, and stays waiting on the background paint', () => {
    const { root, material } = armRig()
    const without = paintFor(root, armoryFor(null).armory, preparationFor(null))
    without.refresh('rig1', root)
    expect((root.children[0] as THREE.Mesh).material).toBe(material)
    expect(without.busy()).toBe(false)

    const armory = armoryFor({} as Dress)
    const paint = paintFor(root, armory.armory, preparationFor(null))
    paint.refresh('rig1', root)
    expect(paint.busy()).toBe(true)
    expect((root.children[0] as THREE.Mesh).material).toBe(material)
    expect(armory.paintArms).toHaveBeenCalledTimes(1)
  })

  it('applies the background paint on arrival, abandoned if the player changes first', async () => {
    const { root, material } = armRig()
    const armory = armoryFor({} as Dress)
    const paint = paintFor(root, armory.armory, preparationFor(null))
    paint.refresh('rig1', root)
    armory.resolve(coatFor(material))
    await tick()
    expect(paint.busy()).toBe(false)
    expect((root.children[0] as THREE.Mesh).material).not.toBe(material)

    const delayed = armRig()
    const armory2 = armoryFor({} as Dress)
    const paint2 = paintFor(delayed.root, armory2.armory, preparationFor(null))
    paint2.refresh('rig1', delayed.root)
    paint2.changePlayer()
    armory2.resolve(coatFor(delayed.material))
    await tick()
    expect(paint2.busy()).toBe(false)
    expect((delayed.root.children[0] as THREE.Mesh).material).toBe(delayed.material)
  })

  it('does not reject a coating computed on an already-dressed rig when a piece lands late', async () => {
    // The arm piece lands while the coat is still computing: `invalidate` drops the in-flight coat,
    // `refresh` recomputes it once on the dressed rig. Before the fix the fresh coat was
    // discarded because the rig was already registered as computed (busy false), so the arms
    // kept their neutral material until the next repaint — the first-person arms vanishing on
    // coat-ready, and again on every weapon switch while a coat was still loading.
    const { root, material } = armRig()
    const piece = armRig()
    root.add(piece.root.children[0]) // the piece lands while the coat is in flight
    const armory = armoryFor({} as Dress)
    const paint = paintFor(root, armory.armory, preparationFor(null))
    paint.refresh('rig1', root)
    expect(paint.busy('rig1')).toBe(true)
    // The coat was computed on the UNDRESSED rig and then invalidated: it must not land.
    armory.resolve(coatFor(material))
    await tick()
    expect((root.children[0] as THREE.Mesh).material).toBe(material)
    expect(paint.busy('rig1')).toBe(false)
    // The repaint, computed on the dressed rig, lands and is kept.
    const armory2 = armoryFor({} as Dress)
    const paint2 = paintFor(root, armory2.armory, preparationFor(null))
    paint2.refresh('rig1', root)
    expect(paint2.busy('rig1')).toBe(true)
    armory2.resolve(new Map([...coatFor(material), ...coatFor(piece.material)]))
    await tick()
    expect(paint2.busy('rig1')).toBe(false)
    expect((root.children[0] as THREE.Mesh).material).not.toBe(material)
    expect((root.children[1] as THREE.Mesh).material).not.toBe(piece.material)
  })

  it('keeps the applied coating on a rig while the new outfit\'s paint is computed', async () => {
    // A weapon switch to an unpainted rig computes its coat in the background: the LAST coat is
    // never replaced by a pending compute (the scene shows the rig painted, never gun-only), and
    // the new coat lands when it arrives.
    const a = armRig(), b = armRig()
    const armory = armoryFor({} as Dress)
    const paint = paintFor(a.root, armory.armory, preparationFor(null))
    paint.refresh('a', a.root)
    armory.resolve(coatFor(a.material))
    await tick()
    const copyA = (a.root.children[0] as THREE.Mesh).material as THREE.Material
    paint.refresh('b', b.root) // the switch: b's coat is computed in the background
    expect((b.root.children[0] as THREE.Mesh).material).toBe(b.material)
    expect((a.root.children[0] as THREE.Mesh).material).toBe(copyA)
    expect(paint.busy('a')).toBe(false)
    expect(paint.busy('b')).toBe(true)
    armory.resolve(coatFor(b.material))
    await tick()
    expect((a.root.children[0] as THREE.Mesh).material).toBe(copyA)
    expect((b.root.children[0] as THREE.Mesh).material).not.toBe(b.material)
    paint.changePlayer()
  })

  it('abandons a prepared coating that became stale, on the next refresh', async () => {
    // The prepared coat was computed on the undressed rig, so it does NOT include the piece's
    // material (which arrived since). The coat is therefore a subset of the rig's paintable
    // materials: `refresh` must drop it and recalculate on the dressed rig.
    const { root, material } = armRig()
    const piece = armRig()
    root.add(piece.root.children[0])
    // The stale coat: only the original material (computed before the piece landed).
    const stale = coatFor(material)
    const coats = new Map([['rig1', stale]])
    const preparation = { coat: (f: string) => coats.get(f) ?? null } as unknown as RigPreparation3d
    const abandon = vi.fn(() => { coats.delete('rig1') })
    ;(preparation as { abandon: unknown }).abandon = abandon
    const armory = armoryFor({} as Dress)
    const paint = paintFor(root, armory.armory, preparation)
    paint.refresh('rig1', root)
    expect(abandon).toHaveBeenCalledWith('rig1')
    expect(paint.busy('rig1')).toBe(true)
    // The fresh coat, computed on the dressed rig, lands and is kept.
    armory.resolve(new Map([...coatFor(material), ...coatFor(piece.material)]))
    await tick()
    expect(paint.busy('rig1')).toBe(false)
    expect((root.children[0] as THREE.Mesh).material).not.toBe(material)
    expect((root.children[1] as THREE.Mesh).material).not.toBe(piece.material)
  })

  it('invalidate forces a repaint on the next refresh', async () => {
    const { root, material } = armRig()
    const armory = armoryFor({} as Dress)
    const paint = paintFor(root, armory.armory, preparationFor(null))
    paint.refresh('rig1', root)
    expect(armory.paintArms).toHaveBeenCalledTimes(1)
    armory.resolve(coatFor(material))
    await tick()
    const copy = (root.children[0] as THREE.Mesh).material
    paint.invalidate('rig1')
    paint.refresh('rig1', root)
    expect(armory.paintArms).toHaveBeenCalledTimes(2)
    armory.resolve(coatFor(material))
    await tick()
    expect((root.children[0] as THREE.Mesh).material).not.toBe(copy)
  })
})
