// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * padGlow3d.ts — THE EQUIPMENT PAD'S GLOW: the lens flares of its effect.
 *
 * The weapon library's index carries `pad_glow` (Go `weapons.PadGlow`, `internal/weapons/pad_glow.go`):
 * the equipment pad's effect (`effe` cf098056, played by the pad's Forge kit), its events in play
 * order and, per lens flare, its drawn reflections with their fx-* textures. The effect loops two
 * events one after the other (`activeEvents`): after a 0.5 s delay, event 0's flare for 0.5 s, then
 * event 1's bluer flare for 1 s; a flare shows only while its event plays. What the tags fix and
 * this draws:
 * - every reflection faces the camera (flag bit 11, world space, unset), centered on the source
 *   (axis offset 0), its texture turned by its rotation offset (degrees), hidden by what stands
 *   nearer the camera;
 * - its size is its radius curve times its X / Y scale curves (the effect part's radius modifier
 *   is not applied, `PAD_LENS_RADIUS_MODIFIER`);
 * - its light is its color curve times its intensity curve (linear RGB) through the view's
 *   compression of game light strengths (`lighting.glowLevel`), added to the frame;
 * - it fades out between the flare's far fade distances (10 to 20) and between its falloff and
 *   cutoff angles off the view axis (65 to 80 degrees), linearly;
 * - it is hidden when the map stands between the camera and the source (no "no occlusion test"
 *   flag; the occlusion offset is 0).
 * Inferred, not read: the radius unit is world units (as a share of the screen, the flare stayed
 * as large on a far pad as on a near one and buried the pad, unlike the game), and the source sits at
 * the top center of the pad object's box (the effect plays at the device's origin, which the
 * object table does not publish). The game's occlusion is a pixel count around the source; this
 * test is one sight line. The reflections' modulation and tint power are not drawn (no external
 * color tints these flares).
 */
import * as THREE from 'three'

import { type FetchJson, IndexField, libraryTexture } from './indexField3d'
import { type LightVolume, LightVolumeMesh, parseLightVolume } from './lightVolume3d'
import { glowLevel } from './lighting'

/**
 * The cone's axis: world up. The generator stacks its profiles along its emitter's local +X, and
 * the effect names a location marker (54b94882) the pad's models do not carry, so the emitter's
 * frame is not read; the game shows the cone pointing up from the pad (an inference from the game,
 * Jordan's capture of 2026-11-21).
 */
const CONE_AXIS = new THREE.Vector3(0, 1, 0)

/** One constant-or-curve property as the build writes it (himap `FonctionParticule`). */
interface Curve {
  min: number
  max: number
  color?: [number, number, number]
}

export interface PadReflection {
  texture: string
  /** The texture is sampled through an sRGB view (its bitmap's color space). */
  srgb: boolean
  rotationOffset: number
  radius: Curve
  scaleX: Curve
  scaleY: Curve
  intensity: Curve
  color: Curve
}

export interface PadFlare {
  falloff: [number, number]
  farFade: [number, number]
  nearFade: [number, number]
  reflections: PadReflection[]
}

/** One event of the pad effect: when it plays (seconds) and the flares it creates. */
export interface PadEvent {
  delay: [number, number]
  duration: [number, number]
  flares: PadFlare[]
  /** The light volumes the event's generators draw (the upward cone). */
  volumes: LightVolume[]
}

export interface PadGlowData {
  looping: boolean
  /** The events play together (each from the effect's start) instead of one after the other. */
  parallel: boolean
  events: PadEvent[]
}

/**
 * activeEvents: which events are playing `t` seconds into the effect (the lower bounds of their
 * delay and duration: the pad's are fixed). One after the other, each event starts after the
 * previous one ends plus its own delay; a looping effect starts over after the last.
 */
export function activeEvents(g: PadGlowData, t: number): boolean[] {
  const spans: [number, number][] = []
  let at = 0
  for (const e of g.events) {
    const start = (g.parallel ? 0 : at) + e.delay[0]
    const end = start + e.duration[0]
    spans.push([start, end])
    at = g.parallel ? Math.max(at, end) : end
  }
  const cycle = g.parallel ? Math.max(0, ...spans.map((s) => s[1])) : at
  const u = g.looping && cycle > 0 ? ((t % cycle) + cycle) % cycle : t
  return spans.map(([a, b]) => u >= a && u < b)
}

/**
 * The factor on a reflection's radius. The pad effect's lens parts carry a radius modifier of 4
 * (`effe` cf098056, part +0x28, both bounds), but whether it scales a screen-space flare is not
 * known: applied, the star and halo cover most of the view at a few meters and bury the pad's
 * item, unlike the game. Not applied (an inference, open to a better reading).
 */
export const PAD_LENS_RADIUS_MODIFIER = 1

/** The pad device's Forge object type (the equipment pad, `objectGlow3d.OBJECT_INPUTS`). */
export const EQUIPMENT_PAD_TYPE = 0xe42158df

function curveOf(v: unknown): Curve | null {
  if (!v || typeof v !== 'object') return null
  const c = v as Curve
  if (typeof c.min !== 'number' || typeof c.max !== 'number') return null
  return c
}

