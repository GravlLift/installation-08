// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * cameraScriptStore.ts — THE LOADED 3D SCENE'S CAMERA, lent to a camera script.
 *
 * The 3D view (`Replay3DView`, loaded on demand with three.js) registers itself here once its
 * map is ready; a camera script reads the camera's pose and the players' feet from it. Like the
 * video export's (`replay3dExportStore`), this module carries only types plus the host's shape:
 * the page's bundle does not pull in three.js just for this. One 3D view per page.
 */
import { useSyncExternalStore } from 'react'

import type { CameraScript, ScriptVec3 } from './cameraScript3d'

/** The camera's pose in GAME coordinates (z up) and its vertical field of view in degrees. */
export interface CameraScriptCapture {
  position: ScriptVec3
  target: ScriptVec3
  verticalFov: number
}

/** A player's feet in GAME coordinates (z up) and heading in game degrees at a frame. */
export interface CameraScriptSubject {
  x: number
  y: number
  z: number
  h: number
}

/** What the scene lends to a camera script. */
export interface CameraScriptHost {
  /** Sets the camera script driving the free camera, or null to stop it. */
  setScript(script: CameraScript | null): void
  /** Sets the script's current time (script ms). */
  setScriptTime(sMs: number): void
  /** The camera's pose in GAME coordinates and its vertical field of view. */
  capture(): CameraScriptCapture
  /** A player's feet in GAME coordinates and heading at a frame; null out of life. */
  subjectAt(xuid: string, frame: number): CameraScriptSubject | null
  /** The match duration of a document frame (ms). */
  frameMs: number
}

let entry: CameraScriptHost | null = null
const listeners = new Set<() => void>()

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function snapshot(): CameraScriptHost | null {
  return entry
}

/** Registers the 3D view; returns the unregister function (a no-op if another registration replaced it). */
export function registerCameraScriptHost(host: CameraScriptHost): () => void {
  entry = host
  for (const fn of listeners) fn()
  return () => {
    if (entry !== host) return
    entry = null
    for (const fn of listeners) fn()
  }
}

/** The registered 3D view's camera-script host, `null` with no 3D map loaded. */
export function cameraScriptHost(): CameraScriptHost | null {
  return entry
}

/** Same read, and a re-render on every registration change. */
export function useCameraScriptHost(): CameraScriptHost | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
