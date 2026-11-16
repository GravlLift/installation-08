import * as THREE from 'three'
import type { LoadGate } from './loadGate3d'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'

import { api, API_BASE_URL } from '@/lib/api/client'
import { viewmodelScale } from '../model/fovLogic'
import { darkMetalFallback } from './fallbackMetal3d'
import { fetchMesh } from './meshFetch'
import { rawMaps } from './armorLibrary3d'
import { ARMURE_NEUTRE, RUGOSITE_ARMURE_NEUTRE } from './armorMaterial3d'
import { nouvellePosePremierePersonne, posePremierePersonne, type EvenementsPremierePersonne } from './actionsPremierePersonne3d'
import { clipDuRig, ROTATION_RIG_CAMERA, tempsDuClip, urlRig, type ClipPremierePersonne, type IndexPremierePersonne, type MarqueurEffetRig, type RigPremierePersonne } from './premierePersonne3d'
import { rigGripOf, type ViewGrip } from './viewGrip3d'
import { BrasPieces3d, type BrasIndex } from './brasPieces3d'
import { boucheMondeRig, boucheRig, boucheRigCamera, boucheRigLocale, type BoucheLocale } from './boucheRig3d'
import type { Dress, SpartanArmory } from './armory3d'
import { PreparationRig3d } from './preparationRig3d'
import type { BakedLight } from './bakedLightShader'
import { assignPlayerProbe } from './playerProbe3d'
import { HabillageRig3d } from './habillageRig3d'
import { PeintureRig3d } from './peintureRig3d'
import type { Recoil } from './recoil3d'
import { pivotDuRecul, poserReculRig } from './reculPremierePersonne3d'
import { fpCableStart } from './grapple3d_logic'
import { CamouflageRig3d } from './camouflageRig3d'
import { withKtx2 } from './ktx2Textures3d'

// La bouche du canon : en repère du porteur (`bouche`, `axe`, pour `boucheVue`) et, pour suivre le
// rig animé, en repère LOCAL de l'objet qui la porte (`porteurLocal` / `point` / `axeLocale`).
type StBouche = {
  bouche: THREE.Vector3
  axe: THREE.Vector3
  porteurLocal?: THREE.Object3D
  point?: THREE.Vector3
  axeLocale?: THREE.Vector3
}
type Entree = { materiaux: THREE.Material[]; root: THREE.Object3D; mixer: THREE.AnimationMixer; rig: RigPremierePersonne; actions: Map<string, THREE.AnimationAction>; listeActions: THREE.AnimationAction[]; clip: ClipPremierePersonne; bouche?: StBouche; pivot: THREE.Vector3 | null; mainGauche: THREE.Object3D | null } | null

// Le champ vertical (degrés) auquel les tenues et la bouche du rig ont été réglées : le
// porteur se contre-échelle à ce champ (viewmodelScale) pour en garder la projection.
const VIEWMODEL_FOV = 55
const AXE_AVANT = new THREE.Vector3(0, 0, -1)
// Bacs à sable partagés : `placer` tourne à chaque image rendue, pas d'allocation par frame.
const BAC_DEPLACEMENT = new THREE.Vector3()
const BAC_ROULIS = new THREE.Quaternion()
// Bacs de `boucheVue` et `mesurerBouche` : aucun tir ni image n'alloue.
const BAC_BOCHE_VUE = new THREE.Vector3()
const BAC_ORIGINE = new THREE.Vector3()
const BAC_IDENTITE = new THREE.Quaternion()
const BAC_AXE_RIG = new THREE.Vector3()
const BAC_MARQUEUR = new THREE.Matrix4()

/**
 * appliquerTenueRig : pose la tenue réglée du rig (viewGrip3d) sur la position et l'orientation
 * du support rig (repère de la caméra, avant la rotation du rig) : x à droite (+X), y en haut
 * (+Y), z loin de l'œil (-Z) ; le décalage est tourné par le quaternion de la caméra (donné ici,
 * avant le roulis) pour rester collé à la visée quelle que soit l'orientation ; `roll` tourne
 * autour de l'axe de la visée (une multiplication à droite de la rotation du support). Une tenue
 * nulle ne change rien.
 */
