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
 */
import * as THREE from 'three'
import type { LoadGate } from './loadGate3d'

import type { ReplaySpartan, SpartanArmorManifest } from '@/lib/replay/spartanArmor'

import { buildCoat, construirePeintureMateriaux, reportCoat, type Coat } from './armorCoat3d'
import { materiauProsthesique, peintureProsthesique, regionsProsthetiques } from './brasProsthesique3d'
import { packPaint, type ArmorMaps } from './armorMaterial3d'
import type { ArmorLibrary } from './armorLibrary3d'
import { planOutfit, type ArmorIndex, type ArmorPose, type OutfitIssue, type PlannedAttachment, type PlannedPiece } from './armorPlan3d'

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
  private disposed = false

  /** `players` : l'armure des joueurs du match (`ReplaySpartans.players`). */
  constructor(library: ArmorLibrary, players: readonly ReplaySpartan[], gate?: LoadGate) {
    this.library = library
    this.gate = gate
    for (const p of players) if (p.xuid && p.status === 'armor' && p.manifest) this.manifests.set(p.xuid, p.manifest)
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
   * peindreBras peint les matériaux de bras du joueur ; les membres prosthétiques de son manifeste
   * ne passent jamais au revêtement d'armure : ils reçoivent la peinture gunmetal
   * (`brasProsthesique3d`).
   */
  async peindreBras(xuid: string, habit: Dress, materiaux: readonly THREE.Material[]): Promise<Coat | null> {
    const manifeste = this.manifests.get(xuid)
    if (!manifeste || this.dress(xuid) !== habit || this.disposed) return null
    const prosthetiques = regionsProsthetiques(manifeste.regions)
    const aPeindre = materiaux.filter((m) => !materiauProsthesique(m, prosthetiques))
    const { coat } = await construirePeintureMateriaux(aPeindre, manifeste, this.library)
    if (this.disposed) return null
    const peinture = new Map(coat)
    for (const m of materiaux) {
      if (!materiauProsthesique(m, prosthetiques)) continue
      peinture.set(m, {
        maps: m.userData.armorMaps as ArmorMaps,
        paint: packPaint(peintureProsthesique(), () => undefined, () => {}),
        gradients: this.library.gradients.uniform,
      })
    }
    return peinture
  }

  /** dispose libère la bibliothèque (géométries, matériaux, images) ; les habits ne servent plus. */
  dispose(): void {
    this.disposed = true
    this.outfits.clear()
    this.dresses.clear()
    this.library.dispose()
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
