// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * loadGate3d.ts — A SCENE'S COUNT OF LOADS IN PROGRESS.
 *
 * Each lazy loader (weapon models, armor, arms) registers its promise here; the loading screen
 * waits for the count to drop back to zero before showing the scene.
 */

/**
 * LoadGate: `track` counts a promise without changing its outcome; `idle` resolves once the
 * count has stayed at zero for a macrotask (a load that chains another after it is covered),
 * or at the `timeoutMs` deadline (`timedOut`). An aborted signal resolves with no deadline.
 */
export class LoadGate {
  pending = 0
  started = 0
  finished = 0
  private listeners = new Set<() => void>()

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  track<T>(promise: Promise<T>): Promise<T> {
    this.started++
    this.pending++
    this.listeners.forEach((notify) => notify())
    const finish = () => { this.pending--; this.finished++; this.listeners.forEach((notify) => notify()) }
    promise.then(finish, finish)
    return promise
  }

  idle(timeoutMs: number, signal?: AbortSignal): Promise<{ timedOut: boolean }> {
    return new Promise((resolve) => {
      let idleTimer: ReturnType<typeof setTimeout> | undefined
      let done = false
      const finish = (timedOut: boolean) => {
        if (done) return
        done = true
        clearTimeout(timeout)
        clearTimeout(idleTimer)
        this.listeners.delete(check)
        signal?.removeEventListener('abort', abort)
        resolve({ timedOut })
      }
      const check = () => {
        clearTimeout(idleTimer)
        if (!this.pending) idleTimer = setTimeout(() => { if (!this.pending) finish(false) }, 0)
      }
      const abort = () => finish(false)
      const timeout = setTimeout(() => finish(true), Math.max(0, timeoutMs))
      this.listeners.add(check)
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
      else check()
    })
  }
}