export function appliquerTenueRig(position: THREE.Vector3, quaternion: THREE.Quaternion, tenue: ViewGrip): void {
  if (tenue.x || tenue.y || tenue.z) {
    position.add(BAC_DEPLACEMENT.set(tenue.x, tenue.y, -tenue.z).applyQuaternion(quaternion))
  }
  if (tenue.roll) {
    quaternion.multiply(BAC_ROULIS.setFromAxisAngle(AXE_AVANT, tenue.roll))
  }
}

/**
 * estMateriauPeint : a raw (unbaked) rig material the view paints, arm or weapon. The library
 * writes the weapon's styled hard surfaces raw too, marked `rigWeapon`, so the held gun takes
 * its player's weapon coating.
 */
export function estMateriauPeint(materiau: THREE.Material): materiau is THREE.MeshStandardMaterial {
  return materiau instanceof THREE.MeshStandardMaterial && !!materiau.userData.surfaceBrute && !materiau.map
}

/** estMateriauBras : a raw rig material of the arms (not the weapon's, `rigWeapon`). */
export function estMateriauBras(materiau: THREE.Material): materiau is THREE.MeshStandardMaterial {
  return estMateriauPeint(materiau) && !materiau.userData.rigWeapon
}

export function peindreMateriauBras(materiau: THREE.Material, habit: Dress | null): boolean {
  return !!habit && estMateriauBras(materiau) && !!materiau.userData.style && !!materiau.userData.armorMaps
}

export function memePeinture(fichier: string, precedent: string | null, habit: Dress | null, ancien: Dress | null): boolean {
  return fichier === precedent && habit === ancien
}

/**
 * BrasPremierePersonne3d : les rigs d'arme à la première personne — chargement, pose et placement
 * du rig visible, mesure de la bouche du canon. L'habillage des bras du joueur suivi
 * (`habillageRig3d`) et leur peinture (`peintureRig3d`) sont des modules séparés, coordonnés ici :
 * un rig ne se montre que l'habillage et la peinture posés ; à l'arrivée des pièces, la peinture
 * se refait sur elles.
 */
export class BrasPremierePersonne3d {
  /** Le porteur porte la caméra (position, orientation et contre-échelle au champ). */
  private readonly porteur = new THREE.Group()
  /** Le support rig : porte la tenue réglée et la rotation du rig, au-dessus de la contre-échelle. */
  private readonly support = new THREE.Group()
  private readonly dossier: string
  private readonly gate?: LoadGate
  private readonly entrees = new Map<string, Entree>()
  private readonly abort = new AbortController()
  private readonly armes = new Map<string, RigPremierePersonne>()
  /** La clé du modèle d'arme, par fichier de rig (l'arme se peint de son revêtement, `cleArmeDe`). */
  private readonly fichiersArmes = new Map<string, string>()
  /** The idle-effect markers of each weapon's rig (the index's `effectMarkers`), by weapon key. */
  private readonly marqueursEffets = new Map<string, readonly MarqueurEffetRig[]>()
  /** The bones the markers hang on, found once per loaded rig root. */
  private readonly osEffets = new WeakMap<THREE.Object3D, Map<string, THREE.Object3D | null>>()
  private visible: THREE.Object3D | null = null
  private readonly mainMonde = new THREE.Vector3()
  private cleVisible: string | null = null
  private armurerie: SpartanArmory | null = null
  private xuid: string | null = null
  private readonly preparation: PreparationRig3d
  private readonly peinture: PeintureRig3d
  /** La lumière cuite de la carte, greffée sur les copies peintes de l'armure. */
  private readonly baked?: BakedLight | null
  /** La sonde d'environnement la plus proche d'un point (reflets éteints : null). */
  private readonly probeAt?: (position: THREE.Vector3) => THREE.Texture | null
  private readonly habillage: HabillageRig3d
  private readonly clesPrechargees = new Set<string>()
  private readonly indexPieces: Promise<BrasIndex | null>
  private readonly chargeurPieces: BrasPieces3d
  private indexPrêt = false
  private readonly pose = nouvellePosePremierePersonne()
  /** The followed player's active camo on the visible rig (`camouflageRig3d`). */
  private readonly camouflage = new CamouflageRig3d()
  /** The renderer's KTX2 loader (ktx2Textures3d); null = load PNG only (older cache). */
  private readonly ktx2: KTX2Loader | null

