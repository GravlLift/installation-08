// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * CameraScriptPanel.test.tsx — the camera panel's view over a hand-built fake editor (unit 4b-2):
 * opening/creating/saving/deleting scripts, the two-step delete, capture controls, the key rows
 * (ease, fov, roll, go to, set from camera, delete), the hold section (add, clip select, loop,
 * weapon, blend, heading, until, hold here, face camera, remove, freeze), the `c` shortcut,
 * Escape, and that a click outside does NOT close it.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { CameraScriptPanel } from './CameraScriptPanel'
import type { CameraScriptEditor } from './useCameraScriptEditor'
import type { CameraScript, CameraKey } from '../scene3d/cameraScript3d'
import type { CameraScriptSummary } from './cameraScriptApi'
import type { Hold } from '../scene3d/hold3d'

const summary = (name: string): CameraScriptSummary => ({ name, modified: '2026-01-01T00:00:00Z', keys: 1 })

const KEY_0: CameraKey = { t: 0, pos: { at: 'world', point: [0, 0, 0] }, look: { at: 'world', point: [1, 0, 0] }, ease: 'smooth', fov: 45 }
const KEY_1: CameraKey = { t: 1000, pos: { at: 'world', point: [2, 0, 0] }, look: { at: 'world', point: [3, 0, 0] } }
const SCRIPT: CameraScript = { version: 1, matchId: 'm', name: 'intro', keys: [KEY_0, KEY_1] }

const HOLD_0: Hold = {
  xuid: 'A',
  at: 1000,
  clip: 'combat:rifle:idle',
  loop: false,
  blendMs: 250,
  heading: null,
  turnMs: 400,
  pitch: 0,
  weapon: 'keep',
  until: null,
}
const SCRIPT_HOLD: CameraScript = { version: 1, matchId: 'm', name: 'intro', keys: [KEY_0], holds: [HOLD_0] }

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

it('refreshes the script list when the panel opens', () => {
  const editor = makeEditor()
  renderPanel(editor)
  expect(editor.refresh).toHaveBeenCalledOnce()
})

it('a key row shows visible FOV and Roll labels beside its inputs', () => {
  // Two keys in the script, so one label per key row.
  renderPanel(makeEditor({ script: SCRIPT }))
  expect(screen.getAllByText('FOV')).toHaveLength(2)
  expect(screen.getAllByText('Roll')).toHaveLength(2)
})

it('a hold row shows visible Blend, Turn, Pitch, Heading and Until labels', () => {
  renderPanel(makeEditor({ script: SCRIPT_HOLD }))
  for (const label of ['Blend', 'Turn', 'Pitch', 'Heading', 'Until']) {
    expect(screen.getByText(label)).toBeInTheDocument()
  }
})

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

it('Add hold lists players without a hold, omits the held one, and calls addHold with the choice', () => {
  const editor = makeEditor({ script: SCRIPT_HOLD })
  renderPanel(editor)
  const select = screen.getByRole('combobox', { name: 'Add hold player' })
  expect(within(select).getByRole('option', { name: 'Bravo' })).toBeInTheDocument()
  expect(within(select).queryByRole('option', { name: 'Alpha' })).toBeNull()
  fireEvent.change(select, { target: { value: 'B' } })
  expect(editor.addHold).toHaveBeenCalledWith('B')
})

it('Add hold is disabled when every player already has a hold', () => {
  const allHeld: CameraScript = {
    ...SCRIPT_HOLD,
    holds: [HOLD_0, { ...HOLD_0, xuid: 'B', at: 2000 }],
  }
  renderPanel(makeEditor({ script: allHeld }))
  expect(screen.getByRole('combobox', { name: 'Add hold player' })).toBeDisabled()
})

