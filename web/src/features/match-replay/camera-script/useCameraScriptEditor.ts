// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useCameraScriptEditor.ts — THE STATE AND ACTIONS of the camera panel (docs/design/camera-scripts.md,
 * unit 4b-1). One hook that owns the script list, the script being edited, its saved copy, the
 * capture anchors, the panel's script-time cursor, and every panel action: open/create/save/delete,
 * capture a key from the free camera, seek a key as a preview, play and stop, and the key-list
 * edits (all through the pure model in `cameraScriptModel.ts`). It lives in the page, not the
 * panel, so closing the panel keeps the edits. A script set on the camera (previewed while the
 * page is paused, or playing with it) is `previewing`/`scriptPlaying`; edits to the script while
 * one is set are re-started on the camera at the same script time so the preview shows them.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  addHold as addHoldModel,
  captureKey,
  faceCameraHeading,
  insertKey,
  isDirty,
  isFrozenAt,
  newCameraScript,
  newHold,
  removeKey,
  removeHold as removeHoldModel,
  replaceKey,
  scriptTimeNow,
  setFreezeAt as setFreezeAtModel,
  updateKey,
  updateHold as updateHoldModel,
  type KeyOpResult,
  type LookAnchor,
  type PosAnchor,
} from './cameraScriptModel'
import {
  deleteCameraScript,
  fetchCameraScript,
  listCameraScripts,
  listPoses,
  saveCameraScript,
  type CameraScriptSummary,
  type PoseSummary,
} from './cameraScriptApi'
import {
  scriptDocFrame,
  scriptPlayback,
  startScript,
  stopScript,
  useCameraScriptHost,
  useScriptPlayback,
} from '../scene3d/cameraScriptStore'
import { scriptClockOf, type CameraKey, type CameraScript } from '../scene3d/cameraScript3d'
import type { Hold } from '../scene3d/hold3d'
import type { CameraMode3d } from '../scene3d/replayScene3d'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'

const NAME_RE = /^[a-z0-9_-]{1,64}$/

/** The inputs to `useCameraScriptEditor`; all of them come from the page that hosts the panel. */
export interface UseCameraScriptEditorArgs {
  matchId: string
  doc: ReplayDocumentReady
  /** The film frame the page is drawing. */
  frameRef: { current: number }
  playing: boolean
  setPlaying: (playing: boolean) => void
  cameraMode: CameraMode3d
  setCameraMode: (mode: CameraMode3d) => void
  /** Moves the film to a frame WITHOUT stopping a script that is set on the camera. */
  showFrame: (frame: number) => void
}

/** The panel's state and actions, as one bundle. */
export interface CameraScriptEditor {
  scripts: CameraScriptSummary[]
  loading: boolean
  error: string | null
  /** A short line for the panel (e.g. "Saved", "Player not in the film here: key pinned to the world"). */
  notice: string | null
  script: CameraScript | null
  /** Dirty against the last saved or loaded copy; a new unsaved script is dirty once it has a key. */
  dirty: boolean
  posAnchor: PosAnchor
  setPosAnchor: (anchor: PosAnchor) => void
  lookAnchor: LookAnchor
  setLookAnchor: (anchor: LookAnchor) => void
  fovMode: 'base' | 'capture'
  setFovMode: (mode: 'base' | 'capture') => void
  /** The panel's own cursor in script ms (see `scriptTimeNow`). */
  cursorMs: number
  /** A script is set on the camera while the page is paused. */
  previewing: boolean
  /** A script is set on the camera and the page is playing. */
  scriptPlaying: boolean
  /** There is a script, a host is registered, and the camera mode is free. */
  canCapture: boolean
  confirmingDelete: boolean
  refresh: () => void
  open: (name: string) => Promise<void>
  create: (name: string) => void
  save: () => Promise<void>
  /** Two-step: the first call arms the confirm, the second deletes on the server. */
  remove: () => Promise<void>
  cancelDelete: () => void
  play: () => void
  /** Stops a script set on the camera, taking its script time into the cursor. */
  stop: () => void
  addKey: () => void
  goToKey: (i: number) => void
  setKeyFromCamera: (i: number) => void
  updateKey: (i: number, patch: Partial<Pick<CameraKey, 'ease' | 'fov' | 'roll' | 't'>>) => void
  deleteKey: (i: number) => void
  /** The pose catalog (idle, emote, stance clips); empty when the game is not installed. */
  poses: PoseSummary[]
  /** Adds a hold for `xuid` at the current script time with the documented defaults; the
   * default clip is the first emote of the pose catalog, else 'combat:rifle:idle'. */
  addHold: (xuid: string) => void
  /** Applies `patch` to the hold at `index`; a re-sort of the holds is kept. */
  updateHold: (i: number, patch: Partial<Omit<Hold, 'xuid'>> & { xuid?: string }) => void
  /** Removes the hold at `index`. */
  removeHold: (i: number) => void
  /** Sets the hold's `at` to the current script time (Hold here). */
  holdHere: (i: number) => void
  /** Sets the hold's `heading` so the player faces the free camera's current position. */
  faceCamera: (i: number) => void
  /** Freezes (or unfreezes) the world at the hold's `at`: a rate-0 entry in the script clock. */
  setFreeze: (i: number, frozen: boolean) => void
  /** The script's clock has a rate-0 entry at the hold's `at`. */
  frozen: (i: number) => boolean
}

