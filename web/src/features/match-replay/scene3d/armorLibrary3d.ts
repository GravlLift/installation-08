// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * armorLibrary3d.ts — LA BIBLIOTHÈQUE DES PIÈCES D'ARMURE côté vue : l'index, puis chaque GLB
 * (pièce à peau ou accessoire rigide) chargé UNE fois par session, géométries, matériaux et images
 * partagés par tous les joueurs qui le portent. Les copies posées sur un joueur (`spartanArmor3d`)
 * ne possèdent rien de ce qui vient d'ici ; `dispose` le libère une fois.
 *
 * Les images d'un GLB sont des fichiers voisins (URI relative, nommés par empreinte) que plusieurs
 * pièces nomment : un greffon du chargeur (`SharedTextures`) n'en télécharge et n'en décode chacune
 * qu'une fois pour toute la bibliothèque.
 *
 * Un matériau peint par la vue (`extras.surfaceBrute`) reçoit ses masques bruts en
 * `userData.armorMaps` (`armorMaterial3d.ArmorMaps`) et sa géométrie l'attribut que le matériau lit.
 * La table des revêtements (`coatings.json`), le fichier d'un revêtement et les images des dégradés
 * (`swatch-<id>.png`, couches de `gradients`, `armorGradients3d`) se lisent aussi une fois par session.
 *
 * Un fichier qui ne se charge pas rend null, journalisé une fois ; l'appelant retombe sur son repli.
 * Les téléchargements de GLB sont bornés à `MAX_LOADS` à la fois : le rejeu ne les attend pas.
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

/** Téléchargements de GLB simultanés au plus. */
const MAX_LOADS = 6
const INDEX_FILE = 'index.json'
const COATINGS_FILE = 'coatings.json'
/** La clé des extras d'un matériau peint (`himap.CleSurfaceBrute`). */
const RAW_SURFACE = 'surfaceBrute'

/** Ce que la bibliothèque demande au réseau (remplacé dans les tests). */
export interface ArmorLibraryIO {
  /** fetchJson rend le document JSON `url` (index, table et fichiers des revêtements). */
  fetchJson(url: string, signal: AbortSignal): Promise<unknown>
  /** loadSwatch rend l'image `url` d'un dégradé en couche (`armorGradients3d.LAYER_BYTES`). */
  loadSwatch(url: string, signal: AbortSignal): Promise<Uint8Array>
  /**
   * loadGlb rend la scène du GLB `url`, ses images relatives résolues contre `base` ; `textures` :
   * les images déjà partagées de la session.
   */
  loadGlb(url: string, base: string, textures: TextureShare, signal: AbortSignal): Promise<THREE.Object3D>
}

/** Les images partagées d'une session, par URI et échantillonneur. */
export type TextureShare = Map<string, Promise<THREE.Texture>>

export class ArmorLibrary {
  private indexLoad: Promise<ArmorIndex | null> | null = null
  private readonly json = new Map<string, Promise<unknown>>()
  private readonly swatches = new Map<string, Promise<number | null>>()
  /** Les dégradés chargés de la session, une couche chacun. */
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

  /** `base` : le dossier servi de la bibliothèque (`…/replay/spartan-pieces`). */
  constructor(base: string, io: ArmorLibraryIO = defaultIO, onGrowth?: () => void) {
    this.base = base
    this.io = io
    this.onGrowth = onGrowth
  }

  /**
   * loadedBytes : l'empreinte estimée de ce qui est chargé jusqu'ici (géométries et textures des
   * GLB possédés, dégradés) — pour le cache de session (`sessionAssetCache3d.ts`), qui ne connaît
   * sinon aucune taille (`storeArmorLibrary`'s `knownBytes`) et ne peut jamais évincer la bibliothèque.
   */
  loadedBytes(): number {
    let bytes = this.gradients.bytes
    for (const root of this.owned) bytes += surfaceModelBytes(root)
    return bytes
  }

