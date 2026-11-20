// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import type { LoadGate } from './loadGate3d'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'

import { api, API_BASE_URL } from '@/lib/api/client'
import { viewmodelScale } from '../model/fovLogic'
import { darkMetalFallback } from './fallbackMetal3d'
import { findCounterQuads, MAGAZINE_GAUGE_WEAPONS, showRounds, type CounterQuad } from './ammoCounter3d'
import { fetchMesh } from './meshFetch'
import { rawMaps } from './armorLibrary3d'
import { ARMURE_NEUTRE, RUGOSITE_ARMURE_NEUTRE } from './armorMaterial3d'
import { newFirstPersonPose, firstPersonPose, type FirstPersonFrameEvents } from './firstPersonActions3d'
import { clipOfRig, ROTATION_RIG_CAMERA, clipTime, rigUrl, type FirstPersonClip, type FirstPersonIndex, type RigEffectMarker, type FirstPersonRig } from './firstPersonRig3d'
import { rigGripOf, type ViewGrip } from './viewGrip3d'
import { ArmPieces3d, type ArmIndex } from './armPieces3d'
import { muzzleWorldPose, muzzlePose, muzzlePoseCamera, muzzleLocalPose, type MuzzleLocal } from './muzzleRig3d'
import type { Dress, SpartanArmory } from './armory3d'
import { RigPreparation3d } from './rigPreparation3d'
import type { BakedLight } from './bakedLightShader'
import { assignPlayerProbe } from './playerProbe3d'
import { RigDressing3d } from './rigDressing3d'
import { RigPaint3d } from './rigPaint3d'
import type { Recoil } from './recoil3d'
import { recoilPivot, applyRigRecoil } from './firstPersonRecoil3d'
import { fpCableStart } from './grapple3d_logic'
import { CamouflageRig3d } from './camouflageRig3d'
import { withKtx2 } from './ktx2Textures3d'

// The barrel's muzzle: in the holder's frame (`muzzle`, `axis`, for `muzzleView`) and, to follow the
// animated rig, in the LOCAL frame of the object carrying it (`localHolder` / `point` / `localAxis`).
type StMuzzle = {
  muzzle: THREE.Vector3
  axis: THREE.Vector3
  localHolder?: THREE.Object3D
  point?: THREE.Vector3
  localAxis?: THREE.Vector3
}
type Entry = { materials: THREE.Material[]; root: THREE.Object3D; mixer: THREE.AnimationMixer; rig: FirstPersonRig; actions: Map<string, THREE.AnimationAction>; actionList: THREE.AnimationAction[]; clip: FirstPersonClip; muzzle?: StMuzzle; pivot: THREE.Vector3 | null; leftHand: THREE.Object3D | null; counters: CounterQuad[] } | null

// The vertical field (degrees) the grips and the rig's muzzle were tuned at: the holder
// counter-scales to this field (viewmodelScale) to keep its projection.
const VIEWMODEL_FOV = 55
const FORWARD_AXIS = new THREE.Vector3(0, 0, -1)
// Shared scratch values: `place` runs every rendered frame, no per-frame allocation.
const SCRATCH_OFFSET = new THREE.Vector3()
const SCRATCH_ROLL = new THREE.Quaternion()
// Scratch values for `muzzleView` and `measureMuzzle`: no shot or frame allocates.
const SCRATCH_MUZZLE_VIEW = new THREE.Vector3()
const SCRATCH_ORIGIN = new THREE.Vector3()
const SCRATCH_IDENTITY = new THREE.Quaternion()
const SCRATCH_RIG_AXIS = new THREE.Vector3()
const SCRATCH_MARKER = new THREE.Matrix4()
const MARKER_QUAT = new THREE.Quaternion()

/**
 * applyRigGrip: applies the rig's tuned grip (viewGrip3d) to the rig support's position and
 * orientation (camera frame, before the rig's rotation): x to the right (+X), y up (+Y), z away
 * from the eye (-Z); the offset is rotated by the camera's quaternion (given here, before roll)
 * to stay glued to the aim regardless of orientation; `roll` rotates around the aim axis (a
 * right multiplication of the support's rotation). A null grip changes nothing.
 */
