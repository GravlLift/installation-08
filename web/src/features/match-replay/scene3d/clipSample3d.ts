/**
 * clipSample3d.ts — LES CLIPS DU JEU POSÉS SUR UNE COPIE DU SPARTAN, à un temps imposé.
 *
 * Aucune horloge ni `AnimationMixer` : la pose est une fonction du mélange demandé (`ClipMix`, tiré
 * de l'image du rejeu par `clipSelect3d`). Chaque appel repart de la pose de repos de tous les os que
 * les clips animent, puis :
 *   1. les couches de BASE (locomotion, postures, saut...) se mélangent en moyenne pondérée (leurs
 *      poids font 1 ; un os qu'aucune n'anime garde le repos pour la part qui manque) ;
 *   2. les couches PAR-DESSUS (corps à corps, lancer, rangement...) remplacent, à leur poids, les os
 *      qu'elles animent (les autres gardent la base).
 * Même mélange = même pose au bit près, quelles que soient les images visitées avant.
 *
 * Les pistes sont liées aux os une fois (par nom) ; un échantillon lit deux clés voisines (une par
 * image du clip) : interpolation sphérique des rotations, linéaire des translations. Un clip bouclé
 * passe de sa dernière image à la première ; un clip joué une fois tient ses bords. Aucune allocation
 * par image : des tampons par copie.
 */
import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'

import { type SpartanClip, type SpartanClips } from './clips3d'

/** Une couche du mélange : un clip, son temps (s), son poids, et s'il boucle. */
export interface ClipLayer {
  clip: SpartanClip | null
  time: number
  weight: number
  loop: boolean
}

/** Le mélange d'une image : couches de base (poids de somme 1) puis couches par-dessus. */
export interface ClipMix {
  base: ClipLayer[]
  baseCount: number
  over: ClipLayer[]
  overCount: number
}

/** newClipMix : un mélange vide aux capacités données (réutilisé d'une image à l'autre). */
export function newClipMix(baseCapacity = 16, overCapacity = 4): ClipMix {
  const layer = (): ClipLayer => ({ clip: null, time: 0, weight: 0, loop: false })
  return {
    base: Array.from({ length: baseCapacity }, layer),
    baseCount: 0,
    over: Array.from({ length: overCapacity }, layer),
    overCount: 0,
  }
}

/** Les liaisons d'un clip à une copie : l'indice d'os de chaque piste (-1 : os absent de la copie). */
type Binding = Int16Array

export class ClipRig {
  /** Les os animés par au moins un clip, dans l'ordre des tampons. */
  readonly bones: THREE.Bone[]
  private readonly restQ: Float32Array
  private readonly restT: Float32Array
  private readonly q: Float32Array
  private readonly t: Float32Array
  private readonly wq: Float32Array
  private readonly wt: Float32Array
  private readonly bindings = new Map<SpartanClip, Binding>()
  private readonly sample = new Float32Array(4)
  readonly clips: SpartanClips

  /** `root` : la copie à son repos ; `clips` : le catalogue de sa source. */
  constructor(root: THREE.Object3D, clips: SpartanClips) {
    this.clips = clips
    const byName = new Map<string, THREE.Bone>()
    root.traverse((o) => {
      if (o instanceof THREE.Bone && !byName.has(o.name)) byName.set(o.name, o)
    })
    this.bones = clips.bones().flatMap((n) => byName.get(n) ?? [])
    const n = this.bones.length
    this.restQ = new Float32Array(4 * n)
    this.restT = new Float32Array(3 * n)
    this.bones.forEach((b, i) => {
      b.quaternion.toArray(this.restQ, 4 * i)
      b.position.toArray(this.restT, 3 * i)
    })
    this.q = new Float32Array(4 * n)
    this.t = new Float32Array(3 * n)
    this.wq = new Float32Array(n)
    this.wt = new Float32Array(n)
    const index = new Map(this.bones.map((b, i) => [b.name, i]))
    for (const name of clips.names()) {
      const clip = clips.get(name) as SpartanClip
      this.bindings.set(clip, Int16Array.from(clip.tracks, (tr) => index.get(tr.bone) ?? -1))
    }
  }

  /** apply pose les os de la copie pour le mélange `mix` (cf. l'en-tête). */
  apply(mix: ClipMix): void {
    this.wq.fill(0)
    this.wt.fill(0)
    for (let i = 0; i < mix.baseCount; i++) this.blendBase(mix.base[i])
    this.settleBase()
    for (let i = 0; i < mix.overCount; i++) this.blendOver(mix.over[i])
    this.bones.forEach((b, i) => {
      b.quaternion.fromArray(this.q, 4 * i)
      b.position.fromArray(this.t, 3 * i)
    })
  }

  /** blendBase ajoute une couche de base à la moyenne pondérée en cours. */
  private blendBase(layer: ClipLayer): void {
    const clip = layer.clip
    if (!clip || layer.weight <= 0) return
    const bind = this.bindings.get(clip) as Binding
    const at = framePosition(clip, layer.time, layer.loop)
    clip.tracks.forEach((tr, k) => {
      const b = bind[k]
      if (b < 0) return
      sampleTrack(tr, at, clip.frames, layer.loop, this.sample)
      if (tr.size === 4) accumulate(this.q, this.wq, b, 4, this.sample, layer.weight)
      else accumulate(this.t, this.wt, b, 3, this.sample, layer.weight)
    })
  }

