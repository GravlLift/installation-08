// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * avatar3d.ts — THE PLAYER IN THE 3D SCENE: the game's Spartan tinted to their team
 * (`spartan3d`, posed by `pose3d`), a capsule in their color while the model is not loaded, an
 * aim cone, and their tag (their name). The scene (`ReplayScene3d`) poses them
 * every frame.
 *
 * The Spartan wears an energy shell (`bodyShell3d`): the shield that takes hits, breaks or
 * recharges, the overshield and the camo outline are drawn on it, at the state the scene gives it
 * every frame (`showBodyFx`); under camo, the armor itself fades out.
 *
 * The weapon in hand is the game's model when it is loaded (`weaponModels3d`), otherwise a bar
 * tinted to its shots. In third person, the model is carried by the Spartan's right hand (bone
 * `b_r_grip`) the way the game attaches it (`GRIP_TO_WEAPON`): the clips hold the weapon with both
 * hands, torso pitch lifts it with them. In first person and without a Spartan, the weapon is
 * carried by the cone. On fire, the weapon recoils (`recoil3d`, posed by `recoilPose3d`): in third
 * person with both arms. The model is painted with the player's weapon coating (`Coat` from
 * `armory3d`) by material copies (`armorMaterial3d`), applied by `showWeapon`, released by
 * `releaseWeapon`.
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

// The weapon in hand: a bar at the end of the aim cone, slightly right and under the eye (in the
// cone's own frame, whose Z follows the aim: its right is its -X).
const GUN_SIZE = new THREE.Vector3(0.045, 0.06, 0.32)
const GUN_OFFSET = new THREE.Vector3(-0.07, -0.05, 0.16)
// The game's model without a Spartan: its grip (its origin) in the hand, in front of the chest,
// slightly right; the stock touches the body (radius 0.12 u) and the barrel (model X) follows the
// aim (cone Z).
const MODEL_GRIP = new THREE.Vector3(-0.06, -0.12, 0.17)
export const MODEL_TURN = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0))
const BARREL = new THREE.Vector3(0, 0, 1)
/**
 * The barrel and top of the weapon model in the `b_r_grip` bone's frame, measured on the GLB's
 * rifle idle pose (`combat:rifle:idle`, frame 0: the rifle aims straight ahead, no cant); across the
 * rifle aim clips the barrel carried this way stays within 1.3° of the model's forward, the left hand
 * 0.113 u ahead of the grip along the barrel.
 */
const GRIP_BARREL = new THREE.Vector3(0.101, -0.171, -0.98).normalize()
const GRIP_UP = new THREE.Vector3(0.146, 0.977, -0.155)
/** GRIP_TO_WEAPON: the weapon model's orientation (X barrel, Y up) in the `b_r_grip` frame. */
export const GRIP_TO_WEAPON = gripToWeapon(GRIP_BARREL, GRIP_UP)

function gripToWeapon(barrel: THREE.Vector3, up: THREE.Vector3): THREE.Quaternion {
  const y = up.clone().addScaledVector(barrel, -up.dot(barrel)).normalize()
  const z = barrel.clone().cross(y)
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(barrel, y, z))
}
// Fully cloaked, the armor keeps this opacity: the shell's outline does the rest.
const CAMO_OPACITY = 0.08

export interface Avatar {
  group: THREE.Group
  body: THREE.Mesh
  aim: THREE.Mesh
  gun: THREE.Mesh
  /** The game's model in hand (a copy), null without a loaded model. */
  model: THREE.Object3D | null
  /** The model `model` is a copy of. */
  modelSource: THREE.Object3D | null
  /** The material copies painted on `model`, by source material, null without an applied coating. */
  weaponCoat: Map<THREE.Material, THREE.Material> | null
  /** The coating (`armory3d.coatArme`) whose copies are applied to `model`. */
  weaponCoatFor: Coat | null
  /** The player's Spartan (a tinted copy), null without a loaded model. */
  spartan: SpartanCopy | null
  /** The model `spartan` is a copy of (set even if the copy failed: no retry). */
  spartanSource: THREE.Object3D | null
  /** The player's outfit worn by `spartan` (`armory3d`), null: the model's default armor. */
  dress: Dress | null
  /** The Spartan's energy shell (`bodyShell3d`), null without a Spartan. */
  shell: BodyShell | null
  tag: CSS2DObject
  /** `tag`'s opacity as placed by `placeTag` for the last frame; the export paints it (0: hidden). */
  tagOpacity: number
  name: string
  color: string
  /** The team tint, which multiplies the Spartan's colors. */
  tint: THREE.Color
  /** The player's clip mix, rewritten every frame (`motion3d`). */
  mix: ClipMix
}

