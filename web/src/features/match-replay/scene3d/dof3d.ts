// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * dof3d.ts — DEPTH OF FIELD for camera scripts: the blur of a real lens, from the scene's depth,
 * the script's focus distance and f-number, and a focal length derived from the camera's field.
 *
 * The lens is a thin lens on a full-frame sensor (36 x 24 mm): the vertical field gives the focal
 * length over the sensor's 24 mm height, `f = 12 mm / tan(vfov / 2)`. A point at distance D, with
 * the lens focused at S, blurs to a circle of confusion of diameter `f^2 / (N (S - f)) * |D - S| / D`
 * on the sensor, scaled to pixels by `view height / 24 mm`. World units are 3.048 m (`M_PER_U`).
 * The CoC is SIGNED: negative in front of the focus plane (the near field), positive behind it.
 *
 * The passes, on the linear HDR image before the output pass (tone mapping):
 *  1. CoC (full size): the signed CoC radius of every pixel from the depth, into its own target, so
 *     no later pass samples the depth texture while drawing into the target that owns it.
 *  2. Prefilter (half size): color and CoC at half size; the CoC is the 2 x 2 block's NEAREST
 *     (smallest), and the color favors the pixels at that CoC, so a block on a silhouette stays
 *     the foreground's and never mixes the two sides.
 *  3. Tiles: the largest near and far CoC per tile, then dilated over 5 x 5 tiles; it bounds how
 *     far any pixel's blur can reach, so the gathers know their radius.
 *  4. Far gather (half size): a disc of rings (8 taps per ring step, up to 8 rings, 289 taps),
 *     each sample counted where its own blur disc covers the center (scatter as gather). A sample
 *     BEHIND the center spreads over it no further than twice the center's own blur, so a far
 *     background never washes over a nearer surface, and in-focus samples (CoC 0) are never pulled
 *     into the background's blur: no halo around a sharp silhouette.
 *  5. Near gather (half size): the foreground's blur, gathered over the dilated tile radius so it
 *     BLEEDS over the in-focus pixels behind it, with its coverage as alpha (each sample's light
 *     spread over its disc's area), premultiplied.
 *  6. Composite (full size): the sharp image, the far field blended in by the pixel's own CoC
 *     through a CoC-aware (bilateral) upsample, then the near field over it.
 *
 * The CoC is clamped to `DOF_MAX_COC_FRACTION` of the view height. The pass is in the compositor
 * only while a playing script's pose has a lens (`PostFx3d.setLens`); without one it is out of
 * the chain and the image is exactly as before.
 */
import * as THREE from 'three'
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js'

import { M_PER_U } from './tracks3d'

/** The sensor's height (mm): full frame, 36 x 24. */
export const SENSOR_HEIGHT_MM = 24
/** The largest CoC RADIUS, as a fraction of the view height (21.6 px at 1080p). */
export const DOF_MAX_COC_FRACTION = 0.02
/** The closest the plane of focus may sit to the lens, in focal lengths (a lens cannot focus nearer than f). */
const MIN_FOCUS_FOCAL_LENGTHS = 1.05
/** Gather rings: one ring every this many half-size pixels of radius, at most MAX_RINGS. */
const RING_STEP = 2
const MAX_RINGS = 8
/** The tile loop's largest side (half-size pixels): enough for a 4K export's max CoC. */
const MAX_TILE = 32
const MM_PER_U = M_PER_U * 1000

/** The focal length (mm) of a full-frame lens whose vertical field is `verticalFovDeg`. */
export function focalLengthMm(verticalFovDeg: number): number {
  return SENSOR_HEIGHT_MM / 2 / Math.tan((verticalFovDeg * Math.PI) / 360)
}

/**
 * The lens's CoC terms for a view: `focusMm`, the plane of focus (mm, at least 1.05 focal
 * lengths), and `scalePx`, the CoC RADIUS in pixels of a point at infinity. A point at D mm has
 * the signed radius `scalePx * (D - focusMm) / D`.
 */
export function cocTerms(focusU: number, fNumber: number, verticalFovDeg: number, viewHeightPx: number): { focusMm: number; scalePx: number } {
  const f = focalLengthMm(verticalFovDeg)
  const focusMm = Math.max(focusU * MM_PER_U, f * MIN_FOCUS_FOCAL_LENGTHS)
  const diameterMm = (f * f) / (fNumber * (focusMm - f))
  return { focusMm, scalePx: ((diameterMm / SENSOR_HEIGHT_MM) * viewHeightPx) / 2 }
}

/**
 * The signed circle of confusion RADIUS (px, unclamped) of a point `depthU` world units in front
 * of the lens (along the view axis), focused at `focusU`, at f-number `fNumber`, for a view
 * `viewHeightPx` tall with a vertical field of `verticalFovDeg`: negative in front of the focus
 * plane, 0 on it, positive behind it. The shader computes the same, then clamps it.
 */
export function cocRadiusPx(depthU: number, focusU: number, fNumber: number, verticalFovDeg: number, viewHeightPx: number): number {
  const { focusMm, scalePx } = cocTerms(focusU, fNumber, verticalFovDeg, viewHeightPx)
  const d = Math.max(depthU * MM_PER_U, 1e-3)
  return (scalePx * (d - focusMm)) / d
}

/** The script's lens at a frame: focus distance (world units, along the view axis) and f-number. */
export interface Lens3d {
  focusDistance: number
  aperture: number
}

const VERTEX = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'

const COC_FRAGMENT = /* glsl */ `
#include <packing>
uniform sampler2D tDepth;
uniform float cameraNear;
uniform float cameraFar;
uniform float uFocusMm;
uniform float uCocScale;
uniform float uMaxCoc;
uniform float uMmPerUnit;
varying vec2 vUv;
void main() {
  float depth = texture2D(tDepth, vUv).x;
  float distMm = max(-perspectiveDepthToViewZ(depth, cameraNear, cameraFar) * uMmPerUnit, 1e-3);
  float coc = uCocScale * (distMm - uFocusMm) / distMm;
  gl_FragColor = vec4(clamp(coc, -uMaxCoc, uMaxCoc), 0.0, 0.0, 1.0);
}
`

const PREFILTER_FRAGMENT = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tCoc;
uniform vec2 uFullTexel;
varying vec2 vUv;
vec3 safe(vec3 c) { return (any(isnan(c)) || any(isinf(c))) ? vec3(0.0) : min(c, vec3(256.0)); }
void main() {
  vec2 o = 0.5 * uFullTexel;
  vec2 uv0 = vUv + vec2(-o.x, -o.y);
  vec2 uv1 = vUv + vec2(o.x, -o.y);
  vec2 uv2 = vUv + vec2(-o.x, o.y);
  vec2 uv3 = vUv + vec2(o.x, o.y);
  float c0 = texture2D(tCoc, uv0).r;
  float c1 = texture2D(tCoc, uv1).r;
  float c2 = texture2D(tCoc, uv2).r;
  float c3 = texture2D(tCoc, uv3).r;
  float cmin = min(min(c0, c1), min(c2, c3));
  float w0 = 1.0 / (1.0 + abs(c0 - cmin));
  float w1 = 1.0 / (1.0 + abs(c1 - cmin));
  float w2 = 1.0 / (1.0 + abs(c2 - cmin));
  float w3 = 1.0 / (1.0 + abs(c3 - cmin));
  vec3 rgb = safe(texture2D(tColor, uv0).rgb) * w0 + safe(texture2D(tColor, uv1).rgb) * w1
    + safe(texture2D(tColor, uv2).rgb) * w2 + safe(texture2D(tColor, uv3).rgb) * w3;
  // The CoC in half-size pixels from here on.
  gl_FragColor = vec4(rgb / (w0 + w1 + w2 + w3), 0.5 * cmin);
}
`

const TILE_FRAGMENT = /* glsl */ `
uniform sampler2D tHalf;
uniform vec2 uHalfTexel;
uniform float uTile;
void main() {
  vec2 base = floor(gl_FragCoord.xy) * uTile;
  float nearMax = 0.0;
  float farMax = 0.0;
  for (int y = 0; y < ${MAX_TILE}; y++) {
    if (float(y) >= uTile) break;
    for (int x = 0; x < ${MAX_TILE}; x++) {
      if (float(x) >= uTile) break;
      float c = texture2D(tHalf, (base + vec2(float(x), float(y)) + 0.5) * uHalfTexel).a;
      nearMax = max(nearMax, -c);
      farMax = max(farMax, c);
    }
  }
  gl_FragColor = vec4(nearMax, farMax, 0.0, 1.0);
}
`

const DILATE_FRAGMENT = /* glsl */ `
uniform sampler2D tTile;
uniform vec2 uTileTexel;
varying vec2 vUv;
void main() {
  vec2 m = vec2(0.0);
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      m = max(m, texture2D(tTile, vUv + vec2(float(x), float(y)) * uTileTexel).rg);
    }
  }
  gl_FragColor = vec4(m, 0.0, 1.0);
}
`

/** The two gathers share their disc; `NEAR` selects the near field's weights and output. */
const GATHER_FRAGMENT = /* glsl */ `
uniform sampler2D tHalf;
uniform sampler2D tTile;
uniform vec2 uHalfSize;
uniform vec2 uHalfTexel;
varying vec2 vUv;
const float PI2 = 6.28318530718;
void main() {
  vec4 center = texture2D(tHalf, vUv);
  vec2 tile = texture2D(tTile, vUv).rg;
#ifdef NEAR
  float R = tile.r;
  if (R < 1.0) { gl_FragColor = vec4(0.0); return; }
#else
  float cc = max(center.a, 0.0);
  float R = min(2.0 * cc, tile.g);
  if (R < 0.5) { gl_FragColor = vec4(center.rgb, 1.0); return; }
#endif
  float rings = clamp(ceil(R / ${RING_STEP.toFixed(1)}), 1.0, ${MAX_RINGS.toFixed(1)});
  float delta = R / rings;
  float soft = max(delta, 1.0);
  float tapArea = 0.25 * delta * delta;
  vec2 px = vUv * uHalfSize;
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int k = 0; k <= ${MAX_RINGS}; k++) {
    if (float(k) > rings) break;
    int count = k == 0 ? 1 : 8 * k;
    float r = float(k) * delta;
    // Odd rings turn half a step: the taps of neighboring rings do not line up into spokes.
    float turn = 0.5 * mod(float(k), 2.0);
    for (int j = 0; j < ${8 * MAX_RINGS}; j++) {
      if (j >= count) break;
      float ang = PI2 * (float(j) + turn) / float(count);
      vec4 s = k == 0 ? center : texture2D(tHalf, (floor(px + vec2(cos(ang), sin(ang)) * r) + 0.5) * uHalfTexel);
#ifdef NEAR
      float cs = max(-s.a, 0.0);
      float cover = clamp((cs - r) / soft + 0.5, 0.0, 1.0);
      // A nearly sharp foreground stays in the full-size image; its light spreads over its disc.
      float w = cover * clamp(cs - 1.0, 0.0, 1.0) * tapArea / max(cs * cs, tapArea);
#else
      float cs = max(s.a, 0.0);
      // Behind the center: hidden by it beyond twice its own blur.
      if (cs > cc) cs = min(cs, 2.0 * cc);
      float w = clamp((cs - r) / soft + 0.5, 0.0, 1.0);
#endif
      sum += s.rgb * w;
      wsum += w;
    }
  }
