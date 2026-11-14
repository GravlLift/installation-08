/**
 * Tests: the team banner of the CTF flag, read from the weapon library index (the values the
 * server reads from the installed game, `internal/weapons/banners_gamefiles_test.go`), and the
 * flag model dressed with it.
 */
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { FlagBanners } from './flagBanner3d'
import { emblemFileOf, parseBanners, quadCenter } from './flagBanner3dModel'

const FLAG = '2a392328'

const emblems = Array.from({ length: 8 }, (_, k) => `banner-${FLAG}-emblem${k}.png`)

const index = {
  schema: 1,
  banners: {
    [FLAG]: {
      marker: [0.0037, 0.554, 0],
      cloth: { files: [`banner-${FLAG}-cloth.png`], width: 0.375, height: 0.2813, pivot: [-0.475, -0.05], offset: [0, 0, 0], across: [0, 0, -1], alpha: 0.5, additive: false },
      emblem: { files: emblems, width: 0.2, height: 0.2, pivot: [0, 0], offset: [0, -0.01, -0.175], across: [0, 0, -1], alpha: 0.5, additive: true },
    },
    // A malformed entry is left out.
    deadbeef: { marker: [0, 0], cloth: null },
  },
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('parseBanners', () => {
  it('reads the cloth and the emblem sheet of the flag, and leaves malformed entries out', () => {
    const table = parseBanners(index)!
    expect(Object.keys(table)).toEqual([FLAG])
    expect(table[FLAG].cloth.alpha).toBe(0.5)
    expect(table[FLAG].emblem?.files).toHaveLength(8)
    expect(table[FLAG].emblem?.additive).toBe(true)
  })

  it('treats an index without the field as not read yet', () => {
    expect(parseBanners({ schema: 1, reticle_ranges: {} })).toBeNull()
  })
})

describe('the banner quads', () => {
  const b = parseBanners(index)![FLAG]

  it('hangs the cloth from its edge at the marker, its middle where the emblem is moved to', () => {
    const [x, y, z] = quadCenter(b.marker, b.cloth)
    expect(x).toBeCloseTo(0.0037, 6)
    // 0.05 of the height above the marker, 0.475 of the width out along `across` (-Z).
    expect(y).toBeCloseTo(0.554 + 0.05 * 0.2813, 6)
    expect(z).toBeCloseTo(-0.475 * 0.375, 6)
    const e = quadCenter(b.marker, b.emblem!)
    expect(e[2]).toBeCloseTo(-0.175, 6)
    expect(Math.abs(e[2] - z)).toBeLessThan(0.01)
  })

  it('shows the emblem of the flag team, none for a flag of no team', () => {
    expect(emblemFileOf(b.emblem, 0)).toBe(emblems[0])
    expect(emblemFileOf(b.emblem, 1)).toBe(emblems[1])
    expect(emblemFileOf(b.emblem, null)).toBeNull()
    expect(emblemFileOf(b.emblem, -1)).toBeNull()
    expect(emblemFileOf(b.emblem, 8)).toBeNull()
  })
})

describe('FlagBanners', () => {
  it('dresses a copy of the flag per team once the index is read, and leaves other weapons bare', async () => {
    const fetchJson = vi.fn((_url: string, _signal: AbortSignal) => Promise.resolve<unknown>(index))
    const banners = new FlagBanners('/api/weapons', fetchJson)
    const flag = new THREE.Group()
    expect(banners.dress(flag, FLAG, 0)).toBe(flag) // index not read yet
    await flush()
    const eagle = banners.dress(flag, FLAG, 0)
    const cobra = banners.dress(flag, FLAG, 1)
    const neutral = banners.dress(flag, FLAG, null)
    expect(eagle).not.toBe(flag)
    expect(banners.dress(flag, FLAG, 0)).toBe(eagle)
    expect(cobra).not.toBe(eagle)
    const quads = (o: THREE.Object3D) => o.getObjectByName('team-banner')?.children as THREE.Mesh[]
    expect(quads(eagle)).toHaveLength(2)
    expect(quads(neutral)).toHaveLength(1)
    const [cloth, emblem] = quads(cobra)
    expect((cloth.material as THREE.MeshBasicMaterial).blending).toBe(THREE.NormalBlending)
    expect((emblem.material as THREE.MeshBasicMaterial).blending).toBe(THREE.AdditiveBlending)
    // The quad's width runs along `across` (-Z), its height up.
    const xAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(cloth.quaternion)
    expect(xAxis.z).toBeCloseTo(-1, 6)
    expect(cloth.scale.x).toBeCloseTo(0.375, 6)
    const other = new THREE.Group()
    expect(banners.dress(other, '2b1824d5', 0)).toBe(other)
    expect(fetchJson).toHaveBeenCalledTimes(1)
    banners.dispose()
  })
})
