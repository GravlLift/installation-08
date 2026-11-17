// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * corpses3d.ts — LES CORPS DES MORTS : une copie du Spartan par mort récente, dans l'armure de la
 * victime quand elle est prête (`armory3d.Dress`, sinon l'armure par défaut à la teinte de son
 * équipe), qui tombe en corps inerte (sa cuisson, `ragdollBake3d`, rejouée à l'âge de la mort) puis
 * reste où il a fini jusqu'à ce que la croix de la mort s'efface. Tant que la cuisson n'est pas
 * prête, le corps tombe par les clips de mort du jeu (`fall3d`).
 *
 * Les copies sont gardées d'une image à l'autre par clé (victime et teinte) et resservies : une copie
 * ne porte rien de la mort qu'elle montre, tout est reposé à chaque image depuis la mort et son âge ;
 * elle est refaite quand l'habit de la victime arrive. Une nouvelle source du Spartan (rechargement)
 * libère toutes les copies.
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

/** Ce qu'il faut savoir d'une mort pour en poser le corps. */
export interface Corpse {
  /** Pieds de la victime à sa mort (axes three). */
  at: THREE.Vector3
  /** L'impulsion : horizontale, unitaire. */
  dir: THREE.Vector3
  /** Cap de la victime à sa mort (degrés). */
  h: number
  kind: FallKind
}

/** Au plus autant de corps à la fois : au-delà, les plus récents passent. */
const MAX_CORPSES = 24

interface Body {
  copy: SpartanCopy
  /** L'habit que porte la copie (null : l'armure par défaut). */
  dress: Dress | null
  /** La place du corps, aux pieds (glissement et envol de la chute) ; la copie y tourne sur son cap. */
  holder: THREE.Group
  /** Les os de la copie alignés sur les noms d'une cuisson (`names`), lus une fois par liste de noms. */
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
  /** La sonde de la carte la plus proche d'un point (reflets éteints : null) ; sans, les corps se tiennent sans sonde. */
  private readonly probeAt: (position: THREE.Vector3) => THREE.Texture | null
  /** La lumière cuite de la carte, greffée sur les copies à leur création (`copySpartan`). */
  private readonly baked: BakedLight | null
  private readonly probePoint = new THREE.Vector3()

  constructor(parent: THREE.Object3D, probeAt?: (position: THREE.Vector3) => THREE.Texture | null, baked: BakedLight | null = null) {
    this.parent = parent
    this.probeAt = probeAt ?? (() => null)
    this.baked = baked
  }

  /** begin ouvre une image ; `source` est le Spartan du jeu (null tant qu'il n'est pas chargé). */
  begin(source: THREE.Object3D | null): void {
    if (source !== this.source) {
      this.releaseAll()
      this.source = source
    }
    this.used.clear()
    this.count = 0
  }

  /** Prépare une copie cachée sans la prendre pour une mort. */
  prepare(key: string, tint: THREE.Color, dress: Dress | null): THREE.Object3D | null {
    const list = this.bodies.get(key)
    const disponible = list?.find((body) => body.dress === dress)
    if (disponible) return disponible.holder
    const n = this.used.get(key) ?? 0
    const body = this.take(key, tint, dress)
    if (n) this.used.set(key, n)
    else this.used.delete(key)
    if (body) body.holder.visible = false
    return body?.holder ?? null
  }

  /**
   * add pose le corps `c`, `t` secondes après la mort, dans l'habit `dress` de la victime (null :
   * l'armure par défaut à la teinte `tint`), clé `key`. `bake` : sa cuisson de corps inerte quand
   * elle est prête (`ragdollBake3d`), sinon la chute par les clips de mort du jeu.
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

  /** illuminate : l'armure du corps porte la sonde de la carte au point où il se tient (comme le joueur vivant). */
  private illuminate(body: Body): void {
    body.holder.getWorldPosition(this.probePoint)
    assignPlayerProbes(body.copy.materials, this.probeAt(this.probePoint))
  }

  /** fall pose le corps par les clips de mort du jeu (la cuisson n'est pas prête). */
  private fall(body: Body, c: Corpse, t: number): void {
    const clips = this.source ? spartanClipsOf(this.source) : null
    const p = fallPose(t, c.kind, this.pose)
    const [fx, , fz] = aimDirThree(c.h, 0)
    const backward = fallsBackward(c.dir, this.facing.set(fx, 0, fz))
    const mix = clips ? deathMix(t, c.kind, backward, clips, this.mix) : null
    poseSpartan(body.copy.rig, { h: fallHeading(c.h, c.dir, backward, p.u), p: 0, mix })
    fallPlacement(c.at, c.dir, p, body.holder.position)
  }

  /** end cache les copies qu'aucune mort n'a prises à cette image. */
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
    // Toute copie d'un autre habit est libérée : la suivante, glissée à sa place, est vérifiée à son tour.
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
