// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * weaponIdleEffects3d.ts — THE PARTICLE EFFECTS HELD WEAPONS CARRY, drawn from the weapon library
 * (`idle_effects`, `weaponIdleEffects3dModel` for the data and the simulation): the Shock Rifle's
 * electricity around its barrel housing, and any other weapon whose tags give one.
 *
 * WHERE: third person on the weapon each holder is drawn holding (`drawnWeapon`), at the effect's
 * markers of the weapon model; first person on the first-person rig's weapon, at the same markers on
 * the rig's weapon bone (`firstPersonEffectAnchor`; the followed player's own avatar is not drawn
 * then). A system draws only in the view its camera mode names, and not while scoped when it is
 * turned off in aimed-down-sight.
 *
 * WHEN: the effect's A scale is its weapon functions' (`effectScales`): on while the weapon is ready
 * (held, its ready animation over: the rig's `ready` clip length after a weapon change) and not
 * reloading (a reload of the film, from its start to the rig's reload clip length, cut by a shot).
 * The "Shots" switch hides them with the other shot effects.
 *
 * HOW (the two particle shaders, decoded from their DXIL, `himap/effet_arme.go`): the sprite shader
 * reads the base texture's red (inverted on request) at the particle's frame, looks it up in the
 * palette at the particle's palette row, multiplies by the vertex color; its alpha is the alpha map's
 * red or alpha times the vertex alpha. The model shader adds scrolling UVs (rotation, scale, random
 * offset, slide over the particle's age), a UV distortion map and a fresnel opacity. Blend mode 9 is
 * additive weighted by alpha; values above the bloom threshold bloom.
 *
 * INFERRED, not read: a mesh's normals (smooth, by position: the exported meshes carry none), the
 * `ready` function following the first-person ready animation's length.
 */
import * as THREE from 'three'

import { api } from '@/lib/api/client'
import { frameToMs } from '@/lib/replay/replayLogic'

import { armeEnMain } from '../model/armeEnMain'
import { episodesRechargementParSlot } from './actionsFilm3d'
import type { ActionContext, ActionLayer3d } from './actionScene3d'
import { heldWeaponAt } from './heldWeapon3d'
import { IndexField, type FetchJson } from './indexField3d'
import { dureeAttendue, finNaturelle, type EpisodeRechargement } from './rechargementPremierePersonne3d'
import {
  effectScales,
  magazineFraction,
  parseIdleEffects,
  reloadingAt,
  simulateSystem,
  systemShown,
  type IdleEffect,
  type IdleEffectTable,
  type IdleSystem,
  type LiveParticle,
  type MagazineEvent,
  type ReloadSpan,
} from './weaponIdleEffects3dModel'
import { weaponModelKey } from './weaponModels3d'

/** Blend mode 9 of a particle (`himap` melangeAddSrcAlpha): dst + src x src alpha. */
const BLEND_ADD_SRC_ALPHA = 9
/** The two particle shaders the view draws. */
const SHADER_SPRITE = '9b1c511e'
const SHADER_MODEL = '96db07b6'
/**
 * Systems not drawn, as weapon key:effect:system, until their model particle's stretch is decoded
 * (docs/KNOWN-ISSUES.md, the model particles' scale x and scale y). The Heatwave's ready glow (its
 * scale x is 5) drawn at its size alone shows as a round disc beside the gun in first person.
 */
const UNDECODED_SYSTEMS: ReadonlySet<string> = new Set(['2ac9c2ff:67537d26:0'])

/** Billboards a sprite draws with: facing the screen or camera, or perpendicular to its direction. */
const BILLBOARD_SCREEN = 0
const BILLBOARD_CAMERA = 1
const BILLBOARD_PERPENDICULAR = 3
/** Instances per drawn system (every holder's particles of it). */
const POOL_CAPACITY = 512

/** The weapon library's idle effects and their files, read on first use. */
export class IdleEffectAssets {
  private readonly table: IndexField<IdleEffectTable>
  private readonly base: string
  private readonly textures = new Map<string, THREE.Texture>()
  private readonly meshes = new Map<string, THREE.BufferGeometry | null>()
  private readonly abort = new AbortController()

  constructor(base: string, fetchJson?: FetchJson) {
    this.base = base
    this.table = new IndexField(base, parseIdleEffects, fetchJson)
  }

  effects(key: string): readonly IdleEffect[] | null {
    return this.table.get()?.[key] ?? null
  }

  /** texture is the library file `file`, its texels read as the shader reads them (sRGB or not). */
  texture(file: string, srgb: boolean): THREE.Texture {
    let t = this.textures.get(file)
    if (!t) {
      t = new THREE.TextureLoader().load(`${this.base}/${file}`, undefined, undefined, (err) => {
        console.warn('replay 3D: weapon effect texture unavailable', file, err)
      })
      // D3D's convention: v = 0 is the image's first row (the layers of an array stack downward).
      t.flipY = false
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
      t.generateMipmaps = false
      t.minFilter = THREE.LinearFilter
      this.textures.set(file, t)
    }
    return t
  }

  /** mesh is the particle mesh `file` (null until read, or when unreadable). */
  mesh(file: string): THREE.BufferGeometry | null {
    if (!this.meshes.has(file)) {
      this.meshes.set(file, null)
      api.getResponse(`${this.base}/${file}`, { signal: this.abort.signal })
        .then((r) => r.arrayBuffer())
        .then((b) => this.meshes.set(file, particleMesh(new Float32Array(b))))
        .catch((err: unknown) => {
          if (!this.abort.signal.aborted) console.warn('replay 3D: weapon effect mesh unavailable', file, err)
        })
    }
    return this.meshes.get(file) ?? null
  }

  dispose(): void {
    this.abort.abort()
    this.table.dispose()
    for (const t of this.textures.values()) t.dispose()
    for (const m of this.meshes.values()) m?.dispose()
    this.textures.clear()
    this.meshes.clear()
  }
}

/**
 * particleMesh builds a particle mesh from the library's records (x, y, z, u, v; three per
 * triangle), with smooth normals by position (the fresnel term reads them; inferred, header).
 */
export function particleMesh(rec: Float32Array): THREE.BufferGeometry {
  const n = Math.floor(rec.length / 5)
  const pos = new Float32Array(n * 3)
  const uv = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) {
    pos.set(rec.subarray(5 * i, 5 * i + 3), 3 * i)
    uv.set(rec.subarray(5 * i + 3, 5 * i + 5), 2 * i)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setAttribute('normal', new THREE.BufferAttribute(smoothNormals(pos), 3))
  return g
}

/** smoothNormals: per vertex, the area-weighted normal of the faces sharing its position. */
export function smoothNormals(pos: Float32Array): Float32Array {
  const key = (i: number) => `${Math.round(pos[3 * i] * 1e5)},${Math.round(pos[3 * i + 1] * 1e5)},${Math.round(pos[3 * i + 2] * 1e5)}`
  const sum = new Map<string, [number, number, number]>()
  const n = pos.length / 3
  for (let t = 0; t + 2 < n; t += 3) {
    const [ax, ay, az] = [pos[3 * t], pos[3 * t + 1], pos[3 * t + 2]]
    const [ux, uy, uz] = [pos[3 * t + 3] - ax, pos[3 * t + 4] - ay, pos[3 * t + 5] - az]
    const [vx, vy, vz] = [pos[3 * t + 6] - ax, pos[3 * t + 7] - ay, pos[3 * t + 8] - az]
    const f: [number, number, number] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
    for (let k = 0; k < 3; k++) {
      const s = sum.get(key(t + k)) ?? [0, 0, 0]
      s[0] += f[0]; s[1] += f[1]; s[2] += f[2]
      sum.set(key(t + k), s)
    }
  }
  const out = new Float32Array(pos.length)
  for (let i = 0; i < n; i++) {
    const s = sum.get(key(i)) ?? [0, 0, 1]
    const l = Math.hypot(s[0], s[1], s[2]) || 1
    out[3 * i] = s[0] / l; out[3 * i + 1] = s[1] / l; out[3 * i + 2] = s[2] / l
  }
  return out
}

/** The unit sprite quad: half side 1 in X and Y, normal +Z, D3D UVs (v = 0 at the top). */
function spriteQuad(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 1, 0, 1, 1, 0, -1, -1, 0, 1, -1, 0]), 3))
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2))
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3))
  g.setIndex([0, 2, 1, 1, 2, 3])
  return g
}