function pairOf(v: unknown): [number, number] | null {
  return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number') ? [v[0], v[1]] : null
}

/** parsePadGlow reads `pad_glow` out of the weapon library index (null: absent or malformed). */
export function parsePadGlow(doc: unknown): PadGlowData | null {
  const g = (doc as { pad_glow?: unknown } | null)?.pad_glow as Record<string, unknown> | null | undefined
  if (!g || !Array.isArray(g.events)) return null
  const events: PadEvent[] = []
  for (const e of g.events as Record<string, unknown>[]) {
    const delay = pairOf(e.delay)
    const duration = pairOf(e.duration)
    if (!delay || !duration) return null
    const volumes = Array.isArray(e.volumes) ? e.volumes.map(parseLightVolume).filter((v): v is LightVolume => v !== null) : []
    events.push({ delay, duration, flares: parseFlares(e.flares), volumes })
  }
  if (!events.some((e) => e.flares.length > 0 || e.volumes.length > 0)) return null
  return { looping: g.looping === true, parallel: g.parallel === true, events }
}

function parseFlares(list: unknown): PadFlare[] {
  if (!Array.isArray(list)) return []
  const flares: PadFlare[] = []
  for (const f of list as Record<string, unknown>[]) {
    const falloff = pairOf(f.falloff)
    const farFade = pairOf(f.farFade)
    const nearFade = pairOf(f.nearFade)
    if (!falloff || !farFade || !nearFade || !Array.isArray(f.reflections)) continue
    const reflections: PadReflection[] = []
    for (const r of f.reflections as Record<string, unknown>[]) {
      const [radius, scaleX, scaleY, intensity, color] = [r.radius, r.scaleX, r.scaleY, r.intensity, r.color].map(curveOf)
      if (typeof r.texture !== 'string' || !radius || !scaleX || !scaleY || !intensity || !color?.color) continue
      reflections.push({ texture: r.texture, srgb: r.srgb === true, rotationOffset: typeof r.rotationOffset === 'number' ? r.rotationOffset : 0, radius, scaleX, scaleY, intensity, color })
    }
    if (reflections.length > 0) flares.push({ falloff, farFade, nearFade, reflections })
  }
  return flares
}

/** 1 below `begin`, 0 past `end`, linear between; 1 when the range is empty (no fade). */
export function fadeOut(x: number, begin: number, end: number): number {
  if (!(end > begin)) return 1
  return Math.min(1, Math.max(0, (end - x) / (end - begin)))
}

/** 0 below `begin`, 1 past `end`, linear between; 1 when the range is empty (no fade). */
export function fadeIn(x: number, begin: number, end: number): number {
  if (!(end > begin)) return 1
  return Math.min(1, Math.max(0, (x - begin) / (end - begin)))
}

/**
 * flareWeight: how much of a flare shows from distance `distance` at angle `angle` (radians) off
 * the view axis: its far fade, its near fade, and its falloff to cutoff angles.
 */
export function flareWeight(f: PadFlare, distance: number, angle: number): number {
  return fadeOut(distance, f.farFade[0], f.farFade[1]) * fadeIn(distance, f.nearFade[0], f.nearFade[1]) * fadeOut(angle, f.falloff[0], f.falloff[1])
}

/** A Forge object as the layer's table publishes it (game axes). */
interface PlacedObject {
  type: number
  min: [number, number, number]
  max: [number, number, number]
}

/** padSources: the glow's sources (three axes) for the layer's object table, one per equipment pad. */
export function padSources(objects: unknown): THREE.Vector3[] {
  if (!Array.isArray(objects)) return []
  const out: THREE.Vector3[] = []
  for (const o of objects as PlacedObject[]) {
    if ((o?.type >>> 0) !== EQUIPMENT_PAD_TYPE || !Array.isArray(o.min) || !Array.isArray(o.max)) continue
    const x = (o.min[0] + o.max[0]) / 2
    const y = (o.min[1] + o.max[1]) / 2
    // game (x, y, z up) to three (x, z up, -y)
    out.push(new THREE.Vector3(x, o.max[2], -y))
  }
  return out
}

/** Sight test: true when the map hides `target` from the camera. */
export type FlareOccluded = (target: THREE.Vector3) => boolean

const ADD_LIGHT: Partial<THREE.SpriteMaterialParameters> = {
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendEquation: THREE.AddEquation,
  depthTest: true,
  depthWrite: false,
  transparent: true,
  sizeAttenuation: true,
  fog: false,
}

/** Drawn after the world and the action (screen-space light). */
const FLARE_RENDER_ORDER = 900

interface Drawn {
  /** The effect event that creates this flare. */
  event: number
  sprite: THREE.Sprite
  flare: PadFlare
  reflection: PadReflection
  source: THREE.Vector3
  light: THREE.Color
}

