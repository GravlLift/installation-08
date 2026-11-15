/**
 * armory3d.ts — L'ARMURE DE CHAQUE JOUEUR DU MATCH, prête à poser : pour chaque joueur dont le
 * manifeste est servi (`status = armor`), le plan de ses pièces (`armorPlan3d`), chargées par la
 * bibliothèque de la session (`armorLibrary3d`), devient une TENUE (`Outfit`) : les maillages source
 * de ses pièces à peau et de ses accessoires, que `spartanArmor3d` copie sur le Spartan du joueur.
 *
 * Paresseuse : l'habit d'un joueur (`Dress` : sa tenue et sa peinture, `armorCoat3d`) se construit à
 * sa première demande (`dress`), et null est rendu tant qu'il n'est pas prêt : le joueur garde le
 * Spartan par défaut, puis change d'armure à l'arrivée de la sienne, peinte. Deux joueurs de même
 * géométrie (`config_hash`) partagent la tenue ; chacun a sa peinture (revêtement, visière).
 *
 * Chaque tenue est rapportée UNE fois à la console : pièces posées, régions vides, et tout écart
 * nommé (pièce en repli et pourquoi, accessoire non posé) ; chaque peinture aussi, avec ses replis.
 * Rien n'est substitué en silence.
 *
 * Les armes du joueur se peignent aussi (`weaponCoat3d`, sur la bibliothèque des armes,
 * `weaponsPath` de la construction) : le modèle en main est peint en 3e personne
 * (`peindreArme`/`coatArme`), le rig de 1re personne dans `peindreBras` (les matériaux dont la
 * liste n'est pas dans la table d'armure sont ceux de l'arme).
 */
import * as THREE from 'three'
import type { LoadGate } from './loadGate3d'

import type { ReplaySpartan, SpartanArmorManifest, WeaponCoating } from '@/lib/replay/spartanArmor'

import { buildCoat, construirePeintureMateriaux, reportCoat, type Coat } from './armorCoat3d'
import type { MaterialStyle } from './armorCoating3d'
import { ArmorLibrary, type ArmorLibraryIO } from './armorLibrary3d'
import { planOutfit, type ArmorIndex, type ArmorPose, type OutfitIssue, type PlannedAttachment, type PlannedPiece } from './armorPlan3d'
import { construirePeintureArme, reportArme } from './weaponCoat3d'

/** Un accessoire posé : à son instance de marqueur, enfant de l'os `bone`, puis à son décalage. */
export interface OutfitRigid {
  key: string
  bone: string
  instance: ArmorPose
  offset: ArmorPose
  /** Les maillages source et leur pose dans la scène de leur GLB. */
  meshes: { mesh: THREE.Mesh; matrix: THREE.Matrix4 }[]
}

/** La tenue d'un joueur : maillages source partagés, à copier (`spartanArmor3d.dressSpartan`). */
export interface Outfit {
  /** Les os de la peau des pièces, dans l'ordre (`index.skeleton.bones`). */
  bones: readonly string[]
  skinned: THREE.SkinnedMesh[]
  rigid: OutfitRigid[]
  /** Ce que la tenue ne porte pas comme le manifeste le dit (plan et chargement). */
  issues: OutfitIssue[]
}

