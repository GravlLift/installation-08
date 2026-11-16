/**
 * actionScene3d.ts — L'ACTION DU MATCH DANS LA SCÈNE 3D : le contrat des calques et leur ensemble.
 *
 * Un calque d'action lit le document et les entrées de la page (`Action3dInputs`) et pose, à chaque
 * image, ce qui est visible (tirs, vols, armes au sol, véhicules, morts...) dans ses lots de formes
 * (`actionKit`). La scène appelle `update(frame)` après avoir posé les joueurs, à l'écran comme
 * pendant un export : les formes sont dans l'image rendue, les étiquettes sont repeintes par l'export.
 *
 * Trois questions remontent des calques vers les joueurs, et l'ensemble y répond pour la scène :
 * l'arme en main (`heldWeapon`), le mouvement du Spartan (`motion`, les clips du jeu choisis par
 * `motion3d`) et la place d'un joueur embarqué (`riderAt`) : un bipède à bord ne réplique plus sa
 * position, il suit son véhicule.
 */
import * as THREE from 'three'

import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import type { Action3dInputs } from './action3dInputs'
import type { Ground, InkCache, LabelPool } from './actionKit'
import { flagBannerInk } from './flagBanner3d'
import type { Aids3d } from './aids3d'
import type { Dress, SpartanArmory } from './armory3d'
import type { DrawnWeapon } from './avatar3d'
import { BodyFx3d } from './bodyFx3d'
import type { BodyFxState } from './bodyShell3d'
import type { BakedLight } from './bakedLightShader'
import type { ClipMix } from './clipSample3d'
import type { FlashLights } from './flash3d'
import type { HeldWeapon3d } from './heldWeapon3d'
import { Motion3d } from './motion3d'
import { actionsParSlot, episodesRechargementParSlot } from './actionsFilm3d'
import { indexShotTimes, type SlotShots } from './recoilShots3d'
import { preparerEvenementsPremierePersonne } from './evenementsPremierePersonne3d'
import type { ChangementArme, EvenementsPremierePersonne } from './actionsPremierePersonne3d'
import type { EpisodeRechargement } from './rechargementPremierePersonne3d'
import type { ShotFxEntry } from '../model/shotFx'
import { newRecoil, type Recoil } from './recoil3d'
import { ShooterRecoil } from './recoilShots3d'
import type { PlayerState3d, Tracks3d } from './tracks3d'
import { weaponModelKey } from './weaponModels3d'