  constructor(scene: THREE.Scene, dossier: string, gate?: LoadGate, baked?: BakedLight | null, probeAt?: (position: THREE.Vector3) => THREE.Texture | null, ktx2: KTX2Loader | null = null) {
    this.dossier = dossier
    this.gate = gate
    this.baked = baked
    this.probeAt = probeAt
    this.ktx2 = ktx2
    scene.add(this.porteur)
    this.porteur.add(this.support)
    this.indexPieces = (async () => {
      try {
        const r = await api.getResponse(`${dossier}/bras.json`, { signal: this.abort.signal })
        return (await r.json()) as BrasIndex
      } catch (erreur: unknown) {
        if (!this.abort.signal.aborted) console.warn('rejeu 3D : catalogue des bras indisponible', erreur)
        return null
      }
    })()
    this.gate?.track(this.indexPieces)
    this.chargeurPieces = new BrasPieces3d(dossier, this.abort.signal, this.ktx2)
    this.preparation = new PreparationRig3d({
      fichiersCharges: () => [...this.entrees.entries()].filter(([, entree]) => entree).map(([fichier]) => fichier),
      materiauxDe: (fichier) => this.entrees.get(fichier)?.materiaux ?? [],
      indexPieces: () => this.indexPieces,
      piece: (fichier) => this.chargeurPieces.piece(fichier),
      armurerie: () => this.armurerie,
      xuid: () => this.xuid,
      cleArmeDe: (fichier) => this.fichiersArmes.get(fichier) ?? null,
    })
    this.peinture = new PeintureRig3d({
      xuid: () => this.xuid,
      armurerie: () => this.armurerie,
      preparation: this.preparation,
      cleArmeDe: (fichier) => this.fichiersArmes.get(fichier) ?? null,
      gate: this.gate,
      baked: this.baked ?? null,
    })
    this.habillage = new HabillageRig3d({
      indexPieces: this.indexPieces,
      chargeur: this.chargeurPieces,
      signal: this.abort.signal,
      xuid: () => this.xuid,
      armurerie: () => this.armurerie,
      materiauSource: (m) => this.peinture.materiauSource(m),
      invaliderPeinture: (fichier) => this.peinture.invalider(fichier),
      termine: (fichier, racine) => this.peinture.actualiser(fichier, racine),
      gate: this.gate,
    })
  }

  async charger(): Promise<void> {
    try {
      const reponse = await api.getResponse(`${this.dossier}/index.json`, { signal: this.abort.signal })
      const index = await reponse.json() as IndexPremierePersonne
      const rigs = new Map(index.rigs.map((rig) => [rig.file, rig]))
      for (const arme of index.weapons) {
        const rig = rigs.get(arme.file)
        if (rig) {
          this.armes.set(arme.weapon.toLowerCase(), rig)
          this.fichiersArmes.set(rig.file, arme.weapon.toLowerCase())
          if (arme.effectMarkers?.length) this.marqueursEffets.set(arme.weapon.toLowerCase(), arme.effectMarkers)
        }
      }
    } catch (erreur) {
      if (!this.abort.signal.aborted) console.warn('rejeu 3D : index première personne indisponible', erreur)
    }
    this.indexPrêt = true
    for (const cle of this.clesPrechargees) this.chargerRigDe(cle)
    this.clesPrechargees.clear()
  }

  /** precharger : le chargement des rigs des clés de modèle `cles` commence sans attendre `montrer` ; sans index chargé, les clés attendent son arrivée. */
  precharger(cles: readonly string[]): void {
    if (!this.indexPrêt) {
      for (const cle of cles) this.clesPrechargees.add(cle)
      return
    }
    for (const cle of cles) this.chargerRigDe(cle)
  }

  private chargerRigDe(cle: string): void {
    const rig = this.armes.get(cle)
    if (!rig || this.entrees.has(rig.file)) return
    this.chargerRig(rig)
  }

  suivre(armurerie: SpartanArmory | null, xuid: string | null): void {
    const change = this.armurerie !== armurerie || this.xuid !== xuid
    if (change) {
      this.peinture.changerJoueur()
      this.habillage.changerJoueur()
    }
    this.armurerie = armurerie
    this.xuid = xuid
    if (change) this.preparation.changerJoueur()
    if (xuid && armurerie && !armurerie.pending(xuid)) this.preparerRig()
  }

