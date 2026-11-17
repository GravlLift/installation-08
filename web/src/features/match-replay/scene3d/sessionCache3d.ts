/**
 * sessionCache3d.ts — a generic, byte-capped LRU cache for GPU-backed 3D resources (the parsed map,
 * a variant layer, a model library) that should outlive one match: the second match on the same map,
 * or reopening a map, finds its resources already decoded and uploaded instead of paying for them
 * again.
 *
 * One entry per key (the server's own identity for the build: a map's served path, a variant's, a
 * model library's base folder). `acquire`/`release` pin an entry while a live scene still points at
 * it: a pinned entry is never evicted, even over the cap, because disposing a geometry or texture a
 * live mesh still draws would show as missing or crash the next frame. Eviction only ever removes
 * the least recently touched UNPINNED entries, oldest first, until the total is back under the cap.
 *
 * `dispose` is this module's own responsibility: once an entry is evicted (or `clear()` runs), it is
 * the only place that frees its geometries, materials and textures — callers must never dispose a
 * cached value themselves after handing it to `set`.
 */

/** The byte cap started with, before the lead's load-time harness calibrates it from real sessions. */
export const DEFAULT_CACHE_CAP_BYTES = 1.5 * 1024 ** 3 // 1.5 GB

/** What `set` is given: the resource, its estimated GPU/CPU footprint, and how to free it. */
export interface CacheEntryInit<T> {
  value: T
  /** Estimated bytes (geometry attributes + index, plus texture texels with mip overhead). */
  bytes: number
  /** Frees the resource's geometries, materials and textures; never called while pinned. */
  dispose: (value: T) => void
}

interface Entry {
  value: unknown
  bytes: number
  dispose: (value: unknown) => void
  refCount: number
}

/**
 * SessionCache3d: one byte-capped LRU map, generic over the kind of resource (callers tag keys by
 * kind, e.g. `map:<path>`, `layer:<path>`, `armor-lib:<path>`, so one instance serves every kind
 * under one shared budget, as the session's resources compete for the same memory).
 */
export class SessionCache3d {
  private readonly entries = new Map<string, Entry>()
  private totalBytesHeld = 0
  private readonly capBytes: number
  private readonly label: string

  constructor(capBytes: number = DEFAULT_CACHE_CAP_BYTES, label = 'it3d:session-cache') {
    this.capBytes = capBytes
    this.label = label
  }

  /** The cache's current estimated footprint (bytes), the sum of every entry still held. */
  get totalBytes(): number {
    return this.totalBytesHeld
  }

  /** The number of entries currently held (pinned or not). */
  get size(): number {
    return this.entries.size
  }

  /** has: whether `key` is in the cache right now, without affecting its LRU order. */
  has(key: string): boolean {
    return this.entries.has(key)
  }

  /** peek: like `get`, but touches nothing and logs nothing — for debug tooling only (`window.__it3dCacheDebug`). */
  peek<T>(key: string): T | undefined {
    return this.entries.get(key)?.value as T | undefined
  }

  /** debugEntries: every key with its estimated bytes and pin count, for debug tooling only. */
  debugEntries(): { key: string; bytes: number; refCount: number }[] {
    return [...this.entries].map(([key, entry]) => ({ key, bytes: entry.bytes, refCount: entry.refCount }))
  }

  /** get: the cached value for `key` (touches it as most-recently-used), or undefined on a miss. */
  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) {
      this.log('miss', key)
      return undefined
    }
    this.touch(key, entry)
    this.log('hit', key, entry.bytes)
    return entry.value as T
  }

  /**
   * set: stores `init.value` under `key` (replacing and disposing whatever was there, unless it is
   * the very value already held), then evicts unpinned entries, oldest first, until the cap holds.
   * The new entry starts unpinned; call `acquire` right after if the caller is about to use it.
   *
   * An entry bigger than the whole cap on its own is a special case: the normal eviction loop
   * below removes unpinned entries oldest-first until the total fits, but the entry just inserted
   * is itself the newest and still unpinned at this point, so on a strict "oldest first" walk it
   * would eventually evict ITSELF too, right after being stored — leaving the cache empty even
   * though the resource is still in use. Such an entry is kept alone instead (every OTHER entry
   * evicted, this one kept) and logged distinctly, since it is either a genuinely huge resource or
   * (more likely) a wrong byte estimate worth noticing rather than silently clearing the cache.
   */
  set<T>(key: string, init: CacheEntryInit<T>): void {
    const previous = this.entries.get(key)
    const sameValue = !!previous && previous.value === init.value
    if (previous && !sameValue) {
      this.totalBytesHeld -= previous.bytes
      this.disposeEntry(key, previous)
    }
    const entry: Entry = {
      value: init.value,
      bytes: init.bytes,
      dispose: init.dispose as (value: unknown) => void,
      refCount: sameValue ? previous.refCount : 0,
    }
    if (init.bytes > this.capBytes) {
      for (const [otherKey, other] of this.entries) {
        if (otherKey === key) continue
        this.entries.delete(otherKey)
        this.totalBytesHeld -= other.bytes
        this.disposeEntry(otherKey, other)
      }
      this.entries.delete(key)
      this.entries.set(key, entry)
      this.totalBytesHeld = init.bytes
      console.warn(`${this.label}: ${key} (${init.bytes} B) alone exceeds the cap (${this.capBytes} B) — keeping it cached alone, evicting everything else`)
      return
    }
    this.entries.delete(key)
    this.entries.set(key, entry)
    this.totalBytesHeld += sameValue ? init.bytes - previous.bytes : init.bytes
    this.evictOverCap()
  }

  /** acquire: pins `key` (one more live user); a pinned entry is never evicted. No-op on a miss. */
  acquire(key: string): void {
    const entry = this.entries.get(key)
    if (entry) entry.refCount++
  }

  /** release: unpins one use of `key`; at zero it becomes evictable again. No-op on a miss or at zero. */
  release(key: string): void {
    const entry = this.entries.get(key)
    if (entry && entry.refCount > 0) {
      entry.refCount--
      this.evictOverCap()
    }
  }

  /** clear: disposes and drops every entry (pinned or not) — only for teardown (tests, a dev reload). */
  clear(): void {
    for (const [key, entry] of this.entries) this.disposeEntry(key, entry)
    this.entries.clear()
    this.totalBytesHeld = 0
  }

  private touch(key: string, entry: Entry): void {
    this.entries.delete(key)
    this.entries.set(key, entry)
  }

  private evictOverCap(): void {
    if (this.totalBytesHeld <= this.capBytes) return
    for (const [key, entry] of this.entries) {
      if (this.totalBytesHeld <= this.capBytes) break
      if (entry.refCount > 0) continue
      this.entries.delete(key)
      this.totalBytesHeld -= entry.bytes
      this.disposeEntry(key, entry)
    }
  }

  private disposeEntry(key: string, entry: Entry): void {
    try {
      entry.dispose(entry.value)
    } catch (err) {
      console.warn(`${this.label}: eviction dispose failed`, key, err)
      return
    }
    this.log('evict', key, entry.bytes)
  }

  private log(kind: 'hit' | 'miss' | 'evict', key: string, bytes = 0): void {
    console.info(`${this.label}: ${kind} ${key}${bytes ? ` (${bytes} B)` : ''} — ${this.entries.size} entries, ${this.totalBytesHeld} / ${this.capBytes} B`)
  }
}