export function applyRigGrip(position: THREE.Vector3, quaternion: THREE.Quaternion, grip: ViewGrip): void {
  if (grip.x || grip.y || grip.z) {
    position.add(SCRATCH_OFFSET.set(grip.x, grip.y, -grip.z).applyQuaternion(quaternion))
  }
  if (grip.roll) {
    quaternion.multiply(SCRATCH_ROLL.setFromAxisAngle(FORWARD_AXIS, grip.roll))
  }
}

/**
 * isPaintedMaterial : a raw (unbaked) rig material the view paints, arm or weapon. The library
 * writes the weapon's styled hard surfaces raw too, marked `rigWeapon`, so the held gun takes
 * its player's weapon coating.
 */
export function isPaintedMaterial(material: THREE.Material): material is THREE.MeshStandardMaterial {
  return material instanceof THREE.MeshStandardMaterial && !!material.userData.surfaceBrute && !material.map
}

/** isArmMaterial : a raw rig material of the arms (not the weapon's, `rigWeapon`). */
export function isArmMaterial(material: THREE.Material): material is THREE.MeshStandardMaterial {
  return isPaintedMaterial(material) && !material.userData.rigWeapon
}

export function paintArmMaterial(material: THREE.Material, outfit: Dress | null): boolean {
  return !!outfit && isArmMaterial(material) && !!material.userData.style && !!material.userData.armorMaps
}

export function samePaint(file: string, previousFile: string | null, outfit: Dress | null, previousOutfit: Dress | null): boolean {
  return file === previousFile && outfit === previousOutfit
}

/**
 * FirstPersonArms3d: the first-person weapon rigs — loading, pose, and placement of the
 * visible rig, measuring the weapon muzzle. The followed player's arm dressing (`RigDressing3d`)
 * and their painting (`RigPaint3d`) are separate modules, coordinated here: a rig only shows
 * once the dressing and painting are applied; once pieces arrive, painting is redone on them.
 */
export class FirstPersonArms3d {
  /** The holder carries the camera (position, orientation, and counter-scale to the field). */
  private readonly holder = new THREE.Group()
  /** The rig support: carries the tuned grip and the rig's rotation, on top of the counter-scale. */
  private readonly support = new THREE.Group()
  private readonly folder: string
  private readonly gate?: LoadGate
  private readonly entries = new Map<string, Entry>()
  /** In-flight rig loads (null in `entries`), each with its gate flag. */
  private readonly loads = new Map<string, { p: Promise<void>; gate: boolean }>()
  private readonly abort = new AbortController()
  private readonly weapons = new Map<string, FirstPersonRig>()
  /** The weapon model key, by rig file (the weapon paints from its coating, `weaponKeyForRig`). */
  private readonly weaponFiles = new Map<string, string>()
  /** The idle-effect markers of each weapon's rig (the index's `effectMarkers`), by weapon key. */
  private readonly effectMarkers = new Map<string, readonly RigEffectMarker[]>()
  /** Each weapon's magazine size (the index's `magazine`), by weapon key: its ammo gauges read the rounds over it. */
  private readonly magazines = new Map<string, number>()
  /** The bones the markers hang on, found once per loaded rig root. */
  private readonly effectBones = new WeakMap<THREE.Object3D, Map<string, THREE.Object3D | null>>()
  private visible: THREE.Object3D | null = null
  private readonly handWorld = new THREE.Vector3()
  private visibleKey: string | null = null
  /** Why the last `effectAnchor` failed (review: the idle effects console hook), null when it succeeded. */
  anchorMiss: string | null = null
  private armory: SpartanArmory | null = null
  private xuid: string | null = null
  private readonly preparation: RigPreparation3d
  private readonly paint: RigPaint3d
  /** The map's baked light, grafted onto the armor's painted copies. */
  private readonly baked?: BakedLight | null
  /** The closest environment probe to a point (null: reflections off). */
  private readonly probeAt?: (position: THREE.Vector3) => THREE.Texture | null
  private readonly dressing: RigDressing3d
  private readonly preloadedKeys = new Set<string>()
  /** The deferred preload is armed: set once the load gate is idle (the loading screen is gone). */
  private preloadArmed = false
  private readonly pieceIndex: Promise<ArmIndex | null>
  private readonly pieceLoader: ArmPieces3d
  private indexReady = false
  private readonly pose = newFirstPersonPose()
  /** The followed player's active camo on the visible rig (`camouflageRig3d`). */
  private readonly camouflage = new CamouflageRig3d()
  /** The renderer's KTX2 loader (ktx2Textures3d); null = load PNG only (older cache). */
  private readonly ktx2: KTX2Loader | null

