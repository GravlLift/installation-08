// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * freeFly3d.ts — THE FREE CAMERA'S KEYBOARD FLIGHT. Keys are read by their PLACE on the
 * keyboard (`KeyboardEvent.code`): W A S D on QWERTY, Z Q S D on AZERTY. Forward/back follow
 * the aim (you fly, you don't walk), left/right strafe horizontally, E rises and Q (A on
 * AZERTY) descends, Shift speeds up. The camera and the orbit's target point glide together:
 * the mouse keeps the rotation around it and the wheel the zoom.
 *
 * None of these keys are taken by the player (`useReplayShortcuts`: space, J K L, F, M, R,
 * arrows, zoom).
 */
import * as THREE from 'three'

/** Speed in game units per second (1 u ~ 3 m), and its multiplier under Shift. */
const SPEED = 4
const BOOST = 3
// Beyond this, the frame skipped (hidden tab, loading): lost time is not caught up.
const MAX_STEP_S = 0.1

/** Movement axis per key: [forward, right, up]. */
const AXES: Readonly<Record<string, readonly [number, number, number]>> = {
  KeyW: [1, 0, 0],
  KeyS: [-1, 0, 0],
  KeyD: [0, 1, 0],
  KeyA: [0, -1, 0],
  KeyE: [0, 0, 1],
  KeyQ: [0, 0, -1],
}

/** flyDelta returns the movement of one `dt`-second step for the held keys, null with no key. */
export function flyDelta(held: ReadonlySet<string>, forward: THREE.Vector3, dt: number, boost: boolean): THREE.Vector3 | null {
  let f = 0
  let r = 0
  let u = 0
  for (const code of held) {
    const a = AXES[code]
    if (!a) continue
    f += a[0]
    r += a[1]
    u += a[2]
  }
  if (f === 0 && r === 0 && u === 0) return null
  const ahead = forward.clone().normalize()
  const right = new THREE.Vector3().crossVectors(ahead, THREE.Object3D.DEFAULT_UP)
  if (right.lengthSq() > 1e-9) right.normalize()
  const move = ahead.multiplyScalar(f).addScaledVector(right, r).addScaledVector(THREE.Object3D.DEFAULT_UP, u)
  if (move.lengthSq() < 1e-12) return null
  return move.normalize().multiplyScalar(SPEED * (boost ? BOOST : 1) * Math.min(dt, MAX_STEP_S))
}

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)
}

/** FreeFly holds the keyboard state; `step` moves the free camera on every frame. */
export class FreeFly {
  private readonly held = new Set<string>()
  private shift = false
  private last = 0

  private readonly onDown = (e: KeyboardEvent) => {
    this.shift = e.shiftKey
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || !AXES[e.code]) return
    this.held.add(e.code)
  }

  private readonly onUp = (e: KeyboardEvent) => {
    this.shift = e.shiftKey
    this.held.delete(e.code)
  }

  // A key released outside the window never bubbles up: release everything.
  private readonly onBlur = () => this.held.clear()

  constructor() {
    window.addEventListener('keydown', this.onDown)
    window.addEventListener('keyup', this.onUp)
    window.addEventListener('blur', this.onBlur)
  }

  /** step glides `camera` and `target` together per the keys held since the previous frame. */
  step(camera: THREE.Camera, target: THREE.Vector3, nowMs: number): void {
    const dt = this.last === 0 ? 0 : (nowMs - this.last) / 1000
    this.last = nowMs
    const d = flyDelta(this.held, camera.getWorldDirection(new THREE.Vector3()), dt, this.shift)
    if (!d) return
    camera.position.add(d)
    target.add(d)
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onDown)
    window.removeEventListener('keyup', this.onUp)
    window.removeEventListener('blur', this.onBlur)
  }
}
