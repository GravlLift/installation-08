/**
 * thruster3d.ts — THE THRUSTER BURST DRAWN: a short exhaust cone that shoots out of the carrier's
 * back, opposite the push, and fades (`thruster3d_logic` gives the direction and the phase).
 *
 * Additive and without depth writes. Its outer flame carries the carrier's team color at the
 * impulse (the 2D dash rule), its core the white-hot ink of the effects (`inks.fx.core`).
 */
import * as THREE from 'three'

import { InstancePool } from './actionKit'
import type { ThrusterJet } from './thruster3d_logic'

/**
 * The full exhaust (u): its length, its radius at the body, and how far behind the body center it
 * starts. ESTIMATES, an on-screen size of about half a player; the true jet is the thruster's
 * particle effect in the game, not in the app.
 */
const JET_LENGTH_U = 0.45
const JET_RADIUS_U = 0.1
const JET_BEHIND_U = 0.12
/** The core: a thinner, shorter cone inside the flame. */
const CORE_RATIO = 0.55
/** How much of their ink the flame and the core add (additive light). */
const FLAME_GLOW = 0.6
const CORE_GLOW = 0.8

const CAPACITY = 32
const UP = new THREE.Vector3(0, 1, 0)

export class Thruster3d {
  private readonly flames: InstancePool
  private readonly cores: InstancePool
  private readonly scratch = { back: new THREE.Vector3(), base: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(), c: new THREE.Color() }

  constructor(parent: THREE.Object3D) {
    const glow = () =>
      new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    // A cone whose base is at the origin and whose tip points along +Y.
    const cone = () => new THREE.ConeGeometry(1, 1, 12, 1, true).translate(0, 0.5, 0)
    this.flames = new InstancePool(parent, cone(), glow(), CAPACITY)
    this.cores = new InstancePool(parent, cone(), glow(), CAPACITY)
  }

  begin(): void {
    this.flames.begin()
    this.cores.begin()
  }

  end(): void {
    this.flames.end()
    this.cores.end()
  }

  dispose(): void {
    this.flames.dispose()
    this.cores.dispose()
  }

  /**
   * jet — the exhaust behind `body` (axes three, the carrier's body center), opposite `push` (unit,
   * horizontal, axes three), at its phase. `team` colors the flame, `core` its heart.
   */
  jet(body: THREE.Vector3, push: THREE.Vector3, jet: ThrusterJet, ink: { team: THREE.Color; core: THREE.Color }): void {
    const length = JET_LENGTH_U * jet.reach
    if (!(length > 1e-3) || !(jet.alpha > 0)) return
    const { back, base, q, s, c } = this.scratch
    back.copy(push).negate()
    q.setFromUnitVectors(UP, back)
    base.copy(back).multiplyScalar(JET_BEHIND_U).add(body)
    this.flames.add(base, q, s.set(JET_RADIUS_U, length, JET_RADIUS_U), c.copy(ink.team).multiplyScalar(FLAME_GLOW * jet.alpha))
    const r = JET_RADIUS_U * CORE_RATIO
    this.cores.add(base, q, s.set(r, length * CORE_RATIO, r), c.copy(ink.core).multiplyScalar(CORE_GLOW * jet.alpha))
  }
}
