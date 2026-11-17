// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * sessionRendererDebug3d.ts — a dev-only `window.__it3dRendererDebug` hook: the shared session
 * renderer's own counters (compiled shader programs, uploaded geometries/textures, draw calls per
 * frame). Called before and after a warm navigation, the diff says whether the warm path reused the
 * renderer's shader-program and GPU-upload caches (as `sessionRenderer3d.ts` is meant to) or paid to
 * recompile/re-upload anyway. Never installed in a production build.
 */
import { getSessionRenderer } from './sessionRenderer3d'

export interface RendererDebugInfo {
  /** Compiled WebGL program count (`WebGLPrograms`) — grows only on a genuinely new shader variant. */
  programs: number
  /** Geometries currently uploaded to the GPU (`renderer.info.memory.geometries`). */
  geometries: number
  /** Textures currently uploaded to the GPU (`renderer.info.memory.textures`). */
  textures: number
  /** Draw calls issued since the last `info.reset()` (`autoReset` is off — see `sessionRenderer3d.ts`). */
  calls: number
}

export function installRendererDebugHook(): void {
  if (typeof window === 'undefined') return
  const hook = (): RendererDebugInfo => {
    const info = getSessionRenderer().info
    return {
      programs: info.programs?.length ?? 0,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      calls: info.render.calls,
    }
  }
  ;(window as unknown as { __it3dRendererDebug: typeof hook }).__it3dRendererDebug = hook
}
