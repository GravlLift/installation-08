/**
 * loadGate3d.ts — LE COMPTE DES CHARGEMENTS EN COURS D'UNE SCÈNE.
 *
 * Chaque chargeur paresseux (modèles d'armes, armures, bras) y inscrit sa promesse ; l'écran de
 * chargement attend que le compte retombe à zéro avant de montrer la scène.
 */

/**
 * LoadGate : `track` compte une promesse sans changer son issue ; `idle` se résout quand le compte
 * est resté nul le temps d'une macrotâche (un chargement qui en lance un autre à sa suite est
 * couvert), ou à l'échéance `timeoutMs` (`timedOut`). Un signal interrompu résout sans échéance.
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
