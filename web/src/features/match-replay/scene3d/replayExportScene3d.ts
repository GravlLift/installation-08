// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** replayExportScene3d.ts — holds and restores the view during video rendering. */
import * as THREE from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import type { Export3dSetup, ExportCamera3d, ExportSubframe3d, ExportTag3d } from '../export/replay3dExportStore'
import type { CameraMode3d } from './replayScene3d'
import type { SceneView3d } from './topDownLogic'
import type { Avatar } from './avatar3d'
import type { ActionScene3d } from './actionScene3d'
import type { PostFx3d } from './postFx3d'
import type { Lighting } from './lighting'
import { ExportReadback3d } from './exportReadback3d'
import { ExportAccumulator3d, type ExportAccumulator } from './exportAccumulator3d'

/** The scene elements used by the export and the operations that hold its state. */
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
  /** Poses the animated self-lit surfaces at match time (seconds), as the screen does (`glowAnimation3d`). */
  setGlowClock?(seconds: number): void
  /** Takes the top-down view's markers out of the scene (what the screen does when the 3D view draws). */
  hideTopDown?(): void
  /** Sets the compositor's look for the frame about to be drawn: a playing script's film look, else the default (`PostFx3d.setFilmLook`). */
  applyFilmLook?(): void
  /** The camera as posed now, in world coordinates (the export's camera track). */
  readCamera?(): ExportCamera3d
}

/** What the center subframe of a blurred frame saw from: the file frame's tags and camera. */
interface CenterPose {
  frame: number
  tags: ExportTag3d[]
  camera: ExportCamera3d | null
  position: THREE.Vector3
  quaternion: THREE.Quaternion
}

/** The on-screen view during an export: what it had, and what it has requested since. */
interface HeldView {
  mode: CameraMode3d
  /** The camera before the export: a change requested during the export replays on return. */
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

/**
 * Manages taking over the scene and restoring the on-screen view.
 *
 * # MOTION BLUR AND SUPERSAMPLING (film-quality export)
 *
 * A blurred file frame is several poses of the scene averaged (`exportFrame` with subframes,
 * `exportShutter.ts` says when they are). What a pose ADVANCES had to be audited, since a
 * subframe must neither advance a simulation twice nor run it backward. Per `pose` call:
 *
 * - `clock.previous` and the `dt` it gives: the ONLY true simulation step. It feeds the
 *   third-person spring arm's eased release (`replayCamera3d.springArm`, its arm length carried
 *   from the previous placement). Subframes arrive in time order and each one steps `dt` by the
 *   time since the previous subframe, so the arm sees the same match time pass as without blur,
 *   in smaller steps; nothing is stepped twice, and the next frame continues from the last
 *   subframe (later than this frame's center, earlier than the next frame's first subframe).
 * - `lastFrame`, the sky and glow clocks: set from the pose's frame, pure.
 * - `action.settle`: bakes the ragdolls visible at the frame to completion; a bake is cached, so
 *   a later subframe finds it done (no double work, no state change).
 * - `placeAvatars`, `placeFirstPerson` (the scope's field, the arms' clips posed with
 *   `mixer.update(0)` at the frame's clip time), `retagTags`, `action.update` (shots, idle
 *   effects, flights, deaths, vehicles: pools refilled from the frame each call, effect ages
 *   `frame - event`), `lighting.updateShadows` (refreshed when the frame changes): all functions
 *   of the frame and script time; the scope keeps only a cache of the last field it set.
 *   Deaths' bakery also pumps background bakes on a wall-clock budget, which is a cache filling.
 * - The free camera without a script does not move during an export; a script poses it from
 *   the script time each subframe sets (`ExportSubframe3d.before`).
 *
 * The one place time can step back is a frame rendered AGAIN after a load wait
 * (`renderComplete`): its first subframe is earlier than the last one just drawn. `dt` is clamped
 * to 0 there (`exportStepSeconds`), so the spring arm holds rather than rewinds; the arm then
 * eases on through the subframes again, an extra fraction of a frame of ease on that one frame.
 *
 * The tags, the camera track and the HUD's camera are the CENTER subframe's: captured when it is
 * posed (`CenterPose`), and the camera is put back there after the last subframe.
 *
 * Supersampling renders at `scale` times the file's size on each side (the renderer's pixel
 * ratio, so the outline keeps its share of the frame) and `exportAccumulator3d` filters it down.
 * Without subframes and at scale 1 the frame is the single pose read straight out of the drawing
 * buffer, exactly as before either existed.
 */
export class ReplayExportScene3d {
  /** The on-screen view held during the export, or null outside an export. */
  held: HeldView | null = null

