// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * weaponModels3d.ts — THE WEAPONS' 3D MODELS, pulled from the installed game (`cmd/mapmesh-build --armes`).
 *
 * One GLB per weapon, under its key: its identifier's family (the `weap` tag's GlobalID, 8
 * lowercase hex digits, the same rule as the server's `meshproto.CleArme`). The model's frame:
 * the map's three.js axes (X toward the barrel's muzzle, Y up), origin at the grip, in world units.
 * Each thrown grenade kind's projectile has its own, under `grenade<rank>` (`meshproto.CleGrenade`).
 * Each equipment object of the title's manifest has its own, under its `eqip` GlobalID (same form
 * as a weapon key); a power-up pad names its item by family, resolved by `equipmentKeys3d`.
 * The skinned Spartan (the game's skeleton, feet at the origin) has its own under `spartan`
 * (`meshproto.CleSpartan`), with the game's animations, stored beside its scene (`clips3d.spartanClipsOf`).
 *
 * A model loads on its first request and the view keeps its simple shape while waiting. Absent
 * (404: not built yet, or a weapon with no model), it is requested again after `RETRY_MS`: a
 * build started during viewing shows up with no page reload.
 *
 * Painted materials (`extras.surfaceBrute`) receive their raw masks into `userData.armorMaps`
 * (`armorLibrary3d.rawMaps`): the view paints the player's weapons with their coating
 * (`weaponCoat3d`).
 */
import * as THREE from 'three'
import type { LoadGate } from './loadGate3d'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'

import { isNotFound } from '@/lib/replay/queries'

import { rawMaps } from './armorLibrary3d'
import { clipsOf, registerSpartanClips, type GltfAnimationJson, type WeaponClips } from './clips3d'
import { measureSyncPhases } from './clipSample3d'
import { EquipmentKeys } from './equipmentKeys3d'
import { darkMetalFallback } from './fallbackMetal3d'
import { FlagBanners } from './flagBanner3d'
import { graftHeroLights } from './heroLightShader3d'
import { giveFiniteNormal, shadesFaceted } from './lighting'
import { fetchMesh } from './meshFetch'
import { ReticleRanges } from './reticleRanges3d'
import { surfaceModelBytes } from './sessionResourceBytes3d'
import { withKtx2 } from './ktx2Textures3d'

/** Delay before requesting an absent model again (ms). */
const RETRY_MS = 15_000
/** The Spartan's key, `meshproto.CleSpartan`'s own. */
const SPARTAN_KEY = 'spartan'

/** weaponModelKey — the replay's model key for a weapon, null for an identifier that is not one. */
export function weaponModelKey(id: string): string | null {
  const m = /^(?:0[xX])?([0-9a-fA-F]{8})([0-9a-fA-F]{8})?$/.exec(id)
  if (!m) return null
  // A bare hex string carries only the family.
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
  /**
   * The current match's load gate, tracked for its still-pending model loads. Mutable (`useGate`):
   * this library may be session-cached (`sessionAssetCache3d`) and reused by a later match whose
   * own gate must see any load this library starts from then on, not the gate of whichever match
   * first built it.
   */
  private _gate?: LoadGate
  get gate(): LoadGate | undefined { return this._gate }
  /** useGate rebinds the match load gate this library tracks new loads against; called by the caller when a cached instance is handed to a new match. */
  useGate(gate?: LoadGate): void { this._gate = gate }
  /** The red-reticle ranges and zoom magnifications of the library's index (served at `base`). */
  readonly reticles: ReticleRanges
  /** The team banners of the library's index (the CTF flag's). */
  private readonly banners: FlagBanners
  /** The model key of each equipment family of the library's index (a power-up pad's item). */
  private readonly equipment: EquipmentKeys
  /** The renderer's KTX2 loader (ktx2Textures3d); null = load PNG only (older cache). */
  private readonly ktx2: KTX2Loader | null
  /** Called after a weapon/Spartan/grenade GLB finishes loading: `loadedBytes()` just grew, so
   *  this library's session-cache entry (`sessionAssetCache3d.ts`) is stale. The caller re-stores
   *  it with a fresh count; never called on dispose or a failed/absent load. */
  private readonly onGrowth?: () => void

  /** `base`: the served folder of models (`…/replay/weapons`). */
  constructor(
    base: string,
    gate?: LoadGate,
    reticles: ReticleRanges = new ReticleRanges(base),
    banners: FlagBanners = new FlagBanners(base),
    equipment: EquipmentKeys = new EquipmentKeys(base),
    ktx2: KTX2Loader | null = null,
    onGrowth?: () => void,
  ) {
    this.base = base
    this._gate = gate
    this.reticles = reticles
    this.banners = banners
    this.equipment = equipment
    this.ktx2 = ktx2
    this.onGrowth = onGrowth
  }

  /** loadedBytes: the estimated footprint of the models loaded so far (see `ArmorLibrary.loadedBytes`). */
  loadedBytes(): number {
    let bytes = 0
    for (const root of this.owned) bytes += surfaceModelBytes(root)
    return bytes
  }

  /** reticleRange is the red-reticle range of the weapon `id` at `zoomLevel`, null when it has none. */
  reticleRange(id: string, zoomLevel: number): number | null {
    const key = weaponModelKey(id)
    return key ? this.reticles.range(key, zoomLevel) : null
  }

  /**
   * model returns the model (to clone) of weapon `id`, null until it is there. An `id` that is
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

  /** spartan returns the skinned Spartan (to clone with `SkeletonUtils`, see `spartan3d`), null until it is there. */
  spartan(): THREE.Object3D | null {
    return this.byKey(SPARTAN_KEY)
  }

  /** grenade returns the model (to clone) of the projectile for grenade rank `rank`, null until it is there. */
  grenade(rank: number): THREE.Object3D | null {
    return Number.isInteger(rank) && rank >= 0 ? this.byKey(`grenade${rank}`) : null
  }

  /**
   * loadedSources: the loaded models, not attached to the scene (their copies are). Their
   * materials and textures are shared by the copies: compiling and loading their textures once
   * covers every copy.
   */
  loadedSources(): THREE.Object3D[] {
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
        const gltf = await withKtx2(new GLTFLoader(), this.ktx2).parseAsync(buffer, '')
        const extras = gltf.parser.json.asset?.extras as { vehicleSeats?: Record<string, [number, number, number]> } | undefined
        if (extras?.vehicleSeats) gltf.scene.userData.vehicleSeats = extras.vehicleSeats
        prepareModel(gltf.scene)
        await rawMaps(gltf.scene, gltf.parser).catch((error: unknown) => {
          if (!this.abort.signal.aborted) console.warn('3D replay: weapon masks unavailable', key, error)
        })
        if (gltf.animations.length > 0) registerClips(gltf)
        this.owned.push(gltf.scene)
        this.entries.set(key, { model: gltf.scene })
        this.onGrowth?.()
      } catch (err) {
        if (this.abort.signal.aborted) return
        if (!isNotFound(err)) console.warn('3D replay: weapon model failed to load', key, err)
        this.entries.set(key, { absentUntil: performance.now() + RETRY_MS })
      }
    })()
    void (this._gate?.track(loading) ?? loading)
  }
}

