// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * perf3d.ts — User Timing measures of the 3D scene's load, named `it3d:<step>`: the map and variant
 * downloads, the GLB parse, each KTX2 transcode and meshopt decode, the materials, the merge, the ray
 * index. DevTools' Performance panel shows them on the Timings track; a script reads them with
 * `performance.getEntriesByType('measure')`. A measure costs one entry and never throws.
 */

/** now is the clock the measures are taken on. */
export function now(): number {
  return performance.now()
}

/** mark records a point-in-time User Timing mark `it3d:<name>` (an event, not a duration — a warm
 *  load's session-cache hit, so the lead's load-time harness can tell it apart from a cold one). */
export function mark(name: string, detail?: unknown): void {
  try {
    performance.mark(`it3d:${name}`, { detail })
  } catch {
    // A mark is a diagnostic: an environment without User Timing loads the same.
  }
}

/** measureSince records `it3d:<name>` from `start` (a `now()` reading) to now. */
export function measureSince(name: string, start: number, detail?: unknown): void {
  try {
    performance.measure(`it3d:${name}`, { start, end: performance.now(), detail })
  } catch {
    // A measure is a diagnostic: an environment without User Timing loads the same.
  }
}

/** measureDuration records `it3d:<name>` of `durationMs` ending now (for accumulated parts of a phase). */
export function measureDuration(name: string, durationMs: number): void {
  try {
    const end = performance.now()
    performance.measure(`it3d:${name}`, { start: end - durationMs, duration: durationMs })
  } catch {
    // A measure is a diagnostic: an environment without User Timing loads the same.
  }
}

/** timed runs `run` and records `it3d:<name>` over its whole duration, failed or not. */
export async function timed<T>(name: string, run: () => Promise<T>): Promise<T> {
  const start = now()
  try {
    return await run()
  } finally {
    measureSince(name, start)
  }
}

/** timedSync is `timed` for synchronous work. */
export function timedSync<T>(name: string, run: () => T): T {
  const start = now()
  try {
    return run()
  } finally {
    measureSince(name, start)
  }
}

/** `requestIdleCallback`'s own type, not declared in this project's lib target. */
interface IdleWindow {
  requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number
}

/**
 * runWhenIdle runs `fn` off the main thread's busy stretch (`requestIdleCallback`, falling back to
 * `setTimeout(fn, 0)` where it is not available), for work that must never push back a load's first
 * frame: packing the session's freshly built ray index for upload (`bvhCache.serializeBVHCache`) is
 * itself real main-thread work, so it runs here, after the scene is shown, never before. A generous
 * timeout (2 s) keeps it from being starved indefinitely on a busy page.
 */
export function runWhenIdle(fn: () => void): void {
  const w = globalThis as unknown as IdleWindow
  if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(fn, { timeout: 2000 })
  else setTimeout(fn, 0)
}