  constructor(scene: THREE.Scene, folder: string, gate?: LoadGate, baked?: BakedLight | null, probeAt?: (position: THREE.Vector3) => THREE.Texture | null, ktx2: KTX2Loader | null = null) {
    this.folder = folder
    this.gate = gate
    this.baked = baked
    this.probeAt = probeAt
    this.ktx2 = ktx2
    scene.add(this.holder)
    this.holder.add(this.support)
    this.pieceIndex = (async () => {
      try {
        const r = await api.getResponse(`${folder}/bras.json`, { signal: this.abort.signal })
        return (await r.json()) as ArmIndex
      } catch (error: unknown) {
        if (!this.abort.signal.aborted) console.warn('3D replay: arm catalog unavailable', error)
        return null
      }
    })()
    this.gate?.track(this.pieceIndex)
    this.pieceLoader = new ArmPieces3d(folder, this.abort.signal, this.ktx2)
    this.preparation = new RigPreparation3d({
      loadedFiles: () => [...this.entries.entries()].filter(([, entry]) => entry).map(([file]) => file),
      materialsFor: (file) => this.entries.get(file)?.materials ?? [],
      armIndex: () => this.pieceIndex,
      piece: (file) => this.pieceLoader.piece(file),
      armory: () => this.armory,
      xuid: () => this.xuid,
      weaponKeyFor: (file) => this.weaponFiles.get(file) ?? null,
    })
    this.paint = new RigPaint3d({
      xuid: () => this.xuid,
      armory: () => this.armory,
      preparation: this.preparation,
      weaponKeyFor: (file) => this.weaponFiles.get(file) ?? null,
      gate: this.gate,
      baked: this.baked ?? null,
    })
    this.dressing = new RigDressing3d({
      pieceIndex: this.pieceIndex,
      loader: this.pieceLoader,
      signal: this.abort.signal,
      xuid: () => this.xuid,
      armory: () => this.armory,
      sourceMaterial: (m) => this.paint.sourceMaterial(m),
      invalidatePaint: (file) => this.paint.invalidate(file),
      done: (file, root) => this.paint.refresh(file, root),
      gate: this.gate,
    })
  }

  async load(): Promise<void> {
    try {
      const response = await api.getResponse(`${this.folder}/index.json`, { signal: this.abort.signal })
      const index = await response.json() as FirstPersonIndex
      const rigs = new Map(index.rigs.map((rig) => [rig.file, rig]))
      for (const weapon of index.weapons) {
        const rig = rigs.get(weapon.file)
        if (rig) {
          this.weapons.set(weapon.weapon.toLowerCase(), rig)
          this.weaponFiles.set(rig.file, weapon.weapon.toLowerCase())
          if (weapon.effectMarkers?.length) this.effectMarkers.set(weapon.weapon.toLowerCase(), weapon.effectMarkers)
          if (weapon.magazine && weapon.magazine > 0 && MAGAZINE_GAUGE_WEAPONS.has(weapon.weapon.toLowerCase())) this.magazines.set(weapon.weapon.toLowerCase(), weapon.magazine)
        }
      }
    } catch (error) {
      if (!this.abort.signal.aborted) console.warn('3D replay: first-person index unavailable', error)
    }
    this.indexReady = true
    this.startPreload()
  }

  /**
   * preload: record the model keys `keys` whose rigs should be preloaded. Recording does not
   * start a download; the downloads begin only once the preload is armed (`armPreload`),
   * so the eager preload does not compete with the gated loads for the loading screen.
   */
  preload(keys: readonly string[]): void {
    for (const key of keys) this.preloadedKeys.add(key)
    this.startPreload()
  }

  /** armPreload: arm the deferred preload; start it now if the index is already ready. Called when the load gate goes idle. */
  armPreload(): void {
    this.preloadArmed = true
    this.startPreload()
  }

  /** startPreload: start the recorded rig loads once armed and the index is ready, once. */
  private startPreload(): void {
    if (!this.preloadArmed || !this.indexReady) return
    for (const key of this.preloadedKeys) this.loadRigFor(key)
    this.preloadedKeys.clear()
  }

  private loadRigFor(key: string): void {
    const rig = this.weapons.get(key)
    if (!rig || this.entries.has(rig.file)) return
    this.loadRig(rig)
  }

