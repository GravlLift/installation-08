// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useCameraScriptEditor.test.tsx — the camera panel's state and actions (unit 4b-1): the script
 * list, create/save/delete, capturing keys from a registered fake host, preview and playback
 * against the camera-script store, and the dirty state.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { useCameraScriptEditor, type UseCameraScriptEditorArgs } from './useCameraScriptEditor'
import {
  deleteCameraScript,
  fetchCameraScript,
  listCameraScripts,
  listPoses,
  saveCameraScript,
} from './cameraScriptApi'
import {
  registerCameraScriptHost,
  scriptPlayback,
  setScriptPlaybackTime,
  stopScript,
  type CameraScriptHost,
} from '../scene3d/cameraScriptStore'
import type { CameraScript } from '../scene3d/cameraScript3d'
import { frameToMs } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'

vi.mock('./cameraScriptApi', () => ({
  listCameraScripts: vi.fn(),
  fetchCameraScript: vi.fn(),
  saveCameraScript: vi.fn(),
  deleteCameraScript: vi.fn(),
  listPoses: vi.fn(),
}))

const DOC: ReplayDocumentReady = { frameIntervalMs: 100 } as ReplayDocumentReady

/** A two-key clock-less script: script time is document time, length 1000 ms. */
const SCRIPT: CameraScript = {
  version: 1,
  matchId: 'm',
  name: 'intro',
  keys: [
    { t: 0, pos: { at: 'world', point: [0, 0, 0] }, look: { at: 'world', point: [1, 0, 0] } },
    { t: 1000, pos: { at: 'world', point: [2, 0, 0] }, look: { at: 'world', point: [3, 0, 0] } },
  ],
}

/** `SCRIPT` with one hold for 'p' at script time 1000. */
const HOLD_SCRIPT: CameraScript = {
  ...SCRIPT,
  holds: [
    {
      xuid: 'p',
      at: 1000,
      clip: 'mp:intro_emote:a',
      loop: false,
      blendMs: 250,
      heading: null,
      turnMs: 400,
      pitch: 0,
      weapon: 'keep',
      until: null,
    },
  ],
}

/** The pose catalog the tests load: an idle, two emotes, and a stance, in this order. */
const POSES = [
  { id: 'idle:a', kind: 'idle' as const, name: 'Idle' },
  { id: 'mp:intro_emote:a', kind: 'emote' as const, name: 'I see you' },
  { id: 'mp:intro_emote:b', kind: 'emote' as const, name: 'Salute' },
  { id: 'stance:a', kind: 'stance' as const, name: 'Stance' },
]

/** The fake host: a fixed capture pose, one known player ('p'), all other xuids out of life. */
function fakeHost(): CameraScriptHost {
  return {
    setScript: () => undefined,
    setScriptTime: () => undefined,
    capture: () => ({ position: [1, 2, 3], target: [4, 5, 6], verticalFov: 45 }),
    subjectAt: (xuid: string) => (xuid === 'p' ? { x: 10, y: 0, z: 0, h: 90 } : null),
    frameMs: 1000 / 30,
  }
}

function renderEditor(overrides: Partial<UseCameraScriptEditorArgs> = {}) {
  const args: UseCameraScriptEditorArgs = {
    matchId: 'm',
    doc: DOC,
    frameRef: { current: 10 },
    playing: false,
    setPlaying: () => undefined,
    cameraMode: 'free',
    setCameraMode: () => undefined,
    showFrame: () => undefined,
    ...overrides,
  }
  return { args, ...renderHook(() => useCameraScriptEditor(args)) }
}

let offHost: (() => void) | null = null

beforeEach(() => {
  offHost = registerCameraScriptHost(fakeHost())
  vi.mocked(listCameraScripts).mockResolvedValue([])
  vi.mocked(listPoses).mockResolvedValue(POSES)
  vi.mocked(fetchCameraScript).mockResolvedValue(SCRIPT)
  vi.mocked(saveCameraScript).mockResolvedValue({ name: 'intro', keys: 2 })
  vi.mocked(deleteCameraScript).mockResolvedValue(undefined)
})

afterEach(() => {
  offHost?.()
  offHost = null
  stopScript()
})

