// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * armorLibrary3d.ts — THE ARMOR PIECE LIBRARY on the view side: the index, then each GLB
 * (skinned piece or rigid accessory) loaded ONCE per session, geometries, materials and
 * images shared by every player who wears it. The copies placed on a player (`spartanArmor3d`)
 * own none of what comes from here; `dispose` releases it once.
 *
 * A GLB's images are neighboring files (relative URI, named by hash) that several pieces
 * name: a loader plugin (`SharedTextures`) downloads and decodes each one only once for the
 * whole library.
 *
 * A material painted by the view (`extras.surfaceBrute`) receives its raw masks in
 * `userData.armorMaps` (`armorMaterial3d.ArmorMaps`) and its geometry the attribute the
 * material reads. The coating table (`coatings.json`), a coating file and the gradient images
 * (`swatch-<id>.png`, layers of `gradients`, `armorGradients3d`) are also each read once per
 * session.
 *
 * A file that fails to load returns null, logged once; the caller falls back to its own
 * fallback. GLB downloads are capped at `MAX_LOADS` at a time: replay does not wait for them.
 */
import * as THREE from 'three'
import { GLTFLoader, type GLTFLoaderPlugin, type GLTFParser } from 'three/addons/loaders/GLTFLoader.js'

import { API_BASE_URL, api } from '@/lib/api/client'

import type { CoatingFile, CoatingTable } from './armorCoating3d'
import { GradientAtlas, SWATCH_SIZE, redBlue } from './armorGradients3d'
import { prepareArmorUVs, type ArmorMaps } from './armorMaterial3d'
import { ARMOR_INDEX_SCHEMA, type ArmorIndex } from './armorPlan3d'
import { fetchMesh } from './meshFetch'
import { withMeshopt } from './meshoptGeometry3d'
import { surfaceModelBytes } from './sessionResourceBytes3d'
import { prepareModel } from './weaponModels3d'

/** Simultaneous GLB downloads, at most. */
const MAX_LOADS = 6
const INDEX_FILE = 'index.json'
const COATINGS_FILE = 'coatings.json'
/** The extras key of a painted material (`himap.CleSurfaceBrute`). */
const RAW_SURFACE = 'surfaceBrute'

/** What the library asks of the network (replaced in tests). */
export interface ArmorLibraryIO {
  /** fetchJson returns the JSON document at `url` (index, table, and coating files). */
  fetchJson(url: string, signal: AbortSignal): Promise<unknown>
  /** loadSwatch returns the image at `url` of a gradient as a layer (`armorGradients3d.LAYER_BYTES`). */
  loadSwatch(url: string, signal: AbortSignal): Promise<Uint8Array>
  /**
   * loadGlb returns the scene of the GLB at `url`, its relative images resolved against
   * `base`; `textures`: the session's already-shared images.
   */
  loadGlb(url: string, base: string, textures: TextureShare, signal: AbortSignal): Promise<THREE.Object3D>
}

/** A session's shared images, by URI and sampler. */
export type TextureShare = Map<string, Promise<THREE.Texture>>

export class ArmorLibrary {
  private indexLoad: Promise<ArmorIndex | null> | null = null
  private readonly json = new Map<string, Promise<unknown>>()
  private readonly swatches = new Map<string, Promise<number | null>>()
  /** The session's loaded gradients, one layer each. */
  readonly gradients = new GradientAtlas()
  private readonly files = new Map<string, Promise<THREE.Object3D | null>>()
  private readonly owned: THREE.Object3D[] = []
  private readonly textures: TextureShare = new Map()
  private readonly abort = new AbortController()
  private readonly queue: (() => void)[] = []
  private active = 0
  private disposed = false
  private readonly base: string
  private readonly io: ArmorLibraryIO
  /** Called after a piece/accessory GLB or a swatch finishes loading: the library's own byte
   *  count (`loadedBytes`) just grew, so its session-cache entry (`sessionAssetCache3d.ts`) is
   *  stale. The caller re-stores it with a fresh count; never called on dispose or a failed load. */
  private readonly onGrowth?: () => void

  /** `base`: the library's served folder (`…/replay/spartan-pieces`). */
  constructor(base: string, io: ArmorLibraryIO = defaultIO, onGrowth?: () => void) {
    this.base = base
    this.io = io
    this.onGrowth = onGrowth
  }

