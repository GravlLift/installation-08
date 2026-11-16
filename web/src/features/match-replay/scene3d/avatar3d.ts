/**
 * avatar3d.ts — LE JOUEUR DANS LA SCÈNE 3D : le Spartan du jeu à la teinte de son équipe
 * (`spartan3d`, posé par `pose3d`), une capsule à sa couleur tant que le modèle n'est pas chargé, un
 * cône de visée, et son étiquette (son nom). La scène (`ReplayScene3d`) les pose à
 * chaque image.
 *
 * Le Spartan porte une coque d'énergie (`bodyShell3d`) : le bouclier qui encaisse, rompt ou se
 * recharge, le surbouclier et le contour du camouflage s'y dessinent, à l'état que la scène lui donne
 * à chaque image (`showBodyFx`) ; sous le camouflage, l'armure elle-même s'efface.
 *
 * L'arme en main est le modèle du jeu quand il est chargé (`weaponModels3d`), sinon une barre à la
 * teinte de ses tirs. En 3e personne, le modèle est porté par la main droite du Spartan (os
 * `b_r_grip`) comme le jeu l'y attache (`GRIP_TO_WEAPON`) : les clips tiennent l'arme des deux mains,
 * le tangage du buste la lève avec eux. En 1re personne et sans Spartan, l'arme est portée par le cône.
 * Au tir, l'arme recule (`recoil3d`, posé par `recoilPose3d`) : en 3e personne avec les deux bras.
 * Le modèle est peint du revêtement de l'arme du joueur (`Coat` de `armory3d`) par copies de
 * matériau (`armorMaterial3d`), posées à `showWeapon`, libérées à `releaseWeapon`.
 */
import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'

import { TAG_CLASS } from './actionKit'
import type { Coat } from './armorCoat3d'
import { armorMaterial } from './armorMaterial3d'
import { energyCopy, energyTintOf, isEnergized } from './energyField3d'
import type { Dress } from './armory3d'
import type { BakedLight } from './bakedLightShader'
import { AIM_HEIGHT, BODY_CENTER, BODY_LENGTH, BODY_RADIUS, CROUCH_DROP, EYE_HEIGHT } from './body3d'
import { makeShell, releaseShell, showShell, type BodyFxState, type BodyShell } from './bodyShell3d'
import { newClipMix, type ClipMix } from './clipSample3d'
import { poseSpartan, type SpartanPose } from './pose3d'
import { assignPlayerProbes } from './playerProbe3d'
import { recoilActive, type Recoil } from './recoil3d'
import { recoilArms, recoilModel } from './recoilPose3d'
import { copySpartan, releaseSpartan, type SpartanCopy } from './spartan3d'
import { aimDirThree } from './tracks3d'
import type { ViewGrip } from './viewGrip3d'

// L'arme en main : une barre au bout de la visée, un peu à droite et sous l'œil (u, repère du cône,
// dont le Z suit la visée : sa droite est son -X).
const GUN_SIZE = new THREE.Vector3(0.045, 0.06, 0.32)
const GUN_OFFSET = new THREE.Vector3(-0.07, -0.05, 0.16)
// Le modèle du jeu sans Spartan : sa poignée (son origine) dans la main, devant la poitrine, un peu
// à droite ; la crosse touche le corps (rayon 0,12 u) et le canon (X du modèle) suit la visée (Z du cône).
const MODEL_GRIP = new THREE.Vector3(-0.06, -0.12, 0.17)
export const MODEL_TURN = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0))
const BARREL = new THREE.Vector3(0, 0, 1)
/**
 * Le canon et le haut du modèle d'arme dans le repère de l'os `b_r_grip`, mesurés sur l'attente au
 * fusil du GLB (`combat:rifle:idle`, image 0 : le fusil vise droit devant, sans dévers) ; au long des
 * clips de visée au fusil le canon ainsi porté reste à 1,3° de l'avant du modèle, la main gauche à
 * 0,113 u devant la poignée le long du canon.
 */