it('refresh lists the match scripts on mount', async () => {
  vi.mocked(listCameraScripts).mockResolvedValue([
    { name: 'intro', modified: '2026-01-01T00:00:00Z', keys: 2 },
  ])
  const { result } = renderEditor()
  expect(vi.mocked(listCameraScripts)).toHaveBeenCalledWith('m')
  await waitFor(() => expect(result.current.scripts).toHaveLength(1))
  expect(result.current.scripts[0]).toEqual({ name: 'intro', modified: '2026-01-01T00:00:00Z', keys: 2 })
  expect(result.current.loading).toBe(false)
})

it('create validates the name: a bad name and a duplicate both stay out', async () => {
  vi.mocked(listCameraScripts).mockResolvedValue([
    { name: 'intro', modified: '2026-01-01T00:00:00Z', keys: 2 },
  ])
  const { result } = renderEditor()
  await waitFor(() => expect(result.current.scripts).toHaveLength(1))

  act(() => result.current.create('Bad Name'))
  expect(result.current.script).toBeNull()
  expect(result.current.error).toBe('Name must be 1 to 64 characters of [a-z0-9_-]')

  act(() => result.current.create('intro'))
  expect(result.current.script).toBeNull()
  expect(result.current.error).toMatch(/already exists/)

  act(() => result.current.create('fresh'))
  expect(result.current.script).toMatchObject({ version: 1, matchId: 'm', name: 'fresh', keys: [] })
  expect(result.current.dirty).toBe(false)
})

it('addKey on a clock-less script captures at the film frame\'s time', () => {
  const { result } = renderEditor()
  act(() => result.current.create('fresh'))

  act(() => result.current.addKey())

  const keys = result.current.script?.keys ?? []
  expect(keys).toHaveLength(1)
  expect(keys[0].t).toBe(frameToMs(10, DOC))
  expect(keys[0].pos).toEqual({ at: 'world', point: [1, 2, 3] })
  expect(keys[0].look).toEqual({ at: 'world', point: [4, 5, 6] })
  expect(keys[0].ease).toBe('smooth')
})

it('addKey is a no-op with an error when the camera mode is not free', () => {
  const { result } = renderEditor({ cameraMode: 'tp' })
  act(() => result.current.create('fresh'))

  act(() => result.current.addKey())

  expect(result.current.script?.keys).toHaveLength(0)
  expect(result.current.error).toMatch(/free flight/)
})

it('a player anchor whose subject is in the film anchors to the player; a missing one falls back to the world with a notice', () => {
  const { result } = renderEditor()
  act(() => result.current.create('fresh'))

  act(() => result.current.setPosAnchor({ kind: 'player', xuid: 'p', relative: 'world' }))
  act(() => result.current.addKey())
  expect(result.current.script?.keys[0].pos).toEqual({ at: 'player', xuid: 'p', offset: [-9, 2, 3], relative: 'world' })
  expect(result.current.notice).toBeNull()

  act(() => result.current.setPosAnchor({ kind: 'player', xuid: 'gone', relative: 'world' }))
  act(() => result.current.addKey())
  expect(result.current.script?.keys[0].pos).toEqual({ at: 'world', point: [1, 2, 3] })
  expect(result.current.notice).toBe('Player not in the film here: key pinned to the world')
})

it('a new script is dirty after addKey and clean after save', async () => {
  const { result } = renderEditor()
  act(() => result.current.create('fresh'))
  expect(result.current.dirty).toBe(false)

  act(() => result.current.addKey())
  expect(result.current.dirty).toBe(true)

  await act(async () => {
    await result.current.save()
  })
  expect(vi.mocked(saveCameraScript)).toHaveBeenCalledTimes(1)
  const saved = vi.mocked(saveCameraScript).mock.calls[0][0] as CameraScript
  expect(saved.name).toBe('fresh')
  expect(saved.keys).toHaveLength(1)
  expect(result.current.dirty).toBe(false)
  expect(result.current.notice).toBe('Saved')
})

it('remove needs two calls; cancelDelete disarms the first', async () => {
  const { result } = renderEditor()
  await act(async () => {
    await result.current.open('intro')
  })

  act(() => {
    void result.current.remove()
  })
  expect(result.current.confirmingDelete).toBe(true)
  expect(vi.mocked(deleteCameraScript)).not.toHaveBeenCalled()

  act(() => result.current.cancelDelete())
  expect(result.current.confirmingDelete).toBe(false)

  act(() => {
    void result.current.remove()
  })
  await act(async () => {
    await result.current.remove()
  })
  expect(vi.mocked(deleteCameraScript)).toHaveBeenCalledWith('m', 'intro')
  expect(result.current.script).toBeNull()
  expect(result.current.confirmingDelete).toBe(false)
})

