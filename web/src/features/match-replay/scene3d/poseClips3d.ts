// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * poseClips3d.ts — THE SPARTAN'S POSE CLIPS (a "hold": an intro emote or a stance), fetched one at
 * a time from the server (`GET /api/spartan/poses/{id}`).
 *
 * A pose is served as a GLB written by the same writer as the Spartan body GLB: the same skeleton,
 * bone names and `levelupAnimation` animation extras, plus the full body mesh (about 4 MB), which
 * this loader does not keep. Only the clip survives: as soon as it is read (`clips3d`), the body's
 * geometry, materials and textures are disposed, so a hold carries no model cost. The clip is named
 * `pose:<id>`; a copy of the catalog is never mutated.
 *
 * A clip loads on its first request. An id that fails is logged once and retried no sooner than
 * `RETRY_MS` later.
 */
import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'

import { clipsOf, type GltfAnimationJson, type SpartanClip } from './clips3d'

/** Delay before requesting a failed pose again (ms). */
const RETRY_MS = 30_000

type Entry = { clip: SpartanClip } | { loading: Promise<SpartanClip | null> } | { failedUntil: number }

/** fetchUrl: the served URL of pose `id` (the default is the server's own route). */
export type PoseFetchUrl = (id: string) => string

export class PoseClips {
  private readonly entries = new Map<string, Entry>()
  private readonly abort = new AbortController()
  private readonly fetchUrl: PoseFetchUrl
  /** Called after a clip finishes loading (the scene uses it to redraw). */
  onLoad?: () => void

  constructor(fetchUrl: PoseFetchUrl = (id) => '/api/spartan/poses/' + encodeURIComponent(id)) {
    this.fetchUrl = fetchUrl
  }

  /**
   * get returns the loaded clip of pose `id`: null while it loads (the first call starts the load)
   * or after a failure (within the retry window); a failed id past its window is retried.
   */
  get(id: string): SpartanClip | null {
    const e = this.entries.get(id)
    if (e && 'clip' in e) return e.clip
    if (e && 'loading' in e) return null
    if (e && 'failedUntil' in e) {
      if (performance.now() < e.failedUntil) return null
      this.entries.delete(id)
    }
    this.load(id)
    return null
  }

  /** pending: the loads in flight, or null when none (an export waits on them before a frame). */
  pending(): Promise<unknown> | null {
    const loads: Promise<unknown>[] = []
    for (const e of this.entries.values()) if ('loading' in e) loads.push(e.loading)
    return loads.length > 0 ? Promise.all(loads) : null
  }

  /** load fetches and decodes pose `id`; resolves to the clip, or null on failure. */
  load(id: string): Promise<SpartanClip | null> {
    const e = this.entries.get(id)
    if (e && 'clip' in e) return Promise.resolve(e.clip)
    if (e && 'loading' in e) return e.loading
    if (e && 'failedUntil' in e && performance.now() < e.failedUntil) return Promise.resolve(null)
    const promise = this.fetch(id)
    this.entries.set(id, { loading: promise })
    return promise
  }

  /** dispose aborts the loads in flight. */
  dispose(): void {
    this.abort.abort()
  }

  private async fetch(id: string): Promise<SpartanClip | null> {
    let gltf: GLTF | null = null
    try {
      const response = await fetch(this.fetchUrl(id), { signal: this.abort.signal })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const buffer = await response.arrayBuffer()
      gltf = await new GLTFLoader().parseAsync(buffer, '')
      const json = gltf.parser.json as { animations?: GltfAnimationJson[] }
      const clips = clipsOf(gltf.animations, json.animations ?? [])
      const clip = clips.get(clips.names()[0])
      if (!clip) throw new Error('the pose GLB carries no animation')
      const named: SpartanClip = { ...clip, name: `pose:${id}` }
      this.entries.set(id, { clip: named })
      this.onLoad?.()
      return named
    } catch (err) {
      if (this.abort.signal.aborted) return null
      console.warn('3D replay: pose clip failed to load', id, err)
      this.entries.set(id, { failedUntil: performance.now() + RETRY_MS })
      return null
    } finally {
      if (gltf) disposeBody(gltf)
    }
  }
}

/**
 * disposeBody frees the body the pose GLB carried (its clip is already read): each mesh's geometry,
 * its materials, and their textures, so the body's memory is released.
 */
function disposeBody(gltf: GLTF): void {
  gltf.scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    o.geometry.dispose()
    const m = o.material as THREE.Material | THREE.Material[]
    const list = Array.isArray(m) ? m : [m]
    for (const material of list) {
      for (const v of Object.values(material)) if (v instanceof THREE.Texture) v.dispose()
      material.dispose()
    }
  })
}