/**
 * registerClips stores a model's (the Spartan's) animations beside its scene: catalogue read
 * from the animations and the GLB's JSON (`clips3d`), sync phases measured on a copy of the bones.
 */
function registerClips(gltf: GLTF): void {
  const json = gltf.parser.json as { animations?: GltfAnimationJson[]; asset?: { extras?: { weaponClips?: WeaponClips } } }
  const clips = clipsOf(gltf.animations, json.animations ?? [], json.asset?.extras?.weaponClips)
  measureSyncPhases(gltf.scene, clips)
  registerSpartanClips(gltf.scene, clips)
}

/**
 * prepareModel: smooth on the game's vertex normals, faceted only for a GLB built before it carried
 * them (`shadesFaceted`), with a finite constant normal for the sun's shadow lookup there
 * (`giveFiniteNormal`, inert where the geometry has normals), cast and receive shadows, dark metal
 * on texture-less materials (`darkMetalFallback`).
 */
export function prepareModel(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const m = o.material as THREE.MeshStandardMaterial
    darkMetalFallback(m)
    m.flatShading = shadesFaceted(o.geometry as THREE.BufferGeometry)
    giveFiniteNormal(m)
    // A camera script's hero lights reach the weapon the model is (`heroLightShader3d`); off, nothing changes.
    graftHeroLights(m)
    m.side = THREE.FrontSide
    m.needsUpdate = true
    o.castShadow = true
    o.receiveShadow = true
  })
}

/**
 * WeaponModelPool — model copies placed on every frame (the same contract as the instance
 * batches: `begin`, then `add`). The copies share geometries and materials.
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

  /** add places a copy of `model` at `position`, oriented by `rotation`. */
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
