// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PoseClips } from './poseClips3d'

/**
 * poseGltf: a pose GLB as the mock GLTFLoader returns it — one animation (a fixed-bone quaternion
 * track, one frame) whose JSON carries the `levelupAnimation` extras, and a body: one mesh whose
 * geometry, material and texture have spied `dispose`.
 */
function poseGltf() {
  const track = new THREE.QuaternionKeyframeTrack('b_x.quaternion', [0], [0, 0, 0, 1])
  const animation = new THREE.AnimationClip('stance', 1, [track])
  const geometry = new THREE.BufferGeometry()
  vi.spyOn(geometry, 'dispose')
  const texture = new THREE.Texture()
  vi.spyOn(texture, 'dispose')
  const material = new THREE.MeshStandardMaterial({ map: texture })
  vi.spyOn(material, 'dispose')
  const scene = new THREE.Group()
  scene.add(new THREE.Mesh(geometry, material))
  const gltf = {
    animations: [animation],
    parser: { json: { animations: [{ name: 'stance', extras: { levelupAnimation: { frameCount: 1, frameRate: 30 } } }] } },
    scene,
  }
  return { gltf, geometry, material, texture }
}

// The mock GLTFLoader's parseAsync: `parse.impl` is set per test.
const parse = vi.hoisted(() => ({ impl: null as null | ((buffer: ArrayBuffer) => Promise<unknown>) }))
vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    parseAsync(buffer: ArrayBuffer): Promise<unknown> {
      if (!parse.impl) return Promise.reject(new Error('parseAsync not configured'))
      return parse.impl(buffer)
    }
  },
}))

/** okFetch mocks global fetch to answer an ok GLB download. */
function okFetch() {
  const mock = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as unknown as Response)
  global.fetch = mock
  return mock
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('PoseClips', () => {
  it('returns null while a pose loads, then the clip named pose:<id>; the body is freed', async () => {
    const { gltf, geometry, material, texture } = poseGltf()
    parse.impl = async () => gltf
    okFetch()
    const clips = new PoseClips()
    const onLoad = vi.fn()
    clips.onLoad = onLoad
    expect(clips.get('i_see_you')).toBeNull()
    const clip = await clips.load('i_see_you')
    expect(clip?.name).toBe('pose:i_see_you')
    expect(clips.get('i_see_you')?.name).toBe('pose:i_see_you')
    expect(onLoad).toHaveBeenCalledTimes(1)
    expect(geometry.dispose).toHaveBeenCalledTimes(1)
    expect(material.dispose).toHaveBeenCalledTimes(1)
    expect(texture.dispose).toHaveBeenCalledTimes(1)
    clips.dispose()
  })

  it('a failed fetch logs once and returns null', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    global.fetch = vi.fn().mockRejectedValue(new Error('boom')) as unknown as typeof fetch
    const clips = new PoseClips()
    expect(clips.get('stance')).toBeNull()
    const clip = await clips.load('stance')
    expect(clip).toBeNull()
    expect(clips.get('stance')).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    clips.dispose()
  })
})