#ifdef NEAR
  float alpha = max(clamp(2.0 * wsum, 0.0, 1.0), smoothstep(1.0, 2.0, -center.a));
  vec3 color = wsum > 1e-5 ? sum / wsum : center.rgb;
  gl_FragColor = vec4(color * alpha, alpha);
#else
  gl_FragColor = vec4(sum / max(wsum, 1e-5), 1.0);
#endif
}
`

const COMPOSITE_FRAGMENT = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tCoc;
uniform sampler2D tHalf;
uniform sampler2D tFar;
uniform sampler2D tNear;
uniform vec2 uHalfSize;
uniform vec2 uHalfTexel;
varying vec2 vUv;
void main() {
  vec4 sharp = texture2D(tColor, vUv);
  float coc = texture2D(tCoc, vUv).r;
  vec3 col = sharp.rgb;
  float farBlend = smoothstep(1.0, 3.0, coc);
  if (farBlend > 0.0) {
    // The four half-size texels around, weighted bilinearly AND by how close their CoC is to this
    // pixel's: a sharp foreground texel next to a blurred background pixel does not tint it.
    vec2 p = vUv * uHalfSize - 0.5;
    vec2 b = floor(p);
    vec2 f = p - b;
    float target = 0.5 * coc;
    vec3 acc = vec3(0.0);
    float wacc = 0.0;
    for (int i = 0; i < 4; i++) {
      vec2 o = vec2(float(i == 1 || i == 3), float(i >= 2));
      vec2 uv = (b + o + 0.5) * uHalfTexel;
      float bil = mix(1.0 - f.x, f.x, o.x) * mix(1.0 - f.y, f.y, o.y);
      float w = bil / (0.25 + abs(texture2D(tHalf, uv).a - target)) + 1e-6;
      acc += texture2D(tFar, uv).rgb * w;
      wacc += w;
    }
    col = mix(col, acc / wacc, farBlend);
  }
  // The near field, premultiplied, through a small tent (four bilinear taps) that smooths its edge.
  vec2 h = 0.5 * uHalfTexel;
  vec4 near = 0.25 * (texture2D(tNear, vUv + vec2(-h.x, -h.y)) + texture2D(tNear, vUv + vec2(h.x, -h.y))
    + texture2D(tNear, vUv + vec2(-h.x, h.y)) + texture2D(tNear, vUv + vec2(h.x, h.y)));
  col = col * (1.0 - near.a) + near.rgb;
  gl_FragColor = vec4(col, sharp.a);
}
`

