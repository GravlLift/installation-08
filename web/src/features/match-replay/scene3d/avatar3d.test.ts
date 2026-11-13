import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { fixtureClips } from '../test/spartanClips'
import { spartanSkeleton } from '../test/spartanSkeleton'
import type { Coat } from './armorCoat3d'
import { neutralPaint } from './armorCoating3d'
import { ARMURE_NEUTRE, packPaint } from './armorMaterial3d'
import { makeAvatar, placeBody, releaseWeapon, showBodyFx, showWeapon, wearSpartan } from './avatar3d'
import type { BodyFxState } from './bodyShell3d'
import { registerSpartanClips } from './clips3d'
import { newClipMix } from './clipSample3d'
import { aimDirThree } from './tracks3d'

function bone(name: string, parent: THREE.Object3D, x: number, y: number, z: number): THREE.Bone {
  const b = new THREE.Bone()
  b.name = name
  b.position.set(x, y, z)
  parent.add(b)
  return b
}

const BASE = new THREE.Color(0.5, 0.5, 0.5)

/** Un Spartan de test : les os pilotés, deux maillages à peau liés à la même peau (comme le GLTFLoader). */
function spartanSource(skeleton?: THREE.Group): THREE.Group {
  const root = skeleton ?? new THREE.Group()
  if (!skeleton) {
    const pedestal = bone('b_pedestal', root, 0, 0, 0)
    const pelvis = bone('b_pelvis', pedestal, 0, 0.4, 0)
    const spine1 = bone('b_spine1', pelvis, 0, 0.03, 0)
    const spine2 = bone('b_spine2', spine1, 0, 0.05, 0)
    const spine3 = bone('b_spine3', spine2, 0, 0.05, 0)
    bone('b_head', spine3, 0, 0.12, 0)
    bone('b_r_grip', spine3, 0.08, -0.04, 0.08)
  }
  const bones: THREE.Bone[] = []
  root.traverse((o) => {
    if (o instanceof THREE.Bone) bones.push(o)
  })
  const geo = new THREE.BoxGeometry(0.1, 0.7, 0.1)
  const n = geo.attributes.position.count
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4))
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4))
  const material = new THREE.MeshStandardMaterial({ color: BASE })
  for (let i = 0; i < 2; i++) {
    const mesh = new THREE.SkinnedMesh(geo, material)
    root.add(mesh)
    mesh.bind(new THREE.Skeleton(bones))
  }
  root.updateMatrixWorld(true)
  return root
}

function skinned(o: THREE.Object3D): THREE.SkinnedMesh[] {
  const out: THREE.SkinnedMesh[] = []
  o.traverse((c) => {
    if (c instanceof THREE.SkinnedMesh) out.push(c)
  })
  return out
}

const TEAM = new THREE.Color(1, 0.25, 0)
const FEET = new THREE.Vector3(2, 1, 3)
const held = { color: new THREE.Color(1, 1, 1) }

/** Un état du corps sans bouclier allumé, camouflé à la force `camo`. */
function bodyFx(camo = 0): BodyFxState {
  return {
    shield: { hit: 0, broke: 0, breakAge: -1, recharge: 0, rechargeAge: -1 },
    equip: { camo, overshield: 0 },
    phase: 0,
    ally: true,
    teamColor: new THREE.Color(0, 1, 0.3),
    overshieldColor: new THREE.Color(0.6, 1, 0.6),
    camoColor: new THREE.Color(1, 1, 1),
  }
}

