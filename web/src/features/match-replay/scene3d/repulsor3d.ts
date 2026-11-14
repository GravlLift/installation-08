/**
 * repulsor3d.ts — THE REPULSOR PULSE DRAWN: a shell of light that bursts from the carrier's body
 * and fades as it opens, with a brighter ring around its middle (`repulsor3d_logic` gives the
 * radius and the presence at the frame).
 *
 * Additive and without depth writes: the burst lights what it crosses and hides nothing. Its ink is
 * the carrier's team color at the activation (the 2D push rule: the color of the author).
 */
import * as THREE from 'three'

import { InstancePool, SegmentPool } from './actionKit'
import type { RepulsorBurst } from './repulsor3d_logic'

/** How much of the team ink the shell and its ring add (additive light). */
const SHELL_GLOW = 0.2
const RING_GLOW = 1
const RING_SEGMENTS = 32
const RING_RADIUS_U = 0.012

const CAPACITY = 32

export class Repulsor3d {
  private readonly shells: InstancePool
  private readonly rings: SegmentPool
  private readonly scratch = { a: new THREE.Vector3(), b: new THREE.Vector3(), shell: new THREE.Color(), ring: new THREE.Color() }

  constructor(parent: THREE.Object3D) {
    const glow = (side: THREE.Side) =>
      new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side, toneMapped: false })
    // Front faces only: a camera inside the burst (the carrier's own view, or anyone it reaches)
    // sees the ring, never a full-screen wash of the team ink.
    this.shells = new InstancePool(parent, new THREE.SphereGeometry(1, 24, 16), glow(THREE.FrontSide), CAPACITY)
    this.rings = new SegmentPool(parent, glow(THREE.FrontSide), CAPACITY * RING_SEGMENTS)
  }

  begin(): void {
    this.shells.begin()
    this.rings.begin()
  }

  end(): void {
    this.shells.end()
    this.rings.end()
  }

  dispose(): void {
    this.shells.dispose()
    this.rings.dispose()
  }

  /** burst — the pulse centered on `center` (axes three, the carrier's body), at its phase. */
  burst(center: THREE.Vector3, burst: RepulsorBurst, color: THREE.Color): void {
    if (!(burst.radius > 1e-3) || !(burst.alpha > 0)) return
    const { a, b, shell, ring } = this.scratch
    this.shells.add(center, null, burst.radius, shell.copy(color).multiplyScalar(SHELL_GLOW * burst.alpha))
    ring.copy(color).multiplyScalar(RING_GLOW * burst.alpha)
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const u = (i / RING_SEGMENTS) * Math.PI * 2
      const v = ((i + 1) / RING_SEGMENTS) * Math.PI * 2
      a.set(center.x + burst.radius * Math.cos(u), center.y, center.z + burst.radius * Math.sin(u))
      b.set(center.x + burst.radius * Math.cos(v), center.y, center.z + burst.radius * Math.sin(v))
      this.rings.add(a, b, RING_RADIUS_U, ring)
    }
  }
}