const VERTEX = /* glsl */ `
attribute vec4 aColor;
attribute vec4 aParams;
attribute vec4 aBill;
attribute vec4 aRand;
uniform float uFacing;
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vParams;
varying vec4 vRand;
varying vec3 vNormalW;
varying vec3 vViewW;
void main() {
  vUv = uv;
  vColor = aColor;
  vParams = aParams;
  vRand = aRand;
  mat4 m = modelMatrix * instanceMatrix;
  if (uFacing > 0.5) {
    vec4 mv = viewMatrix * (m * vec4(0.0, 0.0, 0.0, 1.0));
    float s = sin(aBill.z);
    float c = cos(aBill.z);
    vec2 p = vec2(position.x * aBill.x, position.y * aBill.y);
    mv.xy += vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    vNormalW = vec3(0.0, 0.0, 1.0);
    vViewW = vec3(0.0, 0.0, 1.0);
    gl_Position = projectionMatrix * mv;
  } else {
    vec4 w = m * vec4(position, 1.0);
    vNormalW = normalize(mat3(m) * normal);
    vViewW = cameraPosition - w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
}`

const FRAGMENT = /* glsl */ `
uniform sampler2D uBase;
uniform sampler2D uAlpha;
uniform sampler2D uPalette;
uniform vec2 uLayers;
uniform vec2 uFrames;
uniform vec4 uBaseXf;
uniform vec4 uAlphaXf;
uniform vec4 uFlags;
uniform vec4 uAlphaAnim;
uniform vec4 uBaseBW;
uniform vec4 uAlphaBW;
#ifdef MODEL_SHADER
uniform sampler2D uDist;
uniform vec4 uDistXf;
uniform vec4 uSlide;
uniform vec4 uScale;
uniform vec4 uScroll;
uniform vec4 uDistort;
uniform vec4 uFresnel;
uniform float uDistSigned;
#endif
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vParams;
varying vec4 vRand;
varying vec3 vNormalW;
varying vec3 vViewW;

vec4 layerAt(sampler2D t, float layers, vec2 uv, float layer) {
  vec2 f = fract(uv);
  return texture2D(t, vec2(f.x, (clamp(layer, 0.0, layers - 1.0) + f.y) / layers));
}

float blackWhite(float v, vec4 bw) {
  return bw.x > 0.5 ? clamp((v - bw.y) / max(1e-5, bw.z - bw.y), 0.0, 1.0) : v;
}

#ifdef MODEL_SHADER
vec2 scrolled(vec2 uv, float t) {
  float a = uScroll.x * t;
  vec2 c = uv - 0.5;
  c = vec2(cos(a) * c.x - sin(a) * c.y, sin(a) * c.x + cos(a) * c.y);
  vec2 r = uScale.zw * t;
  vec2 k = vec2(uScale.z >= 0.0 ? 1.0 + r.x : 1.0 / (1.0 + r.x), uScale.w >= 0.0 ? 1.0 + r.y : 1.0 / (1.0 + r.y));
  vec2 o = (c + 0.5) / (uScale.xy * k);
  if (uScroll.y > 0.5) o += vRand.xy;
  return o - uSlide.xy * t;
}
#endif

void main() {
  float frame = vParams.y;
  vec2 baseUV = vUv;
  vec2 alphaUV = vUv;
#ifdef MODEL_SHADER
  float t = vParams.z;
  vec2 s = scrolled(vUv, t);
  if (uDistort.z > 0.5) baseUV = s;
  if (uDistort.w > 0.5) alphaUV = s;
  vec2 duv = vUv + (uScroll.z > 0.5 ? vRand.zw : vec2(0.0)) - uSlide.zw * t;
  vec2 d = texture2D(uDist, fract(duv * uDistXf.xy + uDistXf.zw)).rg;
  if (uDistSigned > 0.5) d = d * 2.0 - 1.0;
  if (uScroll.w < 0.5) d -= 0.5;
  baseUV += d * uDistort.x;
  alphaUV += d * uDistort.y;
#endif
  float base = layerAt(uBase, uLayers.x, baseUV * uBaseXf.xy + uBaseXf.zw, floor(fract(frame) * uFrames.x)).r;
  if (uFlags.x > 0.5) base = 1.0 - base;
  base = blackWhite(base, uBaseBW);
  float alphaFrame = uFlags.w > 0.5 ? frame : uAlphaAnim.x + uAlphaAnim.y * vParams.z;
  vec4 a4 = layerAt(uAlpha, uLayers.y, alphaUV * uAlphaXf.xy + uAlphaXf.zw, floor(fract(alphaFrame) * uFrames.y));
  float alpha = uFlags.y > 0.5 ? a4.r : a4.a;
  if (uFlags.z > 0.5) alpha = 1.0 - alpha;
  alpha = blackWhite(alpha, uAlphaBW);
  vec3 color = texture2D(uPalette, vec2(base, vParams.x)).rgb * vColor.rgb;
  float o = alpha * vColor.a;
#ifdef MODEL_SHADER
  float f = clamp(abs(dot(normalize(vViewW), normalize(vNormalW))), 0.0, 1.0);
  if (uFresnel.w > 0.5) f = 1.0 - f;
  o *= uFresnel.z + (1.0 - uFresnel.z) * uFresnel.x * pow(f, uFresnel.y);
#endif
  if (o <= 0.0) discard;
  gl_FragColor = vec4(color, o);
}`