describe('wearSpartan', () => {
  it('habille le joueur d’une copie teinte qui remplace la capsule', () => {
    const scene = new THREE.Scene()
    const a = makeAvatar(scene, 'joueur', TEAM)
    const source = spartanSource()
    wearSpartan(a, source)
    expect(a.spartan?.rig.root.parent).toBe(a.group)
    const meshes = skinned(a.group).filter((m) => m.material !== a.shell?.material)
    expect(meshes).toHaveLength(2)
    const m = meshes[0].material as THREE.MeshStandardMaterial
    expect(m).not.toBe(skinned(source)[0].material)
    // L'armure par défaut : le gris neutre tiré vers l'équipe, quelle que soit la base du modèle.
    expect(m.color.r).toBeCloseTo(ARMURE_NEUTRE + (TEAM.r - ARMURE_NEUTRE) * 0.3)
    expect(m.color.g).toBeCloseTo(ARMURE_NEUTRE + (TEAM.g - ARMURE_NEUTRE) * 0.3)
    // Un seul squelette pour la copie : les deux maillages le partagent.
    expect(meshes[0].skeleton).toBe(meshes[1].skeleton)
    expect(meshes[0].skeleton.bones[0]).not.toBe(skinned(source)[0].skeleton.bones[0])
    placeBody(a, FEET, { h: 0, p: 0, crouch: false, dropOeil: 0 }, false)
    showWeapon(a, null, null, null)
    expect(a.body.visible).toBe(false)
    expect(a.spartan?.rig.root.visible).toBe(true)
  })

  it('double l’armure d’une coque d’énergie au même squelette, éteinte sans effet, libérée avec la copie', () => {
    const a = makeAvatar(new THREE.Scene(), 'joueur', TEAM)
    wearSpartan(a, spartanSource())
    const shell = a.shell
    expect(shell?.meshes).toHaveLength(2)
    const armor = skinned(a.group).filter((m) => m.material !== shell?.material)
    expect(shell?.meshes[0].skeleton).toBe(armor[0].skeleton)
    expect(shell?.meshes.every((m) => !m.visible)).toBe(true)
    const fx = bodyFx()
    showBodyFx(a, fx)
    expect(shell?.meshes.some((m) => m.visible)).toBe(false)
    showBodyFx(a, { ...fx, shield: { ...fx.shield, hit: 0.5 } })
    expect(shell?.meshes.every((m) => m.visible)).toBe(true)
    expect(shell?.material.uniforms.uHit.value).toBe(0.5)
    // L'éclat du bouclier prend la couleur du camp, pas une couleur de bouclier fixe.
    expect((shell?.material.uniforms.uTeam.value as THREE.Color).toArray()).toEqual([0, 1, 0.3])
    expect(shell?.meshes.every((m) => m.userData.noOutline)).toBe(true)
    // La recharge : une bande au début de la remontée, éteinte ensuite.
    showBodyFx(a, { ...fx, shield: { ...fx.shield, recharge: 1, rechargeAge: 0.2 } })
    expect(shell?.meshes.every((m) => m.visible)).toBe(true)
    showBodyFx(a, { ...fx, shield: { ...fx.shield, recharge: 1, rechargeAge: 2 } })
    expect(shell?.meshes.some((m) => m.visible)).toBe(false)
    showBodyFx(a, { ...fx, equip: { camo: 0, overshield: 1 } })
    expect(shell?.meshes.every((m) => m.visible)).toBe(true)
    expect(shell?.material.uniforms.uOvershield.value).toBe(1)
    showBodyFx(a, null)
    expect(shell?.meshes.some((m) => m.visible)).toBe(false)
    const dispose = vi.spyOn(shell?.material as THREE.ShaderMaterial, 'dispose')
    wearSpartan(a, null)
    expect(dispose).toHaveBeenCalled()
    expect(a.shell).toBeNull()
    expect(skinned(a.group)).toHaveLength(0)
  })

  it('sous le camouflage, l’armure s’efface et ne passe en transparence qu’au changement', () => {
    const a = makeAvatar(new THREE.Scene(), 'joueur', TEAM)
    wearSpartan(a, spartanSource())
    const m = a.spartan?.materials[0] as THREE.Material
    const version = m.version
    showBodyFx(a, bodyFx(0.5))
    expect(m.transparent).toBe(true)
    expect(m.depthWrite).toBe(false)
    expect(m.opacity).toBeGreaterThan(0.08)
    expect(m.opacity).toBeLessThan(1)
    const once = m.version
    expect(once).toBeGreaterThan(version)
    showBodyFx(a, bodyFx(1))
    expect(m.opacity).toBeCloseTo(0.08)
    expect(m.version).toBe(once)
    expect(a.shell?.material.uniforms.uCamo.value).toBe(1)
    showBodyFx(a, null)
    expect(m.transparent).toBe(false)
    expect(m.depthWrite).toBe(true)
    expect(m.opacity).toBe(1)
  })

  it('pose les pieds du modèle sur ceux du joueur, debout comme accroupi', () => {
    const a = makeAvatar(new THREE.Scene(), 'joueur', TEAM)
    wearSpartan(a, spartanSource())
    for (const crouch of [false, true]) {
      placeBody(a, FEET, { h: 30, p: 0, crouch, dropOeil: 0 }, false)
      const root = a.spartan?.rig.root as THREE.Object3D
      expect(root.getWorldPosition(new THREE.Vector3()).distanceTo(FEET)).toBeLessThan(1e-9)
    }
  })

  it('rendu à null, libère la copie et rend la capsule', () => {
    const a = makeAvatar(new THREE.Scene(), 'joueur', TEAM)
    wearSpartan(a, spartanSource())
    const copy = a.spartan
    const dispose = vi.spyOn(copy?.materials[0] as THREE.Material, 'dispose')
    wearSpartan(a, null)
    expect(dispose).toHaveBeenCalled()
    expect(copy?.rig.root.parent).toBeNull()
    showWeapon(a, null, null, null)
    expect(a.body.visible).toBe(true)
  })
})

