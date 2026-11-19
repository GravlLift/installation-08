// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * CameraScriptPanel — the camera panel (docs/design/camera-scripts.md, unit 4b-2): a pure view
 * over the `CameraScriptEditor` (unit 4b-1) that edits a match's camera scripts. It is placed in
 * the player's right-hand panel slot, so it never covers the camera view selector; like the
 * settings drawer it carries `data-replay-escape-layer` and closes on Escape and its close button,
 * but, unlike that drawer, it does NOT close on a click outside — the user flies the free camera
 * with the mouse while it is open. Pressing `c` (outside an editable target, while a key can be
 * captured) adds a key from the current camera.
 */
import { useEffect, useRef, useState } from 'react'

import { keySummary } from './cameraScriptModel'
import type { CameraScriptEditor } from './useCameraScriptEditor'
import { scriptClockOf, type Ease } from '../scene3d/cameraScript3d'
import { isEditableTarget } from '../../../lib/dom/editableTarget'

const PANEL_WIDTH = 360
const EASES: readonly Ease[] = ['smooth', 'linear', 'in', 'out', 'cut']

/** A script time in ms as m:ss.mmm. */
function formatScriptMs(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  const minutes = Math.floor(total / 60000)
  const seconds = Math.floor((total % 60000) / 1000)
  const millis = total % 1000
  const ss = seconds < 10 ? `0${seconds}` : `${seconds}`
  const mm = millis < 100 ? `0${millis}` : millis < 10 ? `00${millis}` : `${millis}`
  return `${minutes}:${ss}.${mm}`
}

/** Read a number field: empty is `undefined` (the viewer's FOV / no roll); non-numeric text is
 * ignored, so the model — not the view — rejects what it rejects. */
function readNumberField(raw: string): number | undefined | null {
  if (raw === '') return undefined
  const value = Number(raw)
  return Number.isNaN(value) ? null : value
}

const BTN =
  'rounded border border-border bg-muted px-2 py-0.5 text-xs text-foreground transition-colors hover:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-50'
const SELECT = 'rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-foreground'
const INPUT = 'rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-foreground'

interface CameraScriptPanelProps {
  editor: CameraScriptEditor
  players: { xuid: string; name: string }[]
  nameOfXuid: (xuid: string) => string
  onClose: () => void
}