  private readonly scene: ExportScene
  /** The previous exported pose's frame, and the match duration of a document frame (ms). */
  private clock = { previous: 0, frameMs: 0 }
  /** Copies each rendered frame out of WebGL (`exportFrame`). */
  private readonly readback = new ExportReadback3d()
  /** The render's size over the file's, on each side (`Export3dSetup.supersample`). */
  private scale = 1
  /** Averages subframes and filters a supersampled render down; made on first need. */
  private accumulator: ExportAccumulator | null = null
  private readonly makeAccumulator: (renderer: THREE.WebGLRenderer) => ExportAccumulator
  /** The last blurred or supersampled frame's center pose, null after a plain frame. */
  private center: CenterPose | null = null

  constructor(scene: ExportScene, makeAccumulator?: (renderer: THREE.WebGLRenderer) => ExportAccumulator) {
    this.scene = scene
    this.makeAccumulator = makeAccumulator ?? ((renderer) => new ExportAccumulator3d(renderer))
  }

  /** Takes over the scene and holds the on-screen view until the export ends. */
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
    this.center = null
    // The file has its own size: the screen's pixel density does not enter the render. A
    // supersampled export renders at `scale` x the file's size through the pixel ratio.
    this.scale = setup.supersample === 2 ? 2 : 1
    this.scene.renderer.setPixelRatio(this.scale)
    this.scene.post.composer.setPixelRatio(this.scale)
    this.applySize(setup.width, setup.height, false)
    // A video is always the perspective view: exported from the 2D (top-down) view, the followed
    // player's own body and the top-down markers filled the first-person frame. `endExport`
    // gives the screen its view back.
    this.scene.view = '3d'
    this.scene.hideTopDown?.()
    this.scene.applyPov(setup.pov)
    // A free camera already chosen on screen keeps its framing; taken over for the export, it
    // starts behind the tracked player at the clip's first frame and does not move from there.
    this.scene.lastFrame = setup.frame
    if (setup.camera !== this.scene.mode) this.scene.applyMode(setup.camera)
    this.scene.orbit.enabled = false
  }

  /**
   * Draws a video frame without rendering the HTML labels. Everything posed here is a function
   * of `frame` and of MATCH time: the export renders far slower or faster than real time, so a
   * wall-clock step would change the motion with the machine's load.
   */
  exportFrame(frame: number, subframes?: readonly ExportSubframe3d[]): HTMLCanvasElement {
    this.center = null
    if (!subframes && this.scale === 1) {
      this.pose(frame)
      this.draw(frame)
      return this.readback.read(this.scene.renderer.getContext())
    }
    return this.accumulate(subframes ?? [{ frame, render: true, center: true }])
  }