  /**
   * montrer pose le rig de l'arme `cleArme` à l'image (`evenements`) sous la caméra, puis le recul
   * de l'image `recul` (`reculPremierePersonne3d`) autour de la poignée, ou de la bouche mesurée
   * quand l'index ne donne pas la pose de l'arme. Faux sans rig chargé — et seulement sans rig
   * chargé : l'habillage des pièces et la peinture en cours se posent sur le rig À SON ARRIVÉE
   * (le revêtement retarde n'efface jamais le précédent), le rig se montre donc tel qu'il est à
   * l'instant — jamais replié sur le modèle statique tant que le fichier est chargé. `camo` : la
   * force du camouflage actif du joueur (0 visible, 1 entier), qui efface aussi ses bras et son arme.
   */
  montrer(camera: THREE.PerspectiveCamera, cleArme: string | null, evenements: EvenementsPremierePersonne, recul: Recoil | null, camo = 0): boolean {
    this.cacher()
    const rig = cleArme && this.armes.get(cleArme)
    if (!rig) return false
    if (!this.entrees.has(rig.file)) this.chargerRig(rig)
    const entree = this.entrees.get(rig.file)
    if (!entree) return false
    this.habillage.actualiser(rig.file, entree.root)
    this.peinture.actualiser(rig.file, entree.root)
    entree.root.visible = true
    this.visible = entree.root
    this.cleVisible = cleArme
    this.camouflage.apply(entree.root, camo)
    const pose = posePremierePersonne(entree.rig, evenements, this.pose)
    for (let i = 0; i < entree.listeActions.length; i++) entree.listeActions[i].weight = 0
    const idle = entree.actions.get(entree.clip.name)!
    const base = pose.base && entree.actions.get(pose.base.name)
    const tir = pose.tir && entree.actions.get(pose.tir.name)
    const poidsTir = tir ? pose.poidsTir : 0
    const tirRemplace = !!tir && !pose.tir?.overlay && pose.tir?.type !== 'overlay' && pose.tir?.type !== 'replacement'
    const poidsBase = base ? pose.poidsBase * (tirRemplace ? 1 - poidsTir : 1) : 0
    idle.time = tempsDuClip(entree.clip, evenements.frame, evenements.fps)
    idle.weight = (pose.base?.type === 'replacement' || pose.base?.type === 'overlay' || pose.base?.overlay ? 1 : 1 - poidsBase) * (tirRemplace ? 1 - poidsTir : 1)
    if (base) { base.time = pose.tempsBase; base.weight = poidsBase }
    if (tir) { tir.time = pose.tempsTir; tir.weight = poidsTir }
    entree.mixer.update(0)
    poserReculRig(entree.root, recul, entree.pivot ?? entree.bouche?.bouche ?? BAC_ORIGINE)
    this.placer(camera)
    return true
  }

  /**
   * placer pose le rig sous la caméra : le porteur copie la caméra et s'y contre-échelle
   * (`viewmodelScale`) dans le plan de la caméra, le support porte la tenue réglée au-dessus.
   * L'arme garde donc sa taille projetée réglée à `VIEWMODEL_FOV` pour tout champ de la caméra ;
   * la profondeur (z du porteur) n'est pas échelonnée : la distance à l'œil suit le champ, c'est
   * voulu. Les décalages de tenue, appliqués dans le repère échelonné, gardent leur projection.
   */
  placer(camera: THREE.PerspectiveCamera): void {
    camera.updateWorldMatrix(true, false)
    camera.getWorldPosition(this.porteur.position)
    camera.getWorldQuaternion(this.porteur.quaternion)
    const echelle = viewmodelScale(camera.fov, VIEWMODEL_FOV)
    this.porteur.scale.set(echelle, echelle, 1)
    this.support.position.set(0, 0, 0)
    this.support.quaternion.identity()
    appliquerTenueRig(this.support.position, this.support.quaternion, rigGripOf(this.cleVisible))
    this.support.quaternion.multiply(ROTATION_RIG_CAMERA)
    // L'armure des bras prend l'environnement de la carte là où se tient le joueur (sonde nulle : reflets éteints).
    if (this.probeAt) {
      const sonde = this.probeAt(this.porteur.position)
      for (const m of this.peinture.materiauxPeints()) assignPlayerProbe(m, sonde)
    }
  }