  /** index rend l'index de la bibliothèque (une lecture par session), null s'il est illisible. */
  index(): Promise<ArmorIndex | null> {
    this.indexLoad ??= this.io.fetchJson(`${this.base}/${INDEX_FILE}`, this.abort.signal).then(
      (doc) => {
        const ix = doc as ArmorIndex
        if (ix.schema === ARMOR_INDEX_SCHEMA) return ix
        console.warn('rejeu 3D : index des pièces d’armure de schéma inconnu', ix.schema)
        return null
      },
      (err: unknown) => {
        if (!this.abort.signal.aborted) console.warn('rejeu 3D : index des pièces d’armure illisible', err)
        return null
      },
    )
    return this.indexLoad
  }

  /** coatings rend la table des revêtements (`coatings.json`), null si elle ne se lit pas. */
  coatings(): Promise<CoatingTable | null> {
    return this.document(COATINGS_FILE) as Promise<CoatingTable | null>
  }

  /** coating rend le revêtement de clé `key` (`coating-<key>.json`), null s'il n'est pas dans la bibliothèque. */
  coating(key: string): Promise<CoatingFile | null> {
    return this.document(`coating-${key}.json`) as Promise<CoatingFile | null>
  }

  /** swatch rend la couche du dégradé `id` (`swatch-<id>.png`) dans `gradients`, null s'il ne se charge pas. */
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
          if (!this.abort.signal.aborted) console.warn('rejeu 3D : dégradé de revêtement non chargé', id, err)
          return null
        },
      )
      this.swatches.set(id, p)
    }
    return p
  }

  /** file rend la scène du GLB `name` de la bibliothèque (partagée : à copier), null s'il ne se charge pas. */
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

  /** document rend le JSON `name` de la bibliothèque (une lecture par session), null s'il ne se lit pas. */
  private document(name: string): Promise<unknown> {
    let p = this.json.get(name)
    if (!p) {
      p = this.io.fetchJson(`${this.base}/${name}`, this.abort.signal).catch((err: unknown) => {
        if (!this.abort.signal.aborted) console.warn('rejeu 3D : fichier des revêtements illisible', name, err)
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
      if (!this.abort.signal.aborted) console.warn('rejeu 3D : pièce d’armure non chargée', name, err)
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

/** disposeScene libère géométries, matériaux et images d'une scène chargée (une image partagée une fois). */
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
 * SharedTextures : greffon de GLTFLoader qui rend, pour une image déjà demandée par un autre GLB de
 * la session (même URI, même échantillonneur), la même texture. Les images embarquées passent par
 * le chargeur normal.
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
 * rawMaps charge les masques bruts de chaque matériau peint de la scène (`extras.surfaceBrute` :
 * rangs glTF des textures, -1 absente) en `userData.armorMaps`, et prépare leurs géométries.
 */
export async function rawMaps(scene: THREE.Object3D, parser: GLTFParser, filtre: (m: THREE.Material) => boolean = () => true): Promise<void> {
  const texture = (i: unknown): Promise<THREE.Texture | null> =>
    typeof i === 'number' && i >= 0 ? (parser.getDependency('texture', i) as Promise<THREE.Texture>) : Promise.resolve(null)
  const done = new Map<THREE.Material, Promise<void>>()
  const meshes: THREE.Mesh[] = []
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) meshes.push(o)
  })
  for (const mesh of meshes) {
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!filtre(m)) continue
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
    // Des données, pas une couleur : ni conversion d'espace colorimétrique ni prémultiplication.
    const bitmap = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
    const canvas = new OffscreenCanvas(SWATCH_SIZE, SWATCH_SIZE)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canevas 2D indisponible')
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

/** apiUrl : le chemin d'API `path` résolu contre la base du client (les images ne passent pas par lui). */
function apiUrl(path: string): string {
  return `${API_BASE_URL.replace(/\/$/, '')}${path}`
}