/** One drawn system: its instanced mesh and per-instance attributes. */
interface Pool {
  mesh: THREE.InstancedMesh
  color: THREE.InstancedBufferAttribute
  params: THREE.InstancedBufferAttribute
  bill: THREE.InstancedBufferAttribute
  rand: THREE.InstancedBufferAttribute
  mode: 'perpendicular' | 'facing' | 'mesh'
  n: number
}

const num = (c: Record<string, number[]>, name: string, i = 0, d = 0) => c[name]?.[i] ?? d
const vec4Of = (c: Record<string, number[]>, name: string) => new THREE.Vector4(num(c, name, 0, 1), num(c, name, 1, 1), num(c, name, 2, 0), num(c, name, 3, 0))

/** The pool's mode for system `s`, null when the view does not draw it (a shader or billboard it lacks). */
function modeOf(s: IdleSystem): Pool['mode'] | null {
  if (s.render.shader !== SHADER_SPRITE && s.render.shader !== SHADER_MODEL) return null
  if (s.render.model) return 'mesh'
  if (s.emitter.billboard === BILLBOARD_PERPENDICULAR) return 'perpendicular'
  if (s.emitter.billboard === BILLBOARD_SCREEN || s.emitter.billboard === BILLBOARD_CAMERA) return 'facing'
  return null
}

