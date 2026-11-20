// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * replay3dExportStore.ts — THE LOADED 3D SCENE, lent to the video export.
 *
 * The 3D view (`Replay3DView`, loaded on demand with three.js) registers itself here once its
 * map is ready; the export and its dialog read it. This module carries only types: the page's
 * bundle does not pull in three.js just for this.
 *
 * The export TAKES the displayed scene rather than building a second one: the map weighs
 * hundreds of MiB in graphics memory, and its render textures (shadows, environment) belong to
 * the WebGL context that created them. During the export, the scene renders at the file's size
 * with the chosen camera and followed player, and the on-screen view goes silent; at the end,
 * everything comes back (`endExport`). One 3D view per page.
 */
import { useSyncExternalStore } from 'react'

import type { FilmAllegiance } from '@/lib/replay/filmAllegiance'

import type { PreparedCallouts } from '../model/mapCallouts'
import type { HeldWeapon } from '../scene3d/redReticle3d'
import type { CameraMode3d } from '../scene3d/replayScene3d'

/** A 3D export's setup: the file's size, the camera and the followed player. */
export interface Export3dSetup {
  width: number
  height: number
  camera: CameraMode3d
  pov: string | null
  /** The clip's first frame: the free camera taken for the export is placed there. */
  frame: number
  /**
   * Milliseconds of match per document frame (`doc.frameIntervalMs`). During the export the
   * scene's time-based motion (third-person spring arm, clouds) runs on MATCH time derived from
   * the posed frames, never on the wall clock, which in an offline export measures render cost.
   */
  frameMs: number
  /**
   * Supersampling: the 3D frame renders at this many times the file's size on each side and is
   * filtered down to it (2x2 box in linear light). Absent or 1: the file's size, as before.
   */
  supersample?: 1 | 2
}

/**
 * One subframe of a motion-blurred export frame (`exportFrame`), in time order. The scene poses
 * each, draws the `render` ones and averages them; the `center` one's camera and tags are the
 * file frame's (camera track, name tags, HUD).
 */
export interface ExportSubframe3d {
  /** The film frame posed (fractional). */
  frame: number
  /** Drawn and added to the average; false: posed only (an even count's exact center). */
  render: boolean
  /** The file frame's exact time. */
  center: boolean
  /** Called right before the subframe is posed: a camera-script export sets its time here. */
  before?: () => void
}

/** A player tag projected into the exported image, in file pixels. */
export interface ExportTag3d {
  x: number
  y: number
  name: string
  /** The player's color, resolved to a CSS string (a canvas does not read theme variables). */
  color: string
  /** Opacity the screen's distance rule gave it (1 full, a fade between, 0 never painted). */
  opacity: number
}

/** What the scene lends to the export. */
export interface Replay3DExportSource {
  readonly players: readonly { xuid: string; name: string }[]
  /** Takes the scene: renders at the file's size, camera and followed player set, on-screen view silent. */
  beginExport(setup: Export3dSetup): void
  /**
   * Poses frame `frame`, renders it and returns a 2D canvas read out of the drawing buffer right
   * after the render (`exportReadback3d`), valid until the next call. Never the WebGL canvas: in a
   * hidden tab that one kept serving the first exported image.
   *
   * `subframes` (motion blur): the frame is the GPU average of those poses instead of the single
   * pose at `frame`; the tags and camera read afterwards are the `center` subframe's. Absent:
   * the single pose, exactly as without motion blur.
   */
  exportFrame(frame: number, subframes?: readonly ExportSubframe3d[]): HTMLCanvasElement
  /** The visible tags of the last rendered frame. */
  exportTags(): readonly ExportTag3d[]
  /**
   * Null when nothing the scene draws is still loading; otherwise a promise that resolves once
   * the pending loads (weapon models, armor, first-person rigs a frame just asked for) settled,
   * with `true` if it gave up waiting. The export then renders the frame AGAIN, so that no frame
   * is encoded with a model missing because it was still in flight.
   */
  exportPendingLoads(): Promise<boolean> | null
  /** Returns the scene to the on-screen view (size, camera, followed player). */
  endExport(): void
  /**
   * The red-reticle test (an enemy under the first-person aim) at the frame just rendered, the
   * same one the live HUD runs: the export HUD paints the reticle hostile red with it.
   */
  redReticle?(frame: number, allegiance: Pick<FilmAllegiance, 'ofXuid'>, held: HeldWeapon | null): boolean
  /** The camera as it drew the frame just rendered (the export's camera track). */
  exportCamera?(): ExportCamera3d
}

/**
 * The camera of one rendered frame, in WORLD coordinates (the film's and the camera script's:
 * world units, z up), so a track compares directly with a script's points.
 */
export interface ExportCamera3d {
  pos: [number, number, number]
  /** Unit view direction. */
  dir: [number, number, number]
  /** Vertical field of view, degrees. */
  fov: number
  /** The script's look point at this frame, when a camera script posed it; null otherwise. */
  target: [number, number, number] | null
}

/** The view's registration: the scene, and the screen's state used as the dialog's default. */
export interface Replay3DExportEntry {
  source: Replay3DExportSource
  /** The 3D view is on screen: the export offers 3D by default. */
  live: boolean
  camera: CameraMode3d
  pov: string | null
  /** The map's named areas the view loaded (`useMapCallouts`): the export HUD's place label. */
  callouts?: PreparedCallouts | null
}

let entry: Replay3DExportEntry | null = null
const listeners = new Set<() => void>()

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function snapshot(): Replay3DExportEntry | null {
  return entry
}

/** Registers the 3D view; returns the unregister function (a no-op if another registration replaced it). */
export function registerReplay3DExport(next: Replay3DExportEntry): () => void {
  entry = next
  for (const fn of listeners) fn()
  return () => {
    if (entry !== next) return
    entry = null
    for (const fn of listeners) fn()
  }
}

/** The registered 3D view, `null` with no 3D map loaded. */
export function replay3DExportEntry(): Replay3DExportEntry | null {
  return entry
}

/** Same read, and a re-render on every registration change. */
export function useReplay3DExport(): Replay3DExportEntry | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
