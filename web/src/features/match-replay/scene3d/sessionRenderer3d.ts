// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * sessionRenderer3d.ts — ONE `THREE.WebGLRenderer` for the whole session, not one per match.
 *
 * three.js keeps its most expensive load-time work on the renderer itself: compiled shader programs
 * (`WebGLPrograms`) and uploaded GPU buffers and textures are cached there, keyed by material and
 * geometry, independent of which `THREE.Scene` or `THREE.Camera` draws them. A match that tears down
 * its renderer and makes a new one on the next match throws that cache away and pays the shader
 * compile and GPU upload again even when the map, armor and weapon models are themselves cached
 * (`sessionAssetCache3d`). Keeping the renderer alive and only reattaching its canvas when a 3D view
 * mounts is what lets those caches actually pay off.
 *
 * `attachRenderer` moves the shared canvas into a new host (removing it from wherever it was before,
 * if anywhere); `detachRenderer` removes it without disposing anything, for a 3D view that unmounts
 * but may come back. Only `disposeSessionRenderer` (tests, or a deliberate full reset) frees the
 * context and the shared KTX2 loader.
 */
import * as THREE from 'three'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { installEmissionMarks } from './emissionMark3d'
import { createKtx2Loader } from './ktx2Textures3d'

let renderer: THREE.WebGLRenderer | null = null
let ktx2: KTX2Loader | null = null

/** getSessionRenderer: the session's one WebGLRenderer, created lazily on first use. */
export function getSessionRenderer(): THREE.WebGLRenderer {
  if (!renderer) {
    // Before any program is compiled: three caches built-in programs by parameters, not source.
    installEmissionMarks()
    renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.info.autoReset = false
  }
  return renderer
}

/** getSessionKtx2Loader: the session renderer's one KTX2 loader (`ktx2Textures3d`), made once. */
export function getSessionKtx2Loader(): KTX2Loader {
  ktx2 ??= createKtx2Loader(getSessionRenderer())
  return ktx2
}

/** attachRenderer: moves the shared canvas into `host` (appended last), detaching it from any previous host first. */
export function attachRenderer(host: HTMLElement): THREE.WebGLRenderer {
  const r = getSessionRenderer()
  if (r.domElement.parentElement !== host) host.appendChild(r.domElement)
  return r
}

/** detachRenderer: removes the shared canvas from its host without disposing the renderer or its GPU resources. */
export function detachRenderer(): void {
  renderer?.domElement.remove()
}

/**
 * disposeSessionRenderer: frees the renderer's context and the KTX2 loader, and drops the
 * singletons so the next call to `getSessionRenderer` makes a fresh one. Only for teardown (a test
 * resetting state between cases, or a deliberate full reload); a 3D view that merely unmounts must
 * call `detachRenderer` instead, or the next match pays the shader-compile and GPU-upload cost again.
 */
export function disposeSessionRenderer(): void {
  ktx2?.dispose()
  ktx2 = null
  renderer?.dispose()
  renderer?.domElement.remove()
  renderer = null
}
