/**
 * scopeView3d.ts — LE ZOOM EN 1re PERSONNE côté scène : le champ de la caméra et les bras quand
 * la lunette est montée. L'AMPLISSÉE vient de `model/scopeLogic` (fonction pure de l'image) ;
 * ce module ne pose que le champ, et ne recompte la matrice de projection que quand il change.
 */
import * as THREE from 'three'

import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import { zoomAt, zoomedFov, type ScopeSpec } from '../model/scopeLogic'

/**
 * ScopeView3d porte le champ de base et le dernier champ posé : hors 1re personne, le champ
 * revient à la base, et la lunette y est toujours repliée.
 */
export class ScopeView3d {
  private baseFov: number
  private lastFov: number
  /** La lunette est montée à la dernière image posée (`appliquer`) : les bras sont retirés de l'écran. */
  montee = false

  constructor(baseFov: number) {
    this.baseFov = baseFov
    this.lastFov = baseFov
  }

  /**
   * appliquer pose le champ de la caméra pour l'image `frame` (amplification effective du zoom)
   * et dit si les bras doivent quitter l'écran : une lunette ou le cadre Bandit monté au-delà
   * de la moitié du lissage remplace l'arme ; un lien intelligent la garde.
   */
  appliquer(camera: THREE.PerspectiveCamera, doc: ReplayDocumentReady, xuid: string, frame: number, spec: ScopeSpec): boolean {
    const zoom = zoomAt(doc, xuid, frame, spec)
    const fov = zoom.mag > 1 ? zoomedFov(this.baseFov, zoom.mag) : this.baseFov
    this.poseFov(camera, fov)
    this.montee = spec.kind !== 'smartLink' && zoom.amount > 0.5
    return this.montee
  }

  /** changerBase change le champ de base (le réglage de champ du jeu) et repose le champ de la caméra. */
  changerBase(camera: THREE.PerspectiveCamera, baseFov: number): void {
    if (baseFov === this.baseFov) return
    this.baseFov = baseFov
    this.poseFov(camera, baseFov)
  }

  /** reposer remet le champ de base (mode tiers ou caméra libre) et replie la lunette. */
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
