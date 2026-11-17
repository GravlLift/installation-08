// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it, vi } from 'vitest'
import type { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import type { Avatar } from './avatar3d'
import { Outline3d } from './outline3d'
import * as THREE from 'three'
import { avecCamouflage, avecObjetsVisibles, prechauffer3d, texturesDe } from './warmup3d'

it('restaure la visibilité et le filtrage même si le rendu échoue', () => {
  const parent = new THREE.Group()
  const enfant = new THREE.Group()
  parent.add(enfant)
  parent.visible = false
  enfant.visible = false
  enfant.frustumCulled = false
  expect(() => avecObjetsVisibles([parent, enfant], () => {
    expect(parent.visible && enfant.visible).toBe(true)
    expect(parent.frustumCulled || enfant.frustumCulled).toBe(false)
    throw new Error('rendu')
  })).toThrow('rendu')
  expect([parent.visible, enfant.visible, parent.frustumCulled, enfant.frustumCulled]).toEqual([false, false, true, false])
})

describe('texturesDe', () => {
  it('marche les cartes standard et les uniformes d’armure peinte, sans doublon', () => {
    const racine = new THREE.Group()
    const map = new THREE.Texture()
    const normalMap = new THREE.Texture()
    const standard = new THREE.MeshStandardMaterial({ map, normalMap })
    racine.add(new THREE.Mesh(new THREE.BoxGeometry(), standard))
    // Deux maillages qui partagent le matériau : la texture compte une seule fois.
    racine.add(new THREE.Mesh(new THREE.BoxGeometry(), standard))

    const asg = new THREE.Texture()
    const gradients = new THREE.Texture()
    const peinture = new THREE.MeshStandardMaterial()
    peinture.userData.armorUniforms = {
      uArmorAsg: { value: asg },
      uArmorGradients: { value: gradients },
      uPaint: { value: new Float32Array(4) },
    }
    racine.add(new THREE.Mesh(new THREE.BoxGeometry(), peinture))

    const textures = texturesDe([racine])
    expect(textures).toContain(map)
    expect(textures).toContain(normalMap)
    expect(textures).toContain(asg)
    expect(textures).toContain(gradients)
    // Les uniformes qui ne sont pas des textures n'entrent pas.
    expect(textures).toHaveLength(4)
  })

  it('marche les uniformes de matériau de shader', () => {
    const racine = new THREE.Group()
    const texture = new THREE.Texture()
    const shader = new THREE.ShaderMaterial({ uniforms: { uImage: { value: texture }, uEchelle: { value: 1 } } })
    racine.add(new THREE.Mesh(new THREE.BoxGeometry(), shader))
    expect(texturesDe([racine])).toEqual([texture])
  })
})

it('camoufle les matériaux réels et restaure leur état même si le rendu échoue', () => {
  const a = new THREE.MeshStandardMaterial({ opacity: 0.7, depthWrite: false })
  const b = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.3 })
  expect(() => avecCamouflage([[a, b]], () => {
    expect(a.transparent && b.transparent).toBe(true)
    expect(a.opacity).toBeCloseTo(0.54)
    throw new Error('rendu')
  })).toThrow('rendu')
  expect([a.transparent, a.opacity, a.depthWrite]).toEqual([false, 0.7, false])
  expect([b.transparent, b.opacity, b.depthWrite]).toEqual([true, 0.3, true])
})

it('restaure la cible et les ombres après un échec du compositeur', async () => {
  const scene = new THREE.Scene()
  const root = new THREE.Group()
  const material = new THREE.MeshStandardMaterial()
  scene.add(root)
  const cible = new THREE.WebGLRenderTarget()
  const lecture = new THREE.WebGLRenderTarget()
  let active: THREE.WebGLRenderTarget | null = cible
  const renderer = {
    getRenderTarget: () => active,
    setRenderTarget: (v: THREE.WebGLRenderTarget | null) => { active = v },
    compileAsync: async () => {}, initTexture: () => {}, shadowMap: { needsUpdate: false },
  } as unknown as THREE.WebGLRenderer
  const outline = new Outline3d(new THREE.PerspectiveCamera())
  let appels = 0
  const composer = { readBuffer: lecture, render: () => {
    appels++
    if (appels === 2) {
      expect(material.transparent).toBe(true)
      throw new Error('rendu')
    }
  } } as unknown as EffectComposer
  const avertir = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    await prechauffer3d(renderer, scene, new THREE.PerspectiveCamera(), {
      roots: [root], detaches: [], composer, outline,
      avatars: [{ group: root, spartan: { materials: [material] } } as unknown as Avatar],
    })
    expect(appels).toBe(2)
    expect(active).toBe(cible)
    expect(renderer.shadowMap.needsUpdate).toBe(false)
    expect(material.transparent).toBe(false)
    expect(outline.subjectsOf()).toEqual([])
  } finally { avertir.mockRestore(); outline.dispose(); cible.dispose(); lecture.dispose() }
})
