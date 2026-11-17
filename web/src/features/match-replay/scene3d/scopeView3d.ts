// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * scopeView3d.ts — 1ST-PERSON ZOOM on the scene side: the camera's field of view and the arms
 * when the scope is mounted. The MAGNIFICATION comes from `model/scopeLogic` (a pure function
 * of the frame); this module only sets the field of view, and only recomputes the projection
 * matrix when it changes.
 */
import * as THREE from 'three'

import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import { zoomAt, zoomedFov, type ScopeSpec } from '../model/scopeLogic'

/**
 * ScopeView3d carries the base field of view and the last one set: outside 1st person, the
 * field of view returns to the base, and the scope is always folded there.
 */
export class ScopeView3d {
  private baseFov: number
  private lastFov: number
  /** The scope is mounted as of the last frame set (`appliquer`): the arms are removed from the screen. */
  montee = false

  constructor(baseFov: number) {
    this.baseFov = baseFov
    this.lastFov = baseFov
  }

  /**
   * appliquer sets the camera's field of view for frame `frame` (the zoom's effective
   * magnification) and says whether the arms must leave the screen: a scope or the Bandit
   * sight mounted past half the smoothing replaces the weapon; a smart-link keeps it.
   */
  appliquer(camera: THREE.PerspectiveCamera, doc: ReplayDocumentReady, xuid: string, frame: number, spec: ScopeSpec, mags: number[] | null): boolean {
    const zoom = zoomAt(doc, xuid, frame, spec, mags)
    const fov = zoom.mag > 1 ? zoomedFov(this.baseFov, zoom.mag) : this.baseFov
    this.poseFov(camera, fov)
    this.montee = spec.kind !== 'smartLink' && zoom.amount > 0.5
    return this.montee
  }

  /** changerBase changes the base field of view (the game's FOV setting) and resets the camera's field of view. */
  changerBase(camera: THREE.PerspectiveCamera, baseFov: number): void {
    if (baseFov === this.baseFov) return
    this.baseFov = baseFov
    this.poseFov(camera, baseFov)
  }

  /** reposer restores the base field of view (third-person or free camera mode) and folds the scope. */
  reposer(camera: THREE.PerspectiveCamera): void {
    this.montee = false
    this.poseFov(camera, this.baseFov)
  }

  private poseFov(camera: THREE.PerspectiveCamera, fov: number): void {
    if (Math.abs(fov - this.lastFov) < 0.0001) return
    this.lastFov = fov
    camera.fov = fov
    camera.updateProjectionMatrix()
  }
}
