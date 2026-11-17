// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * exportLayoutStore.ts — THE EXPORT LAYOUT CURRENTLY IN EFFECT, shared between the export loop
 * (outside React) and the canvas's framing (`useReplayView`, inside React).
 *
 * # WHY A MODULE-LEVEL STORE (replaces `exportRenderScale`, 2026-09-16)
 *
 * The old oversampling was only a FACTOR read when sizing the backing store: a mutable object
 * was enough. Rendering at the target format changes the GEOMETRY — drawing width and height,
 * hence the scene's frame, the projection, the baked layers and every layer tied to
 * `canvasView`. All of that is memoized in React: it needs a re-render, hence a store that
 * `useReplayView` subscribes to (`useSyncExternalStore`). Passing it down as a prop would
 * cross `ReplayCanvas`, which is already at its size ceiling.
 *
 * # REQUESTED / APPLIED: WHY TWO VALUES
 *
 * The export loop REQUESTS a layout, then must not paint its first frame until React has
 * APPLIED it — rendered, baked the static layers, republished `draw`. `useReplayView` signals
 * this from an effect; the same component's effects that follow (baking the layers,
 * publishing `draw`) run in the same pass, before the loop regains control. Pixel density
 * follows the APPLIED value: this way the backing store and the baked layers only change
 * density together with the geometry that goes with it.
 *
 * ONE REPLAY CANVAS PER PAGE: that was already the old module-level factor's assumption.
 */
import { useEffect, useSyncExternalStore } from 'react'

import { yieldToEvents } from './eventLoopYield'
import type { ExportFormat, ExportLayout } from './exportFormats'

let requested: ExportLayout | null = null
let applied: ExportLayout | null = null
const listeners = new Set<() => void>()

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function snapshot(): ExportLayout | null {
  return requested
}

/**
 * requestExportLayout — sets (or clears, `null`) the export layout. The only writer: the
 * export loop, which clears it in a `finally` on every path.
 */
export function requestExportLayout(layout: ExportLayout | null): void {
  requested = layout
  for (const fn of listeners) fn()
}

/** The requested export layout, with a re-render on every change. */
export function useExportLayout(): ExportLayout | null {
  const layout = useSyncExternalStore(subscribe, snapshot, snapshot)
  // THE APPLICATION ACKNOWLEDGMENT, after the commit of the render that read this value (see the header).
  useEffect(() => {
    applied = layout
  }, [layout])
  return layout
}

/** The requested layout (`null` outside an export): its identity marks ONE export. */
export function exportLayoutRequested(): ExportLayout | null {
  return requested
}

function activeSnapshot(): boolean {
  return requested !== null
}

/**
 * useExportActive — a re-render on entering and leaving each export, WITHOUT acknowledging
 * application (that is `useExportLayout`'s role, held by the framing). Used by memos that
 * depend on the theme: the export's inks are the dark theme's (see `themeInk.ts`).
 */
export function useExportActive(): boolean {
  return useSyncExternalStore(subscribe, activeSnapshot, activeSnapshot)
}

/**
 * isExportActive — does an export hold the canvas? TRUE FROM THE REQUEST ONWARD, even before
 * React applies it: this is what non-React gestures (hover, see `hoverLayers.ts`) read in
 * order to go silent during `prepare` and `encode` (decision D7).
 */
export function isExportActive(): boolean {
  return requested !== null
}

/** Is the requested layout the one the canvas has already taken on? */
export function isExportLayoutApplied(): boolean {
  return applied === requested
}

/**
 * canvasPixelRatio — the density the canvas and its baked layers render at: the applied
 * export layout's, otherwise the screen's. DURING AN EXPORT, `devicePixelRatio` PLAYS NO PART
 * ANYWHERE: that is what makes the file identical from one machine to another.
 */
export function canvasPixelRatio(): number {
  return applied ? applied.pixelRatio : window.devicePixelRatio || 1
}

/**
 * The delay past which a requested layout never applied is a failure. In practice it applies
 * on the first return to the event loop (a synchronous React render); without a mounted
 * canvas, it will never apply, and the export must say so rather than wait.
 */
export const EXPORT_LAYOUT_TIMEOUT_MS = 5000

/**
 * waitForExportLayout — returns control once the canvas is REALLY at the target format:
 * layout applied by React, then the backing store resized, proven by a draw at exactly
 * `format.width` x `format.height`.
 *
 * THE BACKING STORE'S SIZE IS THE PROOF, NOT AN ASSUMPTION: the encoder is configured to the
 * format, and a canvas of a different size would be cropped or rejected. Throws after
 * `EXPORT_LAYOUT_TIMEOUT_MS` — the export loop turns that into a displayed failure.
 */
export async function waitForExportLayout(
  canvas: HTMLCanvasElement,
  format: ExportFormat,
  redraw: () => void,
): Promise<void> {
  const deadline = performance.now() + EXPORT_LAYOUT_TIMEOUT_MS
  for (;;) {
    if (isExportLayoutApplied()) {
      redraw()
      if (canvas.width === format.width && canvas.height === format.height) return
    }
    if (performance.now() > deadline) {
      throw new Error(
        `Export layout was not applied (canvas ${canvas.width}x${canvas.height}, expected ${format.width}x${format.height})`,
      )
    }
    await yieldToEvents()
  }
}
