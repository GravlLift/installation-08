import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  cachedMapModel,
  mapModelKey,
  sessionAssetCache,
  storeMapModel,
} from './sessionAssetCache3d'
import type { MapModel } from './mapModel'

function silence() {
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
}

/** A minimal stand-in for `MapModel`: a plain root plus a `dispose` the cache can call. */
function fakeMapModel(meshBytes: number): MapModel {
  const root = new THREE.Group()
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(meshBytes / 4), 1))
  root.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()))
  return { root, dispose: vi.fn() } as unknown as MapModel
}

afterEach(() => {
  sessionAssetCache.clear()
})

describe('sessionAssetCache3d warm path', () => {
  it('a stored map is a hit on the next lookup when nothing evicts it', () => {
    silence()
    const outlookPath = '/api/matches/aaa/mesh.glb'
    const model = fakeMapModel(1_000) // small — nowhere near the 1.5 GB cap
    expect(cachedMapModel(outlookPath)).toBeUndefined() // cold: a miss
    storeMapModel(outlookPath, model)
    sessionAssetCache.acquire(mapModelKey(outlookPath)) // a live scene now points at it
    const hit = cachedMapModel(outlookPath)
    expect(hit).toBe(model) // warm: the exact same object, not reloaded
    sessionAssetCache.release(mapModelKey(outlookPath))
    // Still cached after release: nothing else competed for the cap, so nothing evicted it.
    expect(cachedMapModel(outlookPath)).toBe(model)
    expect(model.dispose).not.toHaveBeenCalled()
  })

  it('reproduces the live bug: a second map whose counted bytes alone exceed the cap evicts the first map as collateral', () => {
    silence()
    const outlookPath = '/api/matches/aaa/mesh.glb'
    const streetsPath = '/api/matches/bbb/mesh.glb'
    const outlook = fakeMapModel(1_000)
    storeMapModel(outlookPath, outlook)
    sessionAssetCache.release(mapModelKey(outlookPath)) // not pinned by a live scene any more, like after navigating away
    expect(cachedMapModel(outlookPath)).toBe(outlook) // still warm before Streets loads

    // Streets' map, sized (by whatever bug) bigger than the whole cache cap on its own — this is
    // exactly the shape of the live bug report (Streets' map ~1.33 TB against a 1.5 GB cap).
    const streets = fakeMapModel(1_000)
    const hugeBytes = sessionAssetCache.totalBytes + 10 * 1024 ** 3 // deliberately over the real cap
    sessionAssetCache.set(mapModelKey(streetsPath), {
      value: streets,
      bytes: hugeBytes,
      dispose: (m: MapModel) => m.dispose(),
    })

    // Outlook's previously-warm entry is gone: this is why the live second-Outlook-visit was a miss.
    expect(cachedMapModel(outlookPath)).toBeUndefined()
    expect(outlook.dispose).toHaveBeenCalledTimes(1)
    // Streets' own oversized entry survives (kept alone), per the cap-overflow fix.
    expect(cachedMapModel(streetsPath)).toBe(streets)
  })
})
