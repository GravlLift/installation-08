/**
 * glowAnimation3d.test.ts — the game's animated self-lit surfaces: a pure function of match time,
 * nothing without the build's extras, and nothing per frame once the look turns them off.
 */
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { evalGameFunction, GlowAnimator, glowStateAt, gradientAt, periodicWave, readGlowAnim, type GlowAnimSpec } from './glowAnimation3d'
import { glowLevel, IMAGE_GLOW_MAX, imageGlowLevel } from './lighting'

/** A periodic function as the build writes it: one wave, output [min, max]. */
function periodic(onde: number, frequence: number, min = 0, max = 1, sub: [number, number] = [0, 1]): GlowAnimSpec['fonction'] {
  return { type: 3, min, max, periodiques: [{ onde, frequence, phase: 0, min: sub[0], max: sub[1] }] }
}

// Streets' sign 03feebae: its picture slides up at 0.3 Hz, its opacity wanders 0.2 Hz between
// 0.15 and 0.4 around its still 0.312 (a factor between 0.48 and 1.28).
const SIGN: GlowAnimSpec[] = [
  { cible: 'uv', composante: 3, periode: 1, fonction: periodic(6, 0.3) },
  { cible: 'force', periode: 1, fonction: periodic(10, 0.2, 0.4811321, 1.2830188) },
]