  /**
   * rigCharge : le rig de l'arme `cleArme` est-il connu de l'index (donc il chargera) ? Faux sans
   * index chargé ou pour une arme sans rig : le tir suit alors le modèle statique, pas le rig.
   */
  rigCharge(cleArme: string | null): boolean {
    return !!(cleArme && this.armes.get(cleArme))
  }

  /**
   * cleRigDe : la clé de modèle d'arme du rig de fichier `fichier`, null sans index chargé (le
   * préchargement en demande les clés pour le joueur suivi, `preparerJoueur`).
   */
  cleRigDe(fichier: string): string | null {
    return this.fichiersArmes.get(fichier) ?? null
  }

  /**
   * preparerJoueur : le joueur `xuid` est suivi en 1re personne — commence l'habillage des pièces et
   * la peinture de CHAQUE rig chargé (celui tenu et les autres, pour que les bascules d'arme
   * trouvent leur revêtement prêt au lieu de replier les bras sur le modèle statique). Le préchauffage
   * fait le même travail sur l'écran de chargement pour tous les joueurs.
   */
  preparerJoueur(xuid: string): void {
    this.suivre(this.armurerie, xuid)
    this.preparerRig()
  }

  /**
   * boucheVue : la bouche du rig en main, en repère CAMÉRA (x à droite, y en haut, -z vers l'avant),
   * composée comme `placer` pose le porteur pour une caméra à l'origine immobile. Faux sans rig
   * chargé pour `cleArme` (l'arme n'a pas de rig, ou il n'est pas encore chargé : le tir prend le
   * modèle statique). `out` est rempli, sans allocation.
   */
  boucheVue(cleArme: string | null, out: THREE.Vector3): boolean {
    const rig = cleArme ? this.armes.get(cleArme) : null
    const entree = rig ? this.entrees.get(rig.file) : null
    const st = entree?.bouche
    if (!rig || !entree || !st) return false
    out.copy(boucheRigCamera(st, rigGripOf(cleArme), BAC_BOCHE_VUE))
    // Le porteur est contre-échelonné dans le plan de la caméra (`placer`) : la bouche dessinée aussi.
    out.x *= this.porteur.scale.x
    out.y *= this.porteur.scale.y
    return true
  }

  /**
   * boucheMonde : la bouche du rig visible en espace MONDE, lue à l'image rendue (la matrice monde
   * du porteur local est rafraîchie), pour un rig posé par `montrer`. `pos` : la bouche, `axe` : le
   * canon unitaire, en monde. Faux sans rig visible ou sans bouche mesurée. Aucun tir ni image
   * n'alloue.
   */
  boucheMonde(pos: THREE.Vector3, axe: THREE.Vector3): boolean {
    const rig = this.cleVisible ? this.armes.get(this.cleVisible) : null
    const st = rig ? this.entrees.get(rig.file)?.bouche : null
    if (!this.visible || !st?.porteurLocal || !st.point || !st.axeLocale) return false
    boucheMondeRig(st.porteurLocal, st.point, st.axeLocale, pos, axe)
    return true
  }

  /**
   * mainGaucheMonde: where a first-person grapple cable leaves, in WORLD space at the rendered
   * frame (`grapple3d_logic.fpCableStart`): the left hand bone of the visible rig, otherwise the
   * estimated left hand carried by the camera the holder copies (`placer`). Allocates nothing.
   */
  mainGaucheMonde(out: THREE.Vector3): THREE.Vector3 {
    const rig = this.visible && this.cleVisible ? this.armes.get(this.cleVisible) : null
    const main = rig ? this.entrees.get(rig.file)?.mainGauche ?? null : null
    if (main) {
      main.updateWorldMatrix(true, false)
      main.getWorldPosition(this.mainMonde)
    }
    return fpCableStart(this.porteur.position, this.porteur.quaternion, main ? this.mainMonde : null, out)
  }

  /**
   * osMonde: the world matrix of bone `nom` of the visible rig at the rendered frame, written in
   * `out`; false without a visible rig or when it has no bone of that name (the arms rig carries the
   * arms and hands, not the body).
   */
  osMonde(nom: string, out: THREE.Matrix4): boolean {
    if (!this.visible) return false
    const os = this.visible.getObjectByName(nom)
    if (!os) return false
    os.updateWorldMatrix(true, false)
    out.copy(os.matrixWorld)
    return true
  }

