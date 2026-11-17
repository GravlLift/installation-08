// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * brasPieces3d.ts — LES PIÈCES DE BRAS DU JOUEUR EN PREMIÈRE PERSONNE.
 *
 * Le rig du rig-GLB embarque un squelette de bras et une armure Mark VII par défaut. Ce module
 * charge la bibliothèque de pièces du joueur (`bras.json`) et lie ses maillages à peau aux os du
 * rig par NOM, pour que le joueur porte SA propre armure à la première personne.
 *
 * `planBras` (pur) choisit la permutation du joueur pour chaque région quand la pièce existe,
 * sinon la permutation par défaut de l'index, sinon rien. `BrasPieces3d` est le chargeur (un par
 * vue) : il met le cache des pièces par fichier, applique les masques bruts et la couleur neutre,
 * et libère tout. `lierPiece` recrée un `SkinnedMesh` par pièce dont le squelette est celui du rig.
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

/** Le squelette des os de bras (80 noms) commun aux pièces et aux rigs. */
export interface BrasSkeleton {
  bones: string[]
}

/** Une pièce du catalogue : sa région, sa permutation, son fichier. */
export interface BrasPiece {
  key: string
  region: string
  permutation: string
  file: string
  triangles: number
  bbox: { min: number[]; max: number[] }
  bytes: number
}

/** Le catalogue des pièces de bras (`bras.json`). */
export interface BrasIndex {
  schema: number
  skeleton: BrasSkeleton
  pieces: BrasPiece[]
  default: Record<string, string>
  failures: unknown[]
}

/** Une région du choix du joueur. */
export interface BrasRegion {
  region_key: string
  permutation_key: string
}

/**
 * planBras : pour chaque région de l'index, la permutation du joueur si sa pièce existe, sinon la
 * permutation par défaut si elle existe, sinon rien. `regions === null` donne le jeu par défaut.
 * L'ordre de sortie est stable (trié par clé). Les régions hors de l'index sont ignorées.
 */
export function planBras(index: BrasIndex, regions: readonly BrasRegion[] | null): BrasPiece[] {
  const parPiece = new Map(index.pieces.map((p) => [p.key, p]))
  const choix = new Map<string, string>()
  if (regions) for (const r of regions) choix.set(r.region_key, r.permutation_key)

  const result: BrasPiece[] = []
  for (const region of Object.keys(index.default)) {
    const playerPerm = choix.get(region)
    let piece: BrasPiece | undefined
    if (playerPerm) piece = parPiece.get(`${region}-${playerPerm}`)
    if (!piece) piece = parPiece.get(`${region}-${index.default[region]}`)
    if (piece) result.push(piece)
  }
  result.sort((a, b) => a.key.localeCompare(b.key))
  return result
}

/**
 * lierPiece : pour chaque SkinnedMesh de la scène de la pièce, un NOUVEAU SkinnedMesh partageant
 * la géométrie et les matériaux, lié à un squelette dont les os sont ceux du RIG (trouvés par
 * nom dans l'ordre des os du squelette de la pièce), avec les boneInverses de la pièce (clonés).
 * Les os manquants dans le rig sont nommés une fois et le maillage est sauté.
 */
export function lierPiece(piece: THREE.Object3D, rigRoot: THREE.Object3D): THREE.SkinnedMesh[] {
  const result: THREE.SkinnedMesh[] = []
  const manquants = new Set<string>()
  piece.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh)) return
    const osRig: THREE.Object3D[] = []
    let saute = false
    for (const os of o.skeleton.bones) {
      const cible = rigRoot.getObjectByName(os.name)
      if (!cible) { manquants.add(os.name); saute = true; break }
      osRig.push(cible)
    }
    if (saute) return
    const squelette = new THREE.Skeleton(osRig as THREE.Bone[], o.skeleton.boneInverses.map((m) => m.clone()))
    const maillage = new THREE.SkinnedMesh(o.geometry, o.material)
    maillage.bind(squelette, o.bindMatrix.clone())
    maillage.frustumCulled = false
    result.push(maillage)
  })
  if (manquants.size) {
    console.warn(`rejeu 3D : os du rig manquants pour les pièces de bras : ${[...manquants].join(', ')}`)
  }
  return result
}

/**
 * BrasPieces3d : le chargeur des pièces de bras d'une vue. Un par `BrasPremierePersonne3d`.
 * Récupère `bras.json` une fois, charge chaque pièce GLB à la demande (cache par nom de fichier,
 * promise), applique les masques bruts et la couleur neutre, et libère géométries, matériaux et
 * textures au `dispose`.
 */
