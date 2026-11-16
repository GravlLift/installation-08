/** replayExportScene3d.ts — conserve et restaure la vue pendant le rendu vidéo. */
import * as THREE from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import type { Export3dSetup, ExportTag3d } from '../export/replay3dExportStore'
import type { CameraMode3d } from './replayScene3d'
import type { SceneView3d } from './topDownLogic'
import type { Avatar } from './avatar3d'
import type { ActionScene3d } from './actionScene3d'
import type { PostFx3d } from './postFx3d'
import type { Lighting } from './lighting'
import { ExportReadback3d } from './exportReadback3d'

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
  view: SceneView3d
  readonly povXuid: string | null
  lastFrame: number
  applyPov(xuid: string | null): void
  applyMode(mode: CameraMode3d): void
  placeAvatars(frame: number): void
  /** `dt`: seconds of MATCH since the previous exported frame (the spring arm's ease). */
  placeCamera(frame: number, dt: number): void
  placeFirstPerson(frame: number): void
  /** Recomputes name tags from the camera as placed for the last exported frame (they were tagged before it moved). */
  retagTags(): void
  /** Drives the clouds from match time (seconds), or hands them back to the wall clock (null). */
  setSkyClock?(seconds: number | null): void
  /** Takes the top-down view's markers out of the scene (what the screen does when the 3D view draws). */
  hideTopDown?(): void
}

/** La vue d'écran pendant un export : ce qu'elle avait, et ce qu'elle demande depuis. */
interface HeldView {
  mode: CameraMode3d
  /** La caméra avant l'export : un changement demandé pendant l'export se rejoue au retour. */
  modeBefore: CameraMode3d
  /** The drawing view before the export; a change asked mid-export is replayed on return. */
  view: SceneView3d
  pov: string | null
  width: number
  height: number
  pixelRatio: number
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  target: THREE.Vector3
}

/**
 * exportStepSeconds: the MATCH seconds between two exported frames (`frameMs` per document
 * frame). Never negative: the first frame, and a held last frame, step by zero.
 */
export function exportStepSeconds(previous: number, frame: number, frameMs: number): number {
  return Math.max(0, frame - previous) * Math.max(0, frameMs) / 1000
}

/** Gère la prise de la scène et la restitution de la vue d'écran. */
export class ReplayExportScene3d {
  /** La vue d'écran retenue pendant l'export, ou null hors export. */
  held: HeldView | null = null

  private readonly scene: ExportScene
  /** The previous exported frame, and the match duration of a document frame (ms). */
  private clock = { previous: 0, frameMs: 0 }
  /** Copies each rendered frame out of WebGL (`exportFrame`). */
  private readonly readback = new ExportReadback3d()

  constructor(scene: ExportScene) { this.scene = scene }

  /** Prend la scène et retient la vue d'écran jusqu'à la fin de l'export. */
  beginExport(setup: Export3dSetup): void {
    if (this.held) return
    const size = this.scene.renderer.getSize(new THREE.Vector2())
    this.held = {
      mode: this.scene.mode,
      modeBefore: this.scene.mode,
      view: this.scene.view,
      pov: this.scene.povXuid,
      width: size.x,
      height: size.y,
      pixelRatio: this.scene.renderer.getPixelRatio(),
      position: this.scene.camera.position.clone(),
      quaternion: this.scene.camera.quaternion.clone(),
      target: this.scene.orbit.target.clone(),
    }
    this.clock = { previous: setup.frame, frameMs: setup.frameMs }
    // Le fichier a sa propre taille : la densité de l'écran n'entre pas dans le rendu.
    this.scene.renderer.setPixelRatio(1)
    this.scene.post.composer.setPixelRatio(1)
    this.applySize(setup.width, setup.height, false)
    // A video is always the perspective view: exported from the 2D (top-down) view, the followed
    // player's own body and the top-down markers filled the first-person frame. `endExport`
    // gives the screen its view back.
    this.scene.view = '3d'
    this.scene.hideTopDown?.()
    this.scene.applyPov(setup.pov)
    // La caméra libre déjà choisie à l'écran garde son cadrage ; prise pour l'export, elle part
    // derrière le joueur suivi à la première image du clip et n'en bouge plus.
    this.scene.lastFrame = setup.frame
    if (setup.camera !== this.scene.mode) this.scene.applyMode(setup.camera)
    this.scene.orbit.enabled = false
  }

  /**
   * Dessine une image vidéo sans rendre les étiquettes HTML. Everything posed here is a function
   * of `frame` and of MATCH time: the export renders far slower or faster than real time, so a
   * wall-clock step would change the motion with the machine's load.
   */
  exportFrame(frame: number): HTMLCanvasElement {
    const dt = exportStepSeconds(this.clock.previous, frame, this.clock.frameMs)
    this.clock.previous = frame
    this.scene.lastFrame = frame
    this.scene.setSkyClock?.((frame * this.clock.frameMs) / 1000)
    if (this.scene.hasTracks) {
      // Bodies visible at this frame are baked to completion FIRST (the death camera reads them
      // too): on screen a body falls by the game's clips until its bake is ready; a video frame
      // does not encode that stopgap.
      this.scene.action?.settle(frame)
      this.scene.placeAvatars(frame)
      this.scene.placeCamera(frame, dt)
      this.scene.placeFirstPerson(frame)
      // The tags were posed against the PREVIOUS camera; recompute them now the camera sits where
      // this frame's image sees from (visibility AND opacity, the screen's own rule).
      this.scene.retagTags()
      this.scene.action?.update(frame)
    }
    this.scene.lighting.updateShadows(frame)
    this.scene.post.composer.render()
    // The frame is read out of the drawing buffer HERE, never through the WebGL canvas: a hidden
    // tab serves the canvas's last composited image (cf. `exportReadback3d`).
    this.scene.renderer.setRenderTarget(null)
    return this.readback.read(this.scene.renderer.getContext())
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
      if (a.tag.visible) push(a.tag.position, { name: a.name, color: a.color, opacity: a.tagOpacity })
    }
    for (const pool of this.scene.action?.labelPools() ?? []) {
      // Event labels have no distance fade: full opacity.
      for (const l of pool.shown()) push(l.position, { name: l.text, color: l.color, opacity: 1 })
    }
    return tags
  }

  /** Rend la scène à la vue d'écran et applique les changements retenus. */
  endExport(): void {
    const held = this.held
    if (!held) return
    this.held = null
    this.readback.dispose()
    this.scene.setSkyClock?.(null)
    this.scene.renderer.setPixelRatio(held.pixelRatio)
    this.scene.post.composer.setPixelRatio(held.pixelRatio)
    this.applySize(held.width, held.height, true)
    this.scene.applyPov(held.pov)
    this.scene.view = held.view
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
