// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** replayCamera3d.ts — tracked state, camera placement, and measuring the map's floor. */
import * as THREE from 'three'
import { EYE_HEIGHT } from './body3d'
import { deathCameraPose, povSubject, type DeathCameraOpts, type DeathCameraPose } from './deathCamera3d'
import { aimDirThree, toThree, type PlayerState3d, type Tracks3d } from './tracks3d'
import { evaluateCameraScript, type CameraScript, type ScriptPose, type ScriptSubjects } from './cameraScript3d'
import { springArmLength } from './springArm3d'
import type { Lens3d } from './dof3d'
import type { ActionScene3d } from './actionScene3d'
import type { CameraMode3d, PovStatus } from './replayScene3d'

const TP_DISTANCE = 1.05
const TP_RISE = 0.2
const FLOOR_SAMPLES = 400
/** The death camera: third person on the ragdoll (distance, rise, and the third-person camera's eye). */
const DEATH_CAMERA: DeathCameraOpts = { distance: TP_DISTANCE, rise: TP_RISE, eyeHeight: EYE_HEIGHT }

/** The data needed to place the camera at a frame. */
interface CameraState {
  tracks: Tracks3d | null
  povXuid: string | null
  mode: CameraMode3d
  action: ActionScene3d | null
  originAboveFloor: number
  /** The players' feet in GAME coordinates for a camera script's player anchors. */
  subjects: ScriptSubjects
  /** The game's FOV setting (horizontal degrees at 16:9): a camera script's base field. */
  gameFov: number
  camera: THREE.PerspectiveCamera
  /** The surfaces the spring arm ray tests against: the map structure, then the attached layer. */
  pickables: () => THREE.Mesh[]
  raycaster: THREE.Raycaster
  /**
   * Receives the lens at every placement: the playing script pose's focus distance and f-number,
   * or null (no script, a tracked camera, or a script without depth of field).
   */
  setLens?: (lens: Lens3d | null) => void
}

/** Computes the tracked state and places the camera without changing the chosen mode. */
export class ReplayCamera3d {
  private readonly state: CameraState
  private readonly tmpFeet = new THREE.Vector3()
  private readonly tmpPose: DeathCameraPose = { position: new THREE.Vector3(), look: new THREE.Vector3() }
  private readonly tmpDesired = new THREE.Vector3()
  private readonly tmpArm = new THREE.Vector3()
  private readonly rise = new THREE.Vector3(0, TP_RISE, 0)
  /** The third-person spring arm length in u; -1 until the first placement, which starts at full length. */
  private armLength = -1
  private lastClock = 0
  /** The match step of the current placement (export), or null on screen (wall clock). */
  private matchDt: number | null = null
  private script: CameraScript | null = null
  private scriptMs = 0
  /** The pose of the last scripted placement, null until the script places a camera. */
  lastScriptPose: ScriptPose | null = null
  /**
   * The playing script pose's `near` (u), the depth the map is cut at (`mapCut3d`), or null (no
   * script pose, a run without one, a tracked camera). The camera's own near plane never moves.
   */
  private cutNear: number | null = null

  constructor(state: CameraState) { this.state = state }

  /**
   * povState: the tracked player's state at frame `f`. Dead, the position where they fell; not
   * yet spawned, that of their first spawn.
   */
  povState(f: number): { state: PlayerState3d | null; status: PovStatus } {
    const { tracks, povXuid } = this.state
    if (!tracks || !povXuid) return { state: null, status: 'none' }
    const alive = tracks.sample(povXuid, f)
    if (alive) return { state: alive, status: 'alive' }
    const fallen = tracks.lastLifeBefore(povXuid, f)
    if (fallen) return { state: fallen, status: 'dead' }
    return { state: tracks.firstLifeAfter(povXuid, f), status: 'unspawned' }
  }

  /** setScript sets the camera script driving the free camera, or null to stop it. */
  setScript(script: CameraScript | null): void {
    this.script = script
    if (!script) {
      this.lastScriptPose = null
      this.state.setLens?.(null)
      this.cutNear = null
    }
  }