export class BrasPieces3d {
  private readonly dossier: string
  private readonly signal: AbortSignal
  private readonly cache = new Map<string, Promise<THREE.Object3D | null>>()
  private indexPromise: Promise<BrasIndex | null> | null = null
  /** Les matériaux de bras chargés, pour la peinture. */
  materiaux: THREE.Material[] = []
  /** The renderer's KTX2 loader (ktx2Textures3d); null = load PNG only (older cache). */
  private readonly ktx2: KTX2Loader | null

  constructor(dossier: string, signal: AbortSignal, ktx2: KTX2Loader | null = null) {
    this.dossier = dossier
    this.signal = signal
    this.ktx2 = ktx2
  }

  /** index : le catalogue des pièces, récupéré une fois. */
  index(): Promise<BrasIndex | null> {
    if (!this.indexPromise) {
      this.indexPromise = (async () => {
        try {
          const r = await api.getResponse(`${this.dossier}/bras.json`, { signal: this.signal })
          return (await r.json()) as BrasIndex
        } catch (erreur: unknown) {
          if (!this.signal.aborted) console.warn('rejeu 3D : catalogue des bras indisponible', erreur)
          return null
        }
      })()
    }
    return this.indexPromise
  }

  /** piece : la scène d'une pièce (cache par fichier), ou null si absente ou en erreur. */
  piece(fichier: string): Promise<THREE.Object3D | null> {
    if (!this.cache.has(fichier)) {
      this.cache.set(fichier, this.charger(fichier))
    }
    return this.cache.get(fichier)!
  }

  /** dispose : libère toutes les pièces chargées (géométries, matériaux, textures). */
  dispose(): void {
    for (const p of this.cache.values()) {
      p.then((scene) => {
        if (scene) this.liberer(scene)
      }).catch(() => {})
    }
    this.cache.clear()
    this.indexPromise = null
    this.materiaux = []
  }

  private async charger(fichier: string): Promise<THREE.Object3D | null> {
    try {
      const buffer = await fetchMesh(`${this.dossier}/${encodeURIComponent(fichier)}`, () => {}, this.signal)
      const gltf = await withKtx2(new GLTFLoader(), this.ktx2).parseAsync(buffer, `${API_BASE_URL}${this.dossier}/`)
      if (this.signal.aborted) { this.liberer(gltf.scene); return null }
      gltf.scene.traverse((objet) => {
        if (!(objet instanceof THREE.Mesh)) return
        if (objet instanceof THREE.SkinnedMesh) objet.frustumCulled = false
        for (const materiau of Array.isArray(objet.material) ? objet.material : [objet.material]) {
          if (!estMateriauBras(materiau)) { darkMetalFallback(materiau); continue }
          materiau.color.setRGB(ARMURE_NEUTRE, ARMURE_NEUTRE, ARMURE_NEUTRE)
          materiau.roughness = RUGOSITE_ARMURE_NEUTRE
        }
      })
      await rawMaps(gltf.scene, gltf.parser, (m) => estMateriauBras(m) && !!m.userData.style)
        .catch((erreur: unknown) => console.warn('rejeu 3D : masques des pièces de bras indisponibles', erreur))
      if (this.signal.aborted) { this.liberer(gltf.scene); return null }
      gltf.scene.traverse((objet) => {
        if (!(objet instanceof THREE.Mesh)) return
        for (const m of Array.isArray(objet.material) ? objet.material : [objet.material]) {
          if (peindreMateriauBras(m, null) && !this.materiaux.includes(m)) this.materiaux.push(m)
        }
      })
      return gltf.scene
    } catch (erreur) {
      if (!this.signal.aborted) console.warn('rejeu 3D : pièce de bras indisponible', fichier, erreur)
      return null
    }
  }

  private liberer(root: THREE.Object3D): void {
    root.traverse((objet) => {
      if (!(objet instanceof THREE.Mesh)) return
      objet.geometry.dispose()
      for (const materiau of Array.isArray(objet.material) ? objet.material : [objet.material]) {
        for (const valeur of [...Object.values(materiau), ...Object.values(materiau.userData.armorMaps ?? {})]) {
          if (valeur instanceof THREE.Texture) valeur.dispose()
        }
        materiau.dispose()
      }
    })
  }
}