  follow(armory: SpartanArmory | null, xuid: string | null): void {
    const change = this.armory !== armory || this.xuid !== xuid
    if (change) {
      this.paint.changePlayer()
      this.dressing.changePlayer()
    }
    this.armory = armory
    this.xuid = xuid
    if (change) this.preparation.changePlayer()
    if (xuid && armory && !armory.pending(xuid)) this.prepareRig()
  }

  /**
   * show poses the rig for weapon `weaponKey` at the frame (`events`) under the camera, then
   * this frame's recoil `recoil` (`firstPersonRecoil3d`) around the grip, or the measured
   * muzzle when the index gives no weapon pose. False without a loaded rig — and only without a
   * loaded rig: dressing of the pieces and ongoing painting apply to the rig AS IT ARRIVES (a
   * delayed coating never erases the previous one), so the rig shows exactly as it is at this
   * instant — never falling back to the static model while the file is loading. `camo`: the
   * strength of the player's active camouflage (0 visible, 1 full), which also hides their arms
   * and weapon. `rounds`: the magazine the HUD shows, which the weapon's ammo counter shows too
   * (`ammoCounter3d`); null leaves the counter as it was.
   */
  show(camera: THREE.PerspectiveCamera, weaponKey: string | null, events: FirstPersonFrameEvents, recoil: Recoil | null, camo = 0, rounds: number | null = null): boolean {
    this.hide()
    const rig = weaponKey && this.weapons.get(weaponKey)
    if (!rig) return false
    // The visible rig holds the loading screen (the first frame shows one): gated.
    this.loadRig(rig, true)
    const entry = this.entries.get(rig.file)
    if (!entry) return false
    this.dressing.refresh(rig.file, entry.root)
    this.paint.refresh(rig.file, entry.root)
    entry.root.visible = true
    this.visible = entry.root
    this.visibleKey = weaponKey
    this.camouflage.apply(entry.root, camo)
    showRounds(entry.counters, rounds, this.magazines.get(weaponKey!) ?? null)
    const pose = firstPersonPose(entry.rig, events, this.pose)
    for (let i = 0; i < entry.actionList.length; i++) entry.actionList[i].weight = 0
    const idle = entry.actions.get(entry.clip.name)!
    const base = pose.base && entry.actions.get(pose.base.name)
    const fire = pose.fire && entry.actions.get(pose.fire.name)
    const fireWeight = fire ? pose.fireWeight : 0
    const fireReplaces = !!fire && !pose.fire?.overlay && pose.fire?.type !== 'overlay' && pose.fire?.type !== 'replacement'
    const baseWeight = base ? pose.baseWeight * (fireReplaces ? 1 - fireWeight : 1) : 0
    idle.time = clipTime(entry.clip, events.frame, events.fps)
    idle.weight = (pose.base?.type === 'replacement' || pose.base?.type === 'overlay' || pose.base?.overlay ? 1 : 1 - baseWeight) * (fireReplaces ? 1 - fireWeight : 1)
    if (base) { base.time = pose.baseTime; base.weight = baseWeight }
    if (fire) { fire.time = pose.fireTime; fire.weight = fireWeight }
    entry.mixer.update(0)
    applyRigRecoil(entry.root, recoil, entry.pivot ?? entry.muzzle?.muzzle ?? SCRATCH_ORIGIN)
    this.place(camera)
    return true
  }

  /**
   * place poses the rig under the camera: the holder copies the camera and counter-scales to it
   * (`viewmodelScale`) in the camera's plane, the support carries the tuned grip on top of that.
   * The weapon thus keeps its projected size tuned at `VIEWMODEL_FOV` for any camera field; depth
   * (the holder's z) is not scaled: the distance to the eye follows the field, which is intended.
   * Grip offsets, applied in the scaled frame, keep their projection.
   */
  place(camera: THREE.PerspectiveCamera): void {
    camera.updateWorldMatrix(true, false)
    camera.getWorldPosition(this.holder.position)
    camera.getWorldQuaternion(this.holder.quaternion)
    const scale = viewmodelScale(camera.fov, VIEWMODEL_FOV)
    this.holder.scale.set(scale, scale, 1)
    this.support.position.set(0, 0, 0)
    this.support.quaternion.identity()
    applyRigGrip(this.support.position, this.support.quaternion, rigGripOf(this.visibleKey))
    this.support.quaternion.multiply(ROTATION_RIG_CAMERA)
    // The arm armor picks up the map's environment where the player stands (null probe: reflections off).
    if (this.probeAt) {
      const probe = this.probeAt(this.holder.position)
      for (const m of this.paint.paintedMaterials()) assignPlayerProbe(m, probe)
    }
  }

