// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * sessionCacheDebug3d.ts — a dev-only `window.__it3dCacheDebug` hook for live introspection of the
 * session cache. Call it from the devtools console with a cache key (the same string the "hit"/
 * "miss" console logs show, e.g. "map:/api/matches/<id>/mesh.glb") to see the top 20 resources
 * counted inside that entry, by estimated bytes. Call it with no argument to list the keys
 * currently cached. Never installed in a production build.
 */
import * as THREE from 'three'

import { sessionAssetCache } from './sessionAssetCache3d'
import { debugSurfaceModelBreakdown, type DebugResourceEntry } from './sessionResourceBytes3d'

/** A cached entry that has a scene root `debugSurfaceModelBreakdown` can walk (map or layer model). */
interface RootedEntry {
  root: THREE.Object3D
}

function hasRoot(value: unknown): value is RootedEntry {
  return typeof value === 'object' && value !== null && (value as RootedEntry).root instanceof THREE.Object3D
}

/**
 * installCacheDebugHook: defines `window.__it3dCacheDebug(key?)`. With a key, logs and returns the
 * top 20 resources (geometry/texture) counted for that cache entry — kind, bytes, dimensions, depth,
 * format, type and use count. Without one, logs and returns the list of currently cached keys.
 * Uses `peek`/`debugEntries`, neither of which touches LRU order or logs a hit/miss, so calling this
 * never perturbs what the live bug (Streets' map sizing) is being observed under.
 */
export function installCacheDebugHook(): void {
  if (typeof window === 'undefined') return
  const hook = (key?: string): DebugResourceEntry[] | { key: string; bytes: number; refCount: number }[] => {
    if (!key) {
      const entries = sessionAssetCache.debugEntries()
      console.info('it3d cache debug: no key given, pass one of these to __it3dCacheDebug(key):', entries)
      return entries
    }
    const value = sessionAssetCache.peek<unknown>(key)
    if (value === undefined) {
      console.warn('it3d cache debug: no entry cached for', key)
      return []
    }
    if (!hasRoot(value)) {
      console.warn('it3d cache debug: entry for', key, 'has no scene root (not a map/layer model)')
      return []
    }
    const top = debugSurfaceModelBreakdown(value.root, 20)
    console.table(top)
    return top
  }
  ;(window as unknown as { __it3dCacheDebug: typeof hook }).__it3dCacheDebug = hook
}