/** L'habit d'un joueur : sa tenue (partagée par géométrie) et sa peinture. */
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
  /** Le réseau de la bibliothèque des armes (remplacé dans les tests). */
  private readonly weaponIO?: ArmorLibraryIO
  private readonly weaponCoatings = new Map<string, WeaponCoating[]>()
  /** La bibliothèque des armes, créée à la première peinture d'arme demandée. */
  private libraryArme: ArmorLibrary | null = null
  /** La peinture des armes, en cours, par joueur et clé de modèle. */
  private readonly armesPretes = new Map<string, Promise<Coat | null>>()
  /** La peinture des armes prête, par joueur et clé de modèle (null : pas de revêtement). */
  private readonly armesCaches = new Map<string, Coat | null>()
  private disposed = false

  /**
   * `players` : l'armure des joueurs du match ; `weaponsPath` : le dossier servi de la bibliothèque
   * des armes (les revêtements d'armes se lisent dessus) ; `weaponIO` : le réseau de cette
   * bibliothèque (remplacé dans les tests).
   */
  constructor(library: ArmorLibrary, players: readonly ReplaySpartan[], gate?: LoadGate, weaponsPath: string | null = null, weaponIO?: ArmorLibraryIO) {
    this.library = library
    this.gate = gate
    this.weaponsPath = weaponsPath
    this.weaponIO = weaponIO
    for (const p of players) {
      if (!p.xuid) continue
      if (p.status === 'armor' && p.manifest) this.manifests.set(p.xuid, p.manifest)
      if (p.weapon_coatings?.length) this.weaponCoatings.set(p.xuid, p.weapon_coatings)
    }
  }

  /**
   * regions rend le choix du joueur pour chaque région du manifeste (dont la `source`, qui dit si
   * la région est un membre prosthétique), null sans manifeste.
   */
  regions(xuid: string): readonly { region_key: string; permutation_key: string; source: string }[] | null {
    const m = this.manifests.get(xuid)
    if (!m) return null
    return m.regions.map((r) => ({ region_key: r.region_key, permutation_key: r.permutation_key, source: r.source }))
  }

  /** dress rend l'habit du joueur `xuid` quand il est prêt ; null sinon (armure par défaut). */
  dress(xuid: string): Dress | null {
    const m = this.manifests.get(xuid)
    if (!m) return null
    const e = this.dresses.get(xuid)
    if (e === undefined) {
      this.dresses.set(xuid, PENDING)
      const loading = this.dressUp(xuid, m).catch((error: unknown) => {
        this.dresses.set(xuid, null)
        console.warn('rejeu 3D : armure indisponible', error)
      })
      void (this.gate?.track(loading) ?? loading)
      return null
    }
    return e === PENDING ? null : e
  }

  pending(xuid: string): boolean { return this.dresses.get(xuid) === PENDING }

  /**
   * peindreBras peint les matériaux de bras du joueur de son revêtement d'armure, as his
   * third-person Spartan is painted. Prosthetic limbs included: their pieces carry their own style
   * list (`a7d83e8c`), which a coating rarely names (3 of the 824 armor coatings), so they wear that
   * list's default style (`a7d83e8c_42c9679f`: warm gray and bronze metal, grime and scratches)
   * unless the player's coating names it, the game's rule for every list. `cleArme` : la clé du
   * modèle de l'arme du rig, quand l'arme y est peinte de son propre revêtement (`weaponCoat3d`,
   * bibliothèque des armes).
   */
  async peindreBras(xuid: string, habit: Dress, materiaux: readonly THREE.Material[], cleArme: string | null = null): Promise<Coat | null> {
    const manifeste = this.manifests.get(xuid)
    if (!manifeste || this.dress(xuid) !== habit || this.disposed) return null
    const { armure, arme } = await this.separerArme([...materiaux], cleArme)
    const { coat } = await construirePeintureMateriaux(armure, manifeste, this.library)
    if (this.disposed) return null
    const peinture = new Map(coat)
    if (arme.length > 0) {
      const libArme = this.weaponsPath ? (this.libraryArme ??= new ArmorLibrary(this.weaponsPath, this.weaponIO)) : null
      const entree = this.weaponCoatings.get(xuid)?.find((e) => e.model_key === cleArme) ?? null
      if (libArme) {
        const { coat: coatArme } = await construirePeintureArme(arme, entree?.style_key || null, libArme)
        for (const [m, p] of coatArme) peinture.set(m, p)
      }
    }
    return peinture
  }

  /**
   * peindreArme prépare en fond la peinture de l'arme `modelKey` du joueur `xuid`, sur les
   * matériaux peints du modèle : son revêtement, ou sans revêtement lu pour cette arme le style par
   * défaut de chaque liste ; null sans bibliothèque des armes (tout neutre).
   */
  peindreArme(xuid: string, modelKey: string, model: THREE.Object3D): Promise<Coat | null> {
    const key = `${xuid}:${modelKey}`
    let p = this.armesPretes.get(key)
    if (!p) {
      p = this.peindreArmeFond(xuid, modelKey, model).catch((erreur: unknown) => {
        console.warn('rejeu 3D : peinture de l’arme indisponible', erreur)
        return null
      })
      this.armesPretes.set(key, p)
    }
    return p
  }

  /** coatArme : la peinture de l'arme `modelKey`, prête et couvrante du modèle ; null en attente. */
  coatArme(xuid: string, modelKey: string, model: THREE.Object3D): Coat | null {
    const coat = this.armesCaches.get(`${xuid}:${modelKey}`)
    if (coat == null) return null
    return materiauxArmesDe(model).every((m) => coat.has(m)) ? coat : null
  }

  /** dispose libère les bibliothèques (géométries, matériaux, images) ; les habits ne servent plus. */
  dispose(): void {
    this.disposed = true
    this.outfits.clear()
    this.dresses.clear()
    this.armesPretes.clear()
    this.armesCaches.clear()
    this.libraryArme?.dispose()
    this.libraryArme = null
    this.library.dispose()
  }

  /** separerArme sépare les matériaux d'armure (liste dans la table d'armure) de ceux de l'arme. */
  private async separerArme(aPeindre: THREE.Material[], cleArme: string | null): Promise<{ armure: THREE.Material[]; arme: THREE.Material[] }> {
    if (!cleArme || !this.weaponsPath) return { armure: aPeindre, arme: [] }
    const table = await this.library.coatings()
    const arme: THREE.Material[] = []
    if (table) for (const m of aPeindre) {
      const style = m.userData.style as MaterialStyle | undefined
      if (style && table.default_styles[style.stylelist] === undefined) arme.push(m)
    }
    return { armure: aPeindre.filter((m) => !arme.includes(m)), arme }
  }

  private async peindreArmeFond(xuid: string, modelKey: string, model: THREE.Object3D): Promise<Coat | null> {
    const key = `${xuid}:${modelKey}`
    const entree = this.weaponCoatings.get(xuid)?.find((e) => e.model_key === modelKey) ?? null
    const libArme = this.weaponsPath ? (this.libraryArme ??= new ArmorLibrary(this.weaponsPath, this.weaponIO)) : null
    if (!libArme) {
      this.armesCaches.set(key, null)
      return null
    }
    // Without a coating entry for this weapon (a weapon with no core: Fuel Rod, Skewer, Energy
    // Sword), the default style of each list (`weaponCoat3d`).
    const { coat, issues } = await construirePeintureArme(materiauxArmesDe(model), entree?.style_key || null, libArme)
    if (this.disposed) return null
    reportArme(xuid, modelKey, coat, issues)
    this.armesCaches.set(key, coat)
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

  /** piece rend les maillages à peau d'une pièce, ou de son repli si elle ne se charge pas. */
  private async piece(p: PlannedPiece, index: ArmorIndex, issues: OutfitIssue[]): Promise<THREE.SkinnedMesh[]> {
    const own = skinnedOf(await this.library.file(p.file), index, p.key, issues)
    if (own) return own
    if (!p.fallback) {
      issues.push({ kind: 'piece_no_fallback', what: p.key, detail: `région ${p.region} (${p.source}) sans pièce de repli` })
      return []
    }
    issues.push({ kind: 'piece_load_failed', what: p.key, detail: `repli ${p.fallback.key} (${p.fallback.from})` })
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
 * skinnedOf : les maillages à peau de la scène d'une pièce, null si elle n'est pas chargée ou si
 * ses os ne sont pas ceux de l'index (dans l'ordre) : la peau ne se lierait pas au squelette du joueur.
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
    issues.push({ kind: 'piece_bones_mismatch', what: key, detail: `${bad.skeleton.bones.length} os` })
    return null
  }
  return out
}

/** materiauxArmesDe : les matériaux peints d'un modèle d'arme (masques bruts chargés), une fois chacun. */
function materiauxArmesDe(model: THREE.Object3D): THREE.Material[] {
  const out = new Set<THREE.Material>()
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.userData.armorMaps) out.add(m)
  })
  return [...out]
}

/** reportOutfit écrit la tenue d'un joueur une fois : ce qui est posé, et chaque écart nommé. */
function reportOutfit(xuid: string, m: SpartanArmorManifest, planned: number, empty: readonly string[], o: Outfit): void {
  const log = o.issues.length > 0 ? console.warn : console.info
  log(
    `rejeu 3D : armure ${xuid} (${m.core_id}, ${m.config_hash.slice(0, 8)}) : ${planned} pièces, ` +
      `${o.rigid.length} accessoires, ${empty.length} régions sans géométrie (${empty.join(', ')}), ` +
      `${o.issues.length} écarts`,
    o.issues.map((i) => `${i.kind} ${i.what} : ${i.detail}`),
  )
}