/** materialOf builds the shader material of system `s` (null while a texture is missing from it). */
function materialOf(s: IdleSystem, assets: IdleEffectAssets, mode: Pool['mode']): THREE.ShaderMaterial | null {
  const r = s.render
  const tex = (name: string) => r.textures.find((t) => t.name === name)
  const base = tex('baseTexture')
  const alpha = tex('alphaMap')
  const palette = tex('paletteTexture')
  if (!base || !alpha || !palette) return null
  const model = r.shader === SHADER_MODEL
  const dist = model ? tex('uvDistortionMap') : undefined
  if (model && !dist) return null
  const c = r.constants
  const uniforms: Record<string, THREE.IUniform> = {
    uFacing: { value: mode === 'facing' ? 1 : 0 },
    uBase: { value: assets.texture(base.file, base.srgb) },
    uAlpha: { value: assets.texture(alpha.file, alpha.srgb) },
    uPalette: { value: assets.texture(palette.file, palette.srgb) },
    uLayers: { value: new THREE.Vector2(Math.max(1, base.layers), Math.max(1, alpha.layers)) },
    uFrames: { value: new THREE.Vector2(Math.max(1, num(c, 'baseTexture_texture_frameCount', 0, 1)), Math.max(1, num(c, 'alphaMap_texture_frameCount', 0, 1))) },
    uBaseXf: { value: vec4Of(c, 'baseTexture_texture_transform') },
    uAlphaXf: { value: vec4Of(c, 'alphaMap_texture_transform') },
    uFlags: { value: new THREE.Vector4(num(c, 'baseTextureInvert'), num(c, 'useAlphaMapRed'), num(c, 'alphaTextureInvert'), num(c, 'SYNC_TEXTURE_ANIM')) },
    uAlphaAnim: { value: new THREE.Vector4(num(c, 'alphaMapFrameIndex'), num(c, 'alphaMapAnimationRate'), 0, 0) },
    uBaseBW: { value: new THREE.Vector4(num(c, 'ALBEDO_BLACK_WHITE_POINT'), num(c, 'baseTextureBlackPoint'), num(c, 'baseTextureWhitePoint', 0, 1), 0) },
    uAlphaBW: { value: new THREE.Vector4(num(c, 'ALPHA_BLACK_WHITE_POINT'), num(c, 'alphaTextureBlackPoint'), num(c, 'alphaTextureWhitePoint', 0, 1), 0) },
  }
  if (model && dist) {
    uniforms.uDist = { value: assets.texture(dist.file, dist.srgb) }
    uniforms.uDistXf = { value: vec4Of(c, 'uvDistortionMap_texture_transform') }
    uniforms.uSlide = { value: new THREE.Vector4(num(c, 'basemapSlideU'), num(c, 'basemapSlideV'), num(c, 'uvDistortionMapSlideU'), num(c, 'uvDistortionMapSlideV')) }
    uniforms.uScale = { value: new THREE.Vector4(num(c, 'basemapScaleU', 0, 1) || 1, num(c, 'basemapScaleV', 0, 1) || 1, num(c, 'basemapScaleRateU'), num(c, 'basemapScaleRateV')) }
    uniforms.uScroll = { value: new THREE.Vector4(num(c, 'basemapRotationRate'), num(c, 'basemapRandomOffset'), num(c, 'uvDistortionRandomOffset'), num(c, 'distortionMapIsZeroCentered')) }
    uniforms.uDistort = { value: new THREE.Vector4(num(c, 'baseMapUVDistortionStrength'), num(c, 'alphaMapUVDistortionStrength'), num(c, 'baseMapUseScrollingUV'), num(c, 'alphaMapUseScrollingUV')) }
    uniforms.uFresnel = { value: new THREE.Vector4(num(c, 'fresnelIntensity', 0, 1), num(c, 'fresnelPower', 0, 1), num(c, 'opacityMin'), num(c, 'fresnelInvert')) }
    uniforms.uDistSigned = { value: dist.signed ? 1 : 0 }
  }
  const additive = r.blendMode === BLEND_ADD_SRC_ALPHA
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    defines: model ? { MODEL_SHADER: '' } : {},
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  })
}