  /**
   * ancreEffet: the WORLD frame of the idle-effect marker `marqueur` of weapon `cle` on the visible
   * rig, at the rendered frame: its bone's world matrix, then the marker's offset in that bone's
   * frame. False when that weapon's rig is not the one shown, or lacks the marker or its bone.
   */
  ancreEffet(cle: string, marqueur: string, out: THREE.Matrix4): boolean {
    if (!this.visible || this.cleVisible !== cle) return false
    const m = this.marqueursEffets.get(cle)?.find((x) => x.marker === marqueur)
    if (!m) return false
    let os = this.osEffets.get(this.visible)
    if (!os) this.osEffets.set(this.visible, (os = new Map()))
    if (!os.has(m.bone)) os.set(m.bone, this.visible.getObjectByName(m.bone) ?? null)
    const bone = os.get(m.bone)
    if (!bone) return false
    bone.updateWorldMatrix(true, false)
    out.copy(bone.matrixWorld).multiply(BAC_MARQUEUR.makeTranslation(m.position[0], m.position[1], m.position[2]))
    return true
  }

  /** dureeClip: the length (s) of the clip the rig of weapon `cle` plays for `action`, null without one. */
  dureeClip(cle: string, action: string): number | null {
    const rig = this.armes.get(cle)
    return rig ? clipDuRig(rig, action)?.durationSeconds ?? null : null
  }

  cacher(): void {
    if (this.visible) this.visible.visible = false
    this.visible = null
    this.cleVisible = null
  }

  /** preparerRig : prépare chaque rig chargé pour le préchauffage, pièces puis peinture. */
  preparerRig(): void {
    if (this.xuid && this.armurerie?.pending(this.xuid)) return
    for (const [fichier, entree] of this.entrees) {
      if (!entree) continue
      this.habillage.actualiser(fichier, entree.root)
      if (!this.habillage.enCours(fichier)) this.peinture.actualiser(fichier, entree.root)
    }
  }

  /** racinesChargees : les racines des rigs chargés (attachées à la scène), pour la marche des textures du préchauffage. */
  racinesChargees(): THREE.Object3D[] {
    return [...this.entrees.values()].filter((e): e is NonNullable<Entree> => !!e).map((e) => e.root)
  }

  dispose(): void {
    this.peinture.changerJoueur()
    this.habillage.changerJoueur()
    this.abort.abort()
    this.chargeurPieces.dispose()
    this.porteur.removeFromParent()
    for (const entree of this.entrees.values()) if (entree) this.liberer(entree.root)
    this.entrees.clear()
  }

  private liberer(root: THREE.Object3D): void {
    root.traverse((objet) => {
      if (!(objet instanceof THREE.Mesh)) return
      objet.geometry.dispose()
      for (const materiau of Array.isArray(objet.material) ? objet.material : [objet.material]) {
        for (const valeur of [...Object.values(materiau), ...Object.values(materiau.userData.armorMaps ?? {})]) if (valeur instanceof THREE.Texture) valeur.dispose()
        materiau.dispose()
      }
    })
  }

  /**
   * mesurerBouche : mesure UNE FOIS la bouche et l'axe du canon du rig (repère du porteur), à la pose
   * idle : le rig pose le porteur à l'origine immobile (`placer` sur une caméra à l'origine), pose
   * l'idle en t=0 (les actions se mélangent à leur poids de repos), et `boucheRig` lit les sommets
   * des maillages d'arme dans l'espace du porteur. Sans axe d'index, le canon pointe loin de l'œil.
   */
  private mesurerBouche(entree: NonNullable<Entree>): void {
    const support = this.support
    support.position.copy(BAC_ORIGINE)
    support.quaternion.copy(BAC_IDENTITE)
    const idle = entree.actions.get(entree.clip.name)
    for (let i = 0; i < entree.listeActions.length; i++) entree.listeActions[i].weight = 0
    if (idle) {
      idle.time = 0
      idle.weight = 1
    }
    entree.mixer.update(0)
    const idleWeapon = entree.rig.idleWeapon
    const axeRig = idleWeapon ? BAC_AXE_RIG.set(idleWeapon.forward[0], idleWeapon.forward[1], idleWeapon.forward[2]) : null
    const st: StBouche = { bouche: new THREE.Vector3(), axe: new THREE.Vector3() }
    if (!boucheRig(entree.root, support, (m) => estMateriauBras(this.peinture.materiauSource(m)), axeRig, st)) return
    // La même bouche en repère LOCAL de son porteur : c'est elle qui suit le rig animé, posé à l'image.
    const locale: BoucheLocale = { porteurLocal: entree.root, point: new THREE.Vector3(), axe: new THREE.Vector3() }
    if (boucheRigLocale(entree.root, support, (m) => estMateriauBras(this.peinture.materiauSource(m)), axeRig, locale)) {
      st.porteurLocal = locale.porteurLocal
      st.point = locale.point
      st.axeLocale = locale.axe
    }
    entree.bouche = st
  }