  /**
   * mapCutNear: the depth (u, along the view axis) the map is cut at for the frame just placed,
   * the playing script pose's `near`; null when nothing is cut (no scripted placement, or a run
   * without a `near`). Only the map is cut (`mapCut3d`): never players or effects.
   */
  mapCutNear(): number | null { return this.scripted() ? this.cutNear : null }

  /** setScriptTime sets the script's current time (script ms). */
  setScriptTime(sMs: number): void { this.scriptMs = sMs }

  /** scripted: a script is set and the camera is free (a script never moves a tracked camera). */
  scripted(): boolean { return this.script !== null && this.state.mode === 'free' }

  /** activeScript: the script driving the free camera when it is scripted, else null. */
  activeScript(): CameraScript | null { return this.scripted() ? this.script : null }

  /** scriptTime: the script's current time (script ms). */
  scriptTime(): number { return this.scriptMs }

  /**
   * placeCamera places the camera on the tracked player (see povState); a set script drives the
   * free camera (see placeScripted), else the free camera stays where it is. `dt`: the seconds of
   * MATCH since the previous placement, given by the video export; absent, the wall clock (the
   * screen plays in real time).
   */
  placeCamera(f: number, dt?: number): PovStatus {
    this.matchDt = dt ?? null
    const { state: s, status } = this.povState(f)
    if (this.scripted()) { this.placeScripted(); return status }
    this.state.setLens?.(null)
    this.cutNear = null
    if (!s || this.state.mode === 'free') return status
    // In first person, a dead player follows their ragdoll in third person, or keeps their last eye.
    if (this.state.mode === 'fp' && status === 'dead') { this.placeDead(f, s); return status }
    // Mounted, the biped no longer replicates: the eye follows the vehicle and looks where it goes.
    const rider = this.state.povXuid ? this.state.action?.riderAt(this.state.povXuid, f) ?? null : null
    const [x, y, z] = toThree(s.x, s.y, s.z)
    const eye = rider
      ? rider.clone().setY(rider.y + EYE_HEIGHT)
      : new THREE.Vector3(x, y - this.state.originAboveFloor + EYE_HEIGHT - s.dropOeil, z)
    const heading = rider && this.state.povXuid ? this.state.action?.riderHeadingAt(this.state.povXuid, f) ?? s.h : s.h
    const d = new THREE.Vector3(...aimDirThree(heading, rider ? 0 : s.p))
    this.state.camera.position.copy(eye)
    if (this.state.mode === 'tp' || rider) this.springArm(eye, d)
    this.state.camera.lookAt(eye.clone().addScaledVector(d, 10))
    return status
  }

  /**
   * placeScripted poses the camera from the script at the current script time; a null pose
   * leaves the camera as it is. The pose is stored in `lastScriptPose` (its target is what the
   * free orbit should keep when the script stops). The pose's shake turns the camera about its
   * own axes after the roll; its lens goes to `setLens`; its `near` is the depth the map is cut
   * at (`mapCutNear`), the camera's own near plane untouched.
   */
  private placeScripted(): void {
    const script = this.script
    if (!script) return
    const pose = evaluateCameraScript(script, this.scriptMs, this.state.subjects, this.state.gameFov)
    if (!pose) { this.state.setLens?.(null); this.cutNear = null; return }
    this.cutNear = pose.near
    const camera = this.state.camera
    camera.position.set(pose.position[0], pose.position[1], pose.position[2])
    camera.lookAt(pose.target[0], pose.target[1], pose.target[2])
    camera.rotateZ((-pose.rollDeg * Math.PI) / 180) // a positive roll turns the frame clockwise
    const { yawDeg, pitchDeg, rollDeg } = pose.shake
    if (yawDeg !== 0 || pitchDeg !== 0 || rollDeg !== 0) {
      const rad = Math.PI / 180
      camera.rotateY(yawDeg * rad) // a positive yaw turns the view left
      camera.rotateX(pitchDeg * rad) // a positive pitch turns it up
      camera.rotateZ(-rollDeg * rad) // a positive roll turns the frame clockwise, like the key's
    }
    this.lastScriptPose = pose
    const { focusDistance, aperture } = pose
    this.state.setLens?.(focusDistance !== null && aperture !== null ? { focusDistance, aperture } : null)
  }

