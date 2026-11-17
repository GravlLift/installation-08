// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { markDrawnBy, tagSurface } from './surfaceProbe3d'
import { FLAT_CUTOUT_SHARE, flatShare, hiddenFromTop, walkedSpan } from './topDownLogic'
import { TOP_SHADE_UNIFORMS } from './topDownShade3d'
import { TopDownStage } from './topDownStage3d'

describe('hiddenFromTop — what the top-down views leave out', () => {
  const surface = (family: string | null, instanced = false, transparent = false) => ({ family, instanced, transparent, cutout: false, objectLayer: false, flat: 1 })
  const cutout = (objectLayer: boolean, flat: number) => ({ ...surface('structure'), cutout: true, objectLayer, flat })

  it('leaves out every cutout of the Forge object layer (ivy, plants, shrubs, leaves)', () => {
    expect(hiddenFromTop(cutout(true, 1))).toBe(true)
    expect(hiddenFromTop(cutout(true, 0))).toBe(true)
  })

  it('keeps a flat map cutout (a grate, a mesh floor) and leaves out a standing one (foliage)', () => {
    expect(hiddenFromTop(cutout(false, FLAT_CUTOUT_SHARE))).toBe(false)
    expect(hiddenFromTop(cutout(false, 0.3))).toBe(true)
  })

  it('keeps a solid placed object', () => {
    expect(hiddenFromTop({ ...surface('structure'), objectLayer: true })).toBe(false)
  })

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

describe('flatShare — how much of a cutout lies flat', () => {
  // Two triangles: one flat on the floor (area 0.5), one standing (area 2).
  const flatTri = [0, 0, 0, 1, 0, 0, 0, 0, 1]
  const wallTri = [0, 0, 0, 2, 0, 0, 0, 2, 0]

  it('is the flat share of the area, either way up', () => {
    expect(flatShare(flatTri, null)).toBe(1)
    expect(flatShare([0, 0, 0, 0, 0, 1, 1, 0, 0], null)).toBe(1)
    expect(flatShare(wallTri, null)).toBe(0)
    expect(flatShare([...flatTri, ...wallTri], null)).toBeCloseTo(0.5 / 2.5)
  })

  it('reads an index, and is 0 without area', () => {
    expect(flatShare([0, 0, 0, 1, 0, 0, 0, 0, 1], [0, 1, 2])).toBe(1)
    expect(flatShare([], null)).toBe(0)
  })
})

describe('walkedSpan — the fixed height scale of the match', () => {
  it('is the lowest and highest walked heights', () => {
    expect(walkedSpan([3, -1, 7.5, 2])).toEqual({ low: -1, high: 7.5 })
  })
  it('is 0 to 0 without heights', () => {
    expect(walkedSpan([])).toEqual({ low: 0, high: 0 })
  })
})

function mesh(family: string | null, material = new THREE.MeshStandardMaterial(), geometry = new THREE.BufferGeometry()): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material)
  if (family) tagSurface(m, material, undefined, family)
  return m
}

/** A unit quad, flat on the floor (`rotateX`) or standing. */
function quad(flat: boolean): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1)
  return flat ? g.rotateX(-Math.PI / 2) : g
}

const cutoutMaterial = () => new THREE.MeshStandardMaterial({ alphaTest: 0.5 })

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
    // Map cutouts: a grate lying flat stays, a foliage card standing goes.
    const grate = mesh('structure', cutoutMaterial(), quad(true))
    const leaves = mesh('structure', cutoutMaterial(), quad(false))
    root.add(floor, decor, decal, clumps, decorDraw, floorDraw, decorPart, floorPart, grate, leaves)
    // The Forge object layer: an ivy patch lying flat (a cutout) goes, a solid crate stays.
    const layer = new THREE.Group()
    layer.userData.levelupObjects = [{ index: 0, type: -1534478213, min: [0, 0, 0], max: [1, 1, 1] }]
    const ivy = mesh('structure', cutoutMaterial(), quad(true))
    const crate = mesh('structure')
    layer.add(ivy, crate)
    scene.add(root, layer, sun)
    const stage = new TopDownStage(scene, sun, { low: 0, high: 8 })
    stage.sync(null, [root, layer])
    return { stage, floor, decor, decal, clumps, decorDraw, floorDraw, decorPart, grate, leaves, ivy, crate }
  }

  it('hides foliage, decor and decals while it draws, and gives them back after', () => {
    const s = staged()
    const all = [s.floor, s.decor, s.decal, s.clumps, s.decorDraw, s.floorDraw, s.grate, s.leaves, s.ivy, s.crate]
    let inside: boolean[] = []
    s.stage.run({ mapOnly: false }, () => {
      inside = all.map((o) => o.visible)
    })
    expect(inside).toEqual([true, false, false, false, false, true, true, false, false, true])
    expect(all.every((o) => o.visible)).toBe(true)
    expect(s.decorPart.visible).toBe(false)
  })

  it('draws the map in its flat light shaded by the match heights, and puts the 3D light back after', () => {
    const s = staged()
    let inside: number[] = []
    s.stage.run({ mapOnly: false }, () => {
      const u = TOP_SHADE_UNIFORMS
      inside = [u.uTopFlat.value, u.uTopRamp.value, u.uTopLow.value, u.uTopHigh.value]
    })
    expect(inside).toEqual([1, 1, 0, 8])
    expect(TOP_SHADE_UNIFORMS.uTopFlat.value).toBe(0)
    expect(TOP_SHADE_UNIFORMS.uTopRamp.value).toBe(0)
  })

  it('stages every render the same way, wherever anyone stands (a stable picture)', () => {
    const s = staged()
    const snap = () => {
      let v: unknown[] = []
      s.stage.run({ mapOnly: true }, () => {
        const u = TOP_SHADE_UNIFORMS
        v = [u.uTopRamp.value, u.uTopLow.value, u.uTopHigh.value, s.grate.visible, s.leaves.visible]
      })
      return v
    }
    expect(snap()).toEqual(snap())
  })
})