describe('showWeapon avec le Spartan', () => {
  const gun = () => {
    const g = new THREE.Group()
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.02)))
    return g
  }

  it('en 3e personne, l’arme est portée par la main droite ; sur l’attente du jeu, canon le long de la visée', () => {
    const a = makeAvatar(new THREE.Scene(), 'joueur', TEAM)
    const source = spartanSource(spartanSkeleton())
    const clips = fixtureClips(source)
    registerSpartanClips(source, clips)
    wearSpartan(a, source)
    const mix = newClipMix()
    mix.baseCount = 1
    Object.assign(mix.base[0], { clip: clips.get('combat:rifle:idle'), time: 0, weight: 1, loop: true })
    for (const [h, p] of [[90, 20], [200, -40]]) {
      placeBody(a, FEET, { h, p, crouch: false, dropOeil: 0, mix }, false)
      showWeapon(a, held, gun(), null)
      const grip = a.spartan?.rig.rightGrip as THREE.Bone
      expect(a.model?.parent).toBe(grip)
      const barrel = new THREE.Vector3(1, 0, 0).applyQuaternion(a.model?.getWorldQuaternion(new THREE.Quaternion()) as THREE.Quaternion)
      const [x, y, z] = aimDirThree(h, p)
      expect(THREE.MathUtils.radToDeg(barrel.angleTo(new THREE.Vector3(x, y, z)))).toBeLessThan(0.5)
      expect(a.model?.getWorldPosition(new THREE.Vector3()).distanceTo(grip.getWorldPosition(new THREE.Vector3()))).toBeLessThan(1e-6)
    }
  })

  it('en 1re personne, le Spartan se cache et l’arme revient au cône', () => {
    const a = makeAvatar(new THREE.Scene(), 'joueur', TEAM)
    wearSpartan(a, spartanSource())
    placeBody(a, FEET, { h: 0, p: 0, crouch: false, dropOeil: 0 }, true)
    showWeapon(a, held, gun(), { x: 0, y: -0.09, z: 0.06, roll: 0 })
    expect(a.model?.parent).toBe(a.aim)
    expect(a.spartan?.rig.root.visible).toBe(false)
    expect(a.body.visible).toBe(false)
  })
})

describe('showWeapon avec le revêtement de l’arme', () => {
  /** Un modèle d'arme : un maillage peint (masques bruts). */
  function gunSource(): THREE.Group {
    const g = new THREE.Group()
    const m = new THREE.MeshStandardMaterial()
    m.userData.armorMaps = { asg: null, mask0: null, mask1: null }
    g.add(new THREE.Mesh(new THREE.BoxGeometry(), m))
    return g
  }

  /** Le revêtement `materiaux` peints, une peinture neutre chacun. */
  function coatDe(...materiaux: THREE.Material[]): Coat {
    return new Map(materiaux.map((m) => [m, {
      maps: { asg: null, mask0: null, mask1: null },
      paint: packPaint(neutralPaint(), () => undefined, () => {}),
      gradients: { value: null } as unknown as THREE.IUniform<THREE.Texture>,
    }]))
  }

  it('peint la copie du modèle en main du revêtement, une copie par matériau source', () => {
    const a = makeAvatar(new THREE.Scene(), 'joueur', TEAM)
    const source = gunSource()
    const mat = (source.children[0] as THREE.Mesh).material as THREE.Material
    showWeapon(a, held, source, null, coatDe(mat))
    const copie = (a.model!.children[0] as THREE.Mesh).material as THREE.Material
    expect(copie).not.toBe(mat)
    expect(copie.userData.armorUniforms).toBeDefined()
    expect(a.weaponCoat?.get(mat)).toBe(copie)
  })

  it('change de revêtement : les copies précédentes sont disposées', () => {
    const a = makeAvatar(new THREE.Scene(), 'joueur', TEAM)
    const source = gunSource()
    const mat = (source.children[0] as THREE.Mesh).material as THREE.Material
    showWeapon(a, held, source, null, coatDe(mat))
    const copie1 = (a.model!.children[0] as THREE.Mesh).material as THREE.Material
    const dispose = vi.spyOn(copie1, 'dispose')
    showWeapon(a, held, source, null, coatDe(mat))
    expect((a.model!.children[0] as THREE.Mesh).material).not.toBe(copie1)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('sans revêtement, la source revient ; à la sortie de l’arme, les copies sont libérées', () => {
    const a = makeAvatar(new THREE.Scene(), 'joueur', TEAM)
    const source = gunSource()
    const mat = (source.children[0] as THREE.Mesh).material as THREE.Material
    showWeapon(a, held, source, null, coatDe(mat))
    const copie = (a.model!.children[0] as THREE.Mesh).material as THREE.Material
    const dispose = vi.spyOn(copie, 'dispose')
    showWeapon(a, held, source, null, null)
    expect((a.model!.children[0] as THREE.Mesh).material).toBe(mat)
    expect(dispose).toHaveBeenCalledTimes(1)
    showWeapon(a, null, null, null)
    expect(a.model).toBeNull()
    expect(a.weaponCoat).toBeNull()
  })

  it('releaseWeapon libère le revêtement posé', () => {
    const a = makeAvatar(new THREE.Scene(), 'joueur', TEAM)
    const source = gunSource()
    const mat = (source.children[0] as THREE.Mesh).material as THREE.Material
    showWeapon(a, held, source, null, coatDe(mat))
    const dispose = vi.spyOn((a.model!.children[0] as THREE.Mesh).material as THREE.Material, 'dispose')
    releaseWeapon(a)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(a.weaponCoat).toBeNull()
    expect((a.model!.children[0] as THREE.Mesh).material).toBe(mat)
  })
})
