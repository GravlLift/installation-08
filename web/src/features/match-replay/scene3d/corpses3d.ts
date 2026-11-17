// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * corpses3d.ts — THE DEAD'S BODIES: one Spartan copy per recent death, in the victim's armor once
 * it is ready (`armory3d.Dress`, otherwise the default armor tinted for its team), that falls to
 * a ragdoll (its bake, `ragdollBake3d`, replayed at the death's age) then stays where it ended up
 * until the death's cross fades out. While the bake is not ready, the body falls through the
 * game's death clips (`fall3d`).
 *
 * Copies are kept from one frame to the next by key (victim and tint) and reused: a copy carries
 * nothing of the death it shows, everything is re-set each frame from the death and its age; it
 * is remade when the victim's outfit arrives. A new Spartan source (a reload) releases all copies.
 */
import * as THREE from 'three'

import type { Dress } from './armory3d'
import type { BakedLight } from './bakedLightShader'
import { spartanClipsOf } from './clips3d'
import { newClipMix } from './clipSample3d'
import { deathMix, fallHeading, fallPlacement, fallPose, fallsBackward, type FallKind, type FallPose } from './fall3d'
import { assignPlayerProbes } from './playerProbe3d'
import { poseSpartan } from './pose3d'
import { poseBake, type RagdollBake } from './ragdollBake3d'
import { bonesOf } from './ragdollBones3d'
import { copySpartan, releaseSpartan, type SpartanCopy } from './spartan3d'
import { aimDirThree } from './tracks3d'

/** What needs to be known about a death to place its body. */
export interface Corpse {
  /** Victim's feet at death (three.js axes). */
  at: THREE.Vector3
  /** The impulse: horizontal, unit length. */
  dir: THREE.Vector3
  /** Victim's heading at death (degrees). */
  h: number
  kind: FallKind
}

/** At most this many bodies at once: past that, the most recent ones win. */
const MAX_CORPSES = 24

interface Body {
  copy: SpartanCopy
  /** The outfit the copy wears (null: the default armor). */
  dress: Dress | null
  /** The body's spot, at the feet (the fall's slide and launch); the copy rotates there to its heading. */
  holder: THREE.Group
  /** The copy's bones aligned to a bake's names (`names`), read once per name list. */
  names: readonly string[] | null
  bones: (THREE.Bone | undefined)[]
}

export class Corpses3d {
  private source: THREE.Object3D | null = null
  private readonly bodies = new Map<string, Body[]>()
  private readonly used = new Map<string, number>()
  private count = 0
  private readonly pose: FallPose = { u: 0, slide: 0, lift: 0 }
  private readonly mix = newClipMix(4, 0)
  private readonly facing = new THREE.Vector3()
  private readonly parent: THREE.Object3D
  /** The map's closest probe to a point (reflections off: null); without one, bodies stand with no probe. */
  private readonly probeAt: (position: THREE.Vector3) => THREE.Texture | null
  /** The map's baked light, grafted onto copies when they are created (`copySpartan`). */
  private readonly baked: BakedLight | null
  private readonly probePoint = new THREE.Vector3()

  constructor(parent: THREE.Object3D, probeAt?: (position: THREE.Vector3) => THREE.Texture | null, baked: BakedLight | null = null) {
    this.parent = parent
    this.probeAt = probeAt ?? (() => null)
    this.baked = baked
  }

  /** begin opens a frame; `source` is the game's Spartan (null until it loads). */
  begin(source: THREE.Object3D | null): void {
    if (source !== this.source) {
      this.releaseAll()
      this.source = source
    }
    this.used.clear()
    this.count = 0
  }

  /** Prepares a hidden copy without claiming it for a death. */
  prepare(key: string, tint: THREE.Color, dress: Dress | null): THREE.Object3D | null {
    const list = this.bodies.get(key)
    const available = list?.find((body) => body.dress === dress)
    if (available) return available.holder
    const n = this.used.get(key) ?? 0
    const body = this.take(key, tint, dress)
    if (n) this.used.set(key, n)
    else this.used.delete(key)
    if (body) body.holder.visible = false
    return body?.holder ?? null
  }

  /**
   * add places body `c`, `t` seconds after death, in victim's outfit `dress` (null: the default
   * armor tinted `tint`), key `key`. `bake`: its ragdoll bake once it is ready
   * (`ragdollBake3d`), otherwise the fall through the game's death clips.
   */
  add(c: Corpse, t: number, tint: THREE.Color, key: string, dress: Dress | null = null, bake: RagdollBake | null = null): void {
    if (!this.source || this.count >= MAX_CORPSES) return
    const body = this.take(key, tint, dress)
    if (!body) return
    this.count++
    body.holder.visible = true
    if (bake) {
      if (body.names !== bake.names) {
        const byName = new Map(bonesOf(body.copy.rig.root).map((b) => [b.name, b]))
        body.bones = bake.names.map((n) => byName.get(n))
        body.names = bake.names
      }
      body.holder.position.copy(bake.feet)
      body.copy.rig.root.rotation.set(0, bake.yaw, 0)
      poseBake(bake, t, body.bones)
      body.copy.rig.root.updateMatrixWorld(true)
      this.illuminate(body)
      return
    }
    this.fall(body, c, t)
    this.illuminate(body)
  }

  /** illuminate: the body's armor carries the map's probe at the point where it stands (like a living player). */
  private illuminate(body: Body): void {
    body.holder.getWorldPosition(this.probePoint)
    assignPlayerProbes(body.copy.materials, this.probeAt(this.probePoint))
  }

  /** fall places the body through the game's death clips (the bake is not ready). */
  private fall(body: Body, c: Corpse, t: number): void {
    const clips = this.source ? spartanClipsOf(this.source) : null
    const p = fallPose(t, c.kind, this.pose)
    const [fx, , fz] = aimDirThree(c.h, 0)
    const backward = fallsBackward(c.dir, this.facing.set(fx, 0, fz))
    const mix = clips ? deathMix(t, c.kind, backward, clips, this.mix) : null
    poseSpartan(body.copy.rig, { h: fallHeading(c.h, c.dir, backward, p.u), p: 0, mix })
    fallPlacement(c.at, c.dir, p, body.holder.position)
  }

  /** end hides the copies no death claimed this frame. */
  end(): void {
    for (const [key, list] of this.bodies) {
      const n = this.used.get(key) ?? 0
      for (let i = n; i < list.length; i++) list[i].holder.visible = false
    }
  }

  dispose(): void {
    this.releaseAll()
  }

  private take(key: string, tint: THREE.Color, dress: Dress | null): Body | null {
    let list = this.bodies.get(key)
    if (!list) {
      list = []
      this.bodies.set(key, list)
    }
    const n = this.used.get(key) ?? 0
    // Any copy wearing another outfit is released: the next one, slid into its place, is checked in turn.
    while (n < list.length && list[n].dress !== dress) {
      release(list[n])
      list.splice(n, 1)
    }
    if (n >= list.length) {
      const copy = this.source ? copySpartan(this.source, tint, dress, this.baked) : null
      if (!copy) return null
      const holder = new THREE.Group()
      holder.add(copy.rig.root)
      this.parent.add(holder)
      list.splice(n, 0, { copy, dress, holder, names: null, bones: [] })
    }
    this.used.set(key, n + 1)
    return list[n]
  }

  private releaseAll(): void {
    for (const list of this.bodies.values()) for (const b of list) release(b)
    this.bodies.clear()
    this.used.clear()
  }
}

function release(b: Body): void {
  releaseSpartan(b.copy)
  b.holder.removeFromParent()
}
