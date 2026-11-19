// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * CameraScriptPanel.test.tsx — the camera panel's view over a hand-built fake editor (unit 4b-2):
 * opening/creating/saving/deleting scripts, the two-step delete, capture controls, the key rows
 * (ease, fov, roll, go to, set from camera, delete), the `c` shortcut, Escape, and that a click
 * outside does NOT close it.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { CameraScriptPanel } from './CameraScriptPanel'
import type { CameraScriptEditor } from './useCameraScriptEditor'
import type { CameraScript, CameraKey } from '../scene3d/cameraScript3d'
import type { CameraScriptSummary } from './cameraScriptApi'

const summary = (name: string): CameraScriptSummary => ({ name, modified: '2026-01-01T00:00:00Z', keys: 1 })

const KEY_0: CameraKey = { t: 0, pos: { at: 'world', point: [0, 0, 0] }, look: { at: 'world', point: [1, 0, 0] }, ease: 'smooth', fov: 45 }
const KEY_1: CameraKey = { t: 1000, pos: { at: 'world', point: [2, 0, 0] }, look: { at: 'world', point: [3, 0, 0] } }
const SCRIPT: CameraScript = { version: 1, matchId: 'm', name: 'intro', keys: [KEY_0, KEY_1] }

function makeEditor(overrides: Partial<CameraScriptEditor> = {}): CameraScriptEditor {
  return {
    scripts: [],
    loading: false,
    error: null,
    notice: null,
    script: null,
    dirty: false,
    posAnchor: { kind: 'world' },
    setPosAnchor: vi.fn(),
    lookAnchor: { kind: 'orbit' },
    setLookAnchor: vi.fn(),
    fovMode: 'base',
    setFovMode: vi.fn(),
    cursorMs: 0,
    previewing: false,
    scriptPlaying: false,
    canCapture: false,
    confirmingDelete: false,
    refresh: vi.fn(),
    open: vi.fn().mockResolvedValue(undefined),
    create: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    cancelDelete: vi.fn(),
    play: vi.fn(),
    stop: vi.fn(),
    addKey: vi.fn(),
    goToKey: vi.fn(),
    setKeyFromCamera: vi.fn(),
    updateKey: vi.fn(),
    deleteKey: vi.fn(),
    poses: [],
    addHold: vi.fn(),
    updateHold: vi.fn(),
    removeHold: vi.fn(),
    holdHere: vi.fn(),
    faceCamera: vi.fn(),
    setFreeze: vi.fn(),
    frozen: vi.fn().mockReturnValue(false),
    ...overrides,
  }
}

const PLAYERS = [{ xuid: 'A', name: 'Alpha' }, { xuid: 'B', name: 'Bravo' }]
const NAME_OF: Record<string, string> = { A: 'Alpha', B: 'Bravo' }
const nameOfXuid = (xuid: string) => NAME_OF[xuid] ?? xuid

function renderPanel(editor: CameraScriptEditor, onClose = vi.fn()) {
  return {
    onClose,
    utils: render(
      <CameraScriptPanel editor={editor} players={PLAYERS} nameOfXuid={nameOfXuid} onClose={onClose} />,
    ),
  }
}

it('opening a script from the list calls open with its name', () => {
  const editor = makeEditor({ scripts: [summary('intro')] })
  renderPanel(editor)
  fireEvent.change(screen.getByRole('combobox', { name: 'Script' }), { target: { value: 'intro' } })
  expect(editor.open).toHaveBeenCalledWith('intro')
})

it('New calls create with the name input\'s value', () => {
  const editor = makeEditor()
  renderPanel(editor)
  fireEvent.change(screen.getByRole('textbox', { name: 'New script name' }), { target: { value: 'fresh' } })
  fireEvent.click(screen.getByRole('button', { name: 'New' }))
  expect(editor.create).toHaveBeenCalledWith('fresh')
})

