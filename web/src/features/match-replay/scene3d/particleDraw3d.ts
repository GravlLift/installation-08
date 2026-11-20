// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * particleDraw3d.ts — HOW THE GAME'S PARTICLES DRAW, shared by the held weapons' idle effects
 * (`weaponIdleEffects3d`) and the shots' game effects (`gameShotEffects3d`): the effect files of the
 * weapon library (textures, particle meshes), one instanced pool per drawn system, its shader
 * material, and how a simulated particle (`weaponIdleEffects3dModel`) is written into it.
 *
 * HOW (the two particle shaders, decoded from their DXIL, `himap/effet_arme.go`): the sprite shader
 * reads the base texture's red (inverted on request) at the particle's frame, looks it up in the
 * palette at the particle's palette row, multiplies by the vertex color; its alpha is the alpha map's
 * red or alpha times the vertex alpha. The model shader adds scrolling UVs (rotation, scale, random
 * offset, slide over the particle's age), a UV distortion map and a fresnel opacity. Blend mode 9 is
 * additive weighted by alpha; values above the bloom threshold bloom.
 *
 * BILLBOARDS (the emitter's `particle billboard style`, plugin enum): screen and camera facing (0, 1)
 * face the view; perpendicular to direction (3) lies across the particle's direction; parallel to
 * direction (2) keeps its up (the texture's top) along the direction and turns about it to face the
 * camera (the Shock Rifle projectile's electric sprite, whose texture is a plume rising from a bright
 * base: its rotation of half a turn trails the plume behind the projectile). A mesh particle draws its
 * mesh. INFERRED, not read: which of the quad's axes "parallel" aligns (the plume's trailing under
 * the tag's half-turn rotation is the evidence).
 *
 * INFERRED, not read: a mesh's normals (smooth, by position: the exported meshes carry none).
 */
import * as THREE from 'three'

import { api } from '@/lib/api/client'

import { indexReads, libraryTexture } from './indexField3d'
import type { IdleSystem, LiveParticle } from './weaponIdleEffects3dModel'

/** Blend mode 9 of a particle (`himap` melangeAddSrcAlpha): dst + src x src alpha. */
export const BLEND_ADD_SRC_ALPHA = 9
/** The two particle shaders the view draws. */
export const SHADER_SPRITE = '9b1c511e'
export const SHADER_MODEL = '96db07b6'

/** Billboards a sprite draws with (plugin enum). */
const BILLBOARD_SCREEN = 0
const BILLBOARD_CAMERA = 1
const BILLBOARD_PARALLEL = 2
const BILLBOARD_PERPENDICULAR = 3
/** Instances per drawn system (every holder's particles of it). */
export const POOL_CAPACITY = 512

/** The weapon library's effect files (fx-*.png textures, fx-*.bin particle meshes), read on first use. */
export class EffectFiles {
  private readonly base: string
  private readonly textures = new Map<string, THREE.Texture>()
  private readonly meshes = new Map<string, THREE.BufferGeometry | null>()
  private readonly abort = new AbortController()

  constructor(base: string) {
    this.base = base
  }

  /** texture is the library file `file`, its texels read as the shader reads them (sRGB or not). */
  texture(file: string, srgb: boolean): THREE.Texture {
    let t = this.textures.get(file)
    if (!t) {
      t = libraryTexture(`${this.base}/${file}`, (err) => {
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
      // Counted with the index reads: an export frame waits for the mesh (`indexReads`).
      indexReads.track(api.getResponse(`${this.base}/${file}`, { signal: this.abort.signal })
        .then((r) => r.arrayBuffer())
        .then((b) => this.meshes.set(file, particleMesh(new Float32Array(b))))
        .catch((err: unknown) => {
          if (!this.abort.signal.aborted) console.warn('replay 3D: weapon effect mesh unavailable', file, err)
        }))
    }
    return this.meshes.get(file) ?? null
  }

  dispose(): void {
    this.abort.abort()
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
export function spriteQuad(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 1, 0, 1, 1, 0, -1, -1, 0, 1, -1, 0]), 3))
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2))
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3))
  g.setIndex([0, 2, 1, 1, 2, 3])
  return g
}