  /**
   * loadedBytes: the estimated footprint of what's loaded so far (geometries and textures of
   * owned GLBs, gradients) — for the session cache (`sessionAssetCache3d.ts`), which otherwise
   * knows no size (`storeArmorLibrary`'s `knownBytes`) and can never evict the library.
   */
  loadedBytes(): number {
    let bytes = this.gradients.bytes
    for (const root of this.owned) bytes += surfaceModelBytes(root)
    return bytes
  }

  /** index returns the library's index (one read per session), null if unreadable. */
  index(): Promise<ArmorIndex | null> {
    this.indexLoad ??= this.io.fetchJson(`${this.base}/${INDEX_FILE}`, this.abort.signal).then(
      (doc) => {
        const ix = doc as ArmorIndex
        if (ix.schema === ARMOR_INDEX_SCHEMA) return ix
        console.warn('3D replay: unknown schema for the armor pieces index', ix.schema)
        return null
      },
      (err: unknown) => {
        if (!this.abort.signal.aborted) console.warn('3D replay: unreadable armor pieces index', err)
        return null
      },
    )
    return this.indexLoad
  }

  /** coatings returns the coating table (`coatings.json`), null if it can't be read. */
  coatings(): Promise<CoatingTable | null> {
    return this.document(COATINGS_FILE) as Promise<CoatingTable | null>
  }

  /** coating returns the coating keyed `key` (`coating-<key>.json`), null if it isn't in the library. */
  coating(key: string): Promise<CoatingFile | null> {
    return this.document(`coating-${key}.json`) as Promise<CoatingFile | null>
  }

  /** swatch returns the layer of gradient `id` (`swatch-<id>.png`) in `gradients`, null if it fails to load. */
  swatch(id: string): Promise<number | null> {
    let p = this.swatches.get(id)
    if (!p) {
      p = this.io.loadSwatch(`${this.base}/swatch-${id}.png`, this.abort.signal).then(
        (pixels) => {
          if (this.disposed) return null
          const layer = this.gradients.add(id, pixels)
          this.onGrowth?.()
          return layer
        },
        (err: unknown) => {
          if (!this.abort.signal.aborted) console.warn('3D replay: coating gradient not loaded', id, err)
          return null
        },
      )
      this.swatches.set(id, p)
    }
    return p
  }

  /** file returns the scene of the library's GLB `name` (shared: to be copied), null if it fails to load. */
  file(name: string): Promise<THREE.Object3D | null> {
    let p = this.files.get(name)
    if (!p) {
      p = this.load(name)
      this.files.set(name, p)
    }
    return p
  }

  dispose(): void {
    this.disposed = true
    this.abort.abort()
    this.queue.length = 0
    for (const root of this.owned) disposeScene(root)
    this.owned.length = 0
    this.files.clear()
    this.gradients.dispose()
    this.swatches.clear()
    this.json.clear()
  }

  /** document returns the library's JSON `name` (one read per session), null if it can't be read. */
  private document(name: string): Promise<unknown> {
    let p = this.json.get(name)
    if (!p) {
      p = this.io.fetchJson(`${this.base}/${name}`, this.abort.signal).catch((err: unknown) => {
        if (!this.abort.signal.aborted) console.warn('3D replay: unreadable coatings file', name, err)
        return null
      })
      this.json.set(name, p)
    }
    return p
  }

  private async load(name: string): Promise<THREE.Object3D | null> {
    await this.slot()
    try {
      if (this.disposed) return null
      const root = await this.io.loadGlb(`${this.base}/${name}`, `${this.base}/`, this.textures, this.abort.signal)
      if (this.disposed) {
        disposeScene(root)
        return null
      }
      this.owned.push(root)
      this.onGrowth?.()
      return root
    } catch (err) {
      if (!this.abort.signal.aborted) console.warn('3D replay: armor piece not loaded', name, err)
      return null
    } finally {
      this.release()
    }
  }

  private slot(): Promise<void> {
    if (this.active < MAX_LOADS) {
      this.active++
      return Promise.resolve()
    }
    return new Promise((resolve) => this.queue.push(() => {
      this.active++
      resolve()
    }))
  }

  private release(): void {
    this.active--
    this.queue.shift()?.()
  }
}

