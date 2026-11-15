import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { markDrawnBy, tagSurface } from './surfaceProbe3d'
import { hiddenFromTop } from './topDownLogic'
import { TOP_SHADE_UNIFORMS } from './topDownShade3d'
import { TopDownStage } from './topDownStage3d'

describe('hiddenFromTop — what the top-down views leave out', () => {
  const surface = (family: string | null, instanced = false, transparent = false) => ({ family, instanced, transparent })

  it('keeps the structure, the terrain and placed objects', () => {
    expect(hiddenFromTop(surface('structure'))).toBe(false)
  })

  it('leaves out foliage clumps, coarse decor, decals, light cards and glass', () => {
    expect(hiddenFromTop(surface('decor', true))).toBe(true)
    expect(hiddenFromTop(surface('decor'))).toBe(true)
    expect(hiddenFromTop(surface('seeThrough', false, true))).toBe(true)
    expect(hiddenFromTop(surface('structure', false, true))).toBe(true)
  })

  it('does not decide for an untagged helper, unless it is a clump', () => {
    expect(hiddenFromTop(surface(null))).toBe(false)
    expect(hiddenFromTop(surface(null, false, true))).toBe(false)
    expect(hiddenFromTop(surface(null, true))).toBe(true)
  })
})

function mesh(family: string | null, material = new THREE.MeshStandardMaterial()): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BufferGeometry(), material)
  if (family) tagSurface(m, material, undefined, family)
  return m
}

describe('TopDownStage — the map staged for a top-down render', () => {
  function staged() {
    const scene = new THREE.Scene()
    const sun = new THREE.DirectionalLight()
    const root = new THREE.Group()
    const floor = mesh('structure')
    const decor = mesh('decor')
    const decal = mesh('seeThrough', new THREE.MeshStandardMaterial({ transparent: true }))
    const clumps = new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial(), 4)
    tagSurface(clumps, clumps.material as THREE.Material, undefined, 'decor')
    // A merged draw of decor surfaces, and one of structure surfaces (the originals hidden, as `batchLayered` leaves them).
    const decorDraw = mesh(null)
    const floorDraw = mesh(null)
    const decorPart = mesh('decor')
    const floorPart = mesh('structure')
    decorPart.visible = floorPart.visible = false
    markDrawnBy(decorPart, decorDraw)
    markDrawnBy(floorPart, floorDraw)
    root.add(floor, decor, decal, clumps, decorDraw, floorDraw, decorPart, floorPart)
    scene.add(root, sun)
    const stage = new TopDownStage(scene, sun)
    stage.sync(null, [root])
    return { stage, floor, decor, decal, clumps, decorDraw, floorDraw, decorPart }
  }

  it('hides foliage, decor and decals while it draws, and gives them back after', () => {
    const s = staged()
    let inside: boolean[] = []
    s.stage.run({ mapOnly: false }, () => {
      inside = [s.floor, s.decor, s.decal, s.clumps, s.decorDraw, s.floorDraw].map((o) => o.visible)
    })
    expect(inside).toEqual([true, false, false, false, false, true])
    expect([s.floor, s.decor, s.decal, s.clumps, s.decorDraw, s.floorDraw].every((o) => o.visible)).toBe(true)
    expect(s.decorPart.visible).toBe(false)
  })

  it('draws the map in its flat light, and puts the 3D light back after', () => {
    const s = staged()
    let flat = -1
    s.stage.run({ mapOnly: false }, () => {
      flat = TOP_SHADE_UNIFORMS.uTopFlat.value
    })
    expect(flat).toBe(1)
    expect(TOP_SHADE_UNIFORMS.uTopFlat.value).toBe(0)
  })
})
