import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

import type { Dress, SpartanArmory } from './armory3d'
import type { Coat } from './armorCoat3d'
import type { PreparationRig3d } from './preparationRig3d'
import { PeintureRig3d } from './peintureRig3d'

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

/** Un matériau de bras peint (masques bruts et style) sur un maillage de la racine du rig. */
function brasRig(): { root: THREE.Group; materiau: THREE.MeshStandardMaterial } {
  const materiau = new THREE.MeshStandardMaterial()
  materiau.userData.surfaceBrute = {}
  materiau.userData.style = {}
  const maillage = new THREE.Mesh(new THREE.BoxGeometry(), materiau)
  const root = new THREE.Group()
  root.add(maillage)
  return { root, materiau }
}

/** Le revêtement d'un matériau, sans texture (masques nuls). */
function coatDe(materiau: THREE.Material): Coat {
  const peinture = {
    maps: { asg: null, mask0: null, mask1: null },
    paint: { data: new Float32Array(4), globals: [0, 0, 0, 0] as [number, number, number, number], offset: [0, 0] as [number, number] },
    gradients: { value: null } as unknown as THREE.IUniform<THREE.Texture>,
  }
  return new Map([[materiau, peinture]])
}

/** L'armurerie du joueur : l'habit et le calcul de la peinture (une promesse par appel). */
function armurerieDe(habit: Dress | null) {
  let resoudreIntérieur: (coat: Coat | null) => void = () => {}
  const peindreBras = vi.fn(() => new Promise<Coat | null>((r) => { resoudreIntérieur = r }))
  const armurerie = { dress: () => habit, peindreBras } as unknown as SpartanArmory
  return {
    armurerie,
    peindreBras,
    resoudre: (coat: Coat | null) => resoudreIntérieur(coat),
  }
}

function preparationDe(coat: Coat | null): PreparationRig3d {
  return { coat: () => coat } as unknown as PreparationRig3d
}

function peintureDe(_root: THREE.Object3D, armurerie: SpartanArmory, preparation: PreparationRig3d): PeintureRig3d {
  return new PeintureRig3d({
    xuid: () => '1',
    armurerie: () => armurerie,
    preparation,
  })
}