const GRIP_BARREL = new THREE.Vector3(0.101, -0.171, -0.98).normalize()
const GRIP_UP = new THREE.Vector3(0.146, 0.977, -0.155)
/** GRIP_TO_WEAPON : l'orientation du modèle d'arme (X canon, Y haut) dans le repère de `b_r_grip`. */
export const GRIP_TO_WEAPON = gripToWeapon(GRIP_BARREL, GRIP_UP)

function gripToWeapon(barrel: THREE.Vector3, up: THREE.Vector3): THREE.Quaternion {
  const y = up.clone().addScaledVector(barrel, -up.dot(barrel)).normalize()
  const z = barrel.clone().cross(y)
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(barrel, y, z))
}
// Sous le camouflage entier, l'armure garde cette opacité : le contour de la coque fait le reste.
const CAMO_OPACITY = 0.08

export interface Avatar {
  group: THREE.Group
  body: THREE.Mesh
  aim: THREE.Mesh
  gun: THREE.Mesh
  /** Le modèle du jeu en main (une copie), null sans modèle chargé. */
  model: THREE.Object3D | null
  /** Le modèle dont `model` est la copie. */
  modelSource: THREE.Object3D | null
  /** Les copies de matériau peintes sur `model`, par matériau source, null sans revêtement posé. */
  weaponCoat: Map<THREE.Material, THREE.Material> | null
  /** Le revêtement (`armory3d.coatArme`) dont les copies sont posées sur `model`. */
  weaponCoatFor: Coat | null
  /** Le Spartan du joueur (une copie teinte), null sans modèle chargé. */
  spartan: SpartanCopy | null
  /** Le modèle dont `spartan` est la copie (posé même si la copie a échoué : pas de nouvel essai). */
  spartanSource: THREE.Object3D | null
  /** L'habit du joueur que porte `spartan` (`armory3d`), null : l'armure par défaut du modèle. */
  dress: Dress | null
  /** La coque d'énergie du Spartan (`bodyShell3d`), null sans Spartan. */
  shell: BodyShell | null
  tag: CSS2DObject
  /** `tag`'s opacity as placed by `placeTag` for the last frame; the export paints it (0: hidden). */
  tagOpacity: number
  name: string
  color: string
  /** La teinte de l'équipe, qui multiplie les couleurs du Spartan. */
  tint: THREE.Color
  /** Le mélange de clips du joueur, réécrit à chaque image (`motion3d`). */
  mix: ClipMix
}

/** makeAvatar crée le joueur `name` à la couleur `color` et l'ajoute à `scene`. */
export function makeAvatar(scene: THREE.Scene, name: string, color: THREE.Color): Avatar {
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(BODY_RADIUS, BODY_LENGTH, 4, 12), new THREE.MeshLambertMaterial({ color }))
  const aim = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.2, 10), new THREE.MeshBasicMaterial({ color }))
  aim.geometry.rotateX(Math.PI / 2)
  aim.geometry.translate(0, 0, 0.18)
  // L'arme suit la visée : elle est portée par le cône, dans son repère.
  const gun = new THREE.Mesh(new THREE.BoxGeometry(GUN_SIZE.x, GUN_SIZE.y, GUN_SIZE.z), new THREE.MeshLambertMaterial())
  gun.position.copy(GUN_OFFSET)
  gun.visible = false
  body.castShadow = true
  gun.castShadow = true
  aim.add(gun)
  const group = new THREE.Group()
  group.add(body, aim)
  const el = document.createElement('div')
  el.className = TAG_CLASS
  el.style.borderLeftColor = color.getStyle()
  el.append(name)
  const tag = new CSS2DObject(el)
  scene.add(group, tag)
  return {
    group, body, aim, gun, model: null, modelSource: null, weaponCoat: null, weaponCoatFor: null,
    spartan: null, spartanSource: null, dress: null, shell: null,
    tag, tagOpacity: 0, name, color: color.getStyle(), tint: color.clone(), mix: newClipMix(),
  }
}