/** A holder's weapon timeline: its reloads, shots and the frames its weapon changed. */
interface SlotTimeline {
  reloads: ReloadSpan[]
  shots: number[]
  changes: number[]
  /** The film's magazine readings and the holder's shots, by weapon slot, sorted by ms. */
  magazines: Map<number, MagazineEvent[]>
  /** The reload episodes, with the weapon slot in hand at their start. */
  episodes: { ep: EpisodeRechargement; w: number | null }[]
}

const ANCHOR = new THREE.Matrix4()
const LOCAL = new THREE.Matrix4()
const WORLD = new THREE.Matrix4()
const ROOT_INV = new THREE.Matrix4()
const MARKER = new THREE.Matrix4()
const MARKER_Q = new THREE.Quaternion()
const AT = new THREE.Vector3()

/**
 * One drawn system instance, as the debug hook `window.__it3dIdleEffects` lists it: the weapon, effect,
 * system and marker instance, the view, how many particles it drew, and its marker's world position.
 * `window.__it3dIdleEffectsHide` (a list of `weapon:effect:system` keys) leaves those systems out, so a
 * shape on screen can be traced to the system that draws it.
 */
export interface IdleEffectDebugRow {
  key: string
  /** The holder: its film slot and player. */
  slot: number
  xuid: string
  location: string
  instance: number
  firstPerson: boolean
  particles: number
  marker: [number, number, number]
  /** A first-person system whose rig anchor failed (particles -1): why. */
  miss?: string
}

declare global {
  interface Window {
    __it3dIdleEffects?: readonly IdleEffectDebugRow[]
    __it3dIdleEffectsHide?: readonly string[]
  }
}

const DEBUG_HOOK = '__it3dIdleEffects'
const X = new THREE.Vector3()
const Y = new THREE.Vector3()
const Z = new THREE.Vector3()
const U = new THREE.Vector3()
const W = new THREE.Vector3()

/** WeaponIdleEffects3dLayer — the idle effects of every held weapon that has one (header). */
export class WeaponIdleEffects3dLayer implements ActionLayer3d {
  private readonly ctx: ActionContext
  private assets: IdleEffectAssets | null = null
  private readonly pools = new Map<string, Pool | null>()
  private readonly quad = spriteQuad()
  private readonly particles: LiveParticle[] = []
  private timelines: Map<number, SlotTimeline> | null = null
  private slotSeed: Map<number, number> | null = null
  private readonly fetchJson?: FetchJson
  private readonly debugRows: IdleEffectDebugRow[] = []

  constructor(ctx: ActionContext, fetchJson?: FetchJson) {
    this.ctx = ctx
    this.fetchJson = fetchJson
    if (typeof window !== 'undefined') {
      Object.defineProperty(window, DEBUG_HOOK, { configurable: true, enumerable: false, get: () => this.debugRows.slice() })
    }
  }

  update(frame: number): void {
    for (const p of this.pools.values()) if (p) p.n = 0
    this.debugRows.length = 0
    const inputs = this.ctx.inputs()
    if (inputs.show.shots) this.draw(frame, inputs.framesPerSecond, inputs.locale)
    for (const p of this.pools.values()) {
      if (!p) continue
      p.mesh.count = p.n
      p.mesh.visible = p.n > 0
      if (p.n === 0) continue
      p.mesh.instanceMatrix.needsUpdate = true
      p.color.needsUpdate = p.params.needsUpdate = p.bill.needsUpdate = p.rand.needsUpdate = true
    }
  }

