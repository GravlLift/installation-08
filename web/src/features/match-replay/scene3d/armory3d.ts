// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * armory3d.ts — EVERY PLAYER'S ARMOR FOR THE MATCH, ready to place: for each player whose
 * manifest is served (`status = armor`), their piece plan (`armorPlan3d`), loaded by the
 * session's library (`armorLibrary3d`), becomes an OUTFIT (`Outfit`): the source meshes of
 * their skinned pieces and accessories, which `spartanArmor3d` copies onto the player's Spartan.
 *
 * Lazy: a player's dress (`Dress`: their outfit and their paint, `armorCoat3d`) is built on
 * first request (`dress`), and null is returned until it's ready: the player keeps the
 * default Spartan, then switches to their own armor once painted. Two players with the same
 * geometry (`config_hash`) share the outfit; each has their own paint (coating, visor).
 *
 * Each dress is reported to the console ONCE: pieces placed, empty regions, and every
 * deviation named (a piece on fallback and why, an accessory not placed); each paint too,
 * with its own fallbacks. Nothing is substituted silently.
 *
 * A player's weapons are also painted (`weaponCoat3d`, against the weapon library,
 * `weaponsPath` from the constructor): the model held in third person is painted
 * (`paintWeapon`/`weaponCoat`), the first-person rig in `paintArms` (materials whose list is
 * not in the armor table are the weapon's own).
 */
import * as THREE from 'three'
import type { LoadGate } from './loadGate3d'

import type { ReplaySpartan, SpartanArmorManifest, WeaponCoating } from '@/lib/replay/spartanArmor'

import { buildCoat, buildMaterialsCoat, reportCoat, type Coat } from './armorCoat3d'
import type { MaterialStyle } from './armorCoating3d'
import { ArmorLibrary, type ArmorLibraryIO } from './armorLibrary3d'
import { planOutfit, type ArmorIndex, type ArmorPose, type OutfitIssue, type PlannedAttachment, type PlannedPiece } from './armorPlan3d'
import { buildWeaponCoat, reportWeaponCoat } from './weaponCoat3d'

/** A placed accessory: at its marker instance, child of bone `bone`, then at its offset. */
export interface OutfitRigid {
  key: string
  bone: string
  instance: ArmorPose
  offset: ArmorPose
  /** The source meshes and their pose in their GLB's scene. */
  meshes: { mesh: THREE.Mesh; matrix: THREE.Matrix4 }[]
}

/** A player's outfit: shared source meshes, to be copied (`spartanArmor3d.dressSpartan`). */
export interface Outfit {
  /** The bones of the pieces' skin, in order (`index.skeleton.bones`). */
  bones: readonly string[]
  skinned: THREE.SkinnedMesh[]
  rigid: OutfitRigid[]
  /** What the outfit is not wearing as the manifest says (plan and load). */
  issues: OutfitIssue[]
}

/** A player's dress: their outfit (shared by geometry) and their paint. */
export interface Dress {
  outfit: Outfit
  coat: Coat
}

const PENDING = 'pending' as const

export class SpartanArmory {
  private readonly manifests = new Map<string, SpartanArmorManifest>()
  private readonly outfits = new Map<string, Promise<Outfit | null>>()
  private readonly dresses = new Map<string, Dress | null | typeof PENDING>()
  private readonly library: ArmorLibrary
  private readonly gate?: LoadGate
  private readonly weaponsPath: string | null
  /** The weapon library's network (replaced in tests). */
  private readonly weaponIO?: ArmorLibraryIO
  private readonly weaponCoatings = new Map<string, WeaponCoating[]>()
  /**
   * The weapon library (coatings, gradients): the one we were given (session-cached, shared
   * across matches, `ownsWeaponLibrary = false`), else one created on first requested weapon
   * paint and owned by this armory (compatibility: calls without this parameter).
   */
  private weaponLibrary: ArmorLibrary | null
  private readonly ownsWeaponLibrary: boolean
  /** Weapon paint in progress, by player and model key. */
  private readonly weaponsPending = new Map<string, Promise<Coat | null>>()
  /** Weapon paint, ready, by player and model key (null: no coating). */
  private readonly weaponsCache = new Map<string, Coat | null>()
  /** Map object paint (stands, racks, ground): each list's default style (no player wears a
   * coating on it), once per model key. */
  private readonly objectsPending = new Map<string, Promise<Coat | null>>()
  private readonly objectsCache = new Map<string, Coat | null>()
  private disposed = false
  /** Whether `dispose` releases `library` too; false when it is session-cached (`sessionAssetCache3d`) and owned by its caller across matches. */
  private readonly ownsLibrary: boolean

  /**
   * `players`: the match players' armor; `weaponsPath`: the weapon library's served folder
   * (weapon coatings are read against it); `weaponIO`: that library's network (replaced in
   * tests); `ownsLibrary` (default true): false when `library` is shared across matches (the
   * caller releases it itself, through the session cache). `weaponLibraryArg` (optional): a
   * pre-built weapon-coating library, session-cached and shared across matches by its caller
   * (`Replay3DView.tsx`, keyed by `weaponsPath`) — never disposed here. Without one, this
   * armory builds and owns its own (the old behavior: one per match, thrown away with it).
   */
  constructor(library: ArmorLibrary, players: readonly ReplaySpartan[], gate?: LoadGate, weaponsPath: string | null = null, weaponIO?: ArmorLibraryIO, ownsLibrary = true, weaponLibraryArg?: ArmorLibrary) {
    this.library = library
    this.gate = gate
    this.weaponsPath = weaponsPath
    this.weaponIO = weaponIO
    this.ownsLibrary = ownsLibrary
    this.weaponLibrary = weaponLibraryArg ?? null
    this.ownsWeaponLibrary = weaponLibraryArg === undefined
    for (const p of players) {
      if (!p.xuid) continue
      if (p.status === 'armor' && p.manifest) this.manifests.set(p.xuid, p.manifest)
      if (p.weapon_coatings?.length) this.weaponCoatings.set(p.xuid, p.weapon_coatings)
    }
  }

  /**
   * regions returns the player's choice for each manifest region (including `source`, which
   * says whether the region is a prosthetic limb), null without a manifest.
   */
  regions(xuid: string): readonly { region_key: string; permutation_key: string; source: string }[] | null {
    const m = this.manifests.get(xuid)
    if (!m) return null
    return m.regions.map((r) => ({ region_key: r.region_key, permutation_key: r.permutation_key, source: r.source }))
  }

  /** dress returns player `xuid`'s dress once it's ready; null otherwise (default armor). */
  dress(xuid: string): Dress | null {
    const m = this.manifests.get(xuid)
    if (!m) return null
    const e = this.dresses.get(xuid)
    if (e === undefined) {
      this.dresses.set(xuid, PENDING)
      const loading = this.dressUp(xuid, m).catch((error: unknown) => {
        this.dresses.set(xuid, null)
        console.warn('3D replay: armor unavailable', error)
      })
      void (this.gate?.track(loading) ?? loading)
      return null
    }
    return e === PENDING ? null : e
  }

  pending(xuid: string): boolean { return this.dresses.get(xuid) === PENDING }

  /**
   * paintArms paints the player's arm materials from their armor coating, as his
   * third-person Spartan is painted. Prosthetic limbs included: their pieces carry their own style
   * list (`a7d83e8c`), which a coating rarely names (3 of the 824 armor coatings), so they wear that
   * list's default style (`a7d83e8c_42c9679f`: warm gray and bronze metal, grime and scratches)
   * unless the player's coating names it, the game's rule for every list. `weaponKey`: the key
   * of the rig's weapon model, when the weapon is painted there with its own coating
   * (`weaponCoat3d`, weapon library).
   */
  async paintArms(xuid: string, outfit: Dress, materials: readonly THREE.Material[], weaponKey: string | null = null): Promise<Coat | null> {
    const manifest = this.manifests.get(xuid)
    if (!manifest || this.dress(xuid) !== outfit || this.disposed) return null
    const { armor, weapon } = await this.splitWeaponMaterials([...materials], weaponKey)
    const { coat } = await buildMaterialsCoat(armor, manifest, this.library)
    if (this.disposed) return null
    const paint = new Map(coat)
    let weaponPainted = 0
    if (weapon.length > 0) {
      const weaponLib = this.weaponLibrary ?? this.ownWeaponLibrary()
      const entry = this.weaponCoatings.get(xuid)?.find((e) => e.model_key === weaponKey) ?? null
      if (weaponLib) {
        const { coat: weaponCoat } = await buildWeaponCoat(weapon, entry?.style_key || null, weaponLib)
        weaponPainted = weaponCoat.size
        for (const [m, p] of weaponCoat) paint.set(m, p)
      }
    }
    console.info(`3D replay: rig ${xuid} (${weaponKey}): ${coat.size} arm materials, ${weaponPainted} weapon materials painted`)
    return paint
  }

  /**
   * paintObject prepares in the background the default-style paint of a MAP object's weapon model (a pad or
   * rack item, a ground weapon): no player coat applies to it, so its style key is null (the
   * default style of each of its style lists). One coat per model key: ten pads of the same weapon
   * paint once. null without the weapon library (all neutral).
   */
  paintObject(modelKey: string, model: THREE.Object3D): Promise<Coat | null> {
    let p = this.objectsPending.get(modelKey)
    if (!p) {
      p = this.paintObjectAsync(modelKey, model).catch((error: unknown) => {
        console.warn('3D replay: object paint unavailable', error)
        return null
      })
      this.objectsPending.set(modelKey, p)
    }
    return p
  }

  /**
   * objectCoat: the default-style paint of the map object model `modelKey`, ready and covering its
   * painted materials; null while pending, or without the weapon library.
   */
  objectCoat(modelKey: string, model: THREE.Object3D): Coat | null {
    const coat = this.objectsCache.get(modelKey)
    if (coat == null) return null
    return weaponMaterialsOf(model).every((m) => coat.has(m)) ? coat : null
  }

  /**
   * paintWeapon prepares in the background the paint of weapon `modelKey` for player `xuid`, on
   * the model's painted materials: their coating, or without a coating read for this weapon the
   * default style of each list; null without the weapon library (all neutral).
   */
  paintWeapon(xuid: string, modelKey: string, model: THREE.Object3D): Promise<Coat | null> {
    const key = `${xuid}:${modelKey}`
    let p = this.weaponsPending.get(key)
    if (!p) {
      p = this.paintWeaponAsync(xuid, modelKey, model).catch((error: unknown) => {
        console.warn('3D replay: weapon paint unavailable', error)
        return null
      })
      this.weaponsPending.set(key, p)
    }
    return p
  }

  /** weaponCoat: weapon `modelKey`'s paint, ready and covering the model; null while pending. */
  weaponCoat(xuid: string, modelKey: string, model: THREE.Object3D): Coat | null {
    const coat = this.weaponsCache.get(`${xuid}:${modelKey}`)
    if (coat == null) return null
    return weaponMaterialsOf(model).every((m) => coat.has(m)) ? coat : null
  }

  /**
   * dispose releases the libraries (geometries, materials, images); dresses are no longer usable.
   * `library` is skipped when `ownsLibrary` is false, and `libraryArme` when `ownsWeaponLibrary` is
   * false: a session-cached library outlives this match (its caller releases/evicts it instead).
   */
  dispose(): void {
    this.disposed = true
    this.outfits.clear()
    this.dresses.clear()
    this.weaponsPending.clear()
    this.weaponsCache.clear()
    this.objectsPending.clear()
    this.objectsCache.clear()
    if (this.ownsWeaponLibrary) this.weaponLibrary?.dispose()
    this.weaponLibrary = null
    if (this.ownsLibrary) this.library.dispose()
  }

  /**
   * ownWeaponLibrary: the weapon library this armory builds and owns itself (compatibility,
   * without `libraryArme` at the constructor); null without a weapons folder. Never called when
   * `this.weaponLibrary` is already the library the caller provided.
   */
  private ownWeaponLibrary(): ArmorLibrary | null {
    if (!this.weaponsPath) return null
    this.weaponLibrary ??= new ArmorLibrary(this.weaponsPath, this.weaponIO)
    return this.weaponLibrary
  }

  /** splitWeaponMaterials separates armor materials (listed in the armor table) from weapon materials. */
  private async splitWeaponMaterials(toPaint: THREE.Material[], weaponKey: string | null): Promise<{ armor: THREE.Material[]; weapon: THREE.Material[] }> {
    if (!weaponKey || !this.weaponsPath) return { armor: toPaint, weapon: [] }
    const table = await this.library.coatings()
    const weapon: THREE.Material[] = []
    if (table) for (const m of toPaint) {
      const style = m.userData.style as MaterialStyle | undefined
      if (style && table.default_styles[style.stylelist] === undefined) weapon.push(m)
    }
    return { armor: toPaint.filter((m) => !weapon.includes(m)), weapon }
  }

  private async paintWeaponAsync(xuid: string, modelKey: string, model: THREE.Object3D): Promise<Coat | null> {
    const key = `${xuid}:${modelKey}`
    const entry = this.weaponCoatings.get(xuid)?.find((e) => e.model_key === modelKey) ?? null
    const weaponLib = this.weaponLibrary ?? this.ownWeaponLibrary()
    if (!weaponLib) {
      this.weaponsCache.set(key, null)
      return null
    }
    // Without a coating entry for this weapon (a weapon with no core: Fuel Rod, Skewer, Energy
    // Sword), the default style of each list (`weaponCoat3d`).
    const { coat, issues } = await buildWeaponCoat(weaponMaterialsOf(model), entry?.style_key || null, weaponLib)
    if (this.disposed) return null
    reportWeaponCoat(xuid, modelKey, coat, issues)
    this.weaponsCache.set(key, coat)
    return coat
  }

  private async paintObjectAsync(modelKey: string, model: THREE.Object3D): Promise<Coat | null> {
    const weaponLib = this.weaponLibrary ?? this.ownWeaponLibrary()
    if (!weaponLib) {
      this.objectsCache.set(modelKey, null)
      return null
    }
    // A map item wears the default style of each of its style lists: no player coat applies to it.
    const { coat, issues } = await buildWeaponCoat(weaponMaterialsOf(model), null, weaponLib)
    if (this.disposed) return null
    reportWeaponCoat('map', modelKey, coat, issues)
    this.objectsCache.set(modelKey, coat)
    return coat
  }

  private async dressUp(xuid: string, m: SpartanArmorManifest): Promise<void> {
    let p = this.outfits.get(m.config_hash)
    if (!p) {
      p = this.build(xuid, m)
      this.outfits.set(m.config_hash, p)
    }
    const outfit = await p
    if (this.disposed) return
    if (!outfit) {
      this.dresses.set(xuid, null)
      return
    }
    const { coat, issues } = await buildCoat(outfit, m, this.library)
    if (this.disposed) return
    this.dresses.set(xuid, { outfit, coat })
    reportCoat(xuid, m, coat, issues)
  }

  private async build(xuid: string, m: SpartanArmorManifest): Promise<Outfit | null> {
    const index = await this.library.index()
    if (this.disposed || !index) return null
    const plan = planOutfit(m, index)
    const issues = [...plan.issues]
    const skinned = (await Promise.all(plan.pieces.map((p) => this.piece(p, index, issues)))).flat()
    const rigid = (await Promise.all(plan.attachments.map((a) => this.rigid(a, issues)))).filter((r) => r !== null)
    if (this.disposed) return null
    const outfit: Outfit = { bones: index.skeleton.bones, skinned, rigid, issues }
    reportOutfit(xuid, m, plan.pieces.length, plan.empty, outfit)
    return outfit
  }

  /** piece returns a piece's skinned meshes, or its fallback's if it fails to load. */
  private async piece(p: PlannedPiece, index: ArmorIndex, issues: OutfitIssue[]): Promise<THREE.SkinnedMesh[]> {
    const own = skinnedOf(await this.library.file(p.file), index, p.key, issues)
    if (own) return own
    if (!p.fallback) {
      issues.push({ kind: 'piece_no_fallback', what: p.key, detail: `region ${p.region} (${p.source}) has no fallback piece` })
      return []
    }
    issues.push({ kind: 'piece_load_failed', what: p.key, detail: `fallback ${p.fallback.key} (${p.fallback.from})` })
    return skinnedOf(await this.library.file(p.fallback.file), index, p.fallback.key, issues) ?? []
  }

  private async rigid(a: PlannedAttachment, issues: OutfitIssue[]): Promise<OutfitRigid | null> {
    const root = await this.library.file(a.file)
    if (!root) {
      issues.push({ kind: 'attachment_load_failed', what: a.key, detail: a.slot })
      return null
    }
    const meshes: OutfitRigid['meshes'] = []
    root.traverse((o) => {
      if (o instanceof THREE.Mesh && !(o instanceof THREE.SkinnedMesh)) meshes.push({ mesh: o, matrix: o.matrixWorld.clone() })
    })
    return { key: a.key, bone: a.bone, instance: a.instance, offset: a.offset, meshes }
  }
}

/**
 * skinnedOf: a piece's scene's skinned meshes, null if it isn't loaded or if its bones aren't
 * the index's (in order): the skin would not bind to the player's skeleton.
 */
function skinnedOf(root: THREE.Object3D | null, index: ArmorIndex, key: string, issues: OutfitIssue[]): THREE.SkinnedMesh[] | null {
  if (!root) return null
  const out: THREE.SkinnedMesh[] = []
  root.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh) out.push(o)
  })
  const bones = index.skeleton.bones
  const bad = out.find((s) => s.skeleton.bones.length !== bones.length || s.skeleton.bones.some((b, i) => b.name !== bones[i]))
  if (bad) {
    issues.push({ kind: 'piece_bones_mismatch', what: key, detail: `${bad.skeleton.bones.length} bones` })
    return null
  }
  return out
}

/** weaponMaterialsOf: a weapon model's painted materials (loaded raw masks), each once. */
function weaponMaterialsOf(model: THREE.Object3D): THREE.Material[] {
  const out = new Set<THREE.Material>()
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.userData.armorMaps) out.add(m)
  })
  return [...out]
}

/** reportOutfit writes a player's outfit once: what's placed, and every deviation named. */
function reportOutfit(xuid: string, m: SpartanArmorManifest, planned: number, empty: readonly string[], o: Outfit): void {
  const log = o.issues.length > 0 ? console.warn : console.info
  log(
    `3D replay: armor ${xuid} (${m.core_id}, ${m.config_hash.slice(0, 8)}): ${planned} pieces, ` +
      `${o.rigid.length} accessories, ${empty.length} regions without geometry (${empty.join(', ')}), ` +
      `${o.issues.length} deviations`,
    o.issues.map((i) => `${i.kind} ${i.what}: ${i.detail}`),
  )
}
