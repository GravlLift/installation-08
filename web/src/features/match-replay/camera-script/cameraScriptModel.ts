// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * cameraScriptModel.ts — THE PURE MODEL of the camera panel (docs/design/camera-scripts.md,
 * unit 4a). Pure functions over immutable camera scripts: new-script construction, the script
 * time the panel acts at, the field-of-view conversion, turning a captured camera pose into a
 * key anchored to the world or to a player, the key-list operations (all revalidated through
 * `parseCameraScript`), the dirty state, and a short English label for a key. No scene, no
 * React; the panel and its tests are built on this.
 */
import {
  parseCameraScript,
  type CameraKey,
  type CameraScript,
  type ParseResult,
  type ScriptPoint,
} from '../scene3d/cameraScript3d'
import { frameToMs } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import type { CameraScriptCapture, CameraScriptSubject } from '../scene3d/cameraScriptStore'

/** A fresh, empty script: version 1, no keys, no clock (script time is document time). */
export function newCameraScript(matchId: string, name: string): CameraScript {
  return { version: 1, matchId, name, keys: [] }
}

/** The inputs to `scriptTimeNow`: the script, the film frame being drawn, the document, and the
 * panel's own cursor in script ms. */
export interface ScriptTimeNowArgs {
  script: CameraScript
  frame: number
  doc: ReplayDocumentReady
  cursorMs: number
}

/**
 * The script time the panel acts at (when it adds a key, seeks one, and so on). Without a
 * clock, script time IS document time, so the film frame being drawn is the script time: the
 * panel follows the film's own clock (`frameToMs`). With a clock, script time is decoupled from
 * the film (the world may be slow, frozen, or fast under the camera), so the film frame no
 * longer is the script time; the panel's own cursor is, set by Go to, a script-time slider, or
 * the end of a playback.
 */
export function scriptTimeNow({ script, frame, doc, cursorMs }: ScriptTimeNowArgs): number {
  if (script.clock === undefined) return frameToMs(frame, doc)
  return cursorMs
}

/**
 * gameFovOfVertical is the inverse of `verticalFovOf` (`model/fovLogic.ts`): it gives the
 * horizontal field in degrees at 16:9 of a VERTICAL field `verticalDeg`. The half-fields compare
 * by tangent, with the half-field ratio 9:16, so the inverse multiplies by 16/9. Rounded to the
 * nearest 0.1 degree, a script `fov` (the game's own convention) round-trips from the camera's
 * vertical field.
 */
export function gameFovOfVertical(verticalDeg: number): number {
  const demi = (verticalDeg * Math.PI) / 360
  const gameDeg = (2 * Math.atan(Math.tan(demi) * (16 / 9)) * 180) / Math.PI
  return Math.round(gameDeg * 10) / 10
}

/** The position anchor of a captured key: a world point, or a player (world-aligned or turning
 * with the player's heading). */
export type PosAnchor = { kind: 'world' } | { kind: 'player'; xuid: string; relative: 'world' | 'heading' }
/** The look anchor of a captured key: the orbit point, or a player. */
export type LookAnchor = { kind: 'orbit' } | { kind: 'player'; xuid: string }

/** The inputs to `captureKey`: the script time, the camera pose, the anchors, the subject
 * lookup, and whether the key carries the captured field of view. */
export interface CaptureKeyArgs {
  t: number
  capture: CameraScriptCapture
  pos: PosAnchor
  look: LookAnchor
  /** A player's `CameraScriptSubject` at the drawn time, or null (out of life). */
  subject: (xuid: string) => CameraScriptSubject | null
  /** 'capture' carries the camera's field of view on the key; 'base' omits it (the key uses the
   * viewer's FOV setting). */
  fov: 'capture' | 'base'
}

/** The answer of `captureKey`: the key, and whether a player anchor fell back to a world point
 * because its subject was not in the film. */
export interface CaptureKeyResult {
  key: CameraKey
  fellBack: boolean
}

/**
 * captureKey turns the captured camera pose into a key at script time `t`. A world anchor takes
 * the captured point directly. A player anchor is the captured point expressed relative to that
 * player's feet: world-aligned keeps the offset in game axes (position minus feet, all three),
 * while heading-relative puts it in the player's frame (x forward along the heading, y to the
 * player's left, z up). A player anchor whose subject is null falls back to the captured world
 * point, so a capture never fails, and `fellBack` says so.
 */
export function captureKey({ t, capture, pos, look, subject, fov }: CaptureKeyArgs): CaptureKeyResult {
  let posPoint: ScriptPoint
  let fellBack = false
  if (pos.kind === 'world') {
    posPoint = { at: 'world', point: capture.position }
  } else {
    const s = subject(pos.xuid)
    if (s === null) {
      posPoint = { at: 'world', point: capture.position }
      fellBack = true
    } else {
      const dx = capture.position[0] - s.x
      const dy = capture.position[1] - s.y
      const dz = capture.position[2] - s.z
      if (pos.relative === 'heading') {
        const rad = (s.h * Math.PI) / 180
        const cos = Math.cos(rad)
        const sin = Math.sin(rad)
        // Forward along the heading is (cos h, sin h); to the player's left is (-sin h, cos h).
        posPoint = {
          at: 'player',
          xuid: pos.xuid,
          offset: [dx * cos + dy * sin, -dx * sin + dy * cos, dz],
          relative: 'heading',
        }
      } else {
        posPoint = { at: 'player', xuid: pos.xuid, offset: [dx, dy, dz], relative: 'world' }
      }
    }
  }

  let lookPoint: ScriptPoint
  if (look.kind === 'orbit') {
    lookPoint = { at: 'world', point: capture.target }
  } else {
    const s = subject(look.xuid)
    if (s === null) {
      lookPoint = { at: 'world', point: capture.target }
      fellBack = true
    } else {
      // A look at a player is world-aligned: the captured target relative to that player's feet.
      lookPoint = {
        at: 'player',
        xuid: look.xuid,
        offset: [capture.target[0] - s.x, capture.target[1] - s.y, capture.target[2] - s.z],
      }
    }
  }

  const key: CameraKey = { t, pos: posPoint, look: lookPoint, ease: 'smooth' }
  if (fov === 'capture') key.fov = gameFovOfVertical(capture.verticalFov)
  return { key, fellBack }
}

