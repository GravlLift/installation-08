// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * eventLoopYield.ts — YIELDING TO THE EVENT LOOP WITHOUT GETTING THROTTLED.
 *
 * # THE TRAP, MEASURED RATHER THAN ASSUMED (2026-08-28)
 *
 * A long computation loop must yield between two batches, or the tab freezes. The obvious
 * move — `await new Promise(r => setTimeout(r, 0))` — is a TRAP as soon as the tab goes to the
 * background, which is exactly what a user does during an export lasting several minutes.
 *
 * Measurement taken in the replay tab, `document.hidden === true`, 20 draws each:
 *
 * | Primitive         | Average latency | Worst case |
 * |-------------------|------------------|------------|
 * | `setTimeout(…, 0)`| 673.53 ms        | 1009 ms    |
 * | `MessageChannel`  | 0.06 ms          | 1 ms       |
 *
 * Browsers throttle hidden tabs' timers to one second. `requestAnimationFrame` is worse
 * still: it does NOT FIRE AT ALL as long as the tab isn't visible. A `MessageChannel`
 * message, on the other hand, is not a timer: it is a task, and tasks are not throttled.
 *
 * WHAT THIS ACTUALLY COST: the first test export — 30 frames on a test canvas — took 10.2
 * seconds, ten times the real-time length of what it was encoding. All of that time was spent
 * in backpressure waits. With this primitive, the same wait is free.
 *
 * # WHY A MODULE, FOR SO FEW LINES
 *
 * Two consumers: the encoder's backpressure (`replayVideoEncoder.ts`) and the export loop
 * itself (`useReplayExport.ts`). Copying the move into both would guarantee that one of them
 * turns back into a `setTimeout` on the next distracted edit — and the throttling does NOT
 * show up in development, where the tab stays in the foreground.
 */

/**
 * yieldToEvents yields to the event loop for one task, without throttling.
 *
 * Falls back to `setTimeout` where `MessageChannel` doesn't exist (old jsdom, test
 * environments): the fallback is throttled, but a test does not run in a hidden tab.
 */
export function yieldToEvents(): Promise<void> {
  if (typeof MessageChannel !== 'function') {
    return new Promise((resolve) => setTimeout(resolve, 0))
  }
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      // BOTH PORTS ARE CLOSED: a channel left open per wait, across eighteen thousand
      // frames, would hold eighteen thousand port pairs until garbage collection.
      channel.port1.close()
      channel.port2.close()
      resolve()
    }
    channel.port2.postMessage(0)
  })
}