/**
 * wearSpartan habille le joueur du modèle `source` (une copie, ajoutée à son groupe), portant son
 * habit `dress` quand il est prêt (null : l'armure par défaut du modèle, teinte), ne recopiant qu'au
 * changement de l'un ou de l'autre ; `source` null : la copie est libérée et la capsule revient.
 * `baked` : la lumière cuite de la carte, greffée sur l'armure de la copie.
 */
export function wearSpartan(a: Avatar, source: THREE.Object3D | null, dress: Dress | null = null, baked: BakedLight | null = null): void {
  if (source === a.spartanSource && dress === a.dress) return
  if (a.shell) releaseShell(a.shell)
  if (a.spartan) releaseSpartan(a.spartan)
  a.spartanSource = source
  a.dress = dress
  a.spartan = source ? copySpartan(source, a.tint, dress, baked) : null
  a.shell = a.spartan ? makeShell(a.spartan.rig.root) : null
  if (source && !a.spartan) console.warn('rejeu 3D : le modèle du Spartan n’a pas les os attendus')
  if (a.spartan) a.group.add(a.spartan.rig.root)
}

/**
 * showBodyFx pose ce que le corps montre à l'image (null : rien) : la coque d'énergie, et l'armure
 * qui s'efface sous le camouflage.
 */
export function showBodyFx(a: Avatar, fx: BodyFxState | null): void {
  if (a.shell) showShell(a.shell, fx)
  if (a.spartan) cloak(a.spartan.materials, fx?.equip.camo ?? 0)
}

/**
 * cloak rend l'armure transparente à la force `camo` du camouflage (opacité `CAMO_OPACITY` au plus
 * fort). Le passage en transparence ne se fait qu'au changement : il recompile le matériau.
 */
export function cloak(materials: readonly THREE.Material[], camo: number): void {
  const see = camo > 0
  for (const m of materials) {
    if (m.transparent !== see) {
      m.transparent = see
      m.depthWrite = !see
      m.needsUpdate = true
    }
    m.opacity = cloakOpacity(camo)
  }
}

/** cloakOpacity : l'opacité de l'armure sous un camouflage de force `camo` (0 visible, 1 entier). */
export function cloakOpacity(camo: number): number {
  return 1 - (1 - CAMO_OPACITY) * camo
}

/**
 * placeBody pose le joueur, pieds en `feet` (axes three) : le groupe et la capsule (écrasée
 * accroupi, `crouch`), le Spartan (cap, clips, tangage), et la visée (de l'œil en 1re personne).
 * `dropOeil` : la descente de l'œil en fondu (unités monde), que seule la visée en 1re personne
 * suit — la pose du corps reste instantanée (`crouch`). `probe` : la sonde d'environnement de la
 * carte au point des pieds, posée sur l'armure du Spartan (`playerProbe3d`).
 */
export function placeBody(a: Avatar, feet: THREE.Vector3, pose: SpartanPose & { crouch: boolean; dropOeil: number }, firstPerson: boolean, probe: THREE.Texture | null = null): void {
  const crouch = pose.crouch ? CROUCH_DROP : 0
  a.group.position.set(feet.x, feet.y + BODY_CENTER - crouch / 2, feet.z)
  a.body.scale.y = 1 - crouch
  if (a.spartan) {
    // Les pieds du modèle sont son origine ; l'accroupi est porté par les clips.
    a.spartan.rig.root.position.set(0, crouch / 2 - BODY_CENTER, 0)
    poseSpartan(a.spartan.rig, pose)
  }
  const d = aimDirThree(pose.h, pose.p)
  // En 1re personne, la visée part de l'œil de la caméra (placeCamera) : l'arme suit le champ, et
  // l'œil à sa descente en fondu (dropOeil), indépendante de la pose du corps (crouch).
  const aimY = firstPerson ? EYE_HEIGHT - (BODY_CENTER - crouch / 2) - pose.dropOeil : AIM_HEIGHT - crouch
  a.aim.position.set(0, aimY, 0)
  a.aim.lookAt(a.group.position.x + d[0], a.group.position.y + aimY + d[1], a.group.position.z + d[2])
  // L'armure prend l'environnement de la carte là où se tient le joueur (sonde nulle : reflets éteints).
  if (a.spartan) assignPlayerProbes(a.spartan.materials, probe)
}