/** The result of a key-list operation: the new script (and the key's index, where it moves),
 * or a validation error that leaves the input untouched. */
export type KeyOpResult = { ok: true; script: CameraScript; index?: number } | { ok: false; error: string }

/**
 * Builds a candidate script around the new keys and runs it through `parseCameraScript`. Every
 * other field of the script (its clock, and any later addition such as holds) is carried over.
 */
function validateKeys(script: CameraScript, keys: CameraKey[]): ParseResult {
  return parseCameraScript({ ...script, keys }, script.matchId)
}

/**
 * insertKey inserts `key` keeping the keys sorted by `t` (stable for equal `t`: the new key goes
 * after any key that shares its time). A key at the same `t` as an existing non-cut key REPLACES
 * it. The result is revalidated; an invalid result is returned as an error and the input is left
 * unchanged.
 */
export function insertKey(script: CameraScript, key: CameraKey): KeyOpResult {
  const keys = script.keys
  let newKeys: CameraKey[]
  const sameT = keys.findIndex((k) => k.t === key.t && k.ease !== 'cut')
  if (sameT !== -1) {
    newKeys = keys.map((k, i) => (i === sameT ? key : k))
  } else {
    // After every key with t <= key.t: stable for equal t.
    let idx = keys.findIndex((k) => k.t > key.t)
    if (idx === -1) idx = keys.length
    newKeys = [...keys.slice(0, idx), key, ...keys.slice(idx)]
  }
  const result = validateKeys(script, newKeys)
  if (!result.ok) return result
  return { ok: true, script: result.script }
}

/** replaceKey replaces the key at `index` (in place, no re-sort) and revalidates. */
export function replaceKey(script: CameraScript, index: number, key: CameraKey): KeyOpResult {
  if (index < 0 || index >= script.keys.length) return { ok: false, error: `index ${index} out of range` }
  const newKeys = script.keys.map((k, i) => (i === index ? key : k))
  const result = validateKeys(script, newKeys)
  if (!result.ok) return result
  return { ok: true, script: result.script }
}

/** removeKey removes the key at `index` and revalidates. */
export function removeKey(script: CameraScript, index: number): KeyOpResult {
  if (index < 0 || index >= script.keys.length) return { ok: false, error: `index ${index} out of range` }
  const newKeys = script.keys.filter((_, i) => i !== index)
  const result = validateKeys(script, newKeys)
  if (!result.ok) return result
  return { ok: true, script: result.script }
}

/**
 * updateKey applies `patch` to the key at `index` and, after a `t` change, re-sorts the keys
 * (stable for equal `t`), returning the key's new `index` too. The result is revalidated; an
 * invalid result is returned as an error and the input is left unchanged.
 */
export function updateKey(
  script: CameraScript,
  index: number,
  patch: Partial<Pick<CameraKey, 'ease' | 'fov' | 'roll' | 't'>>,
): KeyOpResult {
  if (index < 0 || index >= script.keys.length) return { ok: false, error: `index ${index} out of range` }
  const updated: CameraKey = { ...script.keys[index], ...patch }
  // Stable sort by the (possibly new) t, then by original order for equal t.
  const order = script.keys.map((_, i) => i)
  order.sort((a, b) => {
    const ka = a === index ? updated : script.keys[a]
    const kb = b === index ? updated : script.keys[b]
    return ka.t !== kb.t ? ka.t - kb.t : a - b
  })
  const newIdx = order.indexOf(index)
  const newKeys = order.map((i) => (i === index ? updated : script.keys[i]))
  const result = validateKeys(script, newKeys)
  if (!result.ok) return result
  return { ok: true, script: result.script, index: newIdx }
}

/** A JSON form of `value` whose object keys are sorted, for a stable deep comparison. */
function canonicalJSON(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(src).sort()) out[k] = sortKeys(src[k])
    return out
  }
  return value
}

/** isDirty compares a saved script (null for one that has not been saved) to the current one by
 * their canonical JSON, so key order within a key and object field order do not matter. */
export function isDirty(saved: CameraScript | null, current: CameraScript): boolean {
  if (saved === null) return true
  return canonicalJSON(saved) !== canonicalJSON(current)
}

/**
 * keySummary is a short English label for a key, in the form `<position> → <look>`: the position
 * says where the camera sits (a world point, or following a player, turning with their heading)
 * and the look says what it aims at (the orbit point, or a player).
 */
export function keySummary(key: CameraKey, nameOfXuid: (xuid: string) => string): string {
  const pos =
    key.pos.at === 'world'
      ? 'World'
      : `Follow ${nameOfXuid(key.pos.xuid)}${key.pos.relative === 'heading' ? ' (heading)' : ''}`
  const look = key.look.at === 'world' ? 'orbit point' : `look at ${nameOfXuid(key.look.xuid)}`
  return `${pos} → ${look}`
}
