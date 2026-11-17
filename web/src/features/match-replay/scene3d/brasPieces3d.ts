// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * brasPieces3d.ts — THE PLAYER'S FIRST-PERSON ARM PIECES.
 *
 * The rig GLB ships with an arm skeleton and a default Mark VII armor. This module loads the
 * player's piece library (`bras.json`) and binds its skinned meshes to the rig's bones by NAME,
 * so the player wears THEIR OWN armor in first person.
 *
 * `planBras` (pure) picks the player's permutation for each region when the piece exists,
 * otherwise the index's default permutation, otherwise nothing. `BrasPieces3d` is the loader
 * (one per view): it caches pieces by file, applies the raw masks and the neutral color, and
 * disposes everything. `lierPiece` rebuilds one `SkinnedMesh` per piece whose skeleton is the
 * rig's.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'

import { api, API_BASE_URL } from '@/lib/api/client'
import { darkMetalFallback } from './fallbackMetal3d'
import { fetchMesh } from './meshFetch'
import { rawMaps } from './armorLibrary3d'
import { estMateriauBras, peindreMateriauBras } from './brasPremierePersonne3d'
import { ARMURE_NEUTRE, RUGOSITE_ARMURE_NEUTRE } from './armorMaterial3d'
import { withKtx2 } from './ktx2Textures3d'

/** The arm bone skeleton (80 names) shared by pieces and rigs. */
export interface BrasSkeleton {
  bones: string[]
}

/** A catalog piece: its region, permutation, file. */
export interface BrasPiece {
  key: string
  region: string
  permutation: string
  file: string
  triangles: number
  bbox: { min: number[]; max: number[] }
  bytes: number
}

/** The arm piece catalog (`bras.json`). */
export interface BrasIndex {
  schema: number
  skeleton: BrasSkeleton
  pieces: BrasPiece[]
  default: Record<string, string>
  failures: unknown[]
}

/** A region of the player's choice. */
export interface BrasRegion {
  region_key: string
  permutation_key: string
}

/**
 * planBras: for each region of the index, the player's permutation if its piece exists,
 * otherwise the default permutation if it exists, otherwise nothing. `regions === null` gives
 * the default set. Output order is stable (sorted by key). Regions outside the index are
 * ignored.
 */
export function planBras(index: BrasIndex, regions: readonly BrasRegion[] | null): BrasPiece[] {
  const byPiece = new Map(index.pieces.map((p) => [p.key, p]))
  const selected = new Map<string, string>()
  if (regions) for (const r of regions) selected.set(r.region_key, r.permutation_key)

  const result: BrasPiece[] = []
  for (const region of Object.keys(index.default)) {
    const playerPerm = selected.get(region)
    let piece: BrasPiece | undefined
    if (playerPerm) piece = byPiece.get(`${region}-${playerPerm}`)
    if (!piece) piece = byPiece.get(`${region}-${index.default[region]}`)
    if (piece) result.push(piece)
  }
  result.sort((a, b) => a.key.localeCompare(b.key))
  return result
}

/**
 * lierPiece: for each SkinnedMesh in the piece's scene, a NEW SkinnedMesh sharing the geometry
 * and materials, bound to a skeleton whose bones are the RIG's (found by name in the order of
 * the piece's skeleton bones), with the piece's boneInverses (cloned). Bones missing from the
 * rig are named once and the mesh is skipped.
 */
export function lierPiece(piece: THREE.Object3D, rigRoot: THREE.Object3D): THREE.SkinnedMesh[] {
  const result: THREE.SkinnedMesh[] = []
  const missing = new Set<string>()
  piece.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh)) return
    const rigBones: THREE.Object3D[] = []
    let skipped = false
    for (const bone of o.skeleton.bones) {
      const target = rigRoot.getObjectByName(bone.name)
      if (!target) { missing.add(bone.name); skipped = true; break }
      rigBones.push(target)
    }
    if (skipped) return
    const skeleton = new THREE.Skeleton(rigBones as THREE.Bone[], o.skeleton.boneInverses.map((m) => m.clone()))
    const mesh = new THREE.SkinnedMesh(o.geometry, o.material)
    mesh.bind(skeleton, o.bindMatrix.clone())
    mesh.frustumCulled = false
    result.push(mesh)
  })
  if (missing.size) {
    console.warn(`3D replay: rig bones missing for arm pieces: ${[...missing].join(', ')}`)
  }
  return result
}