describe('PeintureRig3d', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('garde chaque copie, invalide un seul rig et restaure les deux au changement', () => {
    const a = brasRig(), b = brasRig()
    const armurerie = armurerieDe({} as Dress)
    const coats = new Map([['a', coatDe(a.materiau)], ['b', coatDe(b.materiau)]])
    const peinture = peintureDe(a.root, armurerie.armurerie, { coat: (f: string) => coats.get(f) } as unknown as PreparationRig3d)
    peinture.actualiser('a', a.root)
    const copieA = (a.root.children[0] as THREE.Mesh).material as THREE.Material
    const disposeA = vi.spyOn(copieA, 'dispose')
    peinture.actualiser('b', b.root)
    const copieB = (b.root.children[0] as THREE.Mesh).material as THREE.Material
    const disposeB = vi.spyOn(copieB, 'dispose')
    expect(peinture.materiauSource(copieA)).toBe(a.materiau)
    expect(peinture.materiauSource(copieB)).toBe(b.materiau)
    expect(disposeA).not.toHaveBeenCalled()
    peinture.actualiser('a', a.root)
    expect(peinture.enCours('a')).toBe(false)
    expect(armurerie.peindreBras).not.toHaveBeenCalled()
    peinture.invalider('a')
    peinture.actualiser('a', a.root)
    expect(disposeA).toHaveBeenCalledOnce()
    expect(disposeB).not.toHaveBeenCalled()
    expect((b.root.children[0] as THREE.Mesh).material).toBe(copieB)
    peinture.changerJoueur()
    expect(disposeB).toHaveBeenCalledOnce()
    expect((a.root.children[0] as THREE.Mesh).material).toBe(a.materiau)
    expect((b.root.children[0] as THREE.Mesh).material).toBe(b.materiau)
  })

  it('refuse un revêtement préparé qui ne couvre pas les pièces du rig', async () => {
    const a = brasRig(), piece = brasRig(), b = brasRig()
    a.root.add(piece.root.children[0])
    const armurerie = armurerieDe({} as Dress)
    const coats = new Map([['a', coatDe(a.materiau)], ['b', coatDe(b.materiau)]])
    const peinture = peintureDe(a.root, armurerie.armurerie, { coat: (f: string) => coats.get(f) } as unknown as PreparationRig3d)
    peinture.actualiser('a', a.root)
    peinture.actualiser('b', b.root)
    expect(peinture.enCours('a')).toBe(true)
    expect(peinture.enCours('b')).toBe(false)
    expect(armurerie.peindreBras).toHaveBeenCalledWith('1', expect.anything(), [a.materiau, piece.materiau])
    armurerie.resoudre(new Map([...coatDe(a.materiau), ...coatDe(piece.materiau)]))
    await tick()
    expect(peinture.materiauSource((a.root.children[1] as THREE.Mesh).material as THREE.Material)).toBe(piece.materiau)
  })

  it('abandonne une peinture invalidée sans interrompre un autre rig', async () => {
    const a = brasRig(), b = brasRig()
    const attente: Array<(coat: Coat | null) => void> = []
    const armurerie = { dress: () => habit, peindreBras: () => new Promise<Coat | null>((r) => attente.push(r)) } as unknown as SpartanArmory
    const habit = {} as Dress
    const peinture = peintureDe(a.root, armurerie, preparationDe(null))
    peinture.actualiser('a', a.root)
    peinture.actualiser('b', b.root)
    peinture.invalider('a')
    attente[0](coatDe(a.materiau))
    attente[1](coatDe(b.materiau))
    await tick()
    expect((a.root.children[0] as THREE.Mesh).material).toBe(a.materiau)
    expect((b.root.children[0] as THREE.Mesh).material).not.toBe(b.materiau)
    expect(peinture.enCours('b')).toBe(false)
  })

  it('pose le revêtement préparé sans attente, et garde le couple (fichier, habit)', () => {
    const { root, materiau } = brasRig()
    const armurerie = armurerieDe({} as Dress)
    const peinture = peintureDe(root, armurerie.armurerie, preparationDe(coatDe(materiau)))
    peinture.actualiser('rig1', root)
    const copie = (root.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial
    expect(copie).not.toBe(materiau)
    expect(peinture.materiauSource(copie)).toBe(materiau)
    expect(peinture.enCours()).toBe(false)
    peinture.actualiser('rig1', root)
    expect((root.children[0] as THREE.Mesh).material).toBe(copie)
    peinture.changerJoueur()
    expect((root.children[0] as THREE.Mesh).material).toBe(materiau)
  })

  it('ne peint rien sans habit, et reste en attente de la peinture en fond', () => {
    const { root, materiau } = brasRig()
    const sans = peintureDe(root, armurerieDe(null).armurerie, preparationDe(null))
    sans.actualiser('rig1', root)
    expect((root.children[0] as THREE.Mesh).material).toBe(materiau)
    expect(sans.enCours()).toBe(false)

    const armurerie = armurerieDe({} as Dress)
    const peinture = peintureDe(root, armurerie.armurerie, preparationDe(null))
    peinture.actualiser('rig1', root)
    expect(peinture.enCours()).toBe(true)
    expect((root.children[0] as THREE.Mesh).material).toBe(materiau)
    expect(armurerie.peindreBras).toHaveBeenCalledTimes(1)
  })

  it('pose la peinture en fond à son arrivée, abandonnée si le joueur change avant', async () => {
    const { root, materiau } = brasRig()
    const armurerie = armurerieDe({} as Dress)
    const peinture = peintureDe(root, armurerie.armurerie, preparationDe(null))
    peinture.actualiser('rig1', root)
    armurerie.resoudre(coatDe(materiau))
    await tick()
    expect(peinture.enCours()).toBe(false)
    expect((root.children[0] as THREE.Mesh).material).not.toBe(materiau)

    const retard = brasRig()
    const armurerie2 = armurerieDe({} as Dress)
    const peinture2 = peintureDe(retard.root, armurerie2.armurerie, preparationDe(null))
    peinture2.actualiser('rig1', retard.root)
    peinture2.changerJoueur()
    armurerie2.resoudre(coatDe(retard.materiau))
    await tick()
    expect(peinture2.enCours()).toBe(false)
    expect((retard.root.children[0] as THREE.Mesh).material).toBe(retard.materiau)
  })

  it('invalider force un repeintage au prochain actualiser', async () => {
    const { root, materiau } = brasRig()
    const armurerie = armurerieDe({} as Dress)
    const peinture = peintureDe(root, armurerie.armurerie, preparationDe(null))
    peinture.actualiser('rig1', root)
    expect(armurerie.peindreBras).toHaveBeenCalledTimes(1)
    armurerie.resoudre(coatDe(materiau))
    await tick()
    const copie = (root.children[0] as THREE.Mesh).material
    peinture.invalider('rig1')
    peinture.actualiser('rig1', root)
    expect(armurerie.peindreBras).toHaveBeenCalledTimes(2)
    armurerie.resoudre(coatDe(materiau))
    await tick()
    expect((root.children[0] as THREE.Mesh).material).not.toBe(copie)
  })
})