/**
 * showWeapon : l'arme en main (le modèle du jeu `model` s'il est chargé, la barre sinon). `view` :
 * le joueur est la caméra (1re personne), seule son arme se
 * dessine, tenue dans le champ comme `view` le dit (viewGrip3d) ; null sinon. `coat` : le
 * revêtement de l'arme du joueur, peint en copies de matériau sur la copie du modèle ; null
 * s'il n'est pas prêt. Après `placeBody`.
 */
export function showWeapon(
  a: Avatar,
  held: { color: THREE.Color; recoil?: Recoil | null } | null,
  model: THREE.Object3D | null,
  view: ViewGrip | null,
  coat: Coat | null = null,
): void {
  const firstPerson = view !== null
  const spartan = firstPerson ? null : a.spartan
  const holder = spartan ? spartan.rig.rightGrip : a.aim
  const source = held ? model : null
  if (source !== a.modelSource) detacherRevêtementArme(a)
  holdModel(a, source, holder)
  if (a.model && a.weaponCoatFor !== coat) {
    detacherRevêtementArme(a)
    a.weaponCoatFor = coat
    a.weaponCoat = coat ? poserRevêtementArme(a.model, coat) : null
  }
  if (a.model && view) {
    a.model.position.set(view.x, view.y, view.z)
    a.model.quaternion.setFromAxisAngle(BARREL, view.roll).multiply(MODEL_TURN)
  } else if (a.model && spartan) {
    a.model.position.set(0, 0, 0)
    a.model.quaternion.copy(GRIP_TO_WEAPON)
  } else if (a.model) {
    a.model.position.copy(MODEL_GRIP)
    a.model.quaternion.copy(MODEL_TURN)
  }
  // Le recul du tir, par-dessus la tenue : les bras le portent en 3e personne (les mains restent sur
  // l'arme), le modèle seul sinon. La caméra de 1re personne ne bouge pas.
  const recoil = held?.recoil
  if (a.model && recoilActive(recoil)) {
    const armed = spartan ? recoilArms(spartan.rig.arms, spartan.rig.rightGrip, GRIP_TO_WEAPON, recoil) : false
    if (!armed) recoilModel(a.model, recoil)
  }
  if (a.spartan) a.spartan.rig.root.visible = !firstPerson
  a.body.visible = !firstPerson && !a.spartan
  // La barre de repli ne se montre pas en 1re personne : collée à l'œil, elle masque le champ.
  a.gun.visible = held !== null && a.model === null && !firstPerson
  // Le Spartan ou le modèle en main dit la visée : le cône (son porteur) ne se dessine plus, ses enfants restent.
  ;(a.aim.material as THREE.Material).visible = a.model === null && !firstPerson && !a.spartan
  if (held) (a.gun.material as THREE.MeshLambertMaterial).color.copy(held.color)
}

/** Le modèle d'arme dessiné dans la main d'un joueur : la copie posée, et le modèle dont elle est la copie. */
/** Where an attached projectile's bone is (`ActionContext.attachBone`). */
export type AttachBone = 'drawn' | 'hidden' | 'none'

/**
 * attachBoneOf: the world matrix of bone `node` of the Spartan drawn for `a` (the skin joint of that
 * rank, which is the render model's node of that rank), written in `out`, after `placeBody`. In
 * first person (`firstPerson`), the body is not drawn: the bone of the same name of the first-person
 * rig (`rigBone`) when it has one, else 'hidden'. 'none' without a drawn Spartan or such a bone.
 */
