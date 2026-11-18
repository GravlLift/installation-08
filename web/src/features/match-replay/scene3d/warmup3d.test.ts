// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it, vi } from 'vitest'
import type { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import type { Avatar } from './avatar3d'
import { Outline3d } from './outline3d'
import * as THREE from 'three'
import { withCamouflage, withVisibleObjects, warmUp3d, texturesOf } from './warmup3d'

it('restores visibility and culling even if the render fails', () => {
  const parent = new THREE.Group()
  const child = new THREE.Group()
  parent.add(child)
  parent.visible = false
  child.visible = false
  child.frustumCulled = false
  expect(() => withVisibleObjects([parent, child], () => {
    expect(parent.visible && child.visible).toBe(true)
    expect(parent.frustumCulled || child.frustumCulled).toBe(false)
    throw new Error('render')
  })).toThrow('render')
  expect([parent.visible, child.visible, parent.frustumCulled, child.frustumCulled]).toEqual([false, false, true, false])
})

describe('texturesOf', () => {
  it('walks standard maps and painted armor uniforms, with no duplicates', () => {
    const root = new THREE.Group()
    const map = new THREE.Texture()
    const normalMap = new THREE.Texture()
    const standard = new THREE.MeshStandardMaterial({ map, normalMap })
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), standard))
    // Two meshes sharing the material: the texture counts only once.
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), standard))

    const asg = new THREE.Texture()
    const gradients = new THREE.Texture()
    const painted = new THREE.MeshStandardMaterial()
    painted.userData.armorUniforms = {
      uArmorAsg: { value: asg },
      uArmorGradients: { value: gradients },
      uPaint: { value: new Float32Array(4) },
    }
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), painted))

    const textures = texturesOf([root])
    expect(textures).toContain(map)
    expect(textures).toContain(normalMap)
    expect(textures).toContain(asg)
    expect(textures).toContain(gradients)
    // Uniforms that aren't textures don't go in.
    expect(textures).toHaveLength(4)
  })

  it('walks shader material uniforms', () => {
    const root = new THREE.Group()
    const texture = new THREE.Texture()
    const shader = new THREE.ShaderMaterial({ uniforms: { uImage: { value: texture }, uScale: { value: 1 } } })
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), shader))
    expect(texturesOf([root])).toEqual([texture])
  })
})

it('cloaks the real materials and restores their state even if the render fails', () => {
  const a = new THREE.MeshStandardMaterial({ opacity: 0.7, depthWrite: false })
  const b = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.3 })
  expect(() => withCamouflage([[a, b]], () => {
    expect(a.transparent && b.transparent).toBe(true)
    expect(a.opacity).toBeCloseTo(0.54)
    throw new Error('render')
  })).toThrow('render')
  expect([a.transparent, a.opacity, a.depthWrite]).toEqual([false, 0.7, false])
  expect([b.transparent, b.opacity, b.depthWrite]).toEqual([true, 0.3, true])
})

it('restores the target and the shadows after a compositor failure', async () => {
  const scene = new THREE.Scene()
  const root = new THREE.Group()
  const material = new THREE.MeshStandardMaterial()
  scene.add(root)
  const target = new THREE.WebGLRenderTarget()
  const readBuffer = new THREE.WebGLRenderTarget()
  let active: THREE.WebGLRenderTarget | null = target
  const renderer = {
    getRenderTarget: () => active,
    setRenderTarget: (v: THREE.WebGLRenderTarget | null) => { active = v },
    compileAsync: async () => {}, initTexture: () => {}, shadowMap: { needsUpdate: false },
  } as unknown as THREE.WebGLRenderer
  const outline = new Outline3d(new THREE.PerspectiveCamera())
  let calls = 0
  const composer = { readBuffer, render: () => {
    calls++
    if (calls === 2) {
      expect(material.transparent).toBe(true)
      throw new Error('render')
    }
  } } as unknown as EffectComposer
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    await warmUp3d(renderer, scene, new THREE.PerspectiveCamera(), {
      roots: [root], detaches: [], composer, outline,
      avatars: [{ group: root, spartan: { materials: [material] } } as unknown as Avatar],
    })
    expect(calls).toBe(2)
    expect(active).toBe(target)
    expect(renderer.shadowMap.needsUpdate).toBe(false)
    expect(material.transparent).toBe(false)
    expect(outline.subjectsOf()).toEqual([])
  } finally { warn.mockRestore(); outline.dispose(); target.dispose(); readBuffer.dispose() }
})
