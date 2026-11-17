// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { clipsOf, registerSpartanClips, spartanClipsOf, type GltfAnimationJson } from './clips3d'

const quat = (name: string, keys: number) =>
  new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, Array.from({ length: keys }, (_, k) => k / 30), new Array(4 * keys).fill(0).map((_, i) => (i % 4 === 3 ? 1 : 0)))
const pos = (name: string, keys: number) =>
  new THREE.VectorKeyframeTrack(`${name}.position`, Array.from({ length: keys }, (_, k) => k / 30), new Array(3 * keys).fill(0.5))
const scale = (name: string, v: number) => new THREE.VectorKeyframeTrack(`${name}.scale`, [0], [v, v, v])

const extras = (frameCount: number, rootMotion: number[][] = []): GltfAnimationJson['extras'] => ({ levelupAnimation: { frameCount, rootMotion } })

describe('clipsOf', () => {
  it('lit le nombre d’images, la foulée et le sens dans les extras du GLB', () => {
    const anim = new THREE.AnimationClip('combat:rifle:locomote_run_front', -1, [quat('b_pelvis', 22), pos('b_pelvis', 1)])
    // 22 images qui avancent chacune de (0,07 ; 0 ; 0) : 1,54 u le long de +X.
    const clips = clipsOf([anim], [{ name: anim.name, extras: extras(22, Array.from({ length: 22 }, () => [0.07, 0, 0])) }])
    const c = clips.get('combat:rifle:locomote_run_front')
    expect(c?.frames).toBe(22)
    expect(c?.cycle).toBeCloseTo(22 / 30)
    expect(c?.once).toBeCloseTo(21 / 30)
    expect(c?.stride).toBeCloseTo(1.54)
    expect(c?.dir[0]).toBeCloseTo(1)
    expect(c?.tracks.map((t) => [t.bone, t.size, t.keys])).toEqual([['b_pelvis', 4, 22], ['b_pelvis', 3, 1]])
    expect(clips.bones()).toEqual(['b_pelvis'])
  })

  it('lit la cadence propre et garde 30 Hz pour un ancien GLB', () => {
    const a = new THREE.AnimationClip('a', -1, [quat('b_pelvis', 1)])
    const b = new THREE.AnimationClip('b', -1, [quat('b_pelvis', 1)])
    const clips = clipsOf([a, b], [
      { name: 'a', extras: { levelupAnimation: { frameCount: 72, frameRate: 60, durationSeconds: 1.2 } } },
      { name: 'b', extras: extras(72) },
    ])
    expect(clips.get('a')).toMatchObject({ frameRate: 60, cycle: 1.2, once: 71 / 60 })
    expect(clips.get('b')).toMatchObject({ frameRate: 30, cycle: 2.4 })
  })
  it('un clip qui bouge à peine reste sur place (foulée 0, sans sens)', () => {
    const anim = new THREE.AnimationClip('combat:rifle:idle', -1, [quat('b_pelvis', 1)])
    const c = clipsOf([anim], [{ name: anim.name, extras: extras(156, [[0.0001, 0, 0]]) }]).get('combat:rifle:idle')
    expect(c?.stride).toBe(0)
    expect(c?.dir).toEqual([0, 0])
  })

  it('écarte sans bruit l’échelle unité des os d’aide, journalise en une ligne les pistes illisibles', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const anim = new THREE.AnimationClip('combat:rifle:idle', -1, [
      quat('b_spine1', 4),
      scale('b_r_shoulder_helper1', 1),
      scale('b_l_shoulder_helper1', 1),
      quat('b_head', 3),
      scale('b_odd', 1.2),
    ])
    const c = clipsOf([anim], [{ name: anim.name, extras: extras(4) }]).get('combat:rifle:idle')
    expect(c?.tracks.map((t) => t.bone)).toEqual(['b_spine1'])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][2])).toContain('b_head.quaternion (3)')
    expect(String(warn.mock.calls[0][2])).toContain('b_odd.scale (1)')
    warn.mockRestore()
  })

  it('écarte une animation sans nombre d’images, ou dont le JSON ne correspond pas', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const a = new THREE.AnimationClip('a', -1, [quat('b_pelvis', 1)])
    const b = new THREE.AnimationClip('b', -1, [quat('b_pelvis', 1)])
    const clips = clipsOf([a, b], [{ name: 'a' }, { name: 'autre', extras: extras(4) }])
    expect(clips.names()).toEqual([])
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})

describe('registerSpartanClips', () => {
  it('range le catalogue à côté de sa source ; rien pour une autre', () => {
    const source = new THREE.Group()
    const clips = clipsOf([], [])
    expect(spartanClipsOf(source)).toBeNull()
    registerSpartanClips(source, clips)
    expect(spartanClipsOf(source)).toBe(clips)
    expect(spartanClipsOf(new THREE.Group())).toBeNull()
  })
})