function quadMaterial(fragmentShader: string, uniforms: Record<string, THREE.IUniform>, defines: Record<string, string> = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader, uniforms, defines, depthTest: false, depthWrite: false, blending: THREE.NoBlending })
}

function halfFloatTarget(format: THREE.PixelFormat, filter: THREE.MagnificationTextureFilter): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, format, minFilter: filter, magFilter: filter, depthBuffer: false })
}

/**
 * DofPass — the depth of field pass (see the module comment). `depth` gives the scene's depth
 * texture for the frame (the compositor's scene pass records it); `focusDistance` (world units)
 * and `aperture` (f-number) are the lens, set each frame from the script's pose.
 */
export class DofPass extends Pass {
  focusDistance = 1
  aperture = 2.8
  private readonly camera: THREE.PerspectiveCamera
  private readonly depth: () => THREE.DepthTexture | null
  private readonly quad = new FullScreenQuad()
  private readonly cocTarget = halfFloatTarget(THREE.RedFormat, THREE.LinearFilter)
  private readonly halfTarget = halfFloatTarget(THREE.RGBAFormat, THREE.LinearFilter)
  private readonly tileTarget = halfFloatTarget(THREE.RGBAFormat, THREE.NearestFilter)
  private readonly dilatedTarget = halfFloatTarget(THREE.RGBAFormat, THREE.NearestFilter)
  private readonly farTarget = halfFloatTarget(THREE.RGBAFormat, THREE.LinearFilter)
  private readonly nearTarget = halfFloatTarget(THREE.RGBAFormat, THREE.LinearFilter)
  private width = 1
  private height = 1
  private tile = 4
  readonly cocMaterial = quadMaterial(COC_FRAGMENT, {
    tDepth: { value: null },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 1000 },
    uFocusMm: { value: 1000 },
    uCocScale: { value: 0 },
    uMaxCoc: { value: 1 },
    uMmPerUnit: { value: MM_PER_U },
  })
  private readonly prefilterMaterial = quadMaterial(PREFILTER_FRAGMENT, { tColor: { value: null }, tCoc: { value: null }, uFullTexel: { value: new THREE.Vector2() } })
  private readonly tileMaterial = quadMaterial(TILE_FRAGMENT, { tHalf: { value: null }, uHalfTexel: { value: new THREE.Vector2() }, uTile: { value: 4 } })
  private readonly dilateMaterial = quadMaterial(DILATE_FRAGMENT, { tTile: { value: null }, uTileTexel: { value: new THREE.Vector2() } })
  private readonly farMaterial = quadMaterial(GATHER_FRAGMENT, this.gatherUniforms())
  private readonly nearMaterial = quadMaterial(GATHER_FRAGMENT, this.gatherUniforms(), { NEAR: '' })
  private readonly compositeMaterial = quadMaterial(COMPOSITE_FRAGMENT, {
    tColor: { value: null },
    tCoc: { value: null },
    tHalf: { value: null },
    tFar: { value: null },
    tNear: { value: null },
    uHalfSize: { value: new THREE.Vector2() },
    uHalfTexel: { value: new THREE.Vector2() },
  })

  constructor(camera: THREE.PerspectiveCamera, depth: () => THREE.DepthTexture | null) {
    super()
    this.camera = camera
    this.depth = depth
  }

  private gatherUniforms(): Record<string, THREE.IUniform> {
    return { tHalf: { value: null }, tTile: { value: null }, uHalfSize: { value: new THREE.Vector2() }, uHalfTexel: { value: new THREE.Vector2() } }
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, Math.round(width))
    this.height = Math.max(1, Math.round(height))
    const hw = Math.ceil(this.width / 2)
    const hh = Math.ceil(this.height / 2)
    // Two tiles must reach the largest CoC (in half-size pixels) from any pixel: see the dilation.
    const maxCocHalf = (DOF_MAX_COC_FRACTION * this.height) / 2
    this.tile = Math.min(MAX_TILE, Math.max(4, Math.ceil(maxCocHalf / 2)))
    const tw = Math.ceil(hw / this.tile)
    const th = Math.ceil(hh / this.tile)
    this.cocTarget.setSize(this.width, this.height)
    this.halfTarget.setSize(hw, hh)
    this.farTarget.setSize(hw, hh)
    this.nearTarget.setSize(hw, hh)
    this.tileTarget.setSize(tw, th)
    this.dilatedTarget.setSize(tw, th)
    const halfSize = new THREE.Vector2(hw, hh)
    const halfTexel = new THREE.Vector2(1 / hw, 1 / hh)
    this.prefilterMaterial.uniforms.uFullTexel.value.set(1 / this.width, 1 / this.height)
    this.tileMaterial.uniforms.uHalfTexel.value.copy(halfTexel)
    this.tileMaterial.uniforms.uTile.value = this.tile
    this.dilateMaterial.uniforms.uTileTexel.value.set(1 / tw, 1 / th)
    for (const m of [this.farMaterial, this.nearMaterial, this.compositeMaterial]) {
      m.uniforms.uHalfSize.value.copy(halfSize)
      m.uniforms.uHalfTexel.value.copy(halfTexel)
    }
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const depth = this.depth()
    if (!depth) {
      this.needsSwap = false // nothing to focus with: the image passes on untouched
      return
    }
    this.needsSwap = true
    const camera = this.camera
    const { focusMm, scalePx } = cocTerms(this.focusDistance, this.aperture, camera.getEffectiveFOV(), this.height)
    const coc = this.cocMaterial.uniforms
    coc.tDepth.value = depth
    coc.cameraNear.value = camera.near
    coc.cameraFar.value = camera.far
    coc.uFocusMm.value = focusMm
    coc.uCocScale.value = scalePx
    coc.uMaxCoc.value = DOF_MAX_COC_FRACTION * this.height

    const autoClear = renderer.autoClear
    renderer.autoClear = false // full-screen quads cover their targets; the scene's depth stays as it is
    try {
      this.draw(renderer, this.cocMaterial, this.cocTarget)
      this.prefilterMaterial.uniforms.tColor.value = readBuffer.texture
      this.prefilterMaterial.uniforms.tCoc.value = this.cocTarget.texture
      this.draw(renderer, this.prefilterMaterial, this.halfTarget)
      this.tileMaterial.uniforms.tHalf.value = this.halfTarget.texture
      this.draw(renderer, this.tileMaterial, this.tileTarget)
      this.dilateMaterial.uniforms.tTile.value = this.tileTarget.texture
      this.draw(renderer, this.dilateMaterial, this.dilatedTarget)
      for (const [material, target] of [[this.farMaterial, this.farTarget], [this.nearMaterial, this.nearTarget]] as const) {
        material.uniforms.tHalf.value = this.halfTarget.texture
        material.uniforms.tTile.value = this.dilatedTarget.texture
        this.draw(renderer, material, target)
      }
      const out = this.compositeMaterial.uniforms
      out.tColor.value = readBuffer.texture
      out.tCoc.value = this.cocTarget.texture
      out.tHalf.value = this.halfTarget.texture
      out.tFar.value = this.farTarget.texture
      out.tNear.value = this.nearTarget.texture
      this.draw(renderer, this.compositeMaterial, this.renderToScreen ? null : writeBuffer)
    } finally {
      renderer.autoClear = autoClear
    }
  }

  private draw(renderer: THREE.WebGLRenderer, material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material
    renderer.setRenderTarget(target)
    this.quad.render(renderer)
  }

  dispose(): void {
    for (const t of [this.cocTarget, this.halfTarget, this.tileTarget, this.dilatedTarget, this.farTarget, this.nearTarget]) t.dispose()
    for (const m of [this.cocMaterial, this.prefilterMaterial, this.tileMaterial, this.dilateMaterial, this.farMaterial, this.nearMaterial, this.compositeMaterial]) m.dispose()
    this.quad.dispose()
  }
}
