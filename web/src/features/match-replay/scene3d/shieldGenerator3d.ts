// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * shieldGenerator3d.ts — THE SPARTAN SHIELD'S IMPACT, as the game's own effect generator draws it.
 *
 * The weapon library's index carries `shield_hit` (Go `weapons.ShieldGenerator`): the parameters of
 * the shield's third-person impact generator (`efge` 70e04608, named by the Spartan's model), read
 * from its material at build time, and the textures it samples (`fx-*.png`, decoded from the
 * game's bitmaps at build time). Its pixel shader (DXIL, disassembled) composes, with N.V the
 * facing ratio, uv the mesh's texture coordinates, t the game time:
 *
 *   edge   = band(N.V; edge radii)^4               pmask = band(N.V; plasma radii)
 *   p1     = noise1(uv*tile*scale1 + t*speed*(1/24, 1/26))^sharp0 * intensity0
 *   p2     = noise2(uv*tile*scale2 + t*speed*(-1/22, 1/34))^sharp1 * intensity1
 *   plasma = blend(p1, p2), mode 0: saturate(1 - |p1 - p2|)^mix(centerSharpness, edgeSharpness, pmask)
 *   out    = edge*edgeColor + flatColor + (mix(centerColor, plasmaEdgeColor, pmask) + hitColor*hitMask) * plasma
 *
 * added over the scene (the generator's blend mode). For the shield impact the noise is the
 * game's hex grid, the second noise a white default texture, the edge and plasma intensities are
 * constants of 0: what shows is the hit color through the hex pattern, the pattern alone where the
 * body faces the camera, solid toward its silhouette (the exponent goes to 0 at grazing angles).
 *
 * NOT decoded (stated, not guessed):
 *  - the hit intensity and the hit radius are GPU functions of the time since the impact whose
 *    curves are in the tag but not read: the hit level is the film's measured shield drop
 *    (`ShieldFx.hit`, `shields3d`) instead, and the mask is the whole shell (the film carries no
 *    impact point, so `hitMask` is 1);
 *  - the override color slots are engine runtime colors: the team color stands for them;
 *  - the engine's exposure (`exposureAmount` times its alternate exposure) is not applied.
 */
import * as THREE from 'three'

import { IndexField, type FetchJson } from './indexField3d'

/** A GPU property: a constant, or a function of an engine input whose curve is not decoded. */
export interface GeneratorProperty {
  constant?: number
  input?: string
}

export interface GeneratorTexture {
  file: string
  srgb: boolean
}

/** The generator's parameters, by the shader's names (Go `weapons.ShieldGenerator`). */
export interface ShieldGenerator {
  generator: string
  additive: boolean
  tintInsteadOfReplace: boolean
  edgeColorMode: number
  plasmaCenterColorMode: number
  plasmaEdgeColorMode: number
  hitColorMode: number
  flatColorMode: number
  edgeGlowIntensity: GeneratorProperty
  plasmaCenterIntensity: GeneratorProperty
  plasmaEdgeIntensity: GeneratorProperty
  flatColorIntensity: GeneratorProperty
  extrusionDistance: GeneratorProperty
  oscillationAmplitude: GeneratorProperty
  hitIntensity: GeneratorProperty
  hitRadius: GeneratorProperty
  colorOverrideDesaturation: GeneratorProperty
  flatColor: [number, number, number]
  edgeOuterFadeRadius: number
  edgeInnerFadeRadius: number
  edgeScaleOuter: number
  edgeScaleInner: number
  noiseBlendMode: number
  plasma0Intensity: number
  plasma0Sharpness: number
  noise1UScale: number
  noise1VScale: number
  plasma1Intensity: number
  plasma1Sharpness: number
  noise2UScale: number
  noise2VScale: number
  plasmaTileScale: number
  plasmaScrollSpeed: number
  plasmaEdgeSharpness: number
  plasmaCenterSharpness: number
  plasmaOuterFadeRadius: number
  plasmaInnerFadeRadius: number
  plasmaEdgeScaleInner: number
  plasmaEdgeScaleOuter: number
  useHitBlob: boolean
  exposureAmount: number
  noise1: GeneratorTexture
  noise2: GeneratorTexture
  hitBlob: GeneratorTexture
}

/** The shield impact ready to draw: its parameters and its two noise textures. */
export interface ShieldHitLook {
  gen: ShieldGenerator
  noise1: THREE.Texture
  noise2: THREE.Texture
}

const NUMBER_FIELDS = [
  'edgeColorMode', 'plasmaCenterColorMode', 'plasmaEdgeColorMode', 'hitColorMode', 'flatColorMode',
  'edgeOuterFadeRadius', 'edgeInnerFadeRadius', 'edgeScaleOuter', 'edgeScaleInner', 'noiseBlendMode',
  'plasma0Intensity', 'plasma0Sharpness', 'noise1UScale', 'noise1VScale', 'plasma1Intensity', 'plasma1Sharpness',
  'noise2UScale', 'noise2VScale', 'plasmaTileScale', 'plasmaScrollSpeed', 'plasmaEdgeSharpness',
  'plasmaCenterSharpness', 'plasmaOuterFadeRadius', 'plasmaInnerFadeRadius', 'plasmaEdgeScaleInner',
  'plasmaEdgeScaleOuter', 'exposureAmount',
] as const
const PROPERTY_FIELDS = [
  'edgeGlowIntensity', 'plasmaCenterIntensity', 'plasmaEdgeIntensity', 'flatColorIntensity', 'extrusionDistance',
  'oscillationAmplitude', 'hitIntensity', 'hitRadius', 'colorOverrideDesaturation',
] as const
const TEXTURE_FIELDS = ['noise1', 'noise2', 'hitBlob'] as const

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function isProperty(v: unknown): v is GeneratorProperty {
  return isRecord(v) && (v.constant === undefined || typeof v.constant === 'number') &&
    (v.input === undefined || typeof v.input === 'string')
}

/** parseShieldHit reads `shield_hit` out of the weapon library index (null: absent or malformed). */
export function parseShieldHit(doc: unknown): ShieldGenerator | null {
  if (!isRecord(doc)) return null
  const g = doc.shield_hit
  if (!isRecord(g) || typeof g.generator !== 'string') return null
  if (NUMBER_FIELDS.some((k) => typeof g[k] !== 'number')) return null
  if (PROPERTY_FIELDS.some((k) => !isProperty(g[k]))) return null
  if (TEXTURE_FIELDS.some((k) => !isRecord(g[k]) || typeof (g[k] as Record<string, unknown>).file !== 'string')) return null
  if (!Array.isArray(g.flatColor) || g.flatColor.length !== 3) return null
  return g as unknown as ShieldGenerator
}

/** constantOf: a property's value when it is a constant, `fallback` when it is an undecoded function. */
export function constantOf(p: GeneratorProperty, fallback: number): number {
  return p.constant ?? fallback
}

/**
 * bandMask: the shader's fade band on the facing ratio `nv`, rising from `outer` with slope
 * `scaleOuter` and falling to `inner` with slope `scaleInner` (negative), clamped to 0..1.
 */
export function bandMask(nv: number, outer: number, inner: number, scaleOuter: number, scaleInner: number): number {
  return Math.min(1, Math.max(0, Math.min(scaleOuter * (nv - outer), scaleInner * (nv - inner))))
}

/** plasmaExponent: the plasma's sharpness at the plasma band `pmask` (center at 0, edge at 1). */
export function plasmaExponent(g: ShieldGenerator, pmask: number): number {
  return g.plasmaCenterSharpness + (g.plasmaEdgeSharpness - g.plasmaCenterSharpness) * pmask
}

/**
 * hitLevel: the impact's strength at one frame, from the film's shield measurements: the hit's
 * glow, or the break (the hit that empties the shield), whichever is stronger.
 */
export function hitLevel(shield: { hit: number; broke: number }): number {
  return Math.max(shield.hit, shield.broke)
}

// The luminance weights of the vertex shader's color desaturation.
const LUMA = [0.2125, 0.7154, 0.0721] as const

/**
 * slotColor: the color of override slot `mode` (the engine's runtime colors; the team color
 * stands for them), desaturated by `desaturation` for slots 1..3 as the vertex shader does; slot 0
 * (the property's own color, not decoded) is black. Written in `out`.
 */
export function slotColor(mode: number, team: THREE.Color, desaturation: number, out: THREE.Color): THREE.Color {
  if (mode < 1 || mode > 4) return out.setRGB(0, 0, 0)
  out.copy(team)
  if (mode <= 3 && desaturation !== 0) {
    const l = LUMA[0] * team.r + LUMA[1] * team.g + LUMA[2] * team.b
    const d = Math.min(1, Math.max(0, desaturation))
    out.setRGB(team.r + (l - team.r) * d, team.g + (l - team.g) * d, team.b + (l - team.b) * d)
  }
  return out
}

/**
 * termColor: one of the shader's color terms, its slot's color times its intensity. A tinting
 * generator multiplies by the property's own color, not decoded: the term is not drawn.
 */
export function termColor(g: ShieldGenerator, mode: number, intensity: number, team: THREE.Color, out: THREE.Color): THREE.Color {
  if (g.tintInsteadOfReplace || intensity === 0) return out.setRGB(0, 0, 0)
  return slotColor(mode, team, constantOf(g.colorOverrideDesaturation, 0), out).multiplyScalar(intensity)
}

/** The shield impact's library entry and textures, read on first use. */
export class ShieldHitAssets {
  private readonly field: IndexField<ShieldGenerator>
  private readonly base: string
  private readonly textures: THREE.Texture[] = []
  private look: ShieldHitLook | null = null

  constructor(base: string, fetchJson?: FetchJson) {
    this.base = base
    this.field = new IndexField(base, parseShieldHit, fetchJson)
  }

  /** get: the impact's look, null until the library's entry is read (or when it has none). */
  get(): ShieldHitLook | null {
    if (this.look) return this.look
    const gen = this.field.get()
    if (!gen) return null
    this.look = { gen, noise1: this.texture(gen.noise1), noise2: this.texture(gen.noise2) }
    return this.look
  }

  private texture(t: GeneratorTexture): THREE.Texture {
    const tex = new THREE.TextureLoader().load(`${this.base}/${t.file}`, undefined, undefined, (err) => {
      console.warn('replay 3D: shield impact texture unavailable', t.file, err)
    })
    // D3D's convention, as the mesh's glTF texture coordinates: v = 0 is the image's first row.
    tex.flipY = false
    tex.colorSpace = t.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    // The shader scrolls the coordinates: the pattern tiles.
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    this.textures.push(tex)
    return tex
  }

  dispose(): void {
    this.field.dispose()
    for (const t of this.textures) t.dispose()
    this.textures.length = 0
    this.look = null
  }
}