/** The pads' lens flares: built once the library's entry and the layer's pads are both known. */
export class PadGlow3d {
  private readonly field: IndexField<PadGlowData>
  private readonly base: string
  readonly root = new THREE.Group()
  private readonly textures = new Map<string, THREE.Texture>()
  private readonly materials: THREE.SpriteMaterial[] = []
  private drawn: Drawn[] = []
  private volumes: LightVolumeMesh[] = []
  private sources: THREE.Vector3[] = []
  private built = false
  private data: PadGlowData | null = null
  private readonly toSource = new THREE.Vector3()
  private readonly forward = new THREE.Vector3()

  constructor(scene: THREE.Scene, base: string, fetchJson?: FetchJson) {
    this.base = base
    this.field = new IndexField(base, parsePadGlow, fetchJson)
    this.root.name = 'pad-glow'
    scene.add(this.root)
  }

  /** setObjects takes the posed layer's object table (null: no layer, no glow). */
  setObjects(objects: unknown): void {
    this.sources = padSources(objects)
    this.clear()
  }

  /**
   * update places and weighs every flare for `camera` as placed this frame, `seconds` into the
   * replay (the pads' effect runs from the replay's start, an inference: when the game started it
   * is not published).
   */
  update(camera: THREE.PerspectiveCamera, seconds: number, occluded: FlareOccluded): void {
    if (!this.built) {
      const data = this.field.get()
      if (!data || this.sources.length === 0) return
      this.build(data)
    }
    const active = this.data ? activeEvents(this.data, seconds) : []
    for (const m of this.volumes) m.update(camera, { systemAge: seconds })
    camera.getWorldDirection(this.forward)
    const hidden = new Map<THREE.Vector3, boolean>()
    for (const d of this.drawn) {
      this.toSource.subVectors(d.source, camera.position)
      const distance = this.toSource.length()
      const angle = distance > 0 ? this.forward.angleTo(this.toSource) : 0
      let w = active[d.event] ? flareWeight(d.flare, distance, angle) : 0
      if (w > 0) {
        let h = hidden.get(d.source)
        if (h === undefined) hidden.set(d.source, (h = occluded(d.source)))
        if (h) w = 0
      }
      d.sprite.visible = w > 0
      if (w <= 0) continue
      const r = d.reflection
      const radius = r.radius.max * PAD_LENS_RADIUS_MODIFIER
      // World units: the sprite spans its scale. It stands its own radius toward the camera so the
      // pad's surface does not cut it, while whatever is nearer (the held weapon, a wall) hides it.
      d.sprite.scale.set(2 * radius * r.scaleX.max, 2 * radius * r.scaleY.max, 1)
      d.sprite.position.copy(d.source).addScaledVector(this.toSource, -Math.min(radius, distance / 2) / Math.max(distance, 1e-6))
      ;(d.sprite.material as THREE.SpriteMaterial).color.copy(d.light).multiplyScalar(w)
    }
  }

  private build(data: PadGlowData): void {
    this.built = true
    this.data = data
    // The cone's generator is created by its event and kept through the loop (an inference: the
    // game shows it steadily), so it is drawn whatever event plays.
    for (const source of this.sources) {
      for (const e of data.events) for (const v of e.volumes) {
        const m = new LightVolumeMesh(v, source, CONE_AXIS)
        m.mesh.renderOrder = FLARE_RENDER_ORDER - 1
        this.root.add(m.mesh)
        this.volumes.push(m)
      }
    }
    for (const source of this.sources) {
      for (const [event, { flares }] of data.events.entries()) for (const flare of flares) {
        for (const reflection of flare.reflections) {
          const c = reflection.color.color!
          // The game's strength through the view's compression of material light (`glowLevel`), as
          // every other game glow is drawn.
          const light = new THREE.Color().setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace).multiplyScalar(glowLevel(reflection.intensity.max))
          const material = new THREE.SpriteMaterial({ ...ADD_LIGHT, map: this.texture(reflection.texture, reflection.srgb), rotation: THREE.MathUtils.degToRad(reflection.rotationOffset) })
          this.materials.push(material)
          const sprite = new THREE.Sprite(material)
          sprite.position.copy(source)
          sprite.renderOrder = FLARE_RENDER_ORDER
          sprite.frustumCulled = false
          sprite.visible = false
          this.root.add(sprite)
          this.drawn.push({ event, sprite, flare, reflection, source, light })
        }
      }
    }
  }

  private texture(file: string, srgb: boolean): THREE.Texture {
    let tex = this.textures.get(file)
    if (!tex) {
      tex = libraryTexture(`${this.base}/${file}`, (err) => console.warn('replay 3D: pad glow texture unavailable', file, err))
      tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
      this.textures.set(file, tex)
    }
    return tex
  }

  private clear(): void {
    for (const m of this.volumes) {
      this.root.remove(m.mesh)
      m.dispose()
    }
    this.volumes = []
    for (const d of this.drawn) this.root.remove(d.sprite)
    for (const m of this.materials) m.dispose()
    this.materials.length = 0
    this.drawn = []
    this.built = false
  }

  dispose(): void {
    this.clear()
    this.root.removeFromParent()
    this.field.dispose()
    for (const t of this.textures.values()) t.dispose()
    this.textures.clear()
  }
}
