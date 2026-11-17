// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { fixtureClips } from '../test/spartanClips'
import { spartanSkeleton } from '../test/spartanSkeleton'
import type { Coat } from './armorCoat3d'
import { neutralPaint } from './armorCoating3d'
import { ARMURE_NEUTRE, packPaint } from './armorMaterial3d'
import { attachBoneOf, makeAvatar, placeBody, releaseWeapon, showBodyFx, showWeapon, wearSpartan } from './avatar3d'
import { packAtlas } from './bakedLight'
import { BakedLight } from './bakedLightShader'
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

/** A test Spartan: driven bones, two skinned meshes bound to the same skin (like GLTFLoader). */
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

/** A body fx state with no shield lit, camo at strength `camo`. */
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
  it('dresses the player in a tinted copy that replaces the capsule', () => {
    const scene = new THREE.Scene()
    const a = makeAvatar(scene, 'player', TEAM)
    const source = spartanSource()
    wearSpartan(a, source)
    expect(a.spartan?.rig.root.parent).toBe(a.group)
    const meshes = skinned(a.group).filter((m) => m.material !== a.shell?.material)
    expect(meshes).toHaveLength(2)
    const m = meshes[0].material as THREE.MeshStandardMaterial
    expect(m).not.toBe(skinned(source)[0].material)
    // Default armor: neutral gray pulled toward the team color, whatever the model's base color.
    expect(m.color.r).toBeCloseTo(ARMURE_NEUTRE + (TEAM.r - ARMURE_NEUTRE) * 0.3)
    expect(m.color.g).toBeCloseTo(ARMURE_NEUTRE + (TEAM.g - ARMURE_NEUTRE) * 0.3)
    // A single skeleton for the copy: both meshes share it.
    expect(meshes[0].skeleton).toBe(meshes[1].skeleton)
    expect(meshes[0].skeleton.bones[0]).not.toBe(skinned(source)[0].skeleton.bones[0])
    placeBody(a, FEET, { h: 0, p: 0, crouch: false, dropOeil: 0 }, false)
    showWeapon(a, null, null, null)
    expect(a.body.visible).toBe(false)
    expect(a.spartan?.rig.root.visible).toBe(true)
  })

  it('lights the armor from the map\'s lamps, like the street the player stands on', () => {
    const lamp = { kind: 'omni' as const, position: new THREE.Vector3(), direction: new THREE.Vector3(0, -1, 0), color: new THREE.Color(1, 1, 1), energy: 1, range: 2, cone: [0, 90] as [number, number] }
    const light = new BakedLight([], packAtlas([]), 1, [lamp])
    const a = makeAvatar(new THREE.Scene(), 'player', TEAM)
    wearSpartan(a, spartanSource(), null, light)
    const armor = (a.spartan?.materials ?? []).filter((m) => m instanceof THREE.MeshStandardMaterial)
    expect(armor.length).toBeGreaterThan(0)
    for (const m of armor) {
      const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: '#include <common>\n#include <project_vertex>', fragmentShader: '#include <common>\n#include <lights_pars_begin>\n#include <lights_fragment_begin>\n#include <lights_fragment_maps>' }
      m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer)
      expect(shader.fragmentShader).toContain('RE_Direct(clusteredLamp')
    }
    wearSpartan(a, null)
    light.dispose()
  })

  it('doubles the armor with an energy shell on the same skeleton, off with no effect, released with the copy', () => {
    const a = makeAvatar(new THREE.Scene(), 'player', TEAM)
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
    // The shield's glow takes the team color, not a fixed shield color.
    expect((shell?.material.uniforms.uTeam.value as THREE.Color).toArray()).toEqual([0, 1, 0.3])
    expect(shell?.meshes.every((m) => m.userData.noOutline)).toBe(true)
    // Recharge: a band at the start of the climb back up, off afterward.
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

  it('under camo, the armor fades out and only switches to transparent on change', () => {
    const a = makeAvatar(new THREE.Scene(), 'player', TEAM)
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

  it('puts the model\'s feet on the player\'s, standing and crouched alike', () => {
    const a = makeAvatar(new THREE.Scene(), 'player', TEAM)
    wearSpartan(a, spartanSource())
    for (const crouch of [false, true]) {
      placeBody(a, FEET, { h: 30, p: 0, crouch, dropOeil: 0 }, false)
      const root = a.spartan?.rig.root as THREE.Object3D
      expect(root.getWorldPosition(new THREE.Vector3()).distanceTo(FEET)).toBeLessThan(1e-9)
    }
  })

  it('set to null, releases the copy and brings back the capsule', () => {
    const a = makeAvatar(new THREE.Scene(), 'player', TEAM)
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

describe('showWeapon with the Spartan', () => {
  const gun = () => {
    const g = new THREE.Group()
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.02)))
    return g
  }

  it('in third person the weapon is carried by the right hand; at the game\'s idle, barrel along the aim', () => {
    const a = makeAvatar(new THREE.Scene(), 'player', TEAM)
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

  it('in first person the Spartan hides and the weapon goes back to the cone', () => {
    const a = makeAvatar(new THREE.Scene(), 'player', TEAM)
    wearSpartan(a, spartanSource())
    placeBody(a, FEET, { h: 0, p: 0, crouch: false, dropOeil: 0 }, true)
    showWeapon(a, held, gun(), { x: 0, y: -0.09, z: 0.06, roll: 0 })
    expect(a.model?.parent).toBe(a.aim)
    expect(a.spartan?.rig.root.visible).toBe(false)
    expect(a.body.visible).toBe(false)
  })
})

describe('showWeapon with the weapon coating', () => {
  /** A weapon model: one painted mesh (raw masks). */
  function gunSource(): THREE.Group {
    const g = new THREE.Group()
    const m = new THREE.MeshStandardMaterial()
    m.userData.armorMaps = { asg: null, mask0: null, mask1: null }
    g.add(new THREE.Mesh(new THREE.BoxGeometry(), m))
    return g
  }

  /** A coating with `materials` painted, one neutral paint each. */
  function coatOf(...materials: THREE.Material[]): Coat {
    return new Map(materials.map((m) => [m, {
      maps: { asg: null, mask0: null, mask1: null },
      paint: packPaint(neutralPaint(), () => undefined, () => {}),
      gradients: { value: null } as unknown as THREE.IUniform<THREE.Texture>,
    }]))
  }

  it('paints the copy of the model in hand with the coating, one copy per source material', () => {
    const a = makeAvatar(new THREE.Scene(), 'player', TEAM)
    const source = gunSource()
    const mat = (source.children[0] as THREE.Mesh).material as THREE.Material
    showWeapon(a, held, source, null, coatOf(mat))
    const copy = (a.model!.children[0] as THREE.Mesh).material as THREE.Material
    expect(copy).not.toBe(mat)
    expect(copy.userData.armorUniforms).toBeDefined()
    expect(a.weaponCoat?.get(mat)).toBe(copy)
  })

  it('changing coating disposes the previous copies', () => {
    const a = makeAvatar(new THREE.Scene(), 'player', TEAM)
    const source = gunSource()
    const mat = (source.children[0] as THREE.Mesh).material as THREE.Material
    showWeapon(a, held, source, null, coatOf(mat))
    const copy1 = (a.model!.children[0] as THREE.Mesh).material as THREE.Material
    const dispose = vi.spyOn(copy1, 'dispose')
    showWeapon(a, held, source, null, coatOf(mat))
    expect((a.model!.children[0] as THREE.Mesh).material).not.toBe(copy1)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('without a coating, the source comes back; leaving the weapon releases the copies', () => {
    const a = makeAvatar(new THREE.Scene(), 'player', TEAM)
    const source = gunSource()
    const mat = (source.children[0] as THREE.Mesh).material as THREE.Material
    showWeapon(a, held, source, null, coatOf(mat))
    const copy = (a.model!.children[0] as THREE.Mesh).material as THREE.Material
    const dispose = vi.spyOn(copy, 'dispose')
    showWeapon(a, held, source, null, null)
    expect((a.model!.children[0] as THREE.Mesh).material).toBe(mat)
    expect(dispose).toHaveBeenCalledTimes(1)
    showWeapon(a, null, null, null)
    expect(a.model).toBeNull()
    expect(a.weaponCoat).toBeNull()
  })

  it('releaseWeapon releases the applied coating', () => {
    const a = makeAvatar(new THREE.Scene(), 'player', TEAM)
    const source = gunSource()
    const mat = (source.children[0] as THREE.Mesh).material as THREE.Material
    showWeapon(a, held, source, null, coatOf(mat))
    const dispose = vi.spyOn((a.model!.children[0] as THREE.Mesh).material as THREE.Material, 'dispose')
    releaseWeapon(a)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(a.weaponCoat).toBeNull()
    expect((a.model!.children[0] as THREE.Mesh).material).toBe(mat)
  })
})

describe('attachBoneOf — the bone a stuck projectile rides (schema 128)', () => {
  const POSE = { h: 0, p: 0, crouch: false, dropOeil: 0 }
  // The test Spartan's skin joints: 0 b_pedestal, 1 b_pelvis, 2-4 b_spine1-3, 5 b_head, 6 b_r_grip.
  const HEAD = 5

  function placed() {
    const a = makeAvatar(new THREE.Scene(), 'p', TEAM)
    wearSpartan(a, spartanSource())
    placeBody(a, FEET, POSE, false)
    return a
  }

  it('third person: the world matrix of the skin joint of that rank, on the posed body', () => {
    const a = placed()
    const m = new THREE.Matrix4()
    expect(attachBoneOf(a, HEAD, false, null, m)).toBe('drawn')
    const at = new THREE.Vector3().setFromMatrixPosition(m)
    expect([at.x, at.y, at.z].map((v) => +v.toFixed(6))).toEqual([2, 1.65, 3])
  })

  it('first person: the arms rig bone of the same name, else hidden', () => {
    const a = placed()
    const m = new THREE.Matrix4()
    const asked: string[] = []
    const rig = (name: string, out: THREE.Matrix4) => (asked.push(name), out.makeTranslation(9, 9, 9), name === 'b_r_grip')
    expect(attachBoneOf(a, HEAD, true, rig, m)).toBe('hidden')
    expect(attachBoneOf(a, 6, true, rig, m)).toBe('drawn')
    expect(asked).toEqual(['b_head', 'b_r_grip'])
    expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBe(9)
    expect(attachBoneOf(a, HEAD, true, null, m)).toBe('hidden')
  })

  it('none without a drawn Spartan or such a joint', () => {
    const m = new THREE.Matrix4()
    expect(attachBoneOf(undefined, HEAD, false, null, m)).toBe('none')
    expect(attachBoneOf(makeAvatar(new THREE.Scene(), 'q', TEAM), HEAD, false, null, m)).toBe('none')
    const a = placed()
    expect(attachBoneOf(a, 95, false, null, m)).toBe('none')
    a.group.visible = false
    expect(attachBoneOf(a, HEAD, false, null, m)).toBe('none')
  })
})
