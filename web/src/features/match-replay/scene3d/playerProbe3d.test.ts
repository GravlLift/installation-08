// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * playerProbe3d.test.ts — PLAYERS' ENVIRONMENT PROBE: assigning it to a material only recompiles
 * on the probe <-> no-probe toggle (the material's `version` counter, where three sets
 * `needsUpdate`), and `Lighting.probeAt` returns the closest probe to the point, null without a
 * capture or with reflections off.
 */
import { describe, expect, it } from 'vitest'

import * as THREE from 'three'

import { ENV_INTENSITY } from './lighting'
import { Lighting } from './lighting'
import type { Look3d } from './look3d'
import { assignPlayerProbe, assignPlayerProbes } from './playerProbe3d'

function probe(name: string): THREE.Texture {
  const t = new THREE.DataTexture(new Uint8Array(4), 1, 1)
  t.userData.name = name
  return t
}

function lamp(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial()
}

describe('assignPlayerProbe', () => {
  it('does not rewrite a material that already carries the probe', () => {
    const m = lamp()
    const probe1 = probe('a')
    assignPlayerProbe(m, probe1)
    const version = m.version
    assignPlayerProbe(m, probe1)
    expect(m.envMap).toBe(probe1)
    expect(m.version).toBe(version)
  })

  it('swaps one probe for another with no recompile', () => {
    const m = lamp()
    const probe1 = probe('a')
    const probe2 = probe('b')
    assignPlayerProbe(m, probe1)
    const version = m.version
    assignPlayerProbe(m, probe2)
    expect(m.envMap).toBe(probe2)
    expect(m.version).toBe(version)
  })

  it('recompiles on the probe and no-probe toggle', () => {
    const m = lamp()
    const probe1 = probe('a')
    const rest = m.version
    assignPlayerProbe(m, probe1)
    expect(m.version).toBe(rest + 1)
    expect(m.envMapIntensity).toBe(ENV_INTENSITY)
    const withProbe = m.version
    assignPlayerProbe(m, null)
    expect(m.envMap).toBeNull()
    expect(m.version).toBe(withProbe + 1)
  })

  it('leaves a non-standard material alone', () => {
    const m = new THREE.MeshLambertMaterial()
    const probe1 = probe('a')
    expect(() => assignPlayerProbe(m, probe1)).not.toThrow()
  })

  it('assignPlayerProbes: every material carries the probe', () => {
    const a = lamp()
    const b = lamp()
    const probe1 = probe('a')
    assignPlayerProbes([a, b], probe1)
    expect(a.envMap).toBe(probe1)
    expect(b.envMap).toBe(probe1)
  })
})

describe('Lighting.probeAt', () => {
  function scene(fakeRenderer: object): Lighting {
    return new Lighting(fakeRenderer as unknown as THREE.WebGLRenderer, new THREE.Scene())
  }

  function probes(lighting: Lighting, points: readonly THREE.Vector3[]): THREE.Texture[] {
    const textures = points.map((_, i) => probe(`${i}`))
    const inner = lighting as unknown as { probes: THREE.Texture[]; spots: THREE.Vector3[] }
    inner.probes = textures
    inner.spots = points.map((p) => p.clone())
    return textures
  }

  it('returns the closest probe to the point', () => {
    const lighting = scene({ shadowMap: {} })
    const [near, far] = probes(lighting, [new THREE.Vector3(0, 0, 0), new THREE.Vector3(100, 0, 0)])
    expect(lighting.probeAt(new THREE.Vector3(1, 0, 0))).toBe(near)
    expect(lighting.probeAt(new THREE.Vector3(99, 0, 0))).toBe(far)
  })

  it('null without a capture', () => {
    const lighting = scene({ shadowMap: {} })
    expect(lighting.probeAt(new THREE.Vector3(1, 0, 0))).toBeNull()
  })

  it('null when reflections are off', () => {
    const lighting = scene({ shadowMap: {} })
    probes(lighting, [new THREE.Vector3(0, 0, 0)])
    const look: Look3d = { shadows: true, reflections: false, ambientOcclusion: true, gameLight: true, bloom: true, glowAnimation: true }
    lighting.setLook(look)
    expect(lighting.probeAt(new THREE.Vector3(1, 0, 0))).toBeNull()
  })
})
