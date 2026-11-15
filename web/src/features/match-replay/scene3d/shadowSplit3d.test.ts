import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { ShadowSplit } from './shadowSplit3d'

type Pass = { children: THREE.Object3D[]; scene: THREE.Object3D }

/** A stand-in renderer whose stock shadow pass records what it walks and makes a map like three. */
function fakeRenderer(sun: THREE.DirectionalLight) {
  const passes: Pass[] = []
  const merges: { kept: unknown; into: unknown }[] = []
  let target: THREE.WebGLRenderTarget | null = null
  let made = 0
  const shadowMap = {
    enabled: true,
    autoUpdate: false,
    needsUpdate: false,
    render(_lights: THREE.Light[], scene: THREE.Object3D) {
      if (!this.autoUpdate && !this.needsUpdate) return
      passes.push({ children: [...scene.children], scene })
      if (!sun.shadow.map) sun.shadow.map = Object.assign(new THREE.WebGLRenderTarget(1, 1), { name: `map${made++}` })
      this.needsUpdate = false
    },
  }
  const renderer = {
    shadowMap,
    getRenderTarget: () => target,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    setRenderTarget: (t: THREE.WebGLRenderTarget | null) => { target = t },
    renderBufferDirect: (_c: unknown, _s: unknown, _g: unknown, material: THREE.ShaderMaterial) => {
      merges.push({ kept: material.uniforms.tStatic.value, into: target })
    },
  }
  return { renderer: renderer as unknown as THREE.WebGLRenderer, shadowMap, passes, merges }
}

function setup() {
  const scene = new THREE.Scene()
  const sun = new THREE.DirectionalLight()
  const map = new THREE.Group()
  const layer = new THREE.Group()
  const player = new THREE.Group()
  scene.add(sun, map, layer, player)
  const f = fakeRenderer(sun)
  const split = new ShadowSplit(f.renderer, scene, sun)
  const update = (s: THREE.Object3D = scene, lights: THREE.Light[] = [sun]) => {
    f.shadowMap.needsUpdate = true
    ;(f.renderer.shadowMap as unknown as { render: (l: THREE.Light[], s: THREE.Object3D, c: THREE.Camera) => void }).render(lights, s, new THREE.PerspectiveCamera())
  }
  return { scene, sun, map, layer, player, split, update, ...f }
}

describe('ShadowSplit', () => {
  it('draws the static casters once, then only what moves, merging the kept map in', () => {
    const t = setup()
    t.split.setStatic([t.map, t.layer])
    t.update()
    expect(t.passes.map((p) => p.children)).toEqual([[t.map, t.layer], [t.sun, t.player]])
    const kept = t.sun.shadow.map === null ? null : t.merges[0].kept
    expect(t.merges).toHaveLength(1)
    expect(t.merges[0].into).toBe(t.sun.shadow.map)
    expect(t.merges[0].kept).not.toBe(t.sun.shadow.map)
    t.update()
    t.update()
    expect(t.passes.slice(2).map((p) => p.children)).toEqual([[t.sun, t.player], [t.sun, t.player]])
    expect(t.merges.map((m) => m.kept)).toEqual([kept, kept, kept])
    expect(t.renderer.getRenderTarget()).toBeNull()
  })

  it('redraws the static part once after invalidate or new static roots', () => {
    const t = setup()
    t.split.setStatic([t.map])
    t.update()
    t.split.invalidate()
    t.update()
    expect(t.passes.map((p) => p.children.length)).toEqual([1, 3, 1, 3])
    t.split.setStatic([t.map, t.layer])
    t.update()
    expect(t.passes.slice(4).map((p) => p.children)).toEqual([[t.map, t.layer], [t.sun, t.player]])
  })

  it('leaves other scenes, other lights, no static roots and split off to the stock pass', () => {
    const t = setup()
    t.update() // no static roots yet
    t.split.setStatic([t.map])
    const other = new THREE.Group()
    t.update(other)
    t.update(t.scene, [t.sun, new THREE.DirectionalLight()])
    t.split.split = false
    t.update()
    expect(t.passes.map((p) => p.scene)).toEqual([t.scene, other, t.scene, t.scene])
    expect(t.merges).toHaveLength(0)
  })

  it('does nothing when the shadow map does not ask for an update', () => {
    const t = setup()
    t.split.setStatic([t.map])
    ;(t.renderer.shadowMap as unknown as { render: (l: THREE.Light[], s: THREE.Object3D, c: THREE.Camera) => void }).render([t.sun], t.scene, new THREE.PerspectiveCamera())
    expect(t.passes).toHaveLength(0)
  })
})