it('play switches to free, starts the script on the camera and sets the page playing', async () => {
  const setCameraMode = vi.fn()
  const setPlaying = vi.fn()
  const showFrame = vi.fn()
  const { result } = renderEditor({ cameraMode: 'tp', setCameraMode, setPlaying, showFrame })
  await act(async () => {
    await result.current.open('intro')
  })

  act(() => result.current.play())

  expect(setCameraMode).toHaveBeenCalledWith('free')
  expect(scriptPlayback()).toMatchObject({ script: SCRIPT, sMs: 0 })
  expect(setPlaying).toHaveBeenCalledWith(true)
  expect(showFrame).toHaveBeenCalledWith(0)
})

it('play from a cursor at the script length starts at 0', async () => {
  const { result } = renderEditor()
  await act(async () => {
    await result.current.open('intro')
  })
  act(() => result.current.goToKey(1))
  expect(result.current.cursorMs).toBe(1000)

  act(() => result.current.play())

  expect(scriptPlayback()?.sMs).toBe(0)
})

it('stop takes the script time into the cursor, stops the camera and pauses the page', async () => {
  const setPlaying = vi.fn()
  const { result } = renderEditor({ playing: true, setPlaying })
  await act(async () => {
    await result.current.open('intro')
  })
  act(() => result.current.play())
  act(() => setScriptPlaybackTime(400))
  expect(result.current.scriptPlaying).toBe(true)

  act(() => result.current.stop())

  expect(result.current.cursorMs).toBe(400)
  expect(scriptPlayback()).toBeNull()
  expect(setPlaying).toHaveBeenLastCalledWith(false)
  expect(result.current.previewing).toBe(false)
})

it('goToKey previews the key: startScript at its time, the film moves to it, the page stays paused', async () => {
  const setPlaying = vi.fn()
  const showFrame = vi.fn()
  const { result } = renderEditor({ setPlaying, showFrame })
  await act(async () => {
    await result.current.open('intro')
  })

  act(() => result.current.goToKey(1))

  expect(scriptPlayback()).toMatchObject({ script: SCRIPT, sMs: 1000 })
  expect(result.current.previewing).toBe(true)
  expect(result.current.cursorMs).toBe(1000)
  expect(showFrame).toHaveBeenCalledWith(10) // 1000 ms of a 100 ms frame is frame 10
  expect(setPlaying).not.toHaveBeenCalled()
})

it('an edit during a preview re-starts the script on the camera at the same time', async () => {
  const { result } = renderEditor()
  await act(async () => {
    await result.current.open('intro')
  })
  act(() => result.current.goToKey(1))
  expect(scriptPlayback()?.sMs).toBe(1000)

  act(() => result.current.updateKey(1, { ease: 'linear' }))

  const pb = scriptPlayback()
  expect(pb?.sMs).toBe(1000)
  expect(pb?.script.keys[1].ease).toBe('linear')
  expect(result.current.script?.keys[1].ease).toBe('linear')
})

it('deleteKey and a rejected updateKey go through the model; an error lands in the state', async () => {
  const { result } = renderEditor()
  await act(async () => {
    await result.current.open('intro')
  })

  act(() => result.current.updateKey(0, { fov: 200 }))
  expect(result.current.error).toMatch(/fov/)
  expect(result.current.script?.keys[0].fov).toBeUndefined()

  act(() => result.current.deleteKey(0))
  expect(result.current.script?.keys).toHaveLength(1)
})

it('a pause mid-script keeps the cursor at the script time it stopped at', async () => {
  const setPlaying = vi.fn()
  const { args, result, rerender } = renderEditor({ setPlaying })
  await act(async () => {
    await result.current.open('intro')
  })
  act(() => result.current.play())
  args.playing = true
  rerender()
  setScriptPlaybackTime(400)
  args.playing = false
  rerender()
  expect(result.current.cursorMs).toBe(400)
})

it('poses load from listPoses on mount', async () => {
  const { result } = renderEditor()
  expect(vi.mocked(listPoses)).toHaveBeenCalledWith()
  await waitFor(() => expect(result.current.poses).toEqual(POSES))
  expect(result.current.error).toBeNull()
})

