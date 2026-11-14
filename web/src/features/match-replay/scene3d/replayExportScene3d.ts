/** replayExportScene3d.ts — conserve et restaure la vue pendant le rendu vidéo. */
import * as THREE from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import type { Export3dSetup, ExportTag3d } from '../export/replay3dExportStore'
import type { CameraMode3d } from './replayScene3d'
import type { Avatar } from './avatar3d'
import type { ActionScene3d } from './actionScene3d'
import type { PostFx3d } from './postFx3d'
import type { Lighting } from './lighting'

/** Les éléments de scène utilisés par l'export et les opérations qui conservent son état. */
interface ExportScene {
  renderer: THREE.WebGLRenderer
  camera: THREE.PerspectiveCamera
  orbit: OrbitControls
  labels: CSS2DRenderer
  post: PostFx3d
  lighting: Lighting
  avatars: Map<string, Avatar>
  readonly action: ActionScene3d | null
  readonly hasTracks: boolean
  mode: CameraMode3d
  readonly povXuid: string | null
  lastFrame: number
  applyPov(xuid: string | null): void
  applyMode(mode: CameraMode3d): void
  placeAvatars(frame: number): void
  placeCamera(frame: number): void
  placeFirstPerson(frame: number): void
}

/** La vue d'écran pendant un export : ce qu'elle avait, et ce qu'elle demande depuis. */
interface HeldView {
  mode: CameraMode3d
  /** La caméra avant l'export : un changement demandé pendant l'export se rejoue au retour. */
  modeBefore: CameraMode3d
  pov: string | null
  width: number
  height: number
  pixelRatio: number
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  target: THREE.Vector3
}

/** Gère la prise de la scène et la restitution de la vue d'écran. */
export class ReplayExportScene3d {
  /** La vue d'écran retenue pendant l'export, ou null hors export. */
  held: HeldView | null = null

  private readonly scene: ExportScene

  constructor(scene: ExportScene) { this.scene = scene }

  /** Prend la scène et retient la vue d'écran jusqu'à la fin de l'export. */
  beginExport(setup: Export3dSetup): void {
    if (this.held) return
    const size = this.scene.renderer.getSize(new THREE.Vector2())
    this.held = {
      mode: this.scene.mode,
      modeBefore: this.scene.mode,
      pov: this.scene.povXuid,
      width: size.x,
      height: size.y,
      pixelRatio: this.scene.renderer.getPixelRatio(),
      position: this.scene.camera.position.clone(),
      quaternion: this.scene.camera.quaternion.clone(),
      target: this.scene.orbit.target.clone(),
    }
    // Le fichier a sa propre taille : la densité de l'écran n'entre pas dans le rendu.
    this.scene.renderer.setPixelRatio(1)
    this.scene.post.composer.setPixelRatio(1)
    this.applySize(setup.width, setup.height, false)
    this.scene.applyPov(setup.pov)
    // La caméra libre déjà choisie à l'écran garde son cadrage ; prise pour l'export, elle part
    // derrière le joueur suivi à la première image du clip et n'en bouge plus.
    this.scene.lastFrame = setup.frame
    if (setup.camera !== this.scene.mode) this.scene.applyMode(setup.camera)
    this.scene.orbit.enabled = false
  }

  /** Dessine une image vidéo sans rendre les étiquettes HTML. */
  exportFrame(frame: number): HTMLCanvasElement {
    this.scene.lastFrame = frame
    if (this.scene.hasTracks) {
      this.scene.placeAvatars(frame)
      this.scene.placeCamera(frame)
      this.scene.placeFirstPerson(frame)
      this.scene.action?.update(frame)
    }
    this.scene.lighting.updateShadows(frame)
    this.scene.post.composer.render()
    return this.scene.renderer.domElement
  }

  /** Projette les étiquettes visibles dans le format vidéo. */
  exportTags(): readonly ExportTag3d[] {
    const size = this.scene.renderer.getSize(new THREE.Vector2())
    const tags: ExportTag3d[] = []
    const p = new THREE.Vector3()
    const push = (at: THREE.Vector3, tag: Omit<ExportTag3d, 'x' | 'y'>) => {
      p.copy(at).project(this.scene.camera)
      // Derrière la caméra ou hors champ : pas d'étiquette (comme `CSS2DRenderer`).
      if (p.z < -1 || p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1) return
      tags.push({ x: ((p.x + 1) / 2) * size.x, y: ((1 - p.y) / 2) * size.y, ...tag })
    }
    for (const a of this.scene.avatars.values()) {
      if (a.tag.visible) push(a.tag.position, { name: a.name, color: a.color })
    }
    for (const pool of this.scene.action?.labelPools() ?? []) {
      for (const l of pool.shown()) push(l.position, { name: l.text, color: l.color })
    }
    return tags
  }

  /** Rend la scène à la vue d'écran et applique les changements retenus. */
  endExport(): void {
    const held = this.held
    if (!held) return
    this.held = null
    this.scene.renderer.setPixelRatio(held.pixelRatio)
    this.scene.post.composer.setPixelRatio(held.pixelRatio)
    this.applySize(held.width, held.height, true)
    this.scene.applyPov(held.pov)
    this.scene.camera.position.copy(held.position)
    this.scene.camera.quaternion.copy(held.quaternion)
    this.scene.orbit.target.copy(held.target)
    if (held.mode !== held.modeBefore) {
      this.scene.applyMode(held.mode)
    } else {
      this.scene.mode = held.mode
      this.scene.orbit.enabled = held.mode === 'free'
    }
  }

  /** applySize : `onScreen` faux pour l'export, qui rend sans toucher à la boîte de la toile. */
  applySize(width: number, height: number, onScreen: boolean): void {
    this.scene.camera.aspect = width / height
    this.scene.camera.updateProjectionMatrix()
    this.scene.renderer.setSize(width, height, onScreen)
    this.scene.post.composer.setSize(width, height)
    if (onScreen) this.scene.labels.setSize(width, height)
  }
}
