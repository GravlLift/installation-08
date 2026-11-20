// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** dof3d.test.ts — the thin-lens circle of confusion and the depth of field pass's frame setup. */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { cocRadiusPx, cocTerms, DOF_MAX_COC_FRACTION, DofPass, focalLengthMm, SENSOR_HEIGHT_MM } from './dof3d'
import { M_PER_U } from './tracks3d'

/** The vertical field (deg) of a full-frame lens of focal length `f` mm. */
const vfovOf = (f: number) => (2 * Math.atan(SENSOR_HEIGHT_MM / 2 / f) * 180) / Math.PI
const u = (m: number) => m / M_PER_U

describe('focalLengthMm', () => {
  it('derives the focal length from the vertical field over a 24 mm sensor height', () => {
    expect(focalLengthMm(vfovOf(50))).toBeCloseTo(50, 9)
    expect(focalLengthMm(vfovOf(18))).toBeCloseTo(18, 9)
    expect(focalLengthMm(90)).toBeCloseTo(12, 9)
  })
})

describe('cocRadiusPx', () => {
  const f50 = vfovOf(50)

  it('matches the thin-lens formula: a 50 mm f/2 lens focused at 3 m, at 1080 px', () => {
    // At infinity the CoC diameter on the sensor is f^2 / (N (S - f)) = 2500 / (2 * 2950) mm.
    const diameterMm = 2500 / (2 * 2950)
    const radiusPx = ((diameterMm / 24) * 1080) / 2
    expect(cocRadiusPx(1e9, u(3), 2, f50, 1080)).toBeCloseTo(radiusPx, 4)
    expect(cocTerms(u(3), 2, f50, 1080).scalePx).toBeCloseTo(radiusPx, 9)
    // At 6 m: |D - S| / D = 1/2 of the infinity CoC.
    expect(cocRadiusPx(u(6), u(3), 2, f50, 1080)).toBeCloseTo(radiusPx / 2, 6)
  })

  it('is zero on the plane of focus, negative in front of it, positive behind', () => {
    expect(cocRadiusPx(u(3), u(3), 2, f50, 1080)).toBeCloseTo(0, 9)
    expect(cocRadiusPx(u(1.5), u(3), 2, f50, 1080)).toBeLessThan(0)
    expect(cocRadiusPx(u(5), u(3), 2, f50, 1080)).toBeGreaterThan(0)
    // Monotone in depth.
    let prev = -Infinity
    for (const m of [0.5, 1, 2, 3, 4, 8, 30, 300]) {
      const c = cocRadiusPx(u(m), u(3), 2, f50, 1080)
      expect(c).toBeGreaterThan(prev)
      prev = c
    }
  })

  it('scales with 1 / N and with the view height', () => {
    const at2 = cocRadiusPx(u(20), u(3), 2, f50, 1080)
    expect(cocRadiusPx(u(20), u(3), 1, f50, 1080)).toBeCloseTo(2 * at2, 9)
    expect(cocRadiusPx(u(20), u(3), 2, f50, 2160)).toBeCloseTo(2 * at2, 9)
  })

  it('a wide lens blurs far less than a long one at the same f-number', () => {
    const wide = cocRadiusPx(1e9, u(3), 1.4, vfovOf(18), 1080)
    const tele = cocRadiusPx(1e9, u(3), 1.4, vfovOf(85), 1080)
    expect(tele).toBeGreaterThan(10 * wide)
  })

  it('never focuses nearer than the lens can (1.05 focal lengths)', () => {
    const { focusMm } = cocTerms(0.0001, 2, f50, 1080)
    expect(focusMm).toBeCloseTo(52.5, 9)
    expect(Number.isFinite(cocRadiusPx(1e9, 0.0001, 2, f50, 1080))).toBe(true)
  })
})

describe('DofPass', () => {
  /** A renderer that records its draws: the pass needs no GL to set up a frame. */
  function recordingRenderer() {
    const targets: (THREE.WebGLRenderTarget | null)[] = []
    const renderer = {
      autoClear: true,
      autoClearDuring: [] as boolean[],
      setRenderTarget(t: THREE.WebGLRenderTarget | null) { targets.push(t) },
      render() { renderer.autoClearDuring.push(renderer.autoClear) },
    }
    return { renderer, targets }
  }

  it('passes the image on untouched when the frame has no depth', () => {
    const pass = new DofPass(new THREE.PerspectiveCamera(), () => null)
    try {
      const { renderer, targets } = recordingRenderer()
      pass.render(renderer as unknown as THREE.WebGLRenderer, new THREE.WebGLRenderTarget(), new THREE.WebGLRenderTarget())
      expect(pass.needsSwap).toBe(false)
      expect(targets).toEqual([])
    } finally {
      pass.dispose()
    }
  })

  it('sets the lens from the camera and the frame, draws its passes and writes the result to the write buffer', () => {
    const camera = new THREE.PerspectiveCamera(vfovOf(50), 16 / 9, 0.05, 2000)
    const depth = new THREE.DepthTexture(1, 1)
    const pass = new DofPass(camera, () => depth)
    try {
      pass.setSize(1920, 1080)
      pass.focusDistance = u(3)
      pass.aperture = 2
      const { renderer, targets } = recordingRenderer()
      const write = new THREE.WebGLRenderTarget(1920, 1080)
      const read = new THREE.WebGLRenderTarget(1920, 1080)
      pass.render(renderer as unknown as THREE.WebGLRenderer, write, read)
      expect(pass.needsSwap).toBe(true)
      const uniforms = pass.cocMaterial.uniforms
      expect(uniforms.tDepth.value).toBe(depth)
      expect(uniforms.cameraNear.value).toBe(0.05)
      expect(uniforms.cameraFar.value).toBe(2000)
      expect(uniforms.uFocusMm.value).toBeCloseTo(3000, 6)
      expect(uniforms.uCocScale.value).toBeCloseTo(cocTerms(u(3), 2, vfovOf(50), 1080).scalePx, 9)
      expect(uniforms.uMaxCoc.value).toBeCloseTo(DOF_MAX_COC_FRACTION * 1080, 9)
      // CoC, prefilter, tiles, dilation, far, near, composite: the last one into the write buffer.
      expect(targets).toHaveLength(7)
      expect(targets[targets.length - 1]).toBe(write)
      expect(targets.slice(0, -1)).not.toContain(read)
      expect(targets.slice(0, -1)).not.toContain(write)
      // No draw clears its target (the scene's depth stays intact), and autoClear is given back.
      expect(renderer.autoClearDuring).toEqual([false, false, false, false, false, false, false])
      expect(renderer.autoClear).toBe(true)
    } finally {
      pass.dispose()
    }
  })
})