/** Ce que chaque calque reçoit à sa construction. */
export interface ActionContext {
  readonly doc: ReplayDocumentReady
  readonly tracks: Tracks3d
  readonly ground: Ground
  readonly ink: InkCache
  /** Le groupe où le calque pose ses lots et ses étiquettes. */
  readonly root: THREE.Group
  /** Hauteur de l'origine publiée d'un joueur au-dessus de ses pieds (u). */
  readonly originAboveFloor: number
  /** Les entrées courantes de la page : relues à chaque image (thème, tiroir, langue). */
  inputs(): Action3dInputs
  /**
   * Où se tient un joueur à l'image `frame` (axes three, pieds au sol), véhicule compris ; null
   * s'il n'est pas en vie. Le calque des véhicules y répond pour les joueurs embarqués.
   */
  playerFeet(xuid: string, frame: number): THREE.Vector3 | null
  /** Même question par emplacement de bipède (les tirs et les grenades nomment un emplacement). */
  slotState(slot: number, frame: number): PlayerState3d | null
  /** Le modèle du jeu de l'arme `id` (à cloner), null tant qu'il n'est pas chargé (`weaponModels3d`). */
  weaponModel(id: string): THREE.Object3D | null
  /**
   * The game's model of the flag `id` (to clone) dressed with the banner of team `team`, its cloth
   * tinted `ink` (`flagBannerInk`; null: the effect's white), the bare model while the banner is
   * not known, null until the model is loaded (`weaponModels3d.flagModel`).
   */
  flagModel(id: string, team: number | null, ink: THREE.Color | null): THREE.Object3D | null
  /** Le modèle du jeu du projectile de la grenade de rang `rank` (à cloner), null tant qu'il n'est pas chargé. */
  grenadeModel(rank: number): THREE.Object3D | null
  /** Le Spartan à peau du jeu (à cloner par `SkeletonUtils`), null tant qu'il n'est pas chargé. */
  spartanModel(): THREE.Object3D | null
  /** L'habit du joueur `xuid` (`armory3d`), null tant qu'il n'est pas prêt ou sans armure servie. */
  dressOf(xuid: string): Dress | null
  /**
   * The match's armory (held weapons' coatings, and the default-style paint of the map objects:
   * the pad, rack and ground weapons, `armory3d.peindreObjet`/`coatObjet`); null until it is posed
   * (the action layers may be built before the armor query answers).
   */
  armurerie?: () => SpartanArmory | null
  /**
   * L'arme que la scène dessine dans la main du joueur `xuid` à l'image posée (`avatar3d.drawnWeapon`),
   * null sans arme dessinée : l'éclair de bouche se pose au bout de son canon.
   */
  drawnWeapon(xuid: string): DrawnWeapon | null
  /** L'emplacement du bipède que la caméra porte en 1re personne à l'image `frame`, null sinon. */
  firstPersonSlot(frame: number): number | null
  /**
   * La bouche du rig de 1re personne (repère caméra) pour l'arme `held` (clé de modèle) ; true et
   * `out` rempli si le rig de cette arme est chargé, false sinon (le tir prend le modèle statique).
   */
  rigMuzzle?: (held: string | null, out: THREE.Vector3) => boolean
  /**
   * La bouche du rig de 1re personne en espace MONDE, lue à l'image rendue (`pos` et `axe` du canon
   * unitaire) ; true quand un rig visible a une bouche mesurée, false sinon (l'éclair suit le vol).
   */
  rigMuzzleWorld?: (pos: THREE.Vector3, axe: THREE.Vector3) => boolean
  /**
   * Where a first-person grapple cable leaves, in WORLD space at the rendered frame: the viewer's
   * left hand (`grapple3d_logic.fpCableStart`), written in `out`; null when the scene has no rig.
   */
  firstPersonLeftHand?: (out: THREE.Vector3) => THREE.Vector3 | null
  /**
   * La lunette est-elle montée sur la vue 1re personne de l'image rendue (les bras retirés de
   * l'écran), lue à la même image ; `null` quand la scène ne la porte pas.
   */
  scopeMounted?: () => boolean
  /** The served folder of the weapon library (its index and files), null until known. */
  weaponLibrary?: () => string | null
  /**
   * The WORLD frame of the idle-effect marker `marker` of weapon `key` on the visible first-person
   * rig (its bone's world matrix, then the marker's offset), written in `out`; false when the rig of
   * that weapon is not shown or does not carry the marker.
   */
  firstPersonEffectAnchor?: (key: string, marker: string, out: THREE.Matrix4) => boolean
  /** The length in seconds of the first-person clip `action` of weapon `key` (its rig index), null without one. */
  weaponClipSeconds?: (key: string, action: string) => number | null
  /** Les lumières des éclairs brefs : l'ensemble les ouvre et les ferme autour des calques. */
  readonly flashes: FlashLights
  /** La lumière cuite de la carte (`lighting.takeGameLight`), greffée sur les armures des joueurs. */
  readonly baked?: BakedLight | null
  /** La sonde d'environnement la plus proche d'un point (reflets éteints : null) ; sans, les joueurs se tiennent sans sonde. */
  readonly probeAt?: (position: THREE.Vector3) => THREE.Texture | null
}