  /** springArm: the third-person camera, pulled in by the map when the arm from the head hits it. */
  private springArm(eye: THREE.Vector3, d: THREE.Vector3): void {
    this.tmpDesired.copy(eye).addScaledVector(d, -TP_DISTANCE).add(this.rise)
    const fullLength = eye.distanceTo(this.tmpDesired)
    this.tmpArm.copy(this.tmpDesired).sub(eye).normalize()
    let hit: number | null = null
    const pickables = this.state.pickables()
    if (pickables.length > 0) {
      const raycaster = this.state.raycaster
      raycaster.firstHitOnly = true
      raycaster.far = fullLength
      raycaster.set(eye, this.tmpArm)
      const first = raycaster.intersectObjects(pickables, false)[0]
      hit = first ? first.distance : null
    }
    const prev = this.armLength < 0 ? fullLength : this.armLength
    this.armLength = springArmLength(eye, this.tmpDesired, hit, prev, this.deltaTime())
    this.state.camera.position.copy(eye).addScaledVector(this.tmpArm, this.armLength)
  }

  /**
   * deltaTime: seconds since the previous placement, clamped so a pause does not skip the ease.
   * During an export, the match step it was given: the wall clock there measures render cost.
   */
  private deltaTime(): number {
    if (this.matchDt !== null) {
      // The screen's clock restarts from zero after the export instead of seeing one long step.
      this.lastClock = 0
      return Math.min(Math.max(this.matchDt, 0), 0.1)
    }
    const now = performance.now()
    const dt = this.lastClock === 0 ? 0 : (now - this.lastClock) / 1000
    this.lastClock = now
    return Math.min(Math.max(dt, 0), 0.1)
  }

  /** placeDead: in first person, a dead player follows their ragdoll in third person, or keeps their last eye. */
  private placeDead(f: number, s: PlayerState3d): void {
    const xuid = this.state.povXuid
    const body = xuid ? this.state.action?.corpseFeet(xuid, f, this.tmpFeet) ?? null : null
    const subject = povSubject(false, body, s.h)
    if (subject.kind === 'corpse') {
      deathCameraPose(subject.feet, subject.heading, DEATH_CAMERA, this.tmpPose)
      this.state.camera.position.copy(this.tmpPose.position)
      this.state.camera.lookAt(this.tmpPose.look)
      return
    }
    this.holdEye(s)
  }

  /** holdEye: without a known body, the eye stays at the player's last frame alive, looking where they were looking. */
  private holdEye(s: PlayerState3d): void {
    const [x, y, z] = toThree(s.x, s.y, s.z)
    const eye = new THREE.Vector3(x, y - this.state.originAboveFloor + EYE_HEIGHT - s.dropOeil, z)
    const d = new THREE.Vector3(...aimDirThree(s.h, 0))
    this.state.camera.position.copy(eye)
    this.state.camera.lookAt(eye.addScaledVector(d, 10))
  }
}

/**
 * measureOriginAboveFloor: the published origin's median height above the floor, measured by
 * raycasting downward under the player's points. It sets where to place the eye and the capsule.
 * Measured against the nearest of the given surfaces, the map's structure and the posed layer's:
 * a Forge map's floor lives in the layer, not the canvas, so the layer must be included or a spawn
 * near the canvas's ground would be dropped to it (the map alone is passed before the layer arrives).
 */
export function measureOriginAboveFloor(pts: readonly { x: number; y: number; z: number }[], pickables: THREE.Mesh[], raycaster: THREE.Raycaster): number {
  if (pickables.length === 0) return 0
  const step = Math.max(1, Math.floor(pts.length / FLOOR_SAMPLES))
  const gaps: number[] = []
  raycaster.firstHitOnly = true
  raycaster.far = 2
  for (let i = 0; i < pts.length; i += step) {
    const [x, y, z] = toThree(pts[i].x, pts[i].y, pts[i].z)
    raycaster.set(new THREE.Vector3(x, y + 0.1, z), new THREE.Vector3(0, -1, 0))
    const hit = raycaster.intersectObjects(pickables, false)[0]
    if (hit) gaps.push(y - hit.point.y)
  }
  if (gaps.length === 0) return 0
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(0.5 * (gaps.length - 1))]
}