  /** settleBase : la part de poids qu'aucune couche n'a donnée à un os revient à son repos. */
  private settleBase(): void {
    for (let b = 0; b < this.bones.length; b++) {
      settle(this.q, this.wq[b], b, 4, this.restQ)
      settle(this.t, this.wt[b], b, 3, this.restT)
    }
  }

  /** blendOver remplace, au poids de la couche, les os qu'elle anime. */
  private blendOver(layer: ClipLayer): void {
    const clip = layer.clip
    if (!clip || layer.weight <= 0) return
    const bind = this.bindings.get(clip) as Binding
    const at = framePosition(clip, layer.time, layer.loop)
    const w = Math.min(1, layer.weight)
    clip.tracks.forEach((tr, k) => {
      const b = bind[k]
      if (b < 0) return
      sampleTrack(tr, at, clip.frames, layer.loop, this.sample)
      if (tr.size === 4) slerpFlat(this.q, 4 * b, this.q, 4 * b, this.sample, 0, w)
      else for (let c = 0; c < 3; c++) this.t[3 * b + c] += (this.sample[c] - this.t[3 * b + c]) * w
    })
  }
}

/**
 * measureSyncPhases mesure la phase d'accord (`SpartanClip.sync`) de chaque clip qui se déplace :
 * l'image où le pied gauche (`b_l_foot`) mène le plus loin devant le droit dans le sens du
 * déplacement. Pose une copie des os de `source` (jamais `source` elle-même) ; une fois par catalogue.
 */
export function measureSyncPhases(source: THREE.Object3D, clips: SpartanClips): void {
  const root = cloneSkinned(source)
  const left = root.getObjectByName('b_l_foot')
  const right = root.getObjectByName('b_r_foot')
  if (!left || !right) return
  const rig = new ClipRig(root, clips)
  const mix = newClipMix(1, 0)
  const layer = mix.base[0]
  mix.baseCount = 1
  layer.weight = 1
  layer.loop = true
  const l = new THREE.Vector3()
  const r = new THREE.Vector3()
  for (const name of clips.names()) {
    const clip = clips.get(name) as SpartanClip
    if (clip.stride === 0) continue
    let best = -Infinity
    for (let k = 0; k < clip.frames; k++) {
      layer.clip = clip
      layer.time = k / clip.frameRate
      rig.apply(mix)
      root.updateMatrixWorld(true)
      left.getWorldPosition(l).sub(right.getWorldPosition(r))
      const lead = l.x * clip.dir[0] + l.z * clip.dir[1]
      if (lead > best) {
        best = lead
        clip.sync = k / clip.frames
      }
    }
  }
}

/** slerpFlat : `THREE.Quaternion.slerpFlat` sur des tableaux typés (ses types n'acceptent que `number[]`). */
function slerpFlat(dst: Float32Array, d: number, a: Float32Array, ai: number, b: Float32Array, bi: number, t: number): void {
  THREE.Quaternion.slerpFlat(dst as unknown as number[], d, a as unknown as number[], ai, b as unknown as number[], bi, t)
}

/** framePosition : la position fractionnaire (en images du clip) du temps `time` (s). */
export function framePosition(clip: SpartanClip, time: number, loop: boolean): number {
  const p = time * clip.frameRate
  if (loop) return p - clip.frames * Math.floor(p / clip.frames)
  return Math.min(Math.max(p, 0), clip.frames - 1)
}

/** sampleTrack écrit dans `out` la valeur de `tr` à la position `at` (images). */
function sampleTrack(tr: { size: 3 | 4; values: Float32Array; keys: number }, at: number, frames: number, loop: boolean, out: Float32Array): void {
  const s = tr.size
  if (tr.keys === 1) {
    for (let c = 0; c < s; c++) out[c] = tr.values[c]
    return
  }
  const i0 = Math.floor(at)
  const u = at - i0
  const i1 = loop ? (i0 + 1) % frames : Math.min(i0 + 1, frames - 1)
  if (s === 4) {
    slerpFlat(out, 0, tr.values, 4 * i0, tr.values, 4 * i1, u)
    return
  }
  for (let c = 0; c < 3; c++) out[c] = tr.values[3 * i0 + c] + (tr.values[3 * i1 + c] - tr.values[3 * i0 + c]) * u
}

/**
 * accumulate ajoute la valeur `v` au poids `w` à la moyenne de l'os `b` : la première contribution
 * est copiée, les suivantes mêlées au prorata (rotation sphérique, translation linéaire).
 */
function accumulate(acc: Float32Array, weights: Float32Array, b: number, size: 3 | 4, v: Float32Array, w: number): void {
  const total = weights[b] + w
  const k = w / total
  weights[b] = total
  const o = size * b
  if (size === 4) {
    if (k === 1) for (let c = 0; c < 4; c++) acc[o + c] = v[c]
    else slerpFlat(acc, o, acc, o, v, 0, k)
    return
  }
  for (let c = 0; c < 3; c++) acc[o + c] = k === 1 ? v[c] : acc[o + c] + (v[c] - acc[o + c]) * k
}

/** settle : un os de poids `w` < 1 rejoint son repos pour `1 - w` ; sans poids, il est au repos. */
function settle(acc: Float32Array, w: number, b: number, size: 3 | 4, rest: Float32Array): void {
  const o = size * b
  if (w >= 1 - 1e-6) return
  if (w <= 0) {
    for (let c = 0; c < size; c++) acc[o + c] = rest[o + c]
    return
  }
  if (size === 4) slerpFlat(acc, o, rest, o, acc, o, w)
  else for (let c = 0; c < 3; c++) acc[o + c] = rest[o + c] + (acc[o + c] - rest[o + c]) * w
}