  private chargerRig(rig: RigPremierePersonne): void {
    this.entrees.set(rig.file, null)
    const chargement = (async () => {
      try {
        const clip = clipDuRig(rig, 'idle')
        if (!clip) throw new Error('clip idle absent')
        const chemin = urlRig(this.dossier, rig.file)
        const buffer = await fetchMesh(chemin, () => {}, this.abort.signal)
        const gltf = await withKtx2(new GLTFLoader(), this.ktx2).parseAsync(buffer, `${API_BASE_URL}${this.dossier}/`)
        const animation = gltf.animations.find((a) => a.name === clip.name)
        if (!animation) {
          this.liberer(gltf.scene)
          throw new Error('animation idle absente')
        }
        if (this.abort.signal.aborted) {
          this.liberer(gltf.scene)
          return
        }
        gltf.scene.traverse((objet) => {
          if (!(objet instanceof THREE.Mesh)) return
          if (objet instanceof THREE.SkinnedMesh) objet.frustumCulled = false
          for (const materiau of Array.isArray(objet.material) ? objet.material : [objet.material]) {
            if (!estMateriauPeint(materiau)) {
              darkMetalFallback(materiau)
              continue
            }
            materiau.color.setRGB(ARMURE_NEUTRE, ARMURE_NEUTRE, ARMURE_NEUTRE)
            materiau.roughness = RUGOSITE_ARMURE_NEUTRE
          }
        })
        await rawMaps(gltf.scene, gltf.parser, (m) => estMateriauPeint(m) && !!m.userData.style)
          .catch((erreur: unknown) => console.warn('rejeu 3D : masques des bras indisponibles', erreur))
        if (this.abort.signal.aborted) {
          this.liberer(gltf.scene)
          return
        }
        animation.duration = clip.durationSeconds
        const mixer = new THREE.AnimationMixer(gltf.scene)
        const actions = new Map<string, THREE.AnimationAction>()
        for (const meta of rig.clips) {
          const animationRig = gltf.animations.find((a) => a.name === meta.name)
          if (!animationRig) continue
          animationRig.duration = meta.durationSeconds
          const action = mixer.clipAction(animationRig)
          if (meta.overlay || meta.type === 'overlay') action.blendMode = THREE.AdditiveAnimationBlendMode
          action.play()
          actions.set(meta.name, action)
        }
        const listeActions = [...actions.values()]
        gltf.scene.visible = false
        this.support.add(gltf.scene)
        const entree: NonNullable<Entree> = { root: gltf.scene, mixer, clip, rig, actions, listeActions, materiaux: [], pivot: pivotDuRecul(rig.idleWeapon), mainGauche: gltf.scene.getObjectByName('b_l_hand') ?? null }
        this.entrees.set(rig.file, entree)
        // La bouche du canon, une fois, à la pose idle : le rig se repose, c'est sa position de repos.
        this.mesurerBouche(entree)
        const materiaux: THREE.Material[] = []
        gltf.scene.traverse((objet) => {
          if (!(objet instanceof THREE.Mesh)) return
          for (const m of Array.isArray(objet.material) ? objet.material : [objet.material]) {
            if (estMateriauPeint(m) && m.userData.style && !materiaux.includes(m)) materiaux.push(m)
          }
        })
        entree.materiaux = materiaux
        this.preparation.rigCharge(rig.file)
        if (this.xuid && this.armurerie && !this.armurerie.pending(this.xuid)) this.preparerRig()
      } catch (erreur) {
        if (!this.abort.signal.aborted) console.warn('rejeu 3D : rig première personne indisponible', rig.file, erreur)
      }
    })()
    void (this.gate?.track(chargement) ?? chargement)
  }
}
