/** replayCamera3d.ts — état suivi, placement de caméra et mesure du sol de la carte. */
import * as THREE from 'three'
import { EYE_HEIGHT } from './body3d'
import { deathCameraPose, povSubject, type DeathCameraOpts, type DeathCameraPose } from './deathCamera3d'
import { aimDirThree, toThree, type PlayerState3d, type Tracks3d } from './tracks3d'
import type { ActionScene3d } from './actionScene3d'
import type { MapModel } from './mapModel'
import type { CameraMode3d, PovStatus } from './replayScene3d'

const TP_DISTANCE = 1.05
const TP_RISE = 0.2
const FLOOR_SAMPLES = 400
/** La caméra de mort : la 3e personne sur le corps inerte (distance, élévation et œil de la caméra 3e). */
const DEATH_CAMERA: DeathCameraOpts = { distance: TP_DISTANCE, rise: TP_RISE, eyeHeight: EYE_HEIGHT }

/** Les données nécessaires au placement de la caméra à une image. */
interface CameraState {
  tracks: Tracks3d | null
  povXuid: string | null
  mode: CameraMode3d
  action: ActionScene3d | null
  originAboveFloor: number
  camera: THREE.PerspectiveCamera
}

/** Calcule l'état suivi et pose la caméra sans modifier le mode choisi. */
export class ReplayCamera3d {
  private readonly state: CameraState
  private readonly tmpFeet = new THREE.Vector3()
  private readonly tmpPose: DeathCameraPose = { position: new THREE.Vector3(), look: new THREE.Vector3() }

  constructor(state: CameraState) { this.state = state }

  /**
   * povState : l'état du joueur suivi à l'image `f`. Mort, la position où il est tombé ; pas encore
   * apparu, celle de sa première apparition.
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

  /** placeCamera pose la caméra sur le joueur suivi (cf. povState) ; la caméra libre reste où elle est. */
  placeCamera(f: number): PovStatus {
    const { state: s, status } = this.povState(f)
    if (!s || this.state.mode === 'free') return status
    // En 1re personne, un joueur mort suit son corps inerte en 3e, ou garde son dernier œil.
    if (this.state.mode === 'fp' && status === 'dead') { this.placeDead(f, s); return status }
    // À bord, le bipède ne réplique plus : l'œil suit le véhicule et regarde où il va.
    const rider = this.state.povXuid ? this.state.action?.riderAt(this.state.povXuid, f) ?? null : null
    const [x, y, z] = toThree(s.x, s.y, s.z)
    const eye = rider
      ? rider.clone().setY(rider.y + EYE_HEIGHT)
      : new THREE.Vector3(x, y - this.state.originAboveFloor + EYE_HEIGHT - s.dropOeil, z)
    const heading = rider && this.state.povXuid ? this.state.action?.riderHeadingAt(this.state.povXuid, f) ?? s.h : s.h
    const d = new THREE.Vector3(...aimDirThree(heading, rider ? 0 : s.p))
    this.state.camera.position.copy(eye)
    if (this.state.mode === 'tp') this.state.camera.position.addScaledVector(d, -TP_DISTANCE).add(new THREE.Vector3(0, TP_RISE, 0))
    this.state.camera.lookAt(eye.clone().addScaledVector(d, 10))
    return status
  }

  /** placeDead : en 1re personne, un joueur mort suit son corps inerte en 3e, ou garde son dernier œil. */
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

  /** holdEye : sans corps connu, l'œil reste à la dernière image en vie du joueur, regardant où il regardait. */
  private holdEye(s: PlayerState3d): void {
    const [x, y, z] = toThree(s.x, s.y, s.z)
    const eye = new THREE.Vector3(x, y - this.state.originAboveFloor + EYE_HEIGHT - s.dropOeil, z)
    const d = new THREE.Vector3(...aimDirThree(s.h, 0))
    this.state.camera.position.copy(eye)
    this.state.camera.lookAt(eye.addScaledVector(d, 10))
  }
}

/**
 * measureOriginAboveFloor : hauteur médiane de l'origine publiée au-dessus du sol, mesurée par
 * lancer de rayon vers le bas sous les points du joueur. Elle fixe où poser l'œil et la capsule.
 * Mesurée sur la structure de la carte seule : la valeur ne dépend pas de l'arrivée du calque.
 */
export function measureOriginAboveFloor(pts: readonly { x: number; y: number; z: number }[], model: MapModel | null, raycaster: THREE.Raycaster): number {
  if (!model) return 0
  const step = Math.max(1, Math.floor(pts.length / FLOOR_SAMPLES))
  const gaps: number[] = []
  raycaster.firstHitOnly = true
  raycaster.far = 2
  for (let i = 0; i < pts.length; i += step) {
    const [x, y, z] = toThree(pts[i].x, pts[i].y, pts[i].z)
    raycaster.set(new THREE.Vector3(x, y + 0.1, z), new THREE.Vector3(0, -1, 0))
    const hit = raycaster.intersectObjects(model.pickables, false)[0]
    if (hit) gaps.push(y - hit.point.y)
  }
  if (gaps.length === 0) return 0
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(0.5 * (gaps.length - 1))]
}
