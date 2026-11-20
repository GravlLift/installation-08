// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * exportAccumulator3d.ts — THE GPU SIDE of film-quality export: subframe averaging (motion blur)
 * and the downscale of a supersampled frame, both on the GPU, never in a CPU pixel loop.
 *
 * Each subframe is drawn by the viewer's own composer into the default framebuffer, exactly as a
 * single export frame is (the compositor's chain is not touched). `add` copies that framebuffer
 * into a texture and adds it, decoded to LINEAR light, into a float sum target with additive
 * blending. `resolve` divides the sum by the subframe count, box-filters each `scale` x `scale`
 * block down to one file pixel (supersampling), encodes back to sRGB and draws into an 8-bit
 * target at the file's size, which stays bound for the readback (`exportReadback3d`).
 *
 * Averaging in linear light is what a real exposure does: a bright muzzle flash over a dark wall
 * streaks at its true share of the shutter, not darkened by averaging gamma-encoded values.
 *
 * The sum is 32-bit float when the GPU can blend into it (`EXT_float_blend`), half float
 * otherwise. In 32-bit the average of identical subframes encodes back to the same 8-bit value,
 * so a still scene is the same image as without blur; half float can be off by a level.
 *
 * The targets are kept between frames (reallocated only when the size changes) and released by
 * `dispose` at the export's end.
 */
import * as THREE from 'three'
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js'

/** What the export scene asks of the accumulator (a double in the tests). */
export interface ExportAccumulator {
  /** Starts a file frame `width` x `height` (CSS px) rendered at `scale` x that: the sum is cleared. */
  begin(width: number, height: number, scale: number): void
  /** Adds what the default framebuffer holds NOW (call right after the subframe's render). */
  add(): void
  /** Draws the average at the file's size into the output target, LEFT BOUND for the readback. */
  resolve(): { width: number; height: number }
  dispose(): void
}

/** The largest supersampling factor the resolve shader filters (its loop bound). */
export const SUPERSAMPLE_MAX = 2

const VERTEX = 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }'

/** One subframe, sRGB as the composer output it, to linear light. */
const ADD_FRAGMENT = `
uniform sampler2D uFrame;
vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
void main() {
  vec4 c = texelFetch(uFrame, ivec2(gl_FragCoord.xy), 0);
  gl_FragColor = vec4(toLinear(c.rgb), c.a);
}`

/** The average of the sum over subframes and each `uScale` x `uScale` block, back to sRGB. */
const RESOLVE_FRAGMENT = `
uniform sampler2D uSum;
uniform int uScale;
uniform float uWeight;
vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * uScale;
  vec4 sum = vec4(0.0);
  for (int y = 0; y < ${SUPERSAMPLE_MAX}; y++) {
    for (int x = 0; x < ${SUPERSAMPLE_MAX}; x++) {
      if (x < uScale && y < uScale) sum += texelFetch(uSum, base + ivec2(x, y), 0);
    }
  }
  vec4 c = clamp(sum * uWeight, 0.0, 1.0);
  gl_FragColor = vec4(toSrgb(c.rgb), c.a);
}`

/** The size of the render (`scale` x the file's), as the renderer sizes its drawing buffer. */
export function renderSize(width: number, height: number, scale: number): { width: number; height: number } {
  return { width: Math.floor(width * scale), height: Math.floor(height * scale) }
}

/** The GPU accumulator on the export's renderer. */
export class ExportAccumulator3d implements ExportAccumulator {
  private readonly renderer: THREE.WebGLRenderer
  private sum: THREE.WebGLRenderTarget | null = null
  private frame: THREE.FramebufferTexture | null = null
  private out: THREE.WebGLRenderTarget | null = null
  private size = { width: 0, height: 0, scale: 1 }
  private count = 0
  private readonly clear = new THREE.Color()
  private readonly addMaterial = new THREE.ShaderMaterial({
    uniforms: { uFrame: { value: null } },
    vertexShader: VERTEX,
    fragmentShader: ADD_FRAGMENT,
    // sum += subframe, alpha included: the average is formed in `resolve`.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
    premultipliedAlpha: false,
    depthTest: false,
    depthWrite: false,
  })
  private readonly resolveMaterial = new THREE.ShaderMaterial({
    uniforms: { uSum: { value: null }, uScale: { value: 1 }, uWeight: { value: 1 } },
    vertexShader: VERTEX,
    fragmentShader: RESOLVE_FRAGMENT,
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false,
  })
  private readonly addQuad = new FullScreenQuad(this.addMaterial)
  private readonly resolveQuad = new FullScreenQuad(this.resolveMaterial)

  constructor(renderer: THREE.WebGLRenderer) { this.renderer = renderer }

  begin(width: number, height: number, scale: number): void {
    const s = Math.min(Math.max(Math.round(scale), 1), SUPERSAMPLE_MAX)
    if (!this.sum || this.size.width !== width || this.size.height !== height || this.size.scale !== s) this.allocate(width, height, s)
    this.count = 0
    const r = this.renderer
    r.getClearColor(this.clear)
    const alpha = r.getClearAlpha()
    r.setRenderTarget(this.sum)
    r.setClearColor(0x000000, 0)
    r.clear(true, false, false)
    r.setClearColor(this.clear, alpha)
    r.setRenderTarget(null)
  }

  add(): void {
    const r = this.renderer
    if (!this.sum || !this.frame) return
    // The default framebuffer is bound: the composer drew the subframe there.
    r.copyFramebufferToTexture(this.frame)
    this.addMaterial.uniforms.uFrame.value = this.frame
    this.drawInto(this.sum, this.addQuad)
    r.setRenderTarget(null)
    this.count++
  }

  resolve(): { width: number; height: number } {
    if (!this.sum || !this.out) return { width: 0, height: 0 }
    const u = this.resolveMaterial.uniforms
    u.uSum.value = this.sum.texture
    u.uScale.value = this.size.scale
    u.uWeight.value = this.count > 0 ? 1 / (this.count * this.size.scale * this.size.scale) : 0
    this.drawInto(this.out, this.resolveQuad)
    return { width: this.size.width, height: this.size.height }
  }

  dispose(): void {
    this.release()
    this.addQuad.dispose()
    this.resolveQuad.dispose()
    this.addMaterial.dispose()
    this.resolveMaterial.dispose()
  }

  /** drawInto draws a full-screen quad into `target` (left bound), never clearing it first. */
  private drawInto(target: THREE.WebGLRenderTarget, quad: FullScreenQuad): void {
    const r = this.renderer
    const autoClear = r.autoClear
    r.autoClear = false
    r.setRenderTarget(target)
    quad.render(r)
    r.autoClear = autoClear
  }

  private allocate(width: number, height: number, scale: number): void {
    this.release()
    const big = renderSize(width, height, scale)
    // 32-bit float when the GPU can blend into it, else half float (see the header).
    const type = this.renderer.extensions.has('EXT_float_blend') ? THREE.FloatType : THREE.HalfFloatType
    const nearest = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false }
    this.sum = new THREE.WebGLRenderTarget(big.width, big.height, { ...nearest, type, format: THREE.RGBAFormat })
    this.frame = new THREE.FramebufferTexture(big.width, big.height)
    this.out = new THREE.WebGLRenderTarget(width, height, { ...nearest, type: THREE.UnsignedByteType, format: THREE.RGBAFormat })
    this.size = { width, height, scale }
  }

  private release(): void {
    this.sum?.dispose()
    this.frame?.dispose()
    this.out?.dispose()
    this.sum = null
    this.frame = null
    this.out = null
    this.size = { width: 0, height: 0, scale: 1 }
  }
}
