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

import { msToFrames } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { scriptClockOf, type CameraScript, type ScriptClockView, type ScriptVec3 } from './cameraScript3d'

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

function notify(): void {
  for (const fn of listeners) fn()
}

/** The PLAYBACK state of a camera script: the script, its clock view, and the current script time (ms). */
export interface ScriptPlayback {
  script: CameraScript
  clock: ScriptClockView
  sMs: number
}

let playback: ScriptPlayback | null = null

/** Starts playback of a camera script from `fromSMs` and hands it to the registered 3D view. */
export function startScript(script: CameraScript, fromSMs = 0): void {
  playback = { script, clock: scriptClockOf(script), sMs: fromSMs }
  entry?.setScript(script)
  entry?.setScriptTime(fromSMs)
  notify()
}

/** Stops playback; the 3D view's free camera goes back to being unscripted. */
export function stopScript(): void {
  if (playback === null) return
  playback = null
  entry?.setScript(null)
  notify()
}

/**
 * Advances the script's current time (it runs every animation frame). It does NOT notify
 * subscribers: React must not re-render per frame, so it mutates `playback.sMs` in place.
 */
export function setScriptPlaybackTime(sMs: number): void {
  if (playback === null) return
  playback.sMs = sMs
  entry?.setScriptTime(sMs)
}

/** The playback state, null when no script is playing. */
export function scriptPlayback(): ScriptPlayback | null {
  return playback
}

function snapshotPlayback(): ScriptPlayback | null {
  return playback
}

/** Same read, and a re-render on start/stop only (the per-frame time advance is silent). */
export function useScriptPlayback(): ScriptPlayback | null {
  return useSyncExternalStore(subscribe, snapshotPlayback, snapshotPlayback)
}

/** The document frame a playback is showing: the film time the script's clock maps to, in frames. */
export function scriptDocFrame(p: ScriptPlayback, doc: Pick<ReplayDocumentReady, 'frameIntervalMs'>): number {
  return msToFrames(p.clock.docMsAt(p.sMs), doc)
}

/** Registers the 3D view; returns the unregister function (a no-op if another registration replaced it).
 * A script already playing is applied to the newly registered host, so it takes effect on load. */
export function registerCameraScriptHost(host: CameraScriptHost): () => void {
  entry = host
  if (playback !== null) {
    host.setScript(playback.script)
    host.setScriptTime(playback.sMs)
  }
  notify()
  return () => {
    if (entry !== host) return
    entry = null
    notify()
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
