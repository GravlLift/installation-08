/**
 * grapple3d.ts — THE GRAPPLESHOT DRAWN: the hook that flies from the hand to the anchor with its
 * cable behind it, then holds there while the cable pulls (`grapple3d_logic` says where the hook
 * is at the frame).
 *
 * As the game shows it: a thin dark wire and a small dark claw. The analysis aid
 * (`aids3d.grappleLines`) adds the thick bright line from the hand to the anchor and the anchor
 * point, over the whole pull, flight included.
 */
import * as THREE from 'three'

import { InstancePool, SegmentPool } from './actionKit'
import type { GrapplePhase } from './grapple3d_logic'

/** The aid: a thick line and the anchor point. */
const CABLE_RADIUS_U = 0.012
const ANCHOR_RADIUS_U = 0.035
/** The cable as the game shows it: a wire of ~1 cm, the cable ink darkened (metal). */
const GAME_CABLE_RADIUS_U = 0.004
const GAME_CABLE_SHADE = 0.3
/**
 * The claw at the end of the cable (u): its length and its radius. ESTIMATE, an on-screen size
 * of a few centimeters; the true size is the grapple hook model of the game, not in the app.
 */
const HOOK_LENGTH_U = 0.06
const HOOK_RADIUS_U = 0.025

const HOOK_SCALE = new THREE.Vector3(HOOK_RADIUS_U, HOOK_LENGTH_U, HOOK_RADIUS_U)

const CAPACITY = 64
const UP = new THREE.Vector3(0, 1, 0)

export class Grapple3d {
  private readonly wires: SegmentPool
  private readonly hooks: InstancePool
  private readonly beads: InstancePool
  private readonly all: { begin(): void; end(): void; dispose(): void }[]
  private readonly scratch = { head: new THREE.Vector3(), dir: new THREE.Vector3(), q: new THREE.Quaternion(), c: new THREE.Color(), s: new THREE.Vector3() }

  constructor(parent: THREE.Object3D) {
    this.wires = new SegmentPool(parent, new THREE.MeshLambertMaterial(), CAPACITY * 2)
    // The claw: a cone whose base is at the origin and whose tip points along +Y.
    const cone = new THREE.ConeGeometry(1, 1, 8).translate(0, 0.5, 0)
    this.hooks = new InstancePool(parent, cone, new THREE.MeshLambertMaterial(), CAPACITY)
    this.beads = new InstancePool(parent, new THREE.SphereGeometry(1, 8, 6), new THREE.MeshLambertMaterial(), CAPACITY)
    this.all = [this.wires, this.hooks, this.beads]
  }

  begin(): void {
    for (const p of this.all) p.begin()
  }

  end(): void {
    for (const p of this.all) p.end()
  }

  dispose(): void {
    for (const p of this.all) p.dispose()
  }

  /**
   * pull — one grapple at its phase: the hook at `reach` of the way from `hand` to `anchor`, the
   * wire from the hand to the hook. `aid` adds the analysis line and the anchor point.
   */
  pull(hand: THREE.Vector3, anchor: THREE.Vector3, phase: GrapplePhase, color: THREE.Color, aid: boolean): void {
    const { head, dir, q, c, s } = this.scratch
    head.lerpVectors(hand, anchor, phase.reach)
    const metal = c.copy(color).multiplyScalar(GAME_CABLE_SHADE)
    this.wires.add(hand, head, GAME_CABLE_RADIUS_U, metal)
    dir.subVectors(anchor, hand)
    if (dir.lengthSq() > 1e-8) {
      q.setFromUnitVectors(UP, dir.normalize())
      // The claw's tip is at the head, its base trails behind along the cable.
      const base = s.copy(dir).multiplyScalar(-HOOK_LENGTH_U).add(head)
      this.hooks.add(base, q, HOOK_SCALE, metal)
    }
    if (!aid) return
    this.wires.add(hand, anchor, CABLE_RADIUS_U, color)
    this.beads.add(anchor, null, ANCHOR_RADIUS_U, color)
  }
}
