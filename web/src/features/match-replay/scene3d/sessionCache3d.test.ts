import { describe, expect, it, vi } from 'vitest'

import { SessionCache3d } from './sessionCache3d'

function silence() {
  return vi.spyOn(console, 'info').mockImplementation(() => undefined)
}

describe('SessionCache3d', () => {
  it('misses on an empty key and hits the same value after set', () => {
    silence()
    const cache = new SessionCache3d(1000)
    expect(cache.get('a')).toBeUndefined()
    const value = { name: 'map-a' }
    const dispose = vi.fn()
    cache.set('a', { value, bytes: 100, dispose })
    expect(cache.get('a')).toBe(value)
    expect(dispose).not.toHaveBeenCalled()
  })

  it('evicts the least recently used unpinned entry first once the cap is exceeded', () => {
    silence()
    const cache = new SessionCache3d(250)
    const disposeA = vi.fn()
    const disposeB = vi.fn()
    const disposeC = vi.fn()
    cache.set('a', { value: 'A', bytes: 100, dispose: disposeA })
    cache.set('b', { value: 'B', bytes: 100, dispose: disposeB })
    // Touch 'a' so it is more recently used than 'b': the next entry over the cap evicts 'b', not 'a'.
    cache.get('a')
    cache.set('c', { value: 'C', bytes: 100, dispose: disposeC })
    expect(disposeB).toHaveBeenCalledTimes(1)
    expect(disposeA).not.toHaveBeenCalled()
    expect(disposeC).not.toHaveBeenCalled()
    expect(cache.has('a')).toBe(true)
    expect(cache.has('b')).toBe(false)
    expect(cache.has('c')).toBe(true)
  })

  it('never evicts a pinned (acquired) entry even over the cap, and evicts it once released and still over cap', () => {
    silence()
    const cache = new SessionCache3d(250)
    const disposeA = vi.fn()
    const disposeB = vi.fn()
    const disposeC = vi.fn()
    const disposeD = vi.fn()
    cache.set('a', { value: 'A', bytes: 100, dispose: disposeA })
    cache.acquire('a') // a live scene still points at it
    cache.set('b', { value: 'B', bytes: 100, dispose: disposeB })
    cache.set('c', { value: 'C', bytes: 100, dispose: disposeC }) // total 300 > 250: evicts the oldest UNPINNED entry
    expect(disposeA).not.toHaveBeenCalled() // pinned: skipped even though it is the oldest
    expect(disposeB).toHaveBeenCalledTimes(1) // the oldest unpinned entry instead
    expect(cache.has('a')).toBe(true)
    expect(cache.has('c')).toBe(true)
    cache.release('a') // unpinned again, but total (200) is not over the cap yet: not evicted by this alone
    expect(disposeA).not.toHaveBeenCalled()
    cache.set('d', { value: 'D', bytes: 100, dispose: disposeD }) // total 300 > 250 again: now 'a' is evictable
    expect(disposeA).toHaveBeenCalledTimes(1)
    expect(cache.has('a')).toBe(false)
  })

  it('does not dispose a shared resource while any user still holds it (balanced acquire/release)', () => {
    silence()
    const cache = new SessionCache3d(250)
    const dispose = vi.fn()
    cache.set('shared', { value: 'S', bytes: 100, dispose })
    cache.acquire('shared')
    cache.acquire('shared') // two live users
    cache.set('x', { value: 'X', bytes: 100, dispose: vi.fn() })
    cache.set('y', { value: 'Y', bytes: 100, dispose: vi.fn() }) // total 300 > 250: 'shared' pinned, 'x' evicted instead
    cache.release('shared') // one user leaves: still pinned (refCount 1)
    expect(dispose).not.toHaveBeenCalled()
    cache.release('shared') // the second user leaves: now unpinned, but total (200) is under the cap
    expect(dispose).not.toHaveBeenCalled()
    cache.set('z', { value: 'Z', bytes: 100, dispose: vi.fn() }) // total 300 > 250: 'shared' is now evictable
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('re-set on an existing key updates its size and reorders it as most recently used', () => {
    silence()
    const cache = new SessionCache3d(1000)
    cache.set('a', { value: 'A', bytes: 100, dispose: vi.fn() })
    cache.set('b', { value: 'B', bytes: 100, dispose: vi.fn() })
    const disposeNewA = vi.fn()
    cache.set('a', { value: 'A2', bytes: 50, dispose: disposeNewA })
    expect(cache.totalBytes).toBe(150) // 50 (a) + 100 (b)
    expect(cache.get('a')).toBe('A2')
  })

  it('clear disposes every entry, pinned or not', () => {
    silence()
    const cache = new SessionCache3d(1000)
    const disposeA = vi.fn()
    cache.set('a', { value: 'A', bytes: 10, dispose: disposeA })
    cache.acquire('a')
    cache.clear()
    expect(disposeA).toHaveBeenCalledTimes(1)
    expect(cache.size).toBe(0)
    expect(cache.totalBytes).toBe(0)
  })

  it('an entry bigger than the whole cap is kept alone instead of evicting itself too', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    silence()
    const cache = new SessionCache3d(250)
    const disposeA = vi.fn()
    const disposeB = vi.fn()
    const disposeHuge = vi.fn()
    cache.set('a', { value: 'A', bytes: 100, dispose: disposeA })
    cache.set('b', { value: 'B', bytes: 100, dispose: disposeB })
    cache.set('huge', { value: 'HUGE', bytes: 10_000, dispose: disposeHuge }) // alone over the cap
    // Every other entry is evicted to make room, but the huge one survives: it never evicts
    // itself right after being stored (the bug this guards against).
    expect(disposeA).toHaveBeenCalledTimes(1)
    expect(disposeB).toHaveBeenCalledTimes(1)
    expect(disposeHuge).not.toHaveBeenCalled()
    expect(cache.has('huge')).toBe(true)
    expect(cache.get('huge')).toBe('HUGE')
    expect(cache.totalBytes).toBe(10_000)
    expect(cache.size).toBe(1)
    expect(warn).toHaveBeenCalled() // logged distinctly, not silently cleared
  })

  it('a dispose that throws during eviction is logged and does not stop the cache from working', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    silence()
    const cache = new SessionCache3d(100)
    cache.set('a', { value: 'A', bytes: 100, dispose: () => { throw new Error('boom') } })
    cache.set('b', { value: 'B', bytes: 100, dispose: vi.fn() })
    expect(warn).toHaveBeenCalled()
    expect(cache.get('b')).toBe('B')
  })
})