  /**
   * rigLoaded: is weapon `weaponKey`'s rig known to the index (so it will load)? False without a
   * loaded index or for a weapon with no rig: the shot then follows the static model, not the rig.
   */
  rigLoaded(weaponKey: string | null): boolean {
    return !!(weaponKey && this.weapons.get(weaponKey))
  }

  /**
   * weaponKeyForRig: the weapon model key of the rig with file `file`, null without a loaded index
   * (preloading requests these keys for the followed player, `preparePlayer`).
   */
  weaponKeyForRig(file: string): string | null {
    return this.weaponFiles.get(file) ?? null
  }

  /**
   * preparePlayer: player `xuid` is followed in first person — starts dressing the pieces and
   * painting EVERY loaded rig (the one held and the others, so weapon switches find their
   * coating ready instead of falling back to the static model). Prewarming does the same work
   * on the loading screen for every player.
   */
  preparePlayer(xuid: string): void {
    this.follow(this.armory, xuid)
    this.prepareRig()
  }

  /**
   * muzzleView: the held rig's muzzle, in CAMERA frame (x right, y up, -z forward), composed the
   * way `place` poses the holder for a camera fixed at the origin. False without a loaded rig
   * for `weaponKey` (the weapon has no rig, or it isn't loaded yet: the shot uses the static
   * model). `out` is filled in, allocating nothing.
   */
  muzzleView(weaponKey: string | null, out: THREE.Vector3): boolean {
    const rig = weaponKey ? this.weapons.get(weaponKey) : null
    const entry = rig ? this.entries.get(rig.file) : null
    const st = entry?.muzzle
    if (!rig || !entry || !st) return false
    out.copy(muzzlePoseCamera(st, rigGripOf(weaponKey), SCRATCH_MUZZLE_VIEW))
    // The holder is counter-scaled in the camera's plane (`place`): the drawn muzzle follows.
    out.x *= this.holder.scale.x
    out.y *= this.holder.scale.y
    return true
  }

  /**
   * muzzleWorld: the visible rig's muzzle in WORLD space, read at the rendered frame (the local
   * holder's world matrix is refreshed), for a rig posed by `show`. `pos`: the muzzle, `axis`:
   * the unit muzzle direction, in world space. False without a visible rig or a measured muzzle.
   * No shot or frame allocates.
   */
  muzzleWorld(pos: THREE.Vector3, axis: THREE.Vector3): boolean {
    const rig = this.visibleKey ? this.weapons.get(this.visibleKey) : null
    const st = rig ? this.entries.get(rig.file)?.muzzle : null
    if (!this.visible || !st?.localHolder || !st.point || !st.localAxis) return false
    muzzleWorldPose(st.localHolder, st.point, st.localAxis, pos, axis)
    return true
  }

  /**
   * leftHandWorld: where a first-person grapple cable leaves, in WORLD space at the rendered
   * frame (`grapple3d_logic.fpCableStart`): the left hand bone of the visible rig, otherwise the
   * estimated left hand carried by the camera the holder copies (`place`). Allocates nothing.
   */
  leftHandWorld(out: THREE.Vector3): THREE.Vector3 {
    const rig = this.visible && this.visibleKey ? this.weapons.get(this.visibleKey) : null
    const hand = rig ? this.entries.get(rig.file)?.leftHand ?? null : null
    if (hand) {
      hand.updateWorldMatrix(true, false)
      hand.getWorldPosition(this.handWorld)
    }
    return fpCableStart(this.holder.position, this.holder.quaternion, hand ? this.handWorld : null, out)
  }

  /**
   * boneWorld: the world matrix of bone `name` of the visible rig at the rendered frame, written in
   * `out`; false without a visible rig or when it has no bone of that name (the arms rig carries the
   * arms and hands, not the body).
   */
  boneWorld(name: string, out: THREE.Matrix4): boolean {
    if (!this.visible) return false
    const bone = this.visible.getObjectByName(name)
    if (!bone) return false
    bone.updateWorldMatrix(true, false)
    out.copy(bone.matrixWorld)
    return true
  }