/** disposeScene releases the geometries, materials, and images of a loaded scene (a shared image once). */
function disposeScene(root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>()
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    o.geometry.dispose()
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const mat = m as THREE.Material
      for (const v of [...Object.values(mat), ...Object.values((mat.userData.armorMaps ?? {}) as ArmorMaps)]) {
        if (v instanceof THREE.Texture) textures.add(v)
      }
      mat.dispose()
    }
  })
  for (const t of textures) t.dispose()
}

/**
 * SharedTextures: a GLTFLoader plugin that returns, for an image already requested by
 * another GLB in the session (same URI, same sampler), the same texture. Embedded images go
 * through the normal loader.
 */
class SharedTextures implements GLTFLoaderPlugin {
  readonly name = 'LEVELUP_shared_textures'
  private readonly parser: GLTFParser
  private readonly shared: TextureShare

  constructor(parser: GLTFParser, shared: TextureShare) {
    this.parser = parser
    this.shared = shared
  }

  loadTexture(index: number): Promise<THREE.Texture> | null {
    const json = this.parser.json as {
      textures?: { source?: number; sampler?: number }[]
      images?: { uri?: string }[]
      samplers?: unknown[]
    }
    const def = json.textures?.[index]
    const uri = def?.source !== undefined ? json.images?.[def.source]?.uri : undefined
    if (!def || !uri || uri.startsWith('data:')) return null
    const key = `${uri}|${JSON.stringify(def.sampler !== undefined ? json.samplers?.[def.sampler] ?? null : null)}`
    let p = this.shared.get(key)
    if (!p) {
      p = this.parser.loadTexture(index)
      this.shared.set(key, p)
    }
    return p
  }
}

/**
 * rawMaps loads the raw masks of each painted material in the scene (`extras.surfaceBrute`:
 * glTF texture indices, -1 absent) into `userData.armorMaps`, and prepares their geometries.
 */
export async function rawMaps(scene: THREE.Object3D, parser: GLTFParser, filter: (m: THREE.Material) => boolean = () => true): Promise<void> {
  const texture = (i: unknown): Promise<THREE.Texture | null> =>
    typeof i === 'number' && i >= 0 ? (parser.getDependency('texture', i) as Promise<THREE.Texture>) : Promise.resolve(null)
  const done = new Map<THREE.Material, Promise<void>>()
  const meshes: THREE.Mesh[] = []
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) meshes.push(o)
  })
  for (const mesh of meshes) {
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!filter(m)) continue
      const raw = m.userData[RAW_SURFACE] as { asg?: number; masque0?: number; masque1?: number } | undefined
      if (!raw) continue
      prepareArmorUVs(mesh.geometry)
      if (done.has(m)) continue
      done.set(m, Promise.all([texture(raw.asg), texture(raw.masque0), texture(raw.masque1)]).then(([asg, mask0, mask1]) => {
        m.userData.armorMaps = { asg, mask0, mask1 } satisfies ArmorMaps
      }))
    }
  }
  await Promise.all(done.values())
}

const defaultIO: ArmorLibraryIO = {
  fetchJson: (url, signal) => api.get<unknown>(url, undefined, { signal }),
  async loadSwatch(url, signal) {
    const res = await fetch(apiUrl(url), { credentials: 'include', signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    // Data, not a color: no color-space conversion and no premultiplication.
    const bitmap = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
    const canvas = new OffscreenCanvas(SWATCH_SIZE, SWATCH_SIZE)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas unavailable')
    ctx.drawImage(bitmap, 0, 0, SWATCH_SIZE, SWATCH_SIZE)
    bitmap.close()
    return redBlue(ctx.getImageData(0, 0, SWATCH_SIZE, SWATCH_SIZE).data)
  },
  async loadGlb(url, base, textures, signal) {
    const buffer = await fetchMesh(url, noProgress, signal)
    const loader = withMeshopt(new GLTFLoader()).register((parser) => new SharedTextures(parser, textures))
    const gltf = await loader.parseAsync(buffer, apiUrl(base))
    prepareModel(gltf.scene)
    await rawMaps(gltf.scene, gltf.parser)
    gltf.scene.updateMatrixWorld(true)
    return gltf.scene
  },
}

function noProgress(): void {}

/** apiUrl: the API path `path` resolved against the client base (images don't go through it). */
function apiUrl(path: string): string {
  return `${API_BASE_URL.replace(/\/$/, '')}${path}`
}
