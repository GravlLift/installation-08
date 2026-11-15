/**
 * weaponModels3d.ts — LES MODÈLES 3D DES ARMES, tirés du jeu installé (`cmd/mapmesh-build --armes`).
 *
 * Un GLB par arme, sous sa clé : la famille de son identifiant (GlobalID du tag `weap`, 8 chiffres
 * hexadécimaux minuscules, même règle que `meshproto.CleArme` côté serveur). Repère du modèle : axes
 * three de la carte (X vers la bouche du canon, Y vers le haut), origine à la poignée, en unités monde.
 * Le projectile de chaque type de grenade lancé a le sien, sous `grenade<rang>` (`meshproto.CleGrenade`).
 * Each equipment object of the title's manifest has its own, under its `eqip` GlobalID (same form
 * as a weapon key); a power-up pad names its item by family, resolved by `equipmentKeys3d`.
 * Le Spartan à peau (squelette du jeu, pieds à l'origine) a le sien sous `spartan` (`meshproto.CleSpartan`),
 * avec les animations du jeu, rangées à côté de sa scène (`clips3d.spartanClipsOf`).
 *
 * Un modèle se charge à sa première demande et la vue garde sa forme simple en attendant. Absent
 * (404 : pas encore construit, ou arme sans modèle), il est redemandé après `RETRY_MS` : une
 * construction lancée pendant le visionnage paraît sans recharger la page.
 *
 * Les matériaux peints (`extras.surfaceBrute`) reçoivent leurs masques bruts en `userData.armorMaps`
 * (`armorLibrary3d.rawMaps`) : la vue peint les armes du joueur de leur revêtement
 * (`weaponCoat3d`).
 */
import * as THREE from 'three'
import type { LoadGate } from './loadGate3d'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'

import { isNotFound } from '@/lib/replay/queries'

import { rawMaps } from './armorLibrary3d'
import { clipsOf, registerSpartanClips, type GltfAnimationJson, type WeaponClips } from './clips3d'
import { measureSyncPhases } from './clipSample3d'
import { EquipmentKeys } from './equipmentKeys3d'
import { darkMetalFallback } from './fallbackMetal3d'
import { FlagBanners } from './flagBanner3d'
import { fetchMesh } from './meshFetch'
import { ReticleRanges } from './reticleRanges3d'

/** Délai avant de redemander un modèle absent (ms). */
const RETRY_MS = 15_000
/** La clé du Spartan, celle de `meshproto.CleSpartan`. */
const SPARTAN_KEY = 'spartan'

/** weaponModelKey — la clé du modèle d'une arme du rejeu, null pour un identifiant qui n'en est pas une. */
export function weaponModelKey(id: string): string | null {
  const m = /^(?:0[xX])?([0-9a-fA-F]{8})([0-9a-fA-F]{8})?$/.exec(id)
  if (!m) return null
  // Un hexadécimal nu ne porte que la famille.
  if (!/^0[xX]/.test(id) && m[2]) return null
  return m[1].toLowerCase()
}

function noProgress(): void {}

type Entry = { model: THREE.Object3D } | { loading: true } | { absentUntil: number }

export class WeaponModels {
  private readonly entries = new Map<string, Entry>()
  private readonly owned: THREE.Object3D[] = []
  private readonly abort = new AbortController()
  readonly base: string
  readonly gate?: LoadGate
  /** The red-reticle ranges and zoom magnifications of the library's index (served at `base`). */
  readonly reticles: ReticleRanges
  /** The team banners of the library's index (the CTF flag's). */
  private readonly banners: FlagBanners
  /** The model key of each equipment family of the library's index (a power-up pad's item). */
  private readonly equipment: EquipmentKeys

  /** `base` : le dossier servi des modèles (`…/replay/weapons`). */
  constructor(
    base: string,
    gate?: LoadGate,
    reticles: ReticleRanges = new ReticleRanges(base),
    banners: FlagBanners = new FlagBanners(base),
    equipment: EquipmentKeys = new EquipmentKeys(base),
  ) {
    this.base = base
    this.gate = gate
    this.reticles = reticles
    this.banners = banners
    this.equipment = equipment
  }

  /** reticleRange is the red-reticle range of the weapon `id` at `zoomLevel`, null when it has none. */
  reticleRange(id: string, zoomLevel: number): number | null {
    const key = weaponModelKey(id)
    return key ? this.reticles.range(key, zoomLevel) : null
  }

  /**
   * model rend le modèle (à cloner) de l'arme `id`, null tant qu'il n'est pas là. An `id` that is
   * not a weapon identifier is read as an equipment family (a power-up pad's item,
   * `powerup_camo`) and resolves through the index's equipment table.
   */
  model(id: string): THREE.Object3D | null {
    const key = weaponModelKey(id) ?? this.equipment.key(id)
    return key ? this.byKey(key) : null
  }

  /**
   * flagModel is the model (to clone) of the flag `id` dressed with the banner of team `team`
   * (null: a flag of no team), its cloth tinted `ink` (null: the effect's white), the bare model
   * while the banner is not known; null until the model is loaded.
   */
  flagModel(id: string, team: number | null, ink: THREE.Color | null): THREE.Object3D | null {
    const key = weaponModelKey(id)
    const model = key ? this.byKey(key) : null
    return key && model ? this.banners.dress(model, key, team, ink) : null
  }