/**
 * uFacing: 0 the instance's own frame (perpendicular sprite, mesh), 1 facing the view, 2 parallel
 * to the instance's direction (its frame's Z) and turned about it toward the camera.
 */
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
  float s = sin(aBill.z);
  float c = cos(aBill.z);
  vec2 p = vec2(position.x * aBill.x, position.y * aBill.y);
  vec2 r = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  if (uFacing > 1.5) {
    vec3 at = (m * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 d = normalize(mat3(m) * vec3(0.0, 0.0, 1.0));
    vec3 side = cross(d, cameraPosition - at);
    float l = length(side);
    side = l > 1e-6 ? side / l : normalize(cross(d, abs(d.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 w = at + side * r.x + d * r.y;
    vNormalW = normalize(cross(side, d));
    vViewW = cameraPosition - w;
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  } else if (uFacing > 0.5) {
    vec4 mv = viewMatrix * (m * vec4(0.0, 0.0, 0.0, 1.0));
    mv.xy += r;
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
export interface Pool {
  mesh: THREE.InstancedMesh
  color: THREE.InstancedBufferAttribute
  params: THREE.InstancedBufferAttribute
  bill: THREE.InstancedBufferAttribute
  rand: THREE.InstancedBufferAttribute
  mode: 'perpendicular' | 'facing' | 'parallel' | 'mesh'
  n: number
}

const num = (c: Record<string, number[]>, name: string, i = 0, d = 0) => c[name]?.[i] ?? d
const vec4Of = (c: Record<string, number[]>, name: string) => new THREE.Vector4(num(c, name, 0, 1), num(c, name, 1, 1), num(c, name, 2, 0), num(c, name, 3, 0))

/** The pool's mode for system `s`, null when the view does not draw it (a shader or billboard it lacks). */
export function modeOf(s: IdleSystem): Pool['mode'] | null {
  if (s.render.shader !== SHADER_SPRITE && s.render.shader !== SHADER_MODEL) return null
  if (s.render.model) return 'mesh'
  if (s.emitter.billboard === BILLBOARD_PERPENDICULAR) return 'perpendicular'
  if (s.emitter.billboard === BILLBOARD_PARALLEL) return 'parallel'
  if (s.emitter.billboard === BILLBOARD_SCREEN || s.emitter.billboard === BILLBOARD_CAMERA) return 'facing'
  return null
}

/** materialOf builds the shader material of system `s` (null while a texture is missing from it). */
function materialOf(s: IdleSystem, files: EffectFiles, mode: Pool['mode']): THREE.ShaderMaterial | null {
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
    uFacing: { value: mode === 'facing' ? 1 : mode === 'parallel' ? 2 : 0 },
    uBase: { value: files.texture(base.file, base.srgb) },
    uAlpha: { value: files.texture(alpha.file, alpha.srgb) },
    uPalette: { value: files.texture(palette.file, palette.srgb) },
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
    uniforms.uDist = { value: files.texture(dist.file, dist.srgb) }
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

const LOCAL = new THREE.Matrix4()
const WORLD = new THREE.Matrix4()
const X = new THREE.Vector3()
const Y = new THREE.Vector3()
const Z = new THREE.Vector3()
const U = new THREE.Vector3()
const W = new THREE.Vector3()

function perpendicularTo(z: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const a = Math.abs(z.x) < 0.9 ? X.set(1, 0, 0) : X.set(0, 1, 0)
  return out.crossVectors(a, z).normalize()
}

/**
 * ParticlePools — the drawn systems of one layer: one instanced pool per system id, under `root`,
 * named `<prefix>:<particle>`. A frame opens with `begin`, writes particles (`write`), and closes with
 * `end`, which shows the pools written to and hides the others.
 */
export class ParticlePools {
  private readonly pools = new Map<string, Pool | null>()
  private readonly quad = spriteQuad()
  private readonly root: THREE.Object3D
  private readonly prefix: string

  constructor(root: THREE.Object3D, prefix: string) {
    this.root = root
    this.prefix = prefix
  }

  begin(): void {
    for (const p of this.pools.values()) if (p) p.n = 0
  }

  end(): void {
    for (const p of this.pools.values()) {
      if (!p) continue
      p.mesh.count = p.n
      p.mesh.visible = p.n > 0
      if (p.n === 0) continue
      p.mesh.instanceMatrix.needsUpdate = true
      p.color.needsUpdate = p.params.needsUpdate = p.bill.needsUpdate = p.rand.needsUpdate = true
    }
  }

  /** poolOf is the pool of system `s` under `id` (made on first use), null when the view does not draw it. */
  poolOf(id: string, s: IdleSystem, files: EffectFiles | null): Pool | null {
    if (this.pools.has(id)) return this.pools.get(id) ?? null
    const mode = modeOf(s)
    if (!files || !mode) {
      if (!mode) console.warn('replay 3D: weapon effect system not drawn (shader or billboard unsupported)', s.particle, s.render.shader, s.emitter.billboard)
      this.pools.set(id, null)
      return null
    }
    const geometry = s.render.model ? files.mesh(s.render.model) : this.quad
    if (!geometry) return null // the mesh is loading: asked again next frame
    const material = materialOf(s, files, mode)
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
    pool.mesh.name = `${this.prefix}:${s.particle}`
    this.root.add(pool.mesh)
    this.pools.set(id, pool)
    return pool
  }

  /**
   * write appends particle `p` to `pool`, in the frame `anchor` (world space; the emitting location's
   * frame), the pools' root being at `rootInv`'s inverse.
   */
  write(pool: Pool, p: LiveParticle, anchor: THREE.Matrix4, rootInv: THREE.Matrix4): void {
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
    } else if (pool.mode === 'parallel') {
      // The direction is the frame's Z; the shader turns the quad about it and rolls it by the angle.
      LOCAL.makeBasis(U, W, Z)
    } else {
      LOCAL.identity()
    }
    LOCAL.setPosition(p.x, p.y, p.z)
    WORLD.copy(rootInv).multiply(anchor).multiply(LOCAL)
    pool.mesh.setMatrixAt(i, WORLD)
    pool.color.setXYZW(i, p.r, p.g, p.b, p.alpha)
    pool.params.setXYZW(i, p.palette, p.frame, p.age, 0)
    // A facing or parallel sprite's half sides, the anchor's scale applied (the rig's).
    const k = anchor.getMaxScaleOnAxis()
    pool.bill.setXYZW(i, p.size * p.scaleX * k, p.size * p.scaleY * k, p.angle, 0)
    pool.rand.setXYZW(i, p.rand0, p.rand1, p.rand1, p.rand0)
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
  }
}