/** makeAvatar creates player `name` in color `color` and adds it to `scene`. */
export function makeAvatar(scene: THREE.Scene, name: string, color: THREE.Color): Avatar {
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(BODY_RADIUS, BODY_LENGTH, 4, 12), new THREE.MeshLambertMaterial({ color }))
  const aim = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.2, 10), new THREE.MeshBasicMaterial({ color }))
  aim.geometry.rotateX(Math.PI / 2)
  aim.geometry.translate(0, 0, 0.18)
  // The weapon follows the aim: it is carried by the cone, in its own frame.
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
 * wearSpartan dresses the player in model `source` (a copy, added to their group), wearing outfit
 * `dress` once it is ready (null: the model's default armor, tinted), only re-copying when either
 * one changes; `source` null: the copy is released and the capsule comes back. `baked`: the map's
 * baked light, grafted onto the copy's armor.
 */
export function wearSpartan(a: Avatar, source: THREE.Object3D | null, dress: Dress | null = null, baked: BakedLight | null = null): void {
  if (source === a.spartanSource && dress === a.dress) return
  if (a.shell) releaseShell(a.shell)
  if (a.spartan) releaseSpartan(a.spartan)
  a.spartanSource = source
  a.dress = dress
  a.spartan = source ? copySpartan(source, a.tint, dress, baked) : null
  a.shell = a.spartan ? makeShell(a.spartan.rig.root) : null
  if (source && !a.spartan) console.warn('3D replay: the Spartan model does not have the expected bones')
  if (a.spartan) a.group.add(a.spartan.rig.root)
}

/**
 * showBodyFx sets what the body shows this frame (null: nothing): the energy shell, and the armor
 * fading out under camo.
 */
export function showBodyFx(a: Avatar, fx: BodyFxState | null): void {
  if (a.shell) showShell(a.shell, fx)
  if (a.spartan) cloak(a.spartan.materials, fx?.equip.camo ?? 0)
}

/**
 * cloak makes the armor transparent at camo strength `camo` (opacity `CAMO_OPACITY` at full
 * strength). The switch to transparent only happens on change: it recompiles the material.
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

/** cloakOpacity: the armor's opacity under camo strength `camo` (0 visible, 1 full). */
export function cloakOpacity(camo: number): number {
  return 1 - (1 - CAMO_OPACITY) * camo
}

/**
 * placeBody places the player, feet at `feet` (three axes): the group and the capsule (squashed
 * when crouching, `crouch`), the Spartan (pitch, clips, torso), and the aim (from the eye in first
 * person). `dropOeil`: the eye's drop while fading in (world units), which only the first-person
 * aim follows — the body pose stays instant (`crouch`). `probe`: the map's environment probe at the
 * feet point, applied to the Spartan's armor (`playerProbe3d`).
 */
export function placeBody(a: Avatar, feet: THREE.Vector3, pose: SpartanPose & { crouch: boolean; dropOeil: number }, firstPerson: boolean, probe: THREE.Texture | null = null): void {
  const crouch = pose.crouch ? CROUCH_DROP : 0
  a.group.position.set(feet.x, feet.y + BODY_CENTER - crouch / 2, feet.z)
  a.body.scale.y = 1 - crouch
  if (a.spartan) {
    // The model's feet are its origin; crouching is carried by the clips.
    a.spartan.rig.root.position.set(0, crouch / 2 - BODY_CENTER, 0)
    poseSpartan(a.spartan.rig, pose)
  }
  const d = aimDirThree(pose.h, pose.p)
  // In first person, the aim starts at the camera's eye (placeCamera): the weapon follows the view,
  // and the eye at its fade-in drop (dropOeil), independent of the body pose (crouch).
  const aimY = firstPerson ? EYE_HEIGHT - (BODY_CENTER - crouch / 2) - pose.dropOeil : AIM_HEIGHT - crouch
  a.aim.position.set(0, aimY, 0)
  a.aim.lookAt(a.group.position.x + d[0], a.group.position.y + aimY + d[1], a.group.position.z + d[2])
  // The armor picks up the map's environment where the player is standing (null probe: reflections off).
  if (a.spartan) assignPlayerProbes(a.spartan.materials, probe)
}

/**
 * showWeapon: the weapon in hand (the game's `model` if loaded, the bar otherwise). `view`: the
 * player is the camera (first person), only their weapon is drawn, held in the view the way `view`
 * says (viewGrip3d); null otherwise. `coat`: the player's weapon coating, painted as material
 * copies onto the model's copy; null when it is not ready. After `placeBody`.
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
  if (source !== a.modelSource) detachWeaponCoat(a)
  holdModel(a, source, holder)
  if (a.model && a.weaponCoatFor !== coat) {
    detachWeaponCoat(a)
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
  // Fire recoil, on top of the pose: the arms carry it in third person (the hands stay on the
  // weapon), the model alone otherwise. The first-person camera does not move.
  const recoil = held?.recoil
  if (a.model && recoilActive(recoil)) {
    const armed = spartan ? recoilArms(spartan.rig.arms, spartan.rig.rightGrip, GRIP_TO_WEAPON, recoil) : false
    if (!armed) recoilModel(a.model, recoil)
  }
  if (a.spartan) a.spartan.rig.root.visible = !firstPerson
  a.body.visible = !firstPerson && !a.spartan
  // The fallback bar does not show in first person: pressed to the eye, it would block the view.
  a.gun.visible = held !== null && a.model === null && !firstPerson
  // The Spartan or the model in hand already shows the aim: the cone (its carrier) no longer draws, its children still do.
  ;(a.aim.material as THREE.Material).visible = a.model === null && !firstPerson && !a.spartan
  if (held) (a.gun.material as THREE.MeshLambertMaterial).color.copy(held.color)
}

/** The weapon model drawn in a player's hand: the applied copy, and the model it is a copy of. */
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
 * drawnWeapon: the weapon the last pose (`showWeapon`) draws in player `a`'s hand, null without a
 * model in hand or when it does not draw (player hidden, carried in first person).
 */
export function drawnWeapon(a: Avatar | undefined): DrawnWeapon | null {
  if (!a?.model || !a.modelSource) return null
  for (let o: THREE.Object3D | null = a.model; o; o = o.parent) {
    if (!o.visible) return null
    if (o === a.group) return { model: a.model, source: a.modelSource }
  }
  return null
}

/** holdModel puts a copy of `model` in `holder` (null: none), only re-copying on change. */
function holdModel(a: Avatar, model: THREE.Object3D | null, holder: THREE.Object3D): void {
  if (model !== a.modelSource) {
    a.model?.removeFromParent()
    a.modelSource = model
    a.model = model ? model.clone() : null
  }
  if (a.model && a.model.parent !== holder) holder.add(a.model)
}

/**
 * poserRevêtementArme paints copy `model` of the weapon model with coating `coat`: one material
 * copy (`armorMaterial3d`) per painted source material, applied to the meshes; returns the source
 * to copy mapping (empty without a painted material).
 */
export function poserRevêtementArme(model: THREE.Object3D, coat: Coat): Map<THREE.Material, THREE.Material> {
  const copies = new Map<THREE.Material, THREE.Material>()
  // The energy fields (the sword's blade) glow in the weapon's own emissive swatch (`energyField3d`).
  const tint = energyTintOf(coat)
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const list = Array.isArray(o.material) ? o.material : [o.material]
    const next: THREE.Material[] = []
    for (const m of list) {
      const paint = coat.get(m)
      if (!paint && tint && isEnergized(m)) {
        let field = copies.get(m)
        if (!field) { field = energyCopy(m, tint); copies.set(m, field) }
        next.push(field)
        continue
      }
      if (!paint) { next.push(m); continue }
      let copy = copies.get(m)
      if (!copy) { copy = armorMaterial(m as THREE.MeshStandardMaterial, paint); copies.set(m, copy) }
      next.push(copy)
    }
    o.material = Array.isArray(o.material) ? next : next[0]
  })
  return copies
}

/** detachWeaponCoat returns the meshes to their source materials and releases the painted copies. */
function detachWeaponCoat(a: Avatar): void {
  if (!a.weaponCoat) return
  const copies = a.weaponCoat
  // The applied copies are the values; restoring looks up source material by copy.
  const sources = new Map<THREE.Material, THREE.Material>()
  for (const [src, cop] of copies) sources.set(cop, src)
  if (a.model) a.model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const list = Array.isArray(o.material) ? o.material : [o.material]
    const original = list.map((m) => sources.get(m) ?? m)
    o.material = Array.isArray(o.material) ? original : original[0]
  })
  for (const c of copies.values()) c.dispose()
  a.weaponCoat = null
  a.weaponCoatFor = null
}

/** releaseWeapon releases the player's weapon coating (end of the scene). */
export function releaseWeapon(a: Avatar): void {
  detachWeaponCoat(a)
}