  /** spartan rend le Spartan à peau (à cloner par `SkeletonUtils`, cf. `spartan3d`), null tant qu'il n'est pas là. */
  spartan(): THREE.Object3D | null {
    return this.byKey(SPARTAN_KEY)
  }

  /** grenade rend le modèle (à cloner) du projectile de la grenade de rang `rank`, null tant qu'il n'est pas là. */
  grenade(rank: number): THREE.Object3D | null {
    return Number.isInteger(rank) && rank >= 0 ? this.byKey(`grenade${rank}`) : null
  }

  /**
   * sourcesChargees : les modèles chargés, non attachés à la scène (leurs copies le sont). Leurs
   * matériaux et textures sont partagés par les copies : les compiler et charger leurs textures
   * une fois couvre toutes les copies.
   */
  sourcesChargees(): THREE.Object3D[] {
    return this.owned
  }

  private byKey(key: string): THREE.Object3D | null {
    const e = this.entries.get(key)
    if (e && 'model' in e) return e.model
    if (e && ('loading' in e || performance.now() < e.absentUntil)) return null
    this.load(key)
    return null
  }

  dispose(): void {
    this.abort.abort()
    this.reticles.dispose()
    this.banners.dispose()
    this.equipment.dispose()
    for (const root of this.owned) {
      root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        o.geometry.dispose()
        const m = o.material as THREE.MeshStandardMaterial
        for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose()
        m.dispose()
      })
    }
    this.entries.clear()
  }

  private load(key: string): void {
    this.entries.set(key, { loading: true })
    const loading = (async () => {
      try {
        const buffer = await fetchMesh(`${this.base}/${key}.glb`, noProgress, this.abort.signal)
        const gltf = await new GLTFLoader().parseAsync(buffer, '')
        prepareModel(gltf.scene)
        await rawMaps(gltf.scene, gltf.parser).catch((erreur: unknown) => {
          if (!this.abort.signal.aborted) console.warn('rejeu 3D : masques de l’arme indisponibles', key, erreur)
        })
        if (gltf.animations.length > 0) registerClips(gltf)
        this.owned.push(gltf.scene)
        this.entries.set(key, { model: gltf.scene })
      } catch (err) {
        if (this.abort.signal.aborted) return
        if (!isNotFound(err)) console.warn('rejeu 3D : échec du chargement du modèle d’arme', key, err)
        this.entries.set(key, { absentUntil: performance.now() + RETRY_MS })
      }
    })()
    void (this.gate?.track(loading) ?? loading)
  }
}

/**
 * registerClips range les animations d'un modèle (le Spartan) à côté de sa scène : catalogue lu
 * dans les animations et le JSON du GLB (`clips3d`), phases d'accord mesurées sur une copie des os.
 */
function registerClips(gltf: GLTF): void {
  const json = gltf.parser.json as { animations?: GltfAnimationJson[]; asset?: { extras?: { weaponClips?: WeaponClips } } }
  const clips = clipsOf(gltf.animations, json.animations ?? [], json.asset?.extras?.weaponClips)
  measureSyncPhases(gltf.scene, clips)
  registerSpartanClips(gltf.scene, clips)
}

/**
 * prepareModel : facettes (les GLB de l'outil n'ont pas de normales de sommet), ombres portées,
 * métal sombre sur les matériaux sans texture (`darkMetalFallback`).
 */
export function prepareModel(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const m = o.material as THREE.MeshStandardMaterial
    darkMetalFallback(m)
    m.flatShading = true
    m.side = THREE.FrontSide
    m.needsUpdate = true
    o.castShadow = true
    o.receiveShadow = true
  })
}

/**
 * WeaponModelPool — des copies de modèles posées à chaque image (même contrat que les lots
 * d'instances : `begin`, puis `add`). Les copies partagent géométries et matériaux.
 */
export class WeaponModelPool {
  private readonly free = new Map<THREE.Object3D, THREE.Object3D[]>()
  private readonly used: THREE.Object3D[] = []
  private readonly root: THREE.Object3D

  constructor(root: THREE.Object3D) {
    this.root = root
  }

  begin(): void {
    for (const o of this.used) {
      o.visible = false
      this.free.get(o.userData.source as THREE.Object3D)?.push(o)
    }
    this.used.length = 0
  }

  /** add pose une copie de `model` à `position`, orientée par `rotation`. */
  add(model: THREE.Object3D, position: THREE.Vector3, rotation: THREE.Quaternion): void {
    let list = this.free.get(model)
    if (!list) {
      list = []
      this.free.set(model, list)
    }
    let copy = list.pop()
    if (!copy) {
      copy = model.clone()
      copy.userData.source = model
      this.root.add(copy)
    }
    copy.position.copy(position)
    copy.quaternion.copy(rotation)
    copy.visible = true
    this.used.push(copy)
  }

  dispose(): void {
    for (const list of this.free.values()) for (const o of list) this.root.remove(o)
    for (const o of this.used) this.root.remove(o)
    this.free.clear()
    this.used.length = 0
  }
}