  /**
   * accumulate draws the subframes in order and averages them on the GPU (see the class
   * header), the center subframe's tags and camera kept as the frame's, then reads the average
   * back at the file's size.
   */
  private accumulate(subframes: readonly ExportSubframe3d[]): HTMLCanvasElement {
    const renderer = this.scene.renderer
    const size = renderer.getSize(new THREE.Vector2())
    const acc = (this.accumulator ??= this.makeAccumulator(renderer))
    acc.begin(size.x, size.y, this.scale)
    for (const sub of subframes) {
      sub.before?.()
      this.pose(sub.frame)
      if (sub.center) this.center = this.capture(sub.frame)
      if (!sub.render) continue
      this.draw(sub.frame)
      acc.add()
    }
    // The camera goes back to the center pose: what reads it after the frame (the HUD's
    // red-reticle test) sees from where the frame's tags and track were taken. Only position and
    // orientation: the field of view is the scope's to set (`scopeView3d` caches the last one).
    const center = this.center
    if (center) {
      this.scene.camera.position.copy(center.position)
      this.scene.camera.quaternion.copy(center.quaternion)
      this.scene.camera.updateMatrixWorld()
      this.scene.lastFrame = center.frame
    }
    const out = acc.resolve()
    const image = this.readback.read(renderer.getContext(), out)
    renderer.setRenderTarget(null)
    return image
  }

  /** capture keeps what the center subframe sees: the file frame's tags and camera. */
  private capture(frame: number): CenterPose {
    return {
      frame,
      tags: this.projectTags(),
      camera: this.scene.readCamera?.() ?? null,
      position: this.scene.camera.position.clone(),
      quaternion: this.scene.camera.quaternion.clone(),
    }
  }

  /**
   * draw renders the posed scene through the viewer's composer into the default framebuffer
   * (`frame`: the shadow map refreshes when it changes).
   */
  private draw(frame: number): void {
    this.scene.lighting.updateShadows(frame)
    // After the camera: the script time this frame is drawn at seeds the film look's grain.
    this.scene.applyFilmLook?.()
    this.scene.post.composer.render()
    // The frame is read out of the drawing buffer, never through the WebGL canvas: a hidden tab
    // serves the canvas's last composited image (cf. `exportReadback3d`).
    this.scene.renderer.setRenderTarget(null)
  }

  /** pose poses the scene at `frame` and steps the match clock to it (see the class header). */
  private pose(frame: number): void {
    const dt = exportStepSeconds(this.clock.previous, frame, this.clock.frameMs)
    this.clock.previous = frame
    this.scene.lastFrame = frame
    this.scene.setSkyClock?.((frame * this.clock.frameMs) / 1000)
    this.scene.setGlowClock?.((frame * this.clock.frameMs) / 1000)
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
  }

  /** Projects the visible labels into the video format (a blurred frame's: its center's). */
  exportTags(): readonly ExportTag3d[] {
    return this.center ? this.center.tags : this.projectTags()
  }

  /** The camera the last frame was taken from (a blurred frame's: its center's), null without a reader. */
  exportCamera(): ExportCamera3d | null {
    return this.center ? this.center.camera : this.scene.readCamera?.() ?? null
  }

  private projectTags(): ExportTag3d[] {
    const size = this.scene.renderer.getSize(new THREE.Vector2())
    const tags: ExportTag3d[] = []
    const p = new THREE.Vector3()
    const push = (at: THREE.Vector3, tag: Omit<ExportTag3d, 'x' | 'y'>) => {
      p.copy(at).project(this.scene.camera)
      // Behind the camera or out of frame: no label (like `CSS2DRenderer`).
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

  /** Returns the scene to the on-screen view and applies the held changes. */
  endExport(): void {
    const held = this.held
    if (!held) return
    this.held = null
    this.readback.dispose()
    // The subframe sum and the supersampled targets are the export's alone (hundreds of MB at 4K).
    this.accumulator?.dispose()
    this.accumulator = null
    this.center = null
    this.scale = 1
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

  /** applySize: `onScreen` false for the export, which renders without touching the canvas's box. */
  applySize(width: number, height: number, onScreen: boolean): void {
    this.scene.camera.aspect = width / height
    this.scene.camera.updateProjectionMatrix()
    this.scene.renderer.setSize(width, height, onScreen)
    this.scene.post.composer.setSize(width, height)
    if (onScreen) this.scene.labels.setSize(width, height)
  }
}