describe('game functions', () => {
  it('draws the periodic waves in [0, 1]', () => {
    expect(periodicWave(2, 0, 1)).toBeCloseTo(0)
    expect(periodicWave(2, 0.5, 1)).toBeCloseTo(1)
    expect(periodicWave(6, 0.25, 1)).toBeCloseTo(0.25)
    expect(periodicWave(4, 0.5, 1)).toBeCloseTo(1)
    for (const onde of [8, 9, 10, 11]) {
      for (let x = 0; x < 10; x += 0.37) {
        const v = periodicWave(onde, x, 7)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })

  it('maps the wave through the sub-function and the function ranges, on time / period', () => {
    // A slide at 0.3 Hz: a third of a cycle after 1.111 s.
    expect(evalGameFunction(SIGN[0], 1 / 0.3 / 3, 0)).toBeCloseTo(1 / 3)
    // Screen c1ac0f42: a cosine 1 Hz into [0, 0.002], then into [0, 0.5]: at most 0.001.
    const wobble: GlowAnimSpec = { cible: 'uv', composante: 2, periode: 1, fonction: periodic(2, 1, 0, 0.5, [0, 0.002]) }
    expect(evalGameFunction(wobble, 0.5, 0)).toBeCloseTo(0.001)
    expect(evalGameFunction({ ...wobble, periode: 2 }, 1, 0)).toBeCloseTo(0.001)
    // Not periodic: not drawn.
    expect(evalGameFunction({ ...wobble, fonction: { type: 1, min: 0, max: 1 } }, 1, 0)).toBeNull()
  })

  it('is a pure function of match time: the same time and material give the same state', () => {
    const uv: [number, number, number, number] = [1, 1, 0, 0]
    for (const t of [0, 0.4, 12.345, 600.05]) {
      expect(glowStateAt(SIGN, uv, t, 42)).toEqual(glowStateAt(SIGN, uv, t, 42))
    }
    const a = glowStateAt(SIGN, uv, 2, 42)
    expect(a.uv).toEqual([1, 1, 0, (0.3 * 2) % 1])
    expect(a.force).toBeGreaterThanOrEqual(0.4811321 - 1e-6)
    expect(a.force).toBeLessThanOrEqual(1.2830188 + 1e-6)
    // The wander moves with time.
    const forces = new Set([0, 1, 2, 3, 4].map((t) => glowStateAt(SIGN, uv, t, 42).force.toFixed(4)))
    expect(forces.size).toBeGreaterThan(1)
  })

  it('picks a color along the gradient and keeps scale x (the component the build leaves out)', () => {
    expect(gradientAt([[1, 1, 1], [0, 0.5, 1]], 0.5)).toEqual([0.5, 0.75, 1])
    const spec: GlowAnimSpec[] = [{ cible: 'uv', periode: 1, fonction: periodic(6, 0.25) }]
    expect(glowStateAt(spec, [1, 1, 0, 0], 1, 0).uv[0]).toBeCloseTo(0.25)
  })

  it('reads nothing from a material without the build extras (it draws still)', () => {
    expect(readGlowAnim(undefined)).toBeNull()
    expect(readGlowAnim({})).toBeNull()
    expect(readGlowAnim({ emissionAnim: [{ cible: 'autre', fonction: {} }] })).toBeNull()
    expect(readGlowAnim({ emissionAnim: SIGN })).toHaveLength(2)
  })
})

/** A sign's view material (an added picture) and its game material. */
function signMaterials(): { view: THREE.MeshBasicMaterial; source: THREE.MeshStandardMaterial; map: THREE.Texture } {
  const map = new THREE.Texture()
  const source = new THREE.MeshStandardMaterial({ emissive: new THREE.Color(0.2, 0.5, 1), emissiveIntensity: 5, emissiveMap: map })
  const view = new THREE.MeshBasicMaterial({ map })
  view.color.setRGB(0.2, 0.5, 1).multiplyScalar(imageGlowLevel(5))
  return { view, source, map }
}

describe('GlowAnimator', () => {
  it('moves the light and its picture on match time, capped, on its own copy of the texture', () => {
    const { view, source, map } = signMaterials()
    const anim = new GlowAnimator()
    anim.add(view, source, SIGN, true, 1)
    expect(anim.size).toBe(1)
    expect(view.map).not.toBe(map) // the GLB's texture may be shared
    expect(view.map?.source).toBe(map.source)
    anim.update(2)
    const s = glowStateAt(SIGN, [1, 1, 0, 0], 2, 1)
    expect(view.map?.offset.y).toBeCloseTo(s.uv[3])
    expect(view.color.b).toBeCloseTo(imageGlowLevel(5 * s.force))
    expect(view.color.b).toBeLessThanOrEqual(IMAGE_GLOW_MAX)
    expect(map.offset.y).toBe(0)
  })

  it('off: writes the still light back once, then does no per-frame work', () => {
    const { view, source } = signMaterials()
    const still = view.color.clone()
    const anim = new GlowAnimator()
    anim.add(view, source, SIGN, true, 1)
    anim.update(3.3)
    anim.setEnabled(false)
    expect(view.color.r).toBeCloseTo(still.r)
    expect(view.color.b).toBeCloseTo(still.b)
    expect(view.map?.offset.y).toBe(0)
    const color = vi.spyOn(view.color, 'copy')
    const offset = vi.spyOn((view.map as THREE.Texture).offset, 'set')
    const repeat = vi.spyOn((view.map as THREE.Texture).repeat, 'set')
    for (let t = 0; t < 100; t++) anim.update(t / 10)
    expect(color).not.toHaveBeenCalled()
    expect(offset).not.toHaveBeenCalled()
    expect(repeat).not.toHaveBeenCalled()
    color.mockRestore()
    anim.setEnabled(true)
    anim.update(3.3)
    expect(view.color.b).toBeCloseTo(imageGlowLevel(5 * glowStateAt(SIGN, [1, 1, 0, 0], 3.3, 1).force))
  })

  it('drives the copies the environment probes make of a material, sharing its texture', () => {
    const source = new THREE.MeshStandardMaterial({ emissive: new THREE.Color(1, 0.5, 0), emissiveIntensity: 20, emissiveMap: new THREE.Texture() })
    const view = new THREE.MeshStandardMaterial({ emissiveMap: source.emissiveMap })
    const anim = new GlowAnimator()
    anim.add(view, source, SIGN, false, 9)
    // What `assignProbes` does: a clone keeping the original's user data.
    const copy = view.clone()
    copy.userData = view.userData
    const meshes = [new THREE.Mesh(new THREE.BufferGeometry(), view), new THREE.Mesh(new THREE.BufferGeometry(), copy)]
    anim.adoptCopies(meshes)
    anim.adoptCopies(meshes)
    expect(anim.size).toBe(2)
    anim.update(4)
    expect(copy.emissiveIntensity).toBe(view.emissiveIntensity)
    expect(copy.emissiveMap).toBe(view.emissiveMap)
    expect(view.emissiveIntensity).toBeCloseTo(glowLevel(20 * glowStateAt(SIGN, [1, 1, 0, 0], 4, 9).force))
  })

  it('restores the exact still light of a lit (light-mask) material', () => {
    const source = new THREE.MeshStandardMaterial({ emissive: new THREE.Color(0.745, 0.018, 0.745), emissiveIntensity: 120 })
    const view = new THREE.MeshStandardMaterial()
    view.emissive.copy(source.emissive)
    view.emissiveIntensity = glowLevel(120)
    const anim = new GlowAnimator()
    anim.add(view, source, [{ cible: 'force', periode: 1, fonction: periodic(10, 0.2, 1.759288, 0.5858429) }], false, 3)
    anim.update(7)
    expect(view.emissiveIntensity).not.toBe(glowLevel(120))
    anim.setEnabled(false)
    expect(view.emissiveIntensity).toBe(glowLevel(120))
    expect(view.emissive.equals(source.emissive)).toBe(true)
  })
})

describe('GlowAnimator resetCopies / markBaseline', () => {
  it('a reattach that resets before adopting stays at the same entry count instead of growing', () => {
    const anim = new GlowAnimator()
    const source = new THREE.MeshStandardMaterial({ emissive: new THREE.Color(1, 0, 0), emissiveIntensity: 1 })
    const baseMaterial = new THREE.MeshStandardMaterial()
    anim.add(baseMaterial, source, [], false, 0)
    // Loading is done: this is the model's own baseline, before any attach's probe copies.
    anim.markBaseline()
    expect(anim.size).toBe(1)

    // First attach on a match: the lighting probes copy the base material, adopted here.
    const probeCopy1 = baseMaterial.clone()
    probeCopy1.userData = baseMaterial.userData
    anim.adoptCopies([new THREE.Mesh(new THREE.BufferGeometry(), probeCopy1)])
    expect(anim.size).toBe(2)

    // A later match reattaches the SAME session-cached model: reset drops the stale copy first.
    anim.resetCopies()
    expect(anim.size).toBe(1)
    const probeCopy2 = baseMaterial.clone()
    probeCopy2.userData = baseMaterial.userData
    anim.adoptCopies([new THREE.Mesh(new THREE.BufferGeometry(), probeCopy2)])
    expect(anim.size).toBe(2) // not 3: the first match's copy did not linger

    // And once more, to confirm it does not creep up over repeated reattaches.
    anim.resetCopies()
    const probeCopy3 = baseMaterial.clone()
    probeCopy3.userData = baseMaterial.userData
    anim.adoptCopies([new THREE.Mesh(new THREE.BufferGeometry(), probeCopy3)])
    expect(anim.size).toBe(2)
  })

  it('markBaseline only takes effect once: a later call after more entries are added does not move it', () => {
    const anim = new GlowAnimator()
    const source = new THREE.MeshStandardMaterial({ emissive: new THREE.Color(1, 0, 0), emissiveIntensity: 1 })
    const baseMaterial = new THREE.MeshStandardMaterial()
    anim.add(baseMaterial, source, [], false, 0)
    anim.markBaseline()
    const probeCopy = baseMaterial.clone()
    probeCopy.userData = baseMaterial.userData
    anim.adoptCopies([new THREE.Mesh(new THREE.BufferGeometry(), probeCopy)])
    anim.markBaseline() // a second, mistaken call must not swallow the probe copy into the baseline
    anim.resetCopies()
    expect(anim.size).toBe(1)
  })

  it('resetCopies is a no-op before markBaseline has ever run', () => {
    const anim = new GlowAnimator()
    const source = new THREE.MeshStandardMaterial({ emissive: new THREE.Color(1, 0, 0), emissiveIntensity: 1 })
    const baseMaterial = new THREE.MeshStandardMaterial()
    anim.add(baseMaterial, source, [], false, 0)
    anim.resetCopies()
    expect(anim.size).toBe(1)
  })
})
