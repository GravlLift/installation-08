// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { resolveFilmLook } from './filmLook3d'
import { ceilingTable, type ToneChain } from './highlightCeiling3d'
import { EMISSION_SHARE_MAX, HighlightMeter3d, makeMeterProbe, PROBE_RENDER_ORDER } from './highlightMeter3d'

const BASE: ToneChain = { exposure: 1.15, grade: [0.93, 1.02, 1.07], film: null }
const DEMO3: ToneChain = { ...BASE, film: resolveFilmLook({ preset: 'film', exposure: 0.5 }) }

/** A renderer double recording which target each draw went to and which state it read. */
function rig() {
  const meter = new HighlightMeter3d()
  const internals = meter as unknown as { states: THREE.WebGLRenderTarget[]; ceilingMaterial: THREE.ShaderMaterial; cellsMaterial: THREE.ShaderMaterial }
  let bound: THREE.WebGLRenderTarget | null = null
  const draws: { target: THREE.WebGLRenderTarget | null; material: THREE.Material }[] = []
  const renderer = {
    getRenderTarget: () => bound,
    setRenderTarget: (t: THREE.WebGLRenderTarget | null) => { bound = t },
    render: (mesh: THREE.Mesh) => draws.push({ target: bound, material: mesh.material as THREE.Material }),
  } as unknown as THREE.WebGLRenderer
  return { meter, internals, renderer, draws, bound: () => bound }
}

describe('HighlightMeter3d', () => {
  it('draws the cells then the ceiling into a state slot, reading the other one, and gives the bound target back', () => {
    const { meter, internals, renderer, draws, bound } = rig()
    const hdr = new THREE.Texture()
    meter.update(renderer, hdr, 0)
    expect(draws.map((d) => d.material)).toEqual([internals.cellsMaterial, internals.ceilingMaterial])
    expect(internals.cellsMaterial.uniforms.tHdr.value).toBe(hdr)
    const first = draws[1].target
    expect(internals.states).toContain(first)
    expect(internals.ceilingMaterial.uniforms.uHasPrev.value).toBe(0) // the first frame snaps
    expect(meter.texture).toBe(first!.texture)
    expect(bound()).toBeNull()
    meter.update(renderer, hdr, 16)
    const second = draws[3].target
    expect(second).not.toBe(first)
    expect(internals.ceilingMaterial.uniforms.uHasPrev.value).toBe(1)
    expect(internals.ceilingMaterial.uniforms.tPrev.value).toBe(first!.texture)
    expect(internals.ceilingMaterial.uniforms.uAlpha.value).toBeGreaterThan(0)
    // Drawn again at the same time: the same slot is rewritten, from the same previous state.
    meter.update(renderer, hdr, 16)
    expect(draws[5].target).toBe(second)
    expect(internals.ceilingMaterial.uniforms.tPrev.value).toBe(first!.texture)
    meter.reset()
    meter.update(renderer, hdr, 32)
    expect(internals.ceilingMaterial.uniforms.uHasPrev.value).toBe(0)
    meter.dispose()
  })

  it("loads the chain's ceiling table, and rebuilds it only when the chain changes", () => {
    const { meter, internals } = rig()
    const table = internals.ceilingMaterial.uniforms.uTable.value as Float32Array
    meter.setChain(DEMO3)
    expect(Array.from(table)).toEqual(Array.from(ceilingTable(DEMO3, BASE)))
    table.fill(7)
    meter.setChain({ ...DEMO3, film: { ...DEMO3.film! } }) // equal values: kept
    expect(table[0]).toBe(7)
    meter.setChain(BASE)
    expect(Array.from(table)).toEqual(Array.from(ceilingTable(BASE, BASE)))
    meter.dispose()
  })

  it('leaves out only taps marked as emission, never a tap for its brightness, and sizes its shader arrays from the table', () => {
    const { internals, meter } = rig()
    const cells = internals.cellsMaterial.fragmentShader
    expect(EMISSION_SHARE_MAX).toBe(0.5)
    expect(cells).toContain('if (t.a - 1.0 >= 0.5000) continue;')
    // No brightness test is left: a wall lit past white by a detonation's flash is metered.
    expect(cells).not.toMatch(/max\(\s*\w+\.r\s*,\s*max\(/)
    expect(cells).not.toContain('1.5000')
    expect(internals.ceilingMaterial.fragmentShader).toContain(`uniform float uTable[${(internals.ceilingMaterial.uniforms.uTable.value as Float32Array).length}];`)
    meter.dispose()
  })
})

describe('makeMeterProbe', () => {
  it('is a transparent, colorless, depthless object drawn first of the transparent list, never culled', () => {
    const probe = makeMeterProbe(() => {})
    const m = probe.material as THREE.MeshBasicMaterial
    expect(m.transparent).toBe(true)
    expect(m.colorWrite).toBe(false)
    expect(m.depthTest).toBe(false)
    expect(m.depthWrite).toBe(false)
    expect(probe.renderOrder).toBe(PROBE_RENDER_ORDER)
    expect(probe.frustumCulled).toBe(false)
    expect(probe.castShadow).toBe(false)
    // A zero-area triangle: nothing to rasterize, nothing to hit.
    expect(Array.from(probe.geometry.getAttribute('position').array).every((v) => v === 0)).toBe(true)
    const hits: THREE.Intersection[] = []
    probe.raycast(new THREE.Raycaster(), hits)
    expect(hits).toEqual([])
  })

  it('hands the renderer to its callback when three is about to draw it', () => {
    const seen: unknown[] = []
    const probe = makeMeterProbe((r) => seen.push(r))
    const renderer = {} as THREE.WebGLRenderer
    probe.onBeforeRender(renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), probe.geometry, probe.material as THREE.Material, null as never)
    expect(seen).toEqual([renderer])
  })
})
