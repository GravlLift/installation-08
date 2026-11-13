/**
 * playerProbe3d.test.ts — LA SONDE D'ENVIRONNEMENT DES JOUEURS : l'attribution à un matériau ne
 * recompile qu'à la bascule sonde ↔ sans sonde (le compteur `version` du matériau, où three pose
 * `needsUpdate`), et `Lighting.probeAt` donne la sonde la plus proche du point, nulle sans capture
 * ou reflets éteints.
 */
import { describe, expect, it } from 'vitest'

import * as THREE from 'three'

import { ENV_INTENSITY } from './lighting'
import { Lighting } from './lighting'
import type { Look3d } from './look3d'
import { assignPlayerProbe, assignPlayerProbes } from './playerProbe3d'

function sonde(nom: string): THREE.Texture {
  const t = new THREE.DataTexture(new Uint8Array(4), 1, 1)
  t.userData.nom = nom
  return t
}

function lampe(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial()
}

describe('assignPlayerProbe', () => {
  it('ne réécrit pas un matériau qui porte déjà la sonde', () => {
    const m = lampe()
    const sonde1 = sonde('a')
    assignPlayerProbe(m, sonde1)
    const version = m.version
    assignPlayerProbe(m, sonde1)
    expect(m.envMap).toBe(sonde1)
    expect(m.version).toBe(version)
  })

  it('remplace une sonde par une autre sans recompiler', () => {
    const m = lampe()
    const sonde1 = sonde('a')
    const sonde2 = sonde('b')
    assignPlayerProbe(m, sonde1)
    const version = m.version
    assignPlayerProbe(m, sonde2)
    expect(m.envMap).toBe(sonde2)
    expect(m.version).toBe(version)
  })

  it('recompile à la bascule sonde et sans sonde', () => {
    const m = lampe()
    const sonde1 = sonde('a')
    const repos = m.version
    assignPlayerProbe(m, sonde1)
    expect(m.version).toBe(repos + 1)
    expect(m.envMapIntensity).toBe(ENV_INTENSITY)
    const avec = m.version
    assignPlayerProbe(m, null)
    expect(m.envMap).toBeNull()
    expect(m.version).toBe(avec + 1)
  })

  it('laisse un matériau non standard de côté', () => {
    const m = new THREE.MeshLambertMaterial()
    const sonde1 = sonde('a')
    expect(() => assignPlayerProbe(m, sonde1)).not.toThrow()
  })

  it('assignPlayerProbes : chaque matériau porte la sonde', () => {
    const a = lampe()
    const b = lampe()
    const sonde1 = sonde('a')
    assignPlayerProbes([a, b], sonde1)
    expect(a.envMap).toBe(sonde1)
    expect(b.envMap).toBe(sonde1)
  })
})

describe('Lighting.probeAt', () => {
  function scene(fakeRenderer: object): Lighting {
    return new Lighting(fakeRenderer as unknown as THREE.WebGLRenderer, new THREE.Scene())
  }

  function sondes(lighting: Lighting, points: readonly THREE.Vector3[]): THREE.Texture[] {
    const textures = points.map((_, i) => sonde(`${i}`))
    const inner = lighting as unknown as { probes: THREE.Texture[]; spots: THREE.Vector3[] }
    inner.probes = textures
    inner.spots = points.map((p) => p.clone())
    return textures
  }

  it('donne la sonde la plus proche du point', () => {
    const lighting = scene({ shadowMap: {} })
    const [proche, lointaine] = sondes(lighting, [new THREE.Vector3(0, 0, 0), new THREE.Vector3(100, 0, 0)])
    expect(lighting.probeAt(new THREE.Vector3(1, 0, 0))).toBe(proche)
    expect(lighting.probeAt(new THREE.Vector3(99, 0, 0))).toBe(lointaine)
  })

  it('nulle sans capture', () => {
    const lighting = scene({ shadowMap: {} })
    expect(lighting.probeAt(new THREE.Vector3(1, 0, 0))).toBeNull()
  })

  it('nulle quand les reflets sont éteints', () => {
    const lighting = scene({ shadowMap: {} })
    sondes(lighting, [new THREE.Vector3(0, 0, 0)])
    const look: Look3d = { shadows: true, reflections: false, ambientOcclusion: true, gameLight: true }
    lighting.setLook(look)
    expect(lighting.probeAt(new THREE.Vector3(1, 0, 0))).toBeNull()
  })
})