export interface ActionLayer3d {
  update(frame: number): void
  /** Finish the deferred work frame `frame` needs before it is drawn (`ActionScene3d.settle`). */
  settle?(frame: number): void
  prepareCorpses?(): THREE.Object3D[]
  /** Les étiquettes du calque (repeintes dans l'image exportée). */
  readonly labels?: LabelPool
  /** Un joueur embarqué : ses pieds (axes three) sur son véhicule, ou null. */
  riderAt?(xuid: string, frame: number): THREE.Vector3 | null
  /** Le cap de son véhicule (degrés) : la caméra d'un joueur embarqué regarde où il va. */
  riderHeadingAt?(xuid: string, frame: number): number | null
  /** Les pieds du corps inerte de la victime `xuid` à l'image `frame` (axes three), écrits dans `out` ; null sans corps. */
  corpseFeet?(xuid: string, frame: number, out: THREE.Vector3): THREE.Vector3 | null
  dispose(): void
}

/**
 * L'arme en main telle que la capsule la montre : son nom, la teinte de ses tirs, son modèle du jeu
 * et la clé de ce modèle (null quand l'identifiant n'en donne pas).
 */
export interface HeldShown {
  name: string
  color: THREE.Color
  model: THREE.Object3D | null
  key: string | null
  /** Le recul de l'arme à l'image (`recoil3d`), réécrit à chaque appel pour cet emplacement. */
  recoil: Recoil
}

/** L'ensemble des calques d'action d'une scène. */
const VIDE: readonly number[] = []
const SANS_CHANGEMENT: readonly ChangementArme[] = []
const SANS_RECHARGEMENT: readonly EpisodeRechargement[] = []

export class ActionScene3d {
  private readonly ctx: ActionContext
  private readonly layers: readonly ActionLayer3d[]
  private readonly held: { at(slot: number, frame: number): HeldWeapon3d | null }
  private readonly body: BodyFx3d
  private readonly moves: Motion3d
  private readonly recoil: ShooterRecoil
  private readonly rechargements: Map<number, EpisodeRechargement[]>
  private readonly coups: Map<number, number[]>
  private readonly premieres: ReturnType<typeof preparerEvenementsPremierePersonne>
  private sourceTirs: readonly ShotFxEntry[] | null = null
  private tirs = new Map<number, SlotShots>()
  private xuidPremierePersonne = ''
  private readonly evenements: EvenementsPremierePersonne = {
    rechargements: [], coups: [], tirs: [], grenades: [], changements: [], sprints: [], slides: [], accroupis: [], sauts: [], escalades: [], usages: [], frame: 0, fps: 1,
    rechargementValide: (t, f) => this.moves.rechargementValide(this.xuidPremierePersonne, t, f),
  }
  private readonly kicks = new Map<number, Recoil>()

  constructor(
    ctx: ActionContext,
    layers: readonly ActionLayer3d[],
    held: { at(slot: number, frame: number): HeldWeapon3d | null },
  ) {
    this.ctx = ctx
    this.layers = layers
    this.held = held
    this.rechargements = episodesRechargementParSlot(ctx.doc)
    this.coups = actionsParSlot(ctx.doc, 'melee')
    this.premieres = preparerEvenementsPremierePersonne(ctx.doc, (slot, frame) => held.at(slot, frame))
    this.body = new BodyFx3d(ctx)
    this.moves = new Motion3d(ctx, (slot, frame) => held.at(slot, frame))
    this.recoil = new ShooterRecoil(ctx.doc, () => ctx.inputs())
  }