  /**
   * effectAnchor: the WORLD frame of the idle-effect marker `marker` of weapon `key` on the visible
   * rig, at the rendered frame: its bone's world matrix, then the marker's offset and rotation in that
   * bone's frame. `instance`: which instance of the marker, in the index's order (the Heatwave's vent marker
   * sits on both fins). False when that weapon's rig is not the one shown, or lacks the marker or its bone.
   */
  effectAnchor(key: string, marker: string, out: THREE.Matrix4, instance = 0): boolean {
    this.anchorMiss = null
    if (!this.visible || this.visibleKey !== key) {
      this.anchorMiss = `rig shown: ${this.visible ? this.visibleKey : 'none'}`
      return false
    }
    const m = this.effectMarkers.get(key)?.filter((x) => x.marker === marker)[instance]
    if (!m) {
      this.anchorMiss = `no marker ${marker} #${instance} on rig ${key} (${this.effectMarkers.get(key)?.length ?? 0} markers)`
      return false
    }
    let bones = this.effectBones.get(this.visible)
    if (!bones) this.effectBones.set(this.visible, (bones = new Map()))
    if (!bones.has(m.bone)) bones.set(m.bone, this.visible.getObjectByName(m.bone) ?? null)
    const bone = bones.get(m.bone)
    if (!bone) {
      this.anchorMiss = `no bone ${m.bone} on rig ${key}`
      return false
    }
    bone.updateWorldMatrix(true, false)
    const q = m.rotation
    SCRATCH_MARKER.makeRotationFromQuaternion(q ? MARKER_QUAT.set(q[0], q[1], q[2], q[3]) : MARKER_QUAT.identity())
    out.copy(bone.matrixWorld).multiply(SCRATCH_MARKER.setPosition(m.position[0], m.position[1], m.position[2]))
    return true
  }

  /** clipDuration: the length (s) of the clip the rig of weapon `key` plays for `action`, null without one. */
  clipDuration(key: string, action: string): number | null {
    const rig = this.weapons.get(key)
    return rig ? clipOfRig(rig, action)?.durationSeconds ?? null : null
  }

  hide(): void {
    if (this.visible) this.visible.visible = false
    this.visible = null
    this.visibleKey = null
  }

  /** prepareRig: prepares each loaded rig for prewarming, pieces then painting. */
  prepareRig(): void {
    if (this.xuid && this.armory?.pending(this.xuid)) return
    for (const [file, entry] of this.entries) {
      if (!entry) continue
      this.dressing.refresh(file, entry.root)
      if (!this.dressing.busy(file)) this.paint.refresh(file, entry.root)
    }
  }

  /** loadedRoots: the roots of loaded rigs (attached to the scene), for prewarming's texture walk. */
  loadedRoots(): THREE.Object3D[] {
    return [...this.entries.values()].filter((e): e is NonNullable<Entry> => !!e).map((e) => e.root)
  }

  dispose(): void {
    this.paint.changePlayer()
    this.dressing.changePlayer()
    this.abort.abort()
    this.pieceLoader.dispose()
    this.holder.removeFromParent()
    for (const entry of this.entries.values()) if (entry) this.release(entry.root)
    this.entries.clear()
  }