  private draw(frame: number, framesPerSecond: number, locale: Parameters<typeof heldWeaponAt>[3]): void {
    const base = this.ctx.weaponLibrary?.() ?? null
    if (!base) return
    if (!this.assets) this.assets = new IdleEffectAssets(base, this.fetchJson)
    const fps = Math.max(1, framesPerSecond)
    const t = frame / fps
    const f = Math.floor(frame)
    const tracks = this.ctx.doc.tracks
    if (!this.slotSeed) this.slotSeed = new Map(tracks.map((tr, i) => [tr.slot, i]))
    const timelines = this.timelinesOf()
    const fpSlot = this.ctx.firstPersonSlot(frame)
    const scoped = this.ctx.scopeMounted?.() ?? false
    this.ctx.root.updateWorldMatrix(true, false)
    ROOT_INV.copy(this.ctx.root.matrixWorld).invert()
    for (const track of tracks) {
      if (!track.xuid) continue
      const held = heldWeaponAt(this.ctx.doc, track.slot, f, locale)
      const key = held ? weaponModelKey(held.id) : null
      const effects = key ? this.assets.effects(key) : null
      if (!key || !effects) continue
      const firstPerson = fpSlot === track.slot
      const drawn = firstPerson ? null : this.ctx.drawnWeapon(track.xuid)
      if (!firstPerson && !drawn) continue
      const line = timelines.get(track.slot)
      const readyS = this.ctx.weaponClipSeconds?.(key, 'ready') ?? 0
      const lastChange = line ? lastAtOrBefore(line.changes, f) : -Infinity
      const ready = f - lastChange >= readyS * fps
      const clipS = (action: string) => this.ctx.weaponClipSeconds?.(key, action) ?? null
      const reloading = !!line && reloadingAt(line.reloads, f, fps, clipS('reload_full'), line.shots)
      const seed = this.slotSeed.get(track.slot) ?? 0
      // The magazine of the weapon in hand: full at spawn, then the film's readings, shots and reloads.
      const hand = armeEnMain(this.ctx.doc, track.slot, f)
      const atMs = frameToMs(f, this.ctx.doc)
      const magazine = hand && line ? this.magazineEvents(line, hand.slotArme, clipS, atMs, fps) : []
      if (drawn) drawn.model.updateWorldMatrix(true, false)
      effects.forEach((e, ei) => {
        const scales = effectScales(e, { ready, reloading, ammo: magazineFraction(magazine, atMs, e.magazine) })
        if (scales.scaleA <= 0) return
        e.systems.forEach((s, si) => {
          if (!systemShown(s, firstPerson, scoped)) return
          const debugKey = `${key}:${e.effect}:${si}`
          if (UNDECODED_SYSTEMS.has(debugKey)) return
          if (typeof window !== 'undefined' && window.__it3dIdleEffectsHide?.includes(debugKey)) return
          const pool = this.poolOf(`${key}:${ei}:${si}`, s)
          if (!pool) return
          // Every instance of the marker (the Heatwave's vent marker is on both fins), in both views.
          const anchors = e.markers[s.location]?.length ?? 0
          for (let m = 0; m < anchors; m++) {
            if (firstPerson) {
              if (!this.ctx.firstPersonEffectAnchor?.(key, s.location, ANCHOR, m)) {
                // Listed, with no particles: the rig shown is not this weapon's, or lacks the marker or its bone.
                this.debugRows.push({ key: debugKey, slot: track.slot, xuid: track.xuid ?? '', location: s.location, instance: m, firstPerson, particles: -1, marker: [0, 0, 0], miss: this.ctx.firstPersonAnchorMiss?.() ?? 'unknown' })
                return
              }
            } else {
              // The marker's frame on the model: its position, then its rotation (the Heatwave's fins turn
              // their marker a quarter about up, so the vent points out of them).
              const at = e.markers[s.location][m]
              const q = e.markerRotations?.[s.location]?.[m]
              MARKER.makeRotationFromQuaternion(q ? MARKER_Q.set(q[0], q[1], q[2], q[3]) : MARKER_Q.identity()).setPosition(at[0], at[1], at[2])
              ANCHOR.copy(drawn!.model.matrixWorld).multiply(MARKER)
            }
            simulateSystem(s, t, seed * 64 + m, ei * 32 + si, { ...scales, cameraDistance: 0 }, this.particles)
            for (const p of this.particles) this.write(pool, p)
            AT.setFromMatrixPosition(ANCHOR)
            this.debugRows.push({ key: debugKey, slot: track.slot, xuid: track.xuid ?? '', location: s.location, instance: m, firstPerson, particles: this.particles.length, marker: [AT.x, AT.y, AT.z] })
          }
        })
      })
    }
  }

