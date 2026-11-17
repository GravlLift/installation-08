// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * dropWall3d.ts — THE DROP WALL DRAWN: a translucent energy barrier standing on the 2D arc, its
 * flat panels rising from the ground at deployment and sinking away as it dissolves
 * (`dropWall3d_logic` gives the panels and the phase).
 *
 * Additive and without depth writes: the barrier tints what is behind it and hides nothing, like
 * the game's shield. Its ink is the wall's fixed ink (`inks.wall`, the 2D rule: the wall says what
 * it is, not who placed it); the top edge of each panel carries it brighter.
 */
import * as THREE from 'three'

import { InstancePool, SegmentPool } from './actionKit'
import type { WallPanel, WallPhase } from './dropWall3d_logic'
import { headingQuat } from './equipment3dShapes'
import { toThree } from './tracks3d'

/** Height of the barrier (u): an on-screen choice, about a player's shoulder (~0.69 u). */
const WALL_HEIGHT_U = 0.75
const WALL_THICKNESS_U = 0.02
/** How much of the wall ink the barrier face and its top edge add (additive light). */
const BARRIER_GLOW = 0.3
const EDGE_GLOW = 0.9
const EDGE_RADIUS_U = 0.008

const CAPACITY = 128

export class DropWall3d {
  private readonly faces: InstancePool
  private readonly edges: SegmentPool
  private readonly scratch = { p: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3(), t: new THREE.Vector3(), s: new THREE.Vector3(), face: new THREE.Color(), edge: new THREE.Color() }

  constructor(parent: THREE.Object3D) {
    const glow = (side: THREE.Side) =>
      new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side, toneMapped: false })
    // A panel: a box whose foot is at the origin, width along local X, facing local +Z.
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
    this.faces = new InstancePool(parent, box, glow(THREE.DoubleSide), CAPACITY)
    this.edges = new SegmentPool(parent, glow(THREE.FrontSide), CAPACITY)
  }

  begin(): void {
    this.faces.begin()
    this.edges.begin()
  }

  end(): void {
    this.faces.end()
    this.edges.end()
  }

  dispose(): void {
    this.faces.dispose()
    this.edges.dispose()
  }

  /** wall — the barrier's panels on the ground at height `floorY` (three), at their phase. */
  wall(floorY: number, panels: readonly WallPanel[], phase: WallPhase, color: THREE.Color): void {
    const { p, a, b, t, s, face, edge } = this.scratch
    const fade = 1 - phase.dissolve
    const h = WALL_HEIGHT_U * phase.rise * fade
    if (!(h > 1e-4)) return
    face.copy(color).multiplyScalar(BARRIER_GLOW * fade)
    edge.copy(color).multiplyScalar(EDGE_GLOW * fade)
    for (const panel of panels) {
      const [x, , z] = toThree(panel.x, panel.y, 0)
      p.set(x, floorY, z)
      this.faces.add(p, headingQuat(panel.headingDeg), s.set(panel.width, h, WALL_THICKNESS_U), face)
      // The top edge, along the panel: the horizontal perpendicular of the direction it faces.
      const rad = (panel.headingDeg * Math.PI) / 180
      t.set(Math.sin(rad), 0, Math.cos(rad)).multiplyScalar(panel.width / 2)
      a.copy(p).add(t).setY(floorY + h)
      b.copy(p).sub(t).setY(floorY + h)
      this.edges.add(a, b, EDGE_RADIUS_U, edge)
    }
  }
}