it('the clip select lists the gameplay group and the poses grouped by kind, and calls updateHold with the clip', () => {
  const editor = makeEditor({
    script: SCRIPT_HOLD,
    poses: [
      { id: 'emote:wave', kind: 'emote', name: 'Wave' },
      { id: 'stance:guard', kind: 'stance', name: 'Guard' },
      { id: 'idle:rest', kind: 'idle', name: 'Rest' },
    ],
  })
  renderPanel(editor)
  expect(screen.getByRole('option', { name: 'Rifle idle' })).toBeInTheDocument()
  expect(screen.getByRole('option', { name: 'Crouch idle' })).toBeInTheDocument()
  expect(screen.getByRole('option', { name: 'Wave' }).closest('optgroup')).toHaveAttribute('label', 'Emotes')
  expect(screen.getByRole('option', { name: 'Guard' }).closest('optgroup')).toHaveAttribute('label', 'Stances')
  expect(screen.getByRole('option', { name: 'Rest' }).closest('optgroup')).toHaveAttribute('label', 'Idles')
  fireEvent.change(screen.getByRole('combobox', { name: 'Hold 1 clip' }), { target: { value: 'emote:wave' } })
  expect(editor.updateHold).toHaveBeenCalledWith(0, { clip: 'emote:wave' })
})

it('the clip select shows a no-poses note when the pose catalog is empty', () => {
  renderPanel(makeEditor({ script: SCRIPT_HOLD }))
  expect(screen.getByText('Poses need the game installed; gameplay idles only.')).toBeInTheDocument()
})

it('Loop, Hide weapon, Blend, Heading and Until call updateHold with the right patch', () => {
  // heading and until start non-null so clearing the fields is a real change event.
  const editor = makeEditor({
    script: { ...SCRIPT_HOLD, holds: [{ ...HOLD_0, heading: 90, until: 5000 }] },
  })
  renderPanel(editor)
  fireEvent.click(screen.getByRole('checkbox', { name: 'Loop' }))
  expect(editor.updateHold).toHaveBeenLastCalledWith(0, { loop: true })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Hide weapon' }))
  expect(editor.updateHold).toHaveBeenLastCalledWith(0, { weapon: 'hide' })
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Hold 1 blend' }), { target: { value: '500' } })
  expect(editor.updateHold).toHaveBeenLastCalledWith(0, { blendMs: 500 })
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Hold 1 heading' }), { target: { value: '45' } })
  expect(editor.updateHold).toHaveBeenLastCalledWith(0, { heading: 45 })
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Hold 1 heading' }), { target: { value: '' } })
  expect(editor.updateHold).toHaveBeenLastCalledWith(0, { heading: null })
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Hold 1 until' }), { target: { value: '8000' } })
  expect(editor.updateHold).toHaveBeenLastCalledWith(0, { until: 8000 })
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Hold 1 until' }), { target: { value: '' } })
  expect(editor.updateHold).toHaveBeenLastCalledWith(0, { until: null })
})

it('a hold row\'s Hold here, Face camera and Remove call their actions', () => {
  const editor = makeEditor({ script: SCRIPT_HOLD })
  renderPanel(editor)
  fireEvent.click(screen.getByRole('button', { name: 'Hold 1 hold here' }))
  expect(editor.holdHere).toHaveBeenCalledWith(0)
  fireEvent.click(screen.getByRole('button', { name: 'Hold 1 face camera' }))
  expect(editor.faceCamera).toHaveBeenCalledWith(0)
  fireEvent.click(screen.getByRole('button', { name: 'Hold 1 remove' }))
  expect(editor.removeHold).toHaveBeenCalledWith(0)
})

it('the freeze checkbox reflects frozen and calls setFreeze', () => {
  const editor = makeEditor({ script: SCRIPT_HOLD, frozen: () => true })
  renderPanel(editor)
  const freeze = screen.getByRole('checkbox', { name: 'Freeze world here' })
  expect(freeze).toBeChecked()
  fireEvent.click(freeze)
  expect(editor.setFreeze).toHaveBeenCalledWith(0, false)
})