  private release(root: THREE.Object3D): void {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.geometry.dispose()
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of [...Object.values(material), ...Object.values(material.userData.armorMaps ?? {})]) if (value instanceof THREE.Texture) value.dispose()
        material.dispose()
      }
    })
  }

  /**
   * measureMuzzle: measures the rig's muzzle and barrel axis ONCE (holder frame), at the idle
   * pose: the rig poses the holder at a fixed origin (`place` on a camera at the origin), poses
   * idle at t=0 (actions blend at their resting weight), and `muzzlePose` reads the weapon
   * meshes' vertices in the holder's space. Without an index axis, the barrel points away from
   * the eye.
   */
  private measureMuzzle(entry: NonNullable<Entry>): void {
    const support = this.support
    support.position.copy(SCRATCH_ORIGIN)
    support.quaternion.copy(SCRATCH_IDENTITY)
    const idle = entry.actions.get(entry.clip.name)
    for (let i = 0; i < entry.actionList.length; i++) entry.actionList[i].weight = 0
    if (idle) {
      idle.time = 0
      idle.weight = 1
    }
    entry.mixer.update(0)
    const idleWeapon = entry.rig.idleWeapon
    const rigAxis = idleWeapon ? SCRATCH_RIG_AXIS.set(idleWeapon.forward[0], idleWeapon.forward[1], idleWeapon.forward[2]) : null
    const st: StMuzzle = { muzzle: new THREE.Vector3(), axis: new THREE.Vector3() }
    if (!muzzlePose(entry.root, support, (m) => isArmMaterial(this.paint.sourceMaterial(m)), rigAxis, st)) return
    // The same muzzle in its holder's LOCAL frame: this one follows the animated rig, posed per frame.
    const local: MuzzleLocal = { localHolder: entry.root, point: new THREE.Vector3(), axis: new THREE.Vector3() }
    if (muzzleLocalPose(entry.root, support, (m) => isArmMaterial(this.paint.sourceMaterial(m)), rigAxis, local)) {
      st.localHolder = local.localHolder
      st.point = local.point
      st.localAxis = local.axis
    }
    entry.muzzle = st
  }

  /**
   * Load the rig `rig`, once per file. `gate`: the load holds the loading screen
   * (`gate.idle`) — true for the visible rig (the first frame shows one), false for the
   * eagerly preloaded rigs (`preload`), which load without blocking playback. If an
   * ungated load is already in flight and a gated one is requested, it is promoted to gated.
   */
  private loadRig(rig: FirstPersonRig, gate = false): void {
    if (this.entries.get(rig.file)) return
    const inProgress = this.loads.get(rig.file)
    if (inProgress) {
      if (gate && !inProgress.gate) { inProgress.gate = true; this.gate?.track(inProgress.p) }
      return
    }
    this.entries.set(rig.file, null)
    const loading = (async () => {
      try {
        const clip = clipOfRig(rig, 'idle')
        if (!clip) throw new Error('missing idle clip')
        const path = rigUrl(this.folder, rig.file)
        const buffer = await fetchMesh(path, () => {}, this.abort.signal)
        const gltf = await withKtx2(new GLTFLoader(), this.ktx2).parseAsync(buffer, `${API_BASE_URL}${this.folder}/`)
        const animation = gltf.animations.find((a) => a.name === clip.name)
        if (!animation) {
          this.release(gltf.scene)
          throw new Error('missing idle animation')
        }
        if (this.abort.signal.aborted) {
          this.release(gltf.scene)
          return
        }
        gltf.scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return
          if (object instanceof THREE.SkinnedMesh) object.frustumCulled = false
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            if (!isPaintedMaterial(material)) {
              darkMetalFallback(material)
              continue
            }
            material.color.setRGB(ARMURE_NEUTRE, ARMURE_NEUTRE, ARMURE_NEUTRE)
            material.roughness = RUGOSITE_ARMURE_NEUTRE
          }
        })
        await rawMaps(gltf.scene, gltf.parser, (m) => isPaintedMaterial(m) && !!m.userData.style)
          .catch((error: unknown) => console.warn('3D replay: arm masks unavailable', error))
        if (this.abort.signal.aborted) {
          this.release(gltf.scene)
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
        const actionList = [...actions.values()]
        gltf.scene.visible = false
        this.support.add(gltf.scene)
        const entry: NonNullable<Entry> = { root: gltf.scene, mixer, clip, rig, actions, actionList, materials: [], pivot: recoilPivot(rig.idleWeapon), leftHand: gltf.scene.getObjectByName('b_l_hand') ?? null, counters: findCounterQuads(gltf.scene) }
        this.entries.set(rig.file, entry)
        // The weapon muzzle, once, at the idle pose: the rig is at rest, its resting position.
        this.measureMuzzle(entry)
        const materials: THREE.Material[] = []
        gltf.scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return
          for (const m of Array.isArray(object.material) ? object.material : [object.material]) {
            if (isPaintedMaterial(m) && m.userData.style && !materials.includes(m)) materials.push(m)
          }
        })
        entry.materials = materials
        this.preparation.rigLoaded(rig.file)
        if (this.xuid && this.armory && !this.armory.pending(this.xuid)) this.prepareRig()
      } catch (error) {
        if (!this.abort.signal.aborted) console.warn('3D replay: first-person rig unavailable', rig.file, error)
      } finally {
        this.loads.delete(rig.file)
      }
    })()
    this.loads.set(rig.file, { p: loading, gate })
    if (gate) this.gate?.track(loading)
    void loading
  }
}