  evenementsPremierePersonne(xuid: string, slot: number, frame: number, fps: number): EvenementsPremierePersonne {
    const source = this.ctx.inputs().shotFx
    if (source !== this.sourceTirs) {
      this.sourceTirs = source
      this.tirs = indexShotTimes(source)
    }
    this.xuidPremierePersonne = xuid
    const e = this.evenements
    e.rechargements = this.rechargements.get(slot) ?? SANS_RECHARGEMENT
    e.coups = this.coups.get(slot) ?? VIDE
    e.tirs = this.tirs.get(slot)?.frames ?? VIDE
    e.grenades = this.premieres.grenades.get(slot) ?? VIDE
    e.changements = this.premieres.changements.get(slot) ?? SANS_CHANGEMENT
    e.sprints = this.premieres.sprints.get(slot) ?? []
    e.slides = this.premieres.slides.get(slot) ?? []
    const postures = this.moves.postures(slot)
    e.accroupis = postures.crouch
    e.sauts = postures.jump
    e.escalades = postures.clamber
    e.usages = this.moves.firstPersonUses(slot, fps)
    e.frame = frame
    e.fps = fps
    return e
  }

  update(frame: number): void {
    this.ctx.flashes.begin()
    for (const l of this.layers) l.update(frame)
    this.ctx.flashes.end()
  }

  /**
   * settle finishes, before frame `frame` is drawn, the work a layer otherwise spreads over the
   * frames of the view (the ragdoll bakes of the bodies visible there). The video export calls it
   * on each frame so that no encoded frame shows a stopgap; the screen never does.
   */
  settle(frame: number): void {
    for (const l of this.layers) l.settle?.(frame)
  }

  prepareCorpses(): THREE.Object3D[] {
    return this.layers.flatMap((layer) => layer.prepareCorpses?.() ?? [])
  }

  heldWeapon(slot: number, frame: number): HeldShown | null {
    const w = this.held.at(slot, frame)
    if (!w) return null
    const inputs = this.ctx.inputs()
    const fx = inputs.inks.fx
    let recoil = this.kicks.get(slot)
    if (!recoil) this.kicks.set(slot, (recoil = newRecoil()))
    return {
      name: w.name,
      color: this.ctx.ink.of(fx.tint[w.tint] || fx.core),
      model: w.flagTeam === undefined
        ? this.ctx.weaponModel(w.id)
        : this.ctx.flagModel(w.id, w.flagTeam, flagBannerInk(inputs, w.flagTeam, this.ctx.ink)),
      key: weaponModelKey(w.id),
      recoil: this.recoil.at(slot, frame, w.id, recoil),
    }
  }

  /**
   * motion : le mélange de clips du jeu du joueur à l'image (`motion3d`), écrit dans `out` ; null hors
   * vie ou sans Spartan animé. `aboard` : à bord d'un véhicule.
   */
  motion(xuid: string, frame: number, aboard: boolean, out: ClipMix): ClipMix | null {
    return this.moves.at(xuid, frame, aboard, out)
  }

  /** bodyFx : ce que le corps du joueur montre à l'image (bouclier), réécrit à chaque appel. */
  bodyFx(xuid: string, frame: number): BodyFxState {
    return this.body.at(xuid, frame)
  }

  riderAt(xuid: string, frame: number): THREE.Vector3 | null {
    for (const l of this.layers) {
      const p = l.riderAt?.(xuid, frame)
      if (p) return p
    }
    return null
  }

  riderHeadingAt(xuid: string, frame: number): number | null {
    for (const l of this.layers) {
      const h = l.riderHeadingAt?.(xuid, frame)
      if (h !== undefined && h !== null) return h
    }
    return null
  }

  /** corpseFeet : les pieds du corps inerte de `xuid` à l'image `frame` (le calque des morts y répond). */
  corpseFeet(xuid: string, frame: number, out: THREE.Vector3): THREE.Vector3 | null {
    for (const l of this.layers) {
      const p = l.corpseFeet?.(xuid, frame, out)
      if (p) return p
    }
    return null
  }

  /** aids : les repères d'analyse du tiroir 3D (`aids3d`), relus à chaque appel. */
  aids(): Aids3d {
    return this.ctx.inputs().aids
  }

  labelPools(): LabelPool[] {
    return this.layers.flatMap((l) => (l.labels ? [l.labels] : []))
  }

  dispose(): void {
    for (const l of this.layers) l.dispose()
  }
}