it('Save is disabled when clean and enabled when dirty', () => {
  const { utils } = renderPanel(makeEditor({ script: SCRIPT, dirty: false }))
  expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled()
  utils.rerender(<CameraScriptPanel editor={makeEditor({ script: SCRIPT, dirty: true })} players={PLAYERS} nameOfXuid={nameOfXuid} onClose={() => undefined} />)
  expect(screen.getByRole('button', { name: /Save/ })).not.toBeDisabled()
})

it('Delete arms the confirm; when armed, Cancel calls cancelDelete and Confirm delete calls remove', () => {
  const editor = makeEditor({ script: SCRIPT, confirmingDelete: false })
  renderPanel(editor)
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  expect(editor.remove).toHaveBeenCalledOnce()
  expect(screen.queryByRole('button', { name: 'Confirm delete' })).toBeNull()

  const armed = makeEditor({ script: SCRIPT, confirmingDelete: true })
  renderPanel(armed)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(armed.cancelDelete).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
  expect(armed.remove).toHaveBeenCalledOnce()
})

it('Add key is disabled when capture is unavailable', () => {
  renderPanel(makeEditor({ canCapture: false }))
  expect(screen.getByRole('button', { name: /Add key/ })).toBeDisabled()
})

it('Add key calls addKey when capture is available', () => {
  const editor = makeEditor({ canCapture: true, script: SCRIPT })
  renderPanel(editor)
  fireEvent.click(screen.getByRole('button', { name: /Add key/ }))
  expect(editor.addKey).toHaveBeenCalledOnce()
})

it('pressing c on the window calls addKey; typing c into the name input does not', () => {
  const editor = makeEditor({ canCapture: true, script: SCRIPT })
  renderPanel(editor)
  fireEvent.keyDown(window, { key: 'c' })
  expect(editor.addKey).toHaveBeenCalledOnce()
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'New script name' }), { key: 'c' })
  expect(editor.addKey).toHaveBeenCalledOnce()
})

it('a key row\'s ease select calls updateKey with the new ease', () => {
  const editor = makeEditor({ script: SCRIPT })
  renderPanel(editor)
  fireEvent.change(screen.getByRole('combobox', { name: 'Key 1 ease' }), { target: { value: 'linear' } })
  expect(editor.updateKey).toHaveBeenCalledWith(0, { ease: 'linear' })
})

it('clearing a key\'s fov calls updateKey with fov undefined; a number sets it', () => {
  const editor = makeEditor({ script: SCRIPT })
  renderPanel(editor)
  const fov = screen.getByRole('spinbutton', { name: 'Key 1 fov' })
  expect(fov).toHaveValue(45)
  fireEvent.change(fov, { target: { value: '' } })
  expect(editor.updateKey).toHaveBeenLastCalledWith(0, { fov: undefined })
  fireEvent.change(fov, { target: { value: '80' } })
  expect(editor.updateKey).toHaveBeenLastCalledWith(0, { fov: 80 })
})

it('a key row\'s Go to, Set from camera and Delete call their actions', () => {
  const editor = makeEditor({ script: SCRIPT, canCapture: true })
  renderPanel(editor)
  fireEvent.click(screen.getByRole('button', { name: 'Key 1 go to' }))
  expect(editor.goToKey).toHaveBeenCalledWith(0)
  fireEvent.click(screen.getByRole('button', { name: 'Key 2 set from camera' }))
  expect(editor.setKeyFromCamera).toHaveBeenCalledWith(1)
  fireEvent.click(screen.getByRole('button', { name: 'Key 1 delete' }))
  expect(editor.deleteKey).toHaveBeenCalledWith(0)
})

it('Escape closes the panel', () => {
  const onClose = vi.fn()
  renderPanel(makeEditor(), onClose)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledOnce()
})

it('a pointerdown outside does NOT close the panel', () => {
  const onClose = vi.fn()
  renderPanel(makeEditor(), onClose)
  fireEvent.pointerDown(document.body)
  expect(onClose).not.toHaveBeenCalled()
})