export function useCameraScriptEditor({
  matchId,
  doc,
  frameRef,
  playing,
  setPlaying,
  cameraMode,
  setCameraMode,
  showFrame,
}: UseCameraScriptEditorArgs): CameraScriptEditor {
  const [scripts, setScripts] = useState<CameraScriptSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [script, setScript] = useState<CameraScript | null>(null)
  const [savedCopy, setSavedCopy] = useState<CameraScript | null>(null)
  const [posAnchor, setPosAnchor] = useState<PosAnchor>({ kind: 'world' })
  const [lookAnchor, setLookAnchor] = useState<LookAnchor>({ kind: 'orbit' })
  const [fovMode, setFovMode] = useState<'base' | 'capture'>('base')
  const [cursorMs, setCursorMs] = useState(0)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [poses, setPoses] = useState<PoseSummary[]>([])

  const host = useCameraScriptHost()
  const playback = useScriptPlayback()

  const previewing = playback !== null && !playing
  const scriptPlaying = playback !== null && playing
  const canCapture = script !== null && host !== null && cameraMode === 'free'
  const dirty =
    script === null ? false : savedCopy === null ? script.keys.length > 0 : isDirty(savedCopy, script)

  const refresh = useCallback((): void => {
    setLoading(true)
    listCameraScripts(matchId)
      .then(setScripts)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [matchId])

  useEffect(() => {
    refresh()
  }, [refresh])

  // The pose catalog is loaded once on mount; a 503 (game not installed) already resolves to
  // [], so a rejection here is a real failure and goes to `error`.
  useEffect(() => {
    listPoses()
      .then(setPoses)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  // `scriptPlayback` is read at the moment each action is called (not from the render): actions
  // act on the store as it is, and a re-render follows (start/stop notify the subscribers).
  /** Stops a script set on the camera: its script time becomes the cursor, the page stops if it
   * was playing. A no-op with none set. */
  const stop = useCallback((): void => {
    const pb = scriptPlayback()
    if (pb === null) return
    setCursorMs(pb.sMs)
    stopScript()
    if (playing) setPlaying(false)
  }, [playing, setPlaying])

  const open = useCallback(
    async (name: string): Promise<void> => {
      try {
        const s = await fetchCameraScript(matchId, name)
        stopScript()
        setScript(s)
        setSavedCopy(s)
        setCursorMs(0)
        setError(null)
        setNotice(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [matchId],
  )

  const create = useCallback(
    (name: string): void => {
      if (!NAME_RE.test(name)) {
        setError('Name must be 1 to 64 characters of [a-z0-9_-]')
        return
      }
      if (scripts.some((s) => s.name === name)) {
        setError(`A script named '${name}' already exists`)
        return
      }
      setScript(newCameraScript(matchId, name))
      setSavedCopy(null)
      setCursorMs(0)
      setConfirmingDelete(false)
      setError(null)
      setNotice(null)
    },
    [matchId, scripts],
  )

  const save = useCallback(async (): Promise<void> => {
    if (script === null) return
    try {
      await saveCameraScript(script)
      setSavedCopy(script)
      setNotice('Saved')
      setError(null)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [script, refresh])

  const remove = useCallback(async (): Promise<void> => {
    if (script === null) return
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    try {
      await deleteCameraScript(matchId, script.name)
      setConfirmingDelete(false)
      setScript(null)
      setSavedCopy(null)
      setCursorMs(0)
      setNotice(null)
      setError(null)
      refresh()
    } catch (e) {
      setConfirmingDelete(false)
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [script, confirmingDelete, matchId, refresh])

  const cancelDelete = useCallback((): void => setConfirmingDelete(false), [])

  const play = useCallback((): void => {
    if (script === null || script.keys.length === 0) return
    if (cameraMode !== 'free') setCameraMode('free')
    const length = scriptClockOf(script).lengthMs
    const from = cursorMs >= length ? 0 : cursorMs
    startScript(script, from)
    const pb = scriptPlayback()
    if (pb !== null) showFrame(scriptDocFrame(pb, doc))
    setPlaying(true)
  }, [script, cameraMode, setCameraMode, cursorMs, doc, showFrame, setPlaying])

  const addKey = useCallback((): void => {
    if (script === null) return
    if (host === null || cameraMode !== 'free') {
      setError('The camera must be in free flight to capture a key')
      return
    }
    const pb = scriptPlayback()
    if (pb !== null) stop()
    // The stop takes the script's time into the cursor; `scriptTimeNow` only reads the cursor
    // for a clocked script (without one it acts at the film frame), so pass the stopped time.
    const t = scriptTimeNow({ script, frame: frameRef.current, doc, cursorMs: pb !== null ? pb.sMs : cursorMs })
    const { key, fellBack } = captureKey({
      t,
      capture: host.capture(),
      pos: posAnchor,
      look: lookAnchor,
      subject: (xuid: string) => host.subjectAt(xuid, frameRef.current),
      fov: fovMode,
    })
    const res = insertKey(script, key)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setScript(res.script)
    if (fellBack) setNotice('Player not in the film here: key pinned to the world')
  }, [script, host, cameraMode, posAnchor, lookAnchor, fovMode, cursorMs, frameRef, doc, stop])

  /** Applies a script edit (keys, holds, clock) through the model; an error goes to `error`,
   * and an edit made while a script is set on the camera is re-started on it at the same
   * script time. */
  const applyScriptChange = useCallback(
    (op: KeyOpResult): void => {
      if (!op.ok) {
        setError(op.error)
        return
      }
      const pb = scriptPlayback()
      setScript(op.script)
      if (pb !== null) startScript(op.script, pb.sMs)
    },
    [],
  )

  const goToKey = useCallback(
    (i: number): void => {
      if (script === null || i < 0 || i >= script.keys.length) return
      const t = script.keys[i].t
      stop()
      if (cameraMode !== 'free') setCameraMode('free')
      setCursorMs(t)
      startScript(script, t)
      const pb = scriptPlayback()
      if (pb !== null) showFrame(scriptDocFrame(pb, doc))
    },
    [script, cameraMode, setCameraMode, doc, showFrame, stop],
  )

  const setKeyFromCamera = useCallback(
    (i: number): void => {
      if (script === null) return
      if (host === null || cameraMode !== 'free') {
        setError('The camera must be in free flight to capture a key')
        return
      }
      if (i < 0 || i >= script.keys.length) return
      const original = script.keys[i]
      const pb = scriptPlayback()
      if (pb !== null) stop()
      const { key } = captureKey({
        t: original.t,
        capture: host.capture(),
        pos: posAnchor,
        look: lookAnchor,
        subject: (xuid: string) => host.subjectAt(xuid, frameRef.current),
        fov: fovMode,
      })
      // Keep the key's own ease, fov and roll; only a 'capture' fov re-captures the field.
      const merged: CameraKey = { t: key.t, pos: key.pos, look: key.look, ease: original.ease }
      const fov = fovMode === 'capture' ? key.fov : original.fov
      if (fov !== undefined) merged.fov = fov
      if (original.roll !== undefined) merged.roll = original.roll
      applyScriptChange(replaceKey(script, i, merged))
    },
    [script, host, cameraMode, posAnchor, lookAnchor, fovMode, frameRef, stop, applyScriptChange],
  )

  const updateKeyAction = useCallback(
    (i: number, patch: Partial<Pick<CameraKey, 'ease' | 'fov' | 'roll' | 't'>>): void => {
      if (script === null) return
      applyScriptChange(updateKey(script, i, patch))
    },
    [script, applyScriptChange],
  )

  const deleteKey = useCallback(
    (i: number): void => {
      if (script === null) return
      applyScriptChange(removeKey(script, i))
    },
    [script, applyScriptChange],
  )

  const addHold = useCallback(
    (xuid: string): void => {
      if (script === null) return
      const pb = scriptPlayback()
      if (pb !== null) stop()
      // As in addKey: a stopped playback puts its time in the cursor, and a clocked script
      // acts at the cursor, so pass the stopped time.
      const at = scriptTimeNow({ script, frame: frameRef.current, doc, cursorMs: pb !== null ? pb.sMs : cursorMs })
      const clip = poses.find((p) => p.kind === 'emote')?.id ?? 'combat:rifle:idle'
      applyScriptChange(addHoldModel(script, newHold(xuid, at, clip)))
    },
    [script, poses, cursorMs, frameRef, doc, stop, applyScriptChange],
  )

  const updateHoldAction = useCallback(
    (i: number, patch: Partial<Omit<Hold, 'xuid'>> & { xuid?: string }): void => {
      if (script === null) return
      applyScriptChange(updateHoldModel(script, i, patch))
    },
    [script, applyScriptChange],
  )

  const removeHoldAction = useCallback(
    (i: number): void => {
      if (script === null) return
      applyScriptChange(removeHoldModel(script, i))
    },
    [script, applyScriptChange],
  )

  const holdHere = useCallback(
    (i: number): void => {
      if (script === null) return
      const pb = scriptPlayback()
      if (pb !== null) stop()
      const at = scriptTimeNow({ script, frame: frameRef.current, doc, cursorMs: pb !== null ? pb.sMs : cursorMs })
      applyScriptChange(updateHoldModel(script, i, { at }))
    },
    [script, cursorMs, frameRef, doc, stop, applyScriptChange],
  )

  const faceCamera = useCallback(
    (i: number): void => {
      if (script === null) return
      const holds = script.holds ?? []
      if (i < 0 || i >= holds.length) return
      if (host === null) {
        setError('The 3D view is not loaded')
        return
      }
      const feet = host.subjectAt(holds[i].xuid, frameRef.current)
      if (feet === null) {
        setError(`Player ${holds[i].xuid} is not in the film here`)
        return
      }
      applyScriptChange(updateHoldModel(script, i, { heading: faceCameraHeading(host.capture().position, feet) }))
    },
    [script, host, frameRef, applyScriptChange],
  )

  const setFreeze = useCallback(
    (i: number, frozen: boolean): void => {
      if (script === null) return
      const holds = script.holds ?? []
      if (i < 0 || i >= holds.length) return
      applyScriptChange(setFreezeAtModel(script, holds[i].at, frozen))
    },
    [script, applyScriptChange],
  )

  const frozen = useCallback(
    (i: number): boolean => {
      const s = script
      const holds = s?.holds ?? []
      return s !== null && i >= 0 && i < holds.length && isFrozenAt(s, holds[i].at)
    },
    [script],
  )

  // When the page stops playing with the script still set (a pause, or the loop reaching the
  // script's end), the cursor takes the script time it stopped at: its length at the end.
  const wasPlaying = useRef(playing)
  useEffect(() => {
    const prev = wasPlaying.current
    wasPlaying.current = playing
    const pb = scriptPlayback()
    if (prev && !playing && pb !== null) setCursorMs(pb.sMs)
  }, [playing, playback])

  return {
    scripts,
    loading,
    error,
    notice,
    script,
    dirty,
    posAnchor,
    setPosAnchor,
    lookAnchor,
    setLookAnchor,
    fovMode,
    setFovMode,
    cursorMs,
    previewing,
    scriptPlaying,
    canCapture,
    confirmingDelete,
    refresh,
    open,
    create,
    save,
    remove,
    cancelDelete,
    play,
    stop,
    addKey,
    goToKey,
    setKeyFromCamera,
    updateKey: updateKeyAction,
    deleteKey,
    poses,
    addHold,
    updateHold: updateHoldAction,
    removeHold: removeHoldAction,
    holdHere,
    faceCamera,
    setFreeze,
    frozen,
  }
}