  /** write appends particle `p` of system `s` to its pool, in world space through ANCHOR. */
  private write(pool: Pool, p: LiveParticle): void {
    if (pool.n >= POOL_CAPACITY) return
    const i = pool.n++
    Z.set(p.dir[0], p.dir[1], p.dir[2])
    perpendicularTo(Z, U)
    W.crossVectors(Z, U)
    const c = Math.cos(p.angle)
    const sn = Math.sin(p.angle)
    X.copy(U).multiplyScalar(c).addScaledVector(W, sn)
    Y.copy(W).multiplyScalar(c).addScaledVector(U, -sn)
    if (pool.mode === 'perpendicular') {
      X.multiplyScalar(p.size * p.scaleX)
      Y.multiplyScalar(p.size * p.scaleY)
      LOCAL.makeBasis(X, Y, Z.multiplyScalar(p.size))
    } else if (pool.mode === 'mesh') {
      // The mesh in the marker's frame, rolled about the direction by its rotation, scaled by its size.
      LOCAL.makeRotationAxis(Z, p.angle).scale(X.setScalar(p.size))
    } else {
      LOCAL.identity()
    }
    LOCAL.setPosition(p.x, p.y, p.z)
    WORLD.copy(ROOT_INV).multiply(ANCHOR).multiply(LOCAL)
    pool.mesh.setMatrixAt(i, WORLD)
    pool.color.setXYZW(i, p.r, p.g, p.b, p.alpha)
    pool.params.setXYZW(i, p.palette, p.frame, p.age, 0)
    // A screen-facing sprite's half sides in view space: the anchor's scale applies (the rig's).
    const k = ANCHOR.getMaxScaleOnAxis()
    pool.bill.setXYZW(i, p.size * p.scaleX * k, p.size * p.scaleY * k, p.angle, 0)
    pool.rand.setXYZW(i, p.rand0, p.rand1, p.rand1, p.rand0)
  }

  private poolOf(id: string, s: IdleSystem): Pool | null {
    if (this.pools.has(id)) return this.pools.get(id) ?? null
    const assets = this.assets
    const mode = modeOf(s)
    if (!assets || !mode) {
      if (!mode) console.warn('replay 3D: weapon effect system not drawn (shader or billboard unsupported)', s.particle, s.render.shader, s.emitter.billboard)
      this.pools.set(id, null)
      return null
    }
    const geometry = s.render.model ? assets.mesh(s.render.model) : this.quad
    if (!geometry) return null // the mesh is loading: asked again next frame
    const material = materialOf(s, assets, mode)
    if (!material) {
      this.pools.set(id, null)
      return null
    }
    const g = new THREE.BufferGeometry()
    for (const name of ['position', 'uv', 'normal']) g.setAttribute(name, geometry.getAttribute(name))
    if (geometry.index) g.setIndex(geometry.index)
    const attr = (n: number) => new THREE.InstancedBufferAttribute(new Float32Array(POOL_CAPACITY * n), n).setUsage(THREE.DynamicDrawUsage)
    const pool: Pool = { mesh: new THREE.InstancedMesh(g, material, POOL_CAPACITY), color: attr(4), params: attr(4), bill: attr(4), rand: attr(4), mode, n: 0 }
    g.setAttribute('aColor', pool.color)
    g.setAttribute('aParams', pool.params)
    g.setAttribute('aBill', pool.bill)
    g.setAttribute('aRand', pool.rand)
    pool.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    pool.mesh.frustumCulled = false
    pool.mesh.castShadow = pool.mesh.receiveShadow = false
    pool.mesh.count = 0
    pool.mesh.visible = false
    pool.mesh.name = `weapon-idle-effect:${s.particle}`
    this.ctx.root.add(pool.mesh)
    this.pools.set(id, pool)
    return pool
  }