export function attachBoneOf(
  a: Avatar | undefined, node: number, firstPerson: boolean,
  rigBone: ((name: string, out: THREE.Matrix4) => boolean) | null, out: THREE.Matrix4,
): AttachBone {
  const bone = a?.spartan?.skeletons[0]?.bones[node]
  if (!a || !bone || !a.group.visible) return 'none'
  if (firstPerson) return rigBone?.(bone.name, out) ? 'drawn' : 'hidden'
  bone.updateWorldMatrix(true, false)
  out.copy(bone.matrixWorld)
  return 'drawn'
}

export interface DrawnWeapon {
  model: THREE.Object3D
  source: THREE.Object3D
}

/**
 * drawnWeapon : l'arme que la dernière pose (`showWeapon`) dessine dans la main du joueur `a`, null
 * sans modèle en main ou quand elle ne se dessine pas (joueur caché, à bord en 1re personne).
 */
export function drawnWeapon(a: Avatar | undefined): DrawnWeapon | null {
  if (!a?.model || !a.modelSource) return null
  for (let o: THREE.Object3D | null = a.model; o; o = o.parent) {
    if (!o.visible) return null
    if (o === a.group) return { model: a.model, source: a.modelSource }
  }
  return null
}

/** holdModel met dans `holder` une copie de `model` (null : aucune), en ne recopiant qu'au changement. */
function holdModel(a: Avatar, model: THREE.Object3D | null, holder: THREE.Object3D): void {
  if (model !== a.modelSource) {
    a.model?.removeFromParent()
    a.modelSource = model
    a.model = model ? model.clone() : null
  }
  if (a.model && a.model.parent !== holder) holder.add(a.model)
}

/**
 * poserRevêtementArme peint la copie `model` du modèle d'arme du revêtement `coat` : une copie de
 * matériau (`armorMaterial3d`) par matériau source peint, posée sur les maillages ; rend la
 * correspondance source vers copie (vide sans matériau peint).
 */
export function poserRevêtementArme(model: THREE.Object3D, coat: Coat): Map<THREE.Material, THREE.Material> {
  const copies = new Map<THREE.Material, THREE.Material>()
  // The energy fields (the sword's blade) glow in the weapon's own emissive swatch (`energyField3d`).
  const teinte = energyTintOf(coat)
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const liste = Array.isArray(o.material) ? o.material : [o.material]
    const neufs: THREE.Material[] = []
    for (const m of liste) {
      const paint = coat.get(m)
      if (!paint && teinte && isEnergized(m)) {
        let champ = copies.get(m)
        if (!champ) { champ = energyCopy(m, teinte); copies.set(m, champ) }
        neufs.push(champ)
        continue
      }
      if (!paint) { neufs.push(m); continue }
      let copie = copies.get(m)
      if (!copie) { copie = armorMaterial(m as THREE.MeshStandardMaterial, paint); copies.set(m, copie) }
      neufs.push(copie)
    }
    o.material = Array.isArray(o.material) ? neufs : neufs[0]
  })
  return copies
}

/** detacherRevêtementArme rend aux maillages leurs matériaux source et libère les copies peintes. */
function detacherRevêtementArme(a: Avatar): void {
  if (!a.weaponCoat) return
  const copies = a.weaponCoat
  // Les copies posées sont les valeurs ; la restauration cherche par copie vers matériau source.
  const sources = new Map<THREE.Material, THREE.Material>()
  for (const [src, cop] of copies) sources.set(cop, src)
  if (a.model) a.model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const liste = Array.isArray(o.material) ? o.material : [o.material]
    const dOrigine = liste.map((m) => sources.get(m) ?? m)
    o.material = Array.isArray(o.material) ? dOrigine : dOrigine[0]
  })
  for (const c of copies.values()) c.dispose()
  a.weaponCoat = null
  a.weaponCoatFor = null
}

/** releaseWeapon libère le revêtement de l'arme du joueur (fin de la scène). */
export function releaseWeapon(a: Avatar): void {
  detacherRevêtementArme(a)
}
