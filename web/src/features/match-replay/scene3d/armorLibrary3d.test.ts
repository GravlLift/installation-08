// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { LAYER_BYTES } from './armorGradients3d'
import { ArmorLibrary, type ArmorLibraryIO } from './armorLibrary3d'

function pieceScene(): THREE.Object3D {
  const root = new THREE.Group()
  const geometry = new THREE.BoxGeometry() // a real, non-trivial byte count
  root.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()))
  return root
}

function fakeIO(): ArmorLibraryIO {
  return {
    fetchJson: vi.fn(async () => ({})),
    loadSwatch: vi.fn(async () => new Uint8Array(LAYER_BYTES)),
    loadGlb: vi.fn(async () => pieceScene()),
  }
}

describe('ArmorLibrary.loadedBytes / onGrowth', () => {
  it('stays the same before anything owned loads (just the gradient atlas pre-allocated at construction)', () => {
    const lib = new ArmorLibrary('/b', fakeIO())
    expect(lib.loadedBytes()).toBe(lib.loadedBytes())
  })

  it('grows after a piece GLB loads, and calls onGrowth', async () => {
    const onGrowth = vi.fn()
    const lib = new ArmorLibrary('/b', fakeIO(), onGrowth)
    const before = lib.loadedBytes()
    await lib.file('piece-a.glb')
    expect(lib.loadedBytes()).toBeGreaterThan(before)
    expect(onGrowth).toHaveBeenCalledTimes(1)
  })

  it('calls onGrowth after a swatch loads, even though the pre-allocated gradient atlas does not resize for it', async () => {
    const onGrowth = vi.fn()
    const lib = new ArmorLibrary('/b', fakeIO(), onGrowth)
    const before = lib.loadedBytes()
    await lib.swatch('s1')
    // GradientAtlas pre-allocates 16 layers' worth of bytes at construction (`FIRST_CAPACITY`): one
    // swatch, well under that, does not change its backing array's byteLength. `onGrowth` still
    // fires once for this real load — the caller re-stores unconditionally, cheaply, on every
    // growth signal rather than trying to predict when the byte count itself will actually move.
    expect(lib.loadedBytes()).toBe(before)
    expect(onGrowth).toHaveBeenCalledTimes(1)
  })

  it('loadedBytes grows once the gradient atlas itself grows past its first capacity', async () => {
    const lib = new ArmorLibrary('/b', fakeIO())
    const before = lib.loadedBytes()
    for (let i = 0; i < 17; i++) await lib.swatch(`s${i}`) // FIRST_CAPACITY is 16: the 17th doubles it
    expect(lib.loadedBytes()).toBeGreaterThan(before)
  })

  it('never calls onGrowth for a failed load', async () => {
    const onGrowth = vi.fn()
    const io: ArmorLibraryIO = {
      fetchJson: vi.fn(async () => ({})),
      loadSwatch: vi.fn(async () => { throw new Error('404') }),
      loadGlb: vi.fn(async () => { throw new Error('404') }),
    }
    const lib = new ArmorLibrary('/b', io, onGrowth)
    await lib.file('missing.glb')
    await lib.swatch('missing')
    expect(onGrowth).not.toHaveBeenCalled()
  })

  it('never calls onGrowth after dispose', async () => {
    const onGrowth = vi.fn()
    let resolveLoad: ((scene: THREE.Object3D) => void) | null = null
    const io: ArmorLibraryIO = {
      fetchJson: vi.fn(async () => ({})),
      loadSwatch: vi.fn(async () => new Uint8Array(LAYER_BYTES)),
      loadGlb: vi.fn(() => new Promise<THREE.Object3D>((resolve) => { resolveLoad = resolve })),
    }
    const lib = new ArmorLibrary('/b', io, onGrowth)
    const p = lib.file('piece-a.glb')
    // `load()` awaits `slot()` (a resolved promise, under MAX_LOADS) before calling `io.loadGlb`:
    // let that microtask turn happen so `resolveLoad` is assigned before disposing mid-flight.
    await Promise.resolve()
    await Promise.resolve()
    expect(resolveLoad).not.toBeNull()
    lib.dispose()
    resolveLoad!(pieceScene())
    await p
    expect(onGrowth).not.toHaveBeenCalled()
  })
})