export function CameraScriptPanel({ editor, players, nameOfXuid, onClose }: CameraScriptPanelProps) {
  const [newName, setNewName] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)

  // The window listeners read the latest values through refs so they bind once, not per render.
  const addKeyRef = useRef(editor.addKey)
  addKeyRef.current = editor.addKey
  const canCaptureRef = useRef(editor.canCapture)
  canCaptureRef.current = editor.canCapture
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true })
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'c' && event.key !== 'C') return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isEditableTarget(event.target)) return
      if (!canCaptureRef.current) return
      event.preventDefault()
      addKeyRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function onPosition(value: string): void {
    if (value === 'world') {
      editor.setPosAnchor({ kind: 'world' })
      return
    }
    const relative = editor.posAnchor.kind === 'player' ? editor.posAnchor.relative : 'world'
    editor.setPosAnchor({ kind: 'player', xuid: value, relative })
  }

  function onLook(value: string): void {
    if (value === 'orbit') {
      editor.setLookAnchor({ kind: 'orbit' })
      return
    }
    editor.setLookAnchor({ kind: 'player', xuid: value })
  }

  function onHeading(checked: boolean): void {
    const pos = editor.posAnchor
    if (pos.kind !== 'player') return
    editor.setPosAnchor({ kind: 'player', xuid: pos.xuid, relative: checked ? 'heading' : 'world' })
  }

  const script = editor.script
  const canPlay = script !== null && script.keys.length > 0
  const canStop = editor.previewing || editor.scriptPlaying
  const canSave = script !== null && editor.dirty
  const status = editor.scriptPlaying
    ? 'Playing'
    : editor.previewing
      ? `Previewing at ${formatScriptMs(editor.cursorMs)} (Stop to fly the camera)`
      : formatScriptMs(editor.cursorMs)

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="region"
      data-replay-escape-layer=""
      aria-label="Camera script"
      style={{ width: PANEL_WIDTH }}
      className="flex flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-card px-3 py-3 text-sm text-foreground shadow-xl outline-none"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Camera script</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close camera script"
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          ×
        </button>
      </div>

      <section className="space-y-1.5">
        <h3 className="text-xs font-medium text-muted-foreground">Script</h3>
        <select
          className={SELECT}
          aria-label="Script"
          value={script?.name ?? ''}
          onChange={(e) => void editor.open(e.target.value)}
        >
          <option value="" disabled>
            No script
          </option>
          {editor.scripts.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1.5">
          <input
            className={INPUT}
            aria-label="New script name"
            placeholder="new-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button
            type="button"
            className={BTN}
            onClick={() => {
              editor.create(newName)
              setNewName('')
            }}
          >
            New
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className={BTN} disabled={!canSave} onClick={() => void editor.save()}>
            Save{editor.dirty ? ' ·' : ''}
          </button>
          {script !== null && (
            <button type="button" className={BTN} onClick={() => void editor.remove()}>
              {editor.confirmingDelete ? 'Confirm delete' : 'Delete'}
            </button>
          )}
          {script !== null && editor.confirmingDelete && (
            <button type="button" className={BTN} onClick={editor.cancelDelete}>
              Cancel
            </button>
          )}
        </div>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-xs font-medium text-muted-foreground">Transport</h3>
        <div className="flex items-center gap-1.5">
          <button type="button" className={BTN} disabled={!canPlay} onClick={editor.play}>
            Play
          </button>
          <button type="button" className={BTN} disabled={!canStop} onClick={editor.stop}>
            Stop
          </button>
        </div>
        <p className="text-xs text-foreground">{status}</p>
        {script !== null && (
          <p className="text-xs text-muted-foreground">Length: {formatScriptMs(scriptClockOf(script).lengthMs)}</p>
        )}
        {script !== null && script.clock !== undefined && (
          <p className="text-xs text-muted-foreground">Clock: {script.clock.rates.length} rate entries</p>
        )}
      </section>

      <section className="space-y-1.5">
        <h3 className="text-xs font-medium text-muted-foreground">Capture</h3>
        <div className="space-y-1">
          <select
            className={SELECT}
            aria-label="Position"
            value={editor.posAnchor.kind === 'player' ? editor.posAnchor.xuid : 'world'}
            onChange={(e) => onPosition(e.target.value)}
          >
            <option value="world">World</option>
            {players.map((p) => (
              <option key={p.xuid} value={p.xuid}>
                Follow {p.name}
              </option>
            ))}
          </select>
          {editor.posAnchor.kind === 'player' && (
            <label className="flex items-center gap-1.5 text-xs text-foreground">
              <input
                type="checkbox"
                checked={editor.posAnchor.relative === 'heading'}
                onChange={(e) => onHeading(e.target.checked)}
              />
              Turns with heading
            </label>
          )}
        </div>
        <select
          className={SELECT}
          aria-label="Look"
          value={editor.lookAnchor.kind === 'player' ? editor.lookAnchor.xuid : 'orbit'}
          onChange={(e) => onLook(e.target.value)}
        >
          <option value="orbit">Orbit point</option>
          {players.map((p) => (
            <option key={p.xuid} value={p.xuid}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          className={SELECT}
          aria-label="Field of view"
          value={editor.fovMode}
          onChange={(e) => editor.setFovMode(e.target.value === 'capture' ? 'capture' : 'base')}
        >
          <option value="base">Viewer FOV</option>
          <option value="capture">Capture FOV</option>
        </select>
        <button
          type="button"
          className={BTN}
          disabled={!editor.canCapture}
          title={editor.canCapture ? undefined : script === null ? 'No script open' : 'The camera must be on Free'}
          onClick={editor.addKey}
        >
          Add key (C)
        </button>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-xs font-medium text-muted-foreground">Keys</h3>
        {script !== null && script.keys.length > 0
          ? script.keys.map((key, i) => (
              <KeyRow
                key={i}
                index={i}
                t={key.t}
                summary={keySummary(key, nameOfXuid)}
                ease={key.ease ?? 'smooth'}
                fov={key.fov}
                roll={key.roll}
                canCapture={editor.canCapture}
                onEase={(ease) => editor.updateKey(i, { ease })}
                onFov={(fov) => editor.updateKey(i, { fov })}
                onRoll={(roll) => editor.updateKey(i, { roll })}
                onGoTo={() => editor.goToKey(i)}
                onSetFromCamera={() => editor.setKeyFromCamera(i)}
                onDelete={() => editor.deleteKey(i)}
              />
            ))
          : <p className="text-xs text-muted-foreground">No keys</p>}
      </section>

      {editor.error !== null && <p className="text-xs text-destructive">{editor.error}</p>}
      {editor.notice !== null && <p className="text-xs text-muted-foreground">{editor.notice}</p>}
    </div>
  )
}

interface KeyRowProps {
  index: number
  t: number
  summary: string
  ease: Ease
  fov?: number
  roll?: number
  canCapture: boolean
  onEase: (ease: Ease) => void
  onFov: (fov: number | undefined) => void
  onRoll: (roll: number | undefined) => void
  onGoTo: () => void
  onSetFromCamera: () => void
  onDelete: () => void
}

function KeyRow({ index, t, summary, ease, fov, roll, canCapture, onEase, onFov, onRoll, onGoTo, onSetFromCamera, onDelete }: KeyRowProps) {
  const label = `Key ${index + 1}`
  return (
    <div role="group" aria-label={label} className="space-y-1 rounded border border-border p-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-foreground">{summary}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatScriptMs(t)}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <select
          className={SELECT}
          aria-label={`${label} ease`}
          value={ease}
          onChange={(e) => onEase(e.target.value as Ease)}
        >
          {EASES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <input
          className={INPUT}
          type="number"
          aria-label={`${label} fov`}
          value={fov === undefined ? '' : String(fov)}
          onChange={(e) => {
            const value = readNumberField(e.target.value)
            if (value !== null) onFov(value)
          }}
        />
        <input
          className={INPUT}
          type="number"
          aria-label={`${label} roll`}
          value={roll === undefined ? '' : String(roll)}
          onChange={(e) => {
            const value = readNumberField(e.target.value)
            if (value !== null) onRoll(value)
          }}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" className={BTN} aria-label={`${label} go to`} onClick={onGoTo}>
          Go to
        </button>
        <button type="button" className={BTN} aria-label={`${label} set from camera`} disabled={!canCapture} onClick={onSetFromCamera}>
          Set from camera
        </button>
        <button type="button" className={BTN} aria-label={`${label} delete`} onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  )
}
