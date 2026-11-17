// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * topDownInput3d.ts — the pointer and key gestures of the top-down view, on the scene's canvas:
 * the wheel zooms toward the cursor, a drag pans, a double click or the `0` key goes back to the
 * whole map (and to following the followed player). Listened to only while the top-down view draws;
 * the math is `topDownNavLogic`.
 */
import { isEditableTarget } from '@/lib/dom/editableTarget'

import { wheelFactor } from './topDownNavLogic'

/** What the gestures ask of the view. */
export interface TopDownGestures {
  /** Zoom by `factor` toward the canvas point (`x`, `y`, CSS px). */
  zoom(x: number, y: number, factor: number): void
  /** Pan by a drag of (`dx`, `dy`) CSS px. */
  pan(dx: number, dy: number): void
  /** Back to the whole map. */
  reset(): void
}

/** The key that goes back to the whole map, as on the 2D replay's framing (`useReplayShortcuts`). */
const RESET_KEY = '0'

export class TopDownInput {
  /** True while the top-down view draws: the gestures are the view's. */
  active = false
  private readonly canvas: HTMLElement
  private readonly gestures: TopDownGestures
  private drag: { id: number; x: number; y: number } | null = null

  constructor(canvas: HTMLElement, gestures: TopDownGestures) {
    this.canvas = canvas
    this.gestures = gestures
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    canvas.addEventListener('pointerdown', this.onDown)
    canvas.addEventListener('pointermove', this.onMove)
    canvas.addEventListener('pointerup', this.onUp)
    canvas.addEventListener('pointercancel', this.onUp)
    canvas.addEventListener('dblclick', this.onDoubleClick)
    window.addEventListener('keydown', this.onKey)
  }

  dispose(): void {
    const c = this.canvas
    c.removeEventListener('wheel', this.onWheel)
    c.removeEventListener('pointerdown', this.onDown)
    c.removeEventListener('pointermove', this.onMove)
    c.removeEventListener('pointerup', this.onUp)
    c.removeEventListener('pointercancel', this.onUp)
    c.removeEventListener('dblclick', this.onDoubleClick)
    window.removeEventListener('keydown', this.onKey)
  }

  private point(e: MouseEvent): [number, number] {
    const box = this.canvas.getBoundingClientRect()
    return [e.clientX - box.left, e.clientY - box.top]
  }

  private readonly onWheel = (e: WheelEvent) => {
    if (!this.active) return
    e.preventDefault()
    const [x, y] = this.point(e)
    // Line and page deltas (some mice, Firefox) are counted as a 100 px notch.
    const delta = e.deltaMode === 0 ? e.deltaY : Math.sign(e.deltaY) * 100
    this.gestures.zoom(x, y, wheelFactor(delta))
  }

  private readonly onDown = (e: PointerEvent) => {
    if (!this.active || e.button !== 0 || e.altKey) return
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY }
    this.canvas.setPointerCapture?.(e.pointerId)
  }

  private readonly onMove = (e: PointerEvent) => {
    const d = this.drag
    if (!d || d.id !== e.pointerId) return
    if (!this.active) {
      this.drag = null
      return
    }
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (dx === 0 && dy === 0) return
    d.x = e.clientX
    d.y = e.clientY
    this.gestures.pan(dx, dy)
  }

  private readonly onUp = (e: PointerEvent) => {
    if (this.drag?.id !== e.pointerId) return
    this.drag = null
    this.canvas.releasePointerCapture?.(e.pointerId)
  }

  private readonly onDoubleClick = () => {
    if (this.active) this.gestures.reset()
  }

  private readonly onKey = (e: KeyboardEvent) => {
    if (!this.active || e.key !== RESET_KEY || e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target)) return
    e.preventDefault()
    this.gestures.reset()
  }
}