  /**
   * magazineEvents: what changed weapon slot `w`'s magazine up to `atMs`: the film's readings and the
   * holder's shots, and its reloads as the first-person rig plays them (`clipS`: the clip lengths of the
   * weapon in hand). A staged reload (`reload_enter` and a round clip, no `reload_full`: the Heatwave,
   * Cindershot) puts one round in each time a round clip completes: at the next stage, the last one only
   * when the episode's closing message ends it naturally (`finNaturelle`, the rig's own test), or at the
   * round's expected end when no message follows; a shot or a swap stops it. A one-clip reload fills the
   * magazine at the end of its clip (the empty one when the magazine was empty), if nothing stopped it.
   */
  private magazineEvents(line: SlotTimeline, w: number, clipS: (action: string) => number | null, atMs: number, fps: number): MagazineEvent[] {
    const doc = this.ctx.doc
    const out = (line.magazines.get(w) ?? []).filter((e) => e.ms <= atMs)
    for (const { ep, w: held } of line.episodes) {
      const stages = ep.etapes
      const start = stages[0].t
      if (held !== w || frameToMs(start, doc) > atMs) continue
      const stops = Math.min(firstAfter(line.shots, start), firstAfter(line.changes, start))
      const roundS = ep.vide
        ? clipS('reload_continue_empty') ?? clipS('reload_continue_full')
        : clipS('reload_continue_full') ?? clipS('reload_continue_empty')
      if (clipS('reload_full') === null && clipS('reload_enter') !== null && roundS !== null && roundS > 0) {
        const round = { durationSeconds: roundS }
        const last = stages.length - 1
        const closes = stages[last].coupe
        const rounds = closes ? last - 1 : last
        for (let i = 1; i <= rounds; i++) {
          const done = i < last
            ? i + 1 === last && closes && !finNaturelle(stages, round, fps) ? null : stages[i + 1].t
            : stages[i].t + dureeAttendue(stages, i, round, fps) * fps
          if (done !== null && done < stops) out.push({ ms: frameToMs(done, doc), kind: 'round' })
        }
        continue
      }
      const s = ep.vide ? clipS('reload_empty') ?? clipS('reload_full') : clipS('reload_full') ?? clipS('reload_empty')
      if (s !== null && s > 0 && start + s * fps < stops) out.push({ ms: frameToMs(start, doc) + s * 1000, kind: 'full' })
    }
    return out.sort((a, b) => a.ms - b.ms)
  }
  private timelinesOf(): Map<number, SlotTimeline> {
    if (this.timelines) return this.timelines
    const doc = this.ctx.doc
    const out = new Map<number, SlotTimeline>()
    const line = (slot: number) => {
      let l = out.get(slot)
      if (!l) out.set(slot, (l = { reloads: [], shots: [], changes: [], magazines: new Map(), episodes: [] }))
      return l
    }
    for (const [slot, eps] of episodesRechargementParSlot(doc)) {
      line(slot).reloads = eps.map((e) => ({ start: e.etapes[0].t, lastStage: e.etapes[e.etapes.length - 1].t }))
      line(slot).episodes = eps.map((ep) => ({ ep, w: armeEnMain(doc, slot, ep.etapes[0].t)?.slotArme ?? null }))
    }
    const magazine = (slot: number, w: number) => {
      const m = line(slot).magazines
      if (!m.has(w)) m.set(w, [])
      return m.get(w)!
    }
    for (const s of doc.shots) {
      line(s.slot).shots.push(s.t)
      const w = armeEnMain(doc, s.slot, s.t)?.slotArme
      if (w != null) magazine(s.slot, w).push({ ms: frameToMs(s.t, doc) + (s.o ?? 0), kind: 'shot' })
    }
    for (const r of doc.ammoReads) if (r.mag != null) magazine(r.slot, r.w).push({ ms: r.ms, kind: 'read', rounds: r.mag })
    const locale = this.ctx.inputs().locale
    for (const list of [doc.loadouts, doc.inventory, doc.weaponChanges]) {
      for (const r of list) {
        const before = heldWeaponAt(doc, r.slot, r.t - 1, locale)
        const after = heldWeaponAt(doc, r.slot, r.t, locale)
        if (before && after && before.id !== after.id) line(r.slot).changes.push(r.t)
      }
    }
    for (const l of out.values()) {
      l.shots.sort((a, b) => a - b)
      l.changes.sort((a, b) => a - b)
      for (const events of l.magazines.values()) events.sort((a, b) => a.ms - b.ms)
    }
    this.timelines = out
    return out
  }

  dispose(): void {
    for (const p of this.pools.values()) {
      if (!p) continue
      p.mesh.removeFromParent()
      p.mesh.geometry.dispose()
      ;(p.mesh.material as THREE.Material).dispose()
    }
    this.pools.clear()
    this.quad.dispose()
    this.assets?.dispose()
    if (typeof window !== 'undefined') delete (window as unknown as Record<string, unknown>)[DEBUG_HOOK]
  }
}

function lastAtOrBefore(sorted: readonly number[], v: number): number {
  let out = -Infinity
  for (const x of sorted) {
    if (x > v) break
    out = x
  }
  return out
}

function perpendicularTo(z: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const a = Math.abs(z.x) < 0.9 ? X.set(1, 0, 0) : X.set(0, 1, 0)
  return out.crossVectors(a, z).normalize()
}

/** firstAfter: the first frame of a sorted list strictly after `frame`, or Infinity. */
function firstAfter(sorted: readonly number[], frame: number): number {
  for (const t of sorted) if (t > frame) return t
  return Infinity
}