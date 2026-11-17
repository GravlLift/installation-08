// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useReplayShortcuts — THE PLAYER'S KEYBOARD (user request of 2026-08-27).
 *
 * THE SHORTCUTS ARE THE ONES EVERYONE ALREADY KNOWS, and not one more: Space and K for
 * play/pause, ←/→ and J/L for ±10 s, M for sound, R to restart, "," and "." for frame by
 * frame, F for fullscreen; for framing, + / − to zoom in and out, 0 for the whole map,
 * Shift + arrow to pan. Inventing a house convention would make the viewer learn what they
 * already know.
 *
 * IT DOES NOT STEAL KEYSTROKES: a shortcut never fires from an input field, a
 * `contenteditable`, nor with a modifier (Ctrl/Cmd/Alt) — otherwise Space in a search box
 * would pause the replay, and Cmd+R would reload AND rewind.
 *
 * ...EXCEPT FROM THE PLAYER'S TIMELINE, AND THAT IS A USER DECISION (gate of 2026-08-28).
 * An `input[type=range]` is an input field to the browser: the guard above used to catch
 * it, and the shortcuts DIED as soon as you had clicked the timeline — that is, exactly at
 * the moment one is analyzing a match. Space stopped responding, ←/→ advanced by ONE frame
 * (the field's native step) instead of jumping 10 s. The exemption is carried by an
 * ATTRIBUTE (`data-replay-timeline`) and not by a type check: it targets THAT field
 * specifically, not the family.
 *
 * VOLUME, ON THE OTHER HAND, STAYS AN INPUT FIELD — it is the same HTML element, and that is
 * why the exemption had to be nominative: whoever just clicked volume and presses ← expects
 * the volume to go down, not the film to jump ten seconds.
 *
 * `preventDefault` IS ONLY CALLED ON THE KEYS WE HANDLE, and that is what removes the
 * double step: on the focused timeline, ←/→ would do OUR jump PLUS the field's native step.
 */
import { useEffect, useRef } from 'react'
import { isEditableTarget } from '@/lib/dom/editableTarget'
import type { CameraMode3d } from '../scene3d/replayScene3d'

/**
 * THE ATTRIBUTE THAT GIVES KEYSTROKES BACK TO THE TIMELINE. It is set by
 * `ReplayTimelineTracks` on the one field it concerns and read here — the link between the
 * two is the fragile piece of this mechanism, it has its safeguard in
 * `ReplayTimelineTracks.test.tsx`.
 */
export const TIMELINE_SHORTCUT_ATTR = 'data-replay-timeline'

/** What the keyboard commands. Each entry is an already-existing player command. */
export interface ReplayShortcutHandlers {
  togglePlay: () => void
  seekBy: (seconds: number) => void
  stepFrames: (frames: number) => void
  restart: () => void
  toggleSound: () => void
  /** Opens or closes fullscreen mode (useReplayFullscreen): the F key. */
  toggleFullscreen: () => void
  /** Switches the 3D view between the perspective and the orthographic top-down: the key V; absent = the key is not listened to. */
  toggleView?: () => void
  /** Chooses the camera mode: 1 first person, 2 third person, 3 free view (the order of the control bar's segment); absent = the keys are not listened to (the 2D view, where the segment is disabled). */
  setCameraMode?: (mode: CameraMode3d) => void
  /** Seeks to the selected player's previous (-1) or next (1) kill, death or medal: the keys [ and ]; absent = the keys are not listened to. */
  stepEvent?: (direction: -1 | 1) => void
  /** The arrow keys' jump, in seconds (cf. SKIP_SECONDS of the bar). */
  skipSeconds: number
  /** `false` when the page has no replay loaded: nothing is listened to. */
  enabled: boolean
  /**
   * FRAMING (2026-09-02). Absent = framing shortcuts are not listened to.
   *
   * It goes through THIS hook and not through a second listener: two concurrent keyboard
   * listeners on the same keys always end up stepping on each other, and there is only one
   * place here that knows whether the keystroke comes from an input field.
   */
  zoom?: {
    zoomIn: () => void
    zoomOut: () => void
    reset: () => void
    panStep: (dx: number, dy: number) => void
  }
}

/** What a key commands for framing. */
export type ZoomKeyCommand = 'in' | 'out' | 'reset'

/**
 * THE ZOOM KEYS, a single table for the replay and the screens that reuse its zoom (Match
 * View, Tactical: `useReplayZoomKeys`). `=` and `_` come along with `+` and `-`, because `+`
 * and `-` require Shift on many layouts — without them, half the keyboards would have no
 * zoom. `0` resets to the whole map, like the ⌂ button.
 */
export function zoomKeyCommand(key: string): ZoomKeyCommand | null {
  switch (key) {
    case '+':
    case '=':
      return 'in'
    case '-':
    case '_':
      return 'out'
    case '0':
      return 'reset'
    default:
      return null
  }
}

/** Applies a key command to the framing. */
export function applyZoomKey(command: ZoomKeyCommand, zoom: { zoomIn: () => void; zoomOut: () => void; reset: () => void }): void {
  if (command === 'in') zoom.zoomIn()
  else if (command === 'out') zoom.zoomOut()
  else zoom.reset()
}

/**
 * The four arrows, cross-stepped. A positive `dy` goes toward the TOP of the map: the world
 * has its Y pointing up, and it is `worldToCanvas` that carries the inversion — not the
 * command.
 */
const ARROW_PAN: Record<string, [number, number] | undefined> = {
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
}

/** What a key commands for the PLAYER (framing has its own table, `zoomKeyCommand`). */
type PlayerKeyAction =
  | 'play'
  | 'back'
  | 'forward'
  | 'previousFrame'
  | 'nextFrame'
  | 'sound'
  | 'restart'
  | 'fullscreen'
  | 'view'
  | 'cameraFirst'
  | 'cameraThird'
  | 'cameraFree'
  | 'previousEvent'
  | 'nextEvent'

/**
 * THE PLAYER'S KEYS, uppercase included: Caps Lock being on must not disable any shortcut. A
 * `Map` and not an object: a key name must never collide with a property inherited from
 * `Object.prototype`.
 */
const PLAYER_KEYS = new Map<string, PlayerKeyAction>([
  [' ', 'play'], ['k', 'play'], ['K', 'play'],
  ['ArrowLeft', 'back'], ['j', 'back'], ['J', 'back'],
  ['ArrowRight', 'forward'], ['l', 'forward'], ['L', 'forward'],
  [',', 'previousFrame'], ['.', 'nextFrame'],
  ['m', 'sound'], ['M', 'sound'],
  ['r', 'restart'], ['R', 'restart'],
  ['f', 'fullscreen'], ['F', 'fullscreen'],
  ['v', 'view'], ['V', 'view'],
  ['1', 'cameraFirst'], ['2', 'cameraThird'], ['3', 'cameraFree'],
  ['[', 'previousEvent'], [']', 'nextEvent'],
])

/** The camera mode each camera key chooses. */
const CAMERA_KEY_MODE: Partial<Record<PlayerKeyAction, CameraMode3d>> = { cameraFirst: 'fp', cameraThird: 'tp', cameraFree: 'free' }

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  // THE PLAYER'S TIMELINE IS EXEMPTED, AND IT ALONE (cf. the header): the exemption is
  // carried by an attribute, not by a type check — `input[type=range]` would also cover
  // volume, whose arrows must stay native. `hasAttribute` is called optionally: the target of
  // a keyboard event can be `window` or `document`, which have no attribute method.
  if (el.hasAttribute?.(TIMELINE_SHORTCUT_ATTR)) return false
  return isEditableTarget(el)
}

export function useReplayShortcuts(h: ReplayShortcutHandlers): void {
  const { togglePlay, seekBy, stepFrames, restart, toggleSound, toggleFullscreen, toggleView, setCameraMode, stepEvent, skipSeconds, enabled, zoom } = h
  // FRAMING BY REFERENCE, and not as an effect dependency: its object is recreated on every
  // render, and framing changes sixty times a second during playback. As a dependency, the
  // keyboard listener would re-subscribe at that rate. The reference is written inside an
  // effect — never during render, which React reserves for computation.
  const liveZoom = useRef(zoom)
  useEffect(() => {
    liveZoom.current = zoom
  }, [zoom])
  // THE HANDLERS BY REFERENCE TOO: several of them (the event stepper, togglePlay) are rebuilt on
  // every render, and a render happens every frame during playback. With them as effect
  // dependencies the window listener was removed and re-added every frame, and a Space pressed
  // during that churn could be lost (Jordan: "the spacebar plays but doesnt pause"). The
  // listener is now registered once per `enabled` and reads the current handlers at key time.
  const live = useRef({ togglePlay, seekBy, stepFrames, restart, toggleSound, toggleFullscreen, toggleView, setCameraMode, stepEvent, skipSeconds })
  useEffect(() => {
    live.current = { togglePlay, seekBy, stepFrames, restart, toggleSound, toggleFullscreen, toggleView, setCameraMode, stepEvent, skipSeconds }
  })
  useEffect(() => {
    if (!enabled) return
    const camera = (action: PlayerKeyAction) => () => { const mode = CAMERA_KEY_MODE[action]; if (mode) live.current.setCameraMode?.(mode) }
    const actions: Record<PlayerKeyAction, () => void> = {
      play: () => live.current.togglePlay(),
      back: () => live.current.seekBy(-live.current.skipSeconds),
      forward: () => live.current.seekBy(live.current.skipSeconds),
      previousFrame: () => live.current.stepFrames(-1),
      nextFrame: () => live.current.stepFrames(1),
      sound: () => live.current.toggleSound(),
      restart: () => live.current.restart(),
      fullscreen: () => live.current.toggleFullscreen(),
      view: () => live.current.toggleView?.(),
      cameraFirst: camera('cameraFirst'),
      cameraThird: camera('cameraThird'),
      cameraFree: camera('cameraFree'),
      previousEvent: () => live.current.stepEvent?.(-1),
      nextEvent: () => live.current.stepEvent?.(1),
    }
    function onKeyDown(e: KeyboardEvent) {
      const { toggleView, setCameraMode, stepEvent } = live.current
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isTypingTarget(e.target)) return
      // SHIFT + ARROW PANS THE FRAMING, and this short-circuit comes BEFORE the player's
      // keys: bare arrows there mean the time jump, which is the most frequent gesture of a
      // replay and which we do not move. Without the `return`, the same keystroke would do
      // both.
      const z = liveZoom.current
      if (z && e.shiftKey) {
        const p = ARROW_PAN[e.key]
        if (p) {
          e.preventDefault()
          z.panStep(p[0], p[1])
          return
        }
      }
      // KEYBOARD ZOOM: the shared table (`zoomKeyCommand`), before the player's keys.
      const zoomCommand = z ? zoomKeyCommand(e.key) : null
      if (z && zoomCommand) {
        e.preventDefault()
        applyZoomKey(zoomCommand, z)
        return
      }
      // `preventDefault` ON THE ONLY KEYS WE HANDLE (cf. the header): a key outside the table
      // stays with the browser.
      const action = PLAYER_KEYS.get(e.key)
      if (!action) return
      if (action === 'view' && !toggleView) return // no view on this page: the key stays with the browser
      if (CAMERA_KEY_MODE[action] && !setCameraMode) return // no camera choice here: the key stays with the browser
      if ((action === 'previousEvent' || action === 'nextEvent') && !stepEvent) return
      e.preventDefault()
      actions[action]()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