/**
 * BrasPieces3d: the loader for a view's arm pieces. One per `BrasPremierePersonne3d`.
 * Fetches `bras.json` once, loads each piece GLB on demand (cached by file name, as a promise),
 * applies the raw masks and the neutral color, and disposes geometries, materials, and textures
 * on `dispose`.
 */
export class BrasPieces3d {
  private readonly folder: string
  private readonly signal: AbortSignal
  private readonly cache = new Map<string, Promise<THREE.Object3D | null>>()
  private indexPromise: Promise<BrasIndex | null> | null = null
  /** The loaded arm materials, for painting. */
  materiaux: THREE.Material[] = []
  /** The renderer's KTX2 loader (ktx2Textures3d); null = load PNG only (older cache). */
  private readonly ktx2: KTX2Loader | null

  constructor(folder: string, signal: AbortSignal, ktx2: KTX2Loader | null = null) {
    this.folder = folder
    this.signal = signal
    this.ktx2 = ktx2
  }

  /** index: the piece catalog, fetched once. */
  index(): Promise<BrasIndex | null> {
    if (!this.indexPromise) {
      this.indexPromise = (async () => {
        try {
          const r = await api.getResponse(`${this.folder}/bras.json`, { signal: this.signal })
          return (await r.json()) as BrasIndex
        } catch (error: unknown) {
          if (!this.signal.aborted) console.warn('3D replay: arm catalog unavailable', error)
          return null
        }
      })()
    }
    return this.indexPromise
  }

  /** piece: a piece's scene (cached by file), or null if missing or on error. */
  piece(file: string): Promise<THREE.Object3D | null> {
    if (!this.cache.has(file)) {
      this.cache.set(file, this.load(file))
    }
    return this.cache.get(file)!
  }

  /** dispose: releases every loaded piece (geometries, materials, textures). */
  dispose(): void {
    for (const p of this.cache.values()) {
      p.then((scene) => {
        if (scene) this.release(scene)
      }).catch(() => {})
    }
    this.cache.clear()
    this.indexPromise = null
    this.materiaux = []
  }

  private async load(file: string): Promise<THREE.Object3D | null> {
    try {
      const buffer = await fetchMesh(`${this.folder}/${encodeURIComponent(file)}`, () => {}, this.signal)
      const gltf = await withKtx2(new GLTFLoader(), this.ktx2).parseAsync(buffer, `${API_BASE_URL}${this.folder}/`)
      if (this.signal.aborted) { this.release(gltf.scene); return null }
      gltf.scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return
        if (object instanceof THREE.SkinnedMesh) object.frustumCulled = false
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (!estMateriauBras(material)) { darkMetalFallback(material); continue }
          material.color.setRGB(ARMURE_NEUTRE, ARMURE_NEUTRE, ARMURE_NEUTRE)
          material.roughness = RUGOSITE_ARMURE_NEUTRE
        }
      })
      await rawMaps(gltf.scene, gltf.parser, (m) => estMateriauBras(m) && !!m.userData.style)
        .catch((error: unknown) => console.warn('3D replay: arm piece masks unavailable', error))
      if (this.signal.aborted) { this.release(gltf.scene); return null }
      gltf.scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return
        for (const m of Array.isArray(object.material) ? object.material : [object.material]) {
          if (peindreMateriauBras(m, null) && !this.materiaux.includes(m)) this.materiaux.push(m)
        }
      })
      return gltf.scene
    } catch (error) {
      if (!this.signal.aborted) console.warn('3D replay: arm piece unavailable', file, error)
      return null
    }
  }

  private release(root: THREE.Object3D): void {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.geometry.dispose()
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of [...Object.values(material), ...Object.values(material.userData.armorMaps ?? {})]) {
          if (value instanceof THREE.Texture) value.dispose()
        }
        material.dispose()
      }
    })
  }
}