it('addHold adds a hold at the film frame time with the first emote as the default clip', async () => {
  const { result } = renderEditor()
  await waitFor(() => expect(result.current.poses).toHaveLength(POSES.length))
  act(() => result.current.create('fresh'))

  act(() => result.current.addHold('p'))

  const holds = result.current.script?.holds ?? []
  expect(holds).toHaveLength(1)
  expect(holds[0]).toMatchObject({ xuid: 'p', at: frameToMs(10, DOC), clip: 'mp:intro_emote:a' })
  expect(holds[0]).toMatchObject({ loop: false, blendMs: 250, heading: null, turnMs: 400, pitch: 0, weapon: 'keep' })
  expect(holds[0].until).toBeNull()
})

it('addHold falls back to combat:rifle:idle when the catalog has no emote', async () => {
  vi.mocked(listPoses).mockResolvedValue([POSES[0], POSES[3]])
  const { result } = renderEditor()
  await waitFor(() => expect(result.current.poses).toHaveLength(2))
  act(() => result.current.create('fresh'))

  act(() => result.current.addHold('p'))

  expect(result.current.script?.holds?.[0].clip).toBe('combat:rifle:idle')
})

it('holdHere sets the hold at to the current film frame time', () => {
  const frameRef = { current: 20 }
  const { result } = renderEditor({ frameRef })
  act(() => result.current.create('fresh'))
  act(() => result.current.addHold('p'))
  expect(result.current.script?.holds?.[0].at).toBe(2000)

  frameRef.current = 30
  act(() => result.current.holdHere(0))
  expect(result.current.script?.holds?.[0].at).toBe(3000)
})

it('faceCamera sets the hold heading from the free camera position', () => {
  const { result } = renderEditor()
  act(() => result.current.create('fresh'))
  act(() => result.current.addHold('p'))

  act(() => result.current.faceCamera(0))

  // The camera is at [1, 2, 3]; the player at [10, 0] faces back toward it: atan2(2, -9).
  expect(result.current.script?.holds?.[0].heading).toBeCloseTo(167.471, 2)
})

it('faceCamera on a player with no state errors and leaves the hold unchanged', () => {
  const { result } = renderEditor()
  act(() => result.current.create('fresh'))
  act(() => result.current.addHold('gone'))

  act(() => result.current.faceCamera(0))

  expect(result.current.error).toMatch(/not in the film/)
  expect(result.current.script?.holds?.[0].heading).toBeNull()
})

it('setFreeze toggles frozen(i) and the script clock', () => {
  const { result } = renderEditor()
  act(() => result.current.create('fresh'))
  act(() => result.current.addHold('p'))
  expect(result.current.frozen(0)).toBe(false)

  act(() => result.current.setFreeze(0, true))
  expect(result.current.frozen(0)).toBe(true)
  expect(result.current.script?.clock).toEqual({
    startMs: 0,
    rates: [{ s: 0, rate: 1, ease: 'smooth' }, { s: 1000, rate: 0, ease: 'cut' }],
  })

  act(() => result.current.setFreeze(0, false))
  expect(result.current.frozen(0)).toBe(false)
  expect(result.current.script?.clock).toBeUndefined()
})

it('a hold edit during a preview re-starts the script on the camera at the same time', async () => {
  vi.mocked(fetchCameraScript).mockResolvedValue(HOLD_SCRIPT)
  const { result } = renderEditor()
  await act(async () => {
    await result.current.open('intro')
  })
  act(() => result.current.goToKey(1))
  expect(scriptPlayback()?.sMs).toBe(1000)

  act(() => result.current.updateHold(0, { clip: 'mp:intro_emote:b' }))

  const pb = scriptPlayback()
  expect(pb?.sMs).toBe(1000)
  expect(pb?.script.holds?.[0].clip).toBe('mp:intro_emote:b')
  expect(result.current.script?.holds?.[0].clip).toBe('mp:intro_emote:b')
})

it('when the page stops at the script end the cursor takes the length', async () => {
  const setPlaying = vi.fn()
  const { args, result, rerender } = renderEditor({ setPlaying })
  await act(async () => {
    await result.current.open('intro')
  })
  act(() => result.current.play())
  expect(setPlaying).toHaveBeenCalledWith(true)
  args.playing = true
  rerender()
  // The playback loop reaches the end: script time at the length, playing false, script still set.
  setScriptPlaybackTime(1000)
  args.playing = false
  rerender()

  expect(scriptPlayback()).not.toBeNull()
  expect(result.current.cursorMs).toBe(1000)
})
