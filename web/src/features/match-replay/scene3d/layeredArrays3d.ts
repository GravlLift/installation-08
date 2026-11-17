// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * layeredArrays3d.ts — THE TEXTURE ARRAYS AND SHADER OF MERGED LAYERED MATERIALS.
 *
 * `LayeredAtlas` carries the arrays (one per size and settings, see `planArrays`) and the
 * parameter texture (one row of ROW_TEXELS texels per composition, see `packRow`). The arrays
 * receive their images at a merged material's first compile, the only point that has the
 * renderer: three allocates each array with no transfer (`dataReady` false), then each decoded
 * image is copied into it with `texSubImage3D` and mip levels are generated once per array. The
 * maps of a KTX2 GLB are GPU-compressed: their arrays are compressed arrays of the same format,
 * filled level by level with `compressedTexSubImage3D` (the levels come from the file, none are
 * generated).
 *
 * The merged shader is the layers' own (`LAYER_COMPOSE`), its uniforms replaced by the vertex's
 * row (`cRow`) read from the parameter texture, its maps by an array chosen by slot. A
 * triangle's three vertices carry the same row (`assignVertexRows`): the row travels through an
 * ordinary, rounded varying: a `flat` varying follows the last-vertex convention, which ANGLE's
 * D3D backend may have to emulate. Which array is chosen changes from one triangle to the next
 * within the same draw: the samples take explicit derivatives, computed outside any branch.
 */
import * as THREE from 'three'

import { releaseTexels } from './ktx2Textures3d'
import { LAYER_COMPOSE, LAYER_INJECTIONS, LAYER_ROWS, LAYER_VERTEX_HEAD } from './layeredMaterial'
import { GLOW_TEXEL, HEAD_TEXEL, ROW_TEXELS, SLOT_TEXEL, type PlannedArray } from './layeredPlan3d'

/** The `userData` key that flags a merged material (probe copies included, which share it). */
// NOTE: value kept as 'couchesFusionnees' (French) because sessionResourceBytes3d.test.ts, outside
// this group's file list, asserts this exact literal; do not rename without updating that test too.
const MERGED_KEY = 'couchesFusionnees'

/**
 * The `userData` key that flags a map whose image, copied into a texture array, is held by no
 * kept material: `LayeredAtlas.upload` closes the image after the copy, and only then.
 */
export const IMAGE_LIBEREE = 'imageReleased'

/**
 * releaseImage frees the CPU copy of `texture`'s pixels, once: an ImageBitmap is closed, a
 * compressed (KTX2) texture's levels are dropped.
 */
function releaseImage(texture: THREE.Texture): void {
  const image = texture.image as ImageBitmap | null | undefined
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
    image.close()
    texture.image = null
  }
  releaseTexels(texture)
}

/** A merged array: decoded images (PNG maps) or encoded levels (KTX2 maps, GPU-compressed). */
type ArrayTexture = THREE.DataArrayTexture | THREE.CompressedArrayTexture

const isCompressed = (t: THREE.Texture): t is THREE.CompressedTexture => (t as THREE.CompressedTexture).isCompressedTexture === true

/** isMergedMaterial: the material is a merged layered material (`mergedMaterial`) or one of its copies. */
export function isMergedMaterial(material: THREE.Material | THREE.Material[]): material is THREE.MeshStandardMaterial {
  return !Array.isArray(material) && material.userData?.[MERGED_KEY] === true
}

function arrayTexture(plan: PlannedArray<THREE.Texture>): ArrayTexture {
  const like = plan.members[0]
  const depth = plan.members.length
  // A compressed map cannot be decoded nor have levels generated: its array takes the same format
  // and as many levels (the plan groups by both), allocated empty, filled by `upload`.
  const t = isCompressed(like)
    ? new THREE.CompressedArrayTexture(
      (like.mipmaps ?? []).map((m) => ({ data: new Uint8Array(0), width: m.width, height: m.height })),
      plan.width, plan.height, depth, like.format, like.type,
    )
    : new THREE.DataArrayTexture(null, plan.width, plan.height, depth)
  Object.assign(t, {
    colorSpace: like.colorSpace,
    wrapS: like.wrapS,
    wrapT: like.wrapT,
    magFilter: like.magFilter,
    minFilter: like.minFilter,
    anisotropy: like.anisotropy,
    generateMipmaps: like.generateMipmaps,
    flipY: like.flipY,
    premultiplyAlpha: like.premultiplyAlpha,
    unpackAlignment: like.unpackAlignment,
    format: like.format,
    type: like.type,
  })
  // three allocates the array with nothing transferred to it: `upload` copies the images into it.
  t.source.dataReady = false
  t.needsUpdate = true
  return t
}

const MIPMAPPED = new Set<THREE.TextureFilter>([
  THREE.NearestMipmapNearestFilter, THREE.NearestMipmapLinearFilter, THREE.LinearMipmapNearestFilter, THREE.LinearMipmapLinearFilter,
])

/** uploadDecoded copies decoded images (PNG maps) into the bound array, then generates its levels. */
function uploadDecoded(gl: WebGL2RenderingContext, texture: THREE.DataArrayTexture, members: readonly THREE.Texture[]): void {
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, texture.flipY)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, texture.premultiplyAlpha)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, texture.unpackAlignment)
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
  const { width, height } = texture.image
  members.forEach((t, layer) => {
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, width, height, 1, gl.RGBA, gl.UNSIGNED_BYTE, t.image as TexImageSource)
  })
  if (texture.generateMipmaps && MIPMAPPED.has(texture.minFilter)) gl.generateMipmap(gl.TEXTURE_2D_ARRAY)
}

/**
 * uploadCompressed copies each member's encoded levels (KTX2 maps, transcoded) into the bound
 * compressed array, level by level, in the array's GL format: the one three allocated it with
 * (its format and color space). Compressed uploads take no flip nor premultiplication.
 */
function uploadCompressed(
  renderer: THREE.WebGLRenderer, gl: WebGL2RenderingContext, texture: THREE.CompressedArrayTexture, members: readonly THREE.Texture[],
): void {
  const format = new THREE.WebGLUtils(gl, renderer.extensions).convert(texture.format, texture.colorSpace)
  if (format === null) {
    console.warn('3D replay: compressed format not supported by the GPU, layers array left empty', texture.format, texture.colorSpace)
    return
  }
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  const levels = texture.mipmaps?.length ?? 0
  members.forEach((t, layer) => {
    const mipmaps = t.mipmaps ?? []
    for (let level = 0; level < Math.min(levels, mipmaps.length); level++) {
      const m = mipmaps[level] as THREE.CompressedTextureMipmap
      gl.compressedTexSubImage3D(gl.TEXTURE_2D_ARRAY, level, 0, 0, layer, m.width, m.height, 1, format, m.data)
    }
  })
}

/** A map's merged layers: texture arrays and parameter texture. */
export class LayeredAtlas {
  readonly arrays: ArrayTexture[]
  readonly params: THREE.DataTexture
  private pending: readonly (readonly THREE.Texture[])[] | null
  /** Duration of the image transfer (ms), null until it has happened. */
  uploadMs: number | null = null

  /** `rows`: `rowCount` rows of ROW_TEXELS RGBA texels (see `packRow`). */
  constructor(arrays: readonly PlannedArray<THREE.Texture>[], rows: Float32Array<ArrayBuffer>, rowCount: number) {
    this.arrays = arrays.map(arrayTexture)
    this.pending = arrays.map((a) => a.members)
    this.params = new THREE.DataTexture(rows, ROW_TEXELS, rowCount, THREE.RGBAFormat, THREE.FloatType)
    this.params.needsUpdate = true
  }

  /** The textures to release with the map. */
  get textures(): THREE.Texture[] {
    return [...this.arrays, this.params]
  }

  /**
   * upload copies the images into the arrays, once. The transfer settings are those three sets
   * for each source map (flip, premultiplication, alignment; no color conversion: sRGB and
   * linear share the working space's primaries). A compressed array receives each map's
   * encoded levels as they are (no decode, no generated levels).
   */
  upload(renderer: THREE.WebGLRenderer): void {
    const pending = this.pending
    if (!pending) return
    this.pending = null
    const start = performance.now()
    const gl = renderer.getContext() as WebGL2RenderingContext
    this.arrays.forEach((texture, a) => {
      renderer.initTexture(texture)
      const handle = (renderer.properties.get(texture) as { __webglTexture?: WebGLTexture }).__webglTexture
      if (!handle) {
        console.warn('3D replay: layers texture array not allocated', texture.image.width, texture.image.height)
        return
      }
      renderer.state.bindTexture(gl.TEXTURE_2D_ARRAY, handle)
      if (isCompressed(texture)) uploadCompressed(renderer, gl, texture, pending[a])
      else uploadDecoded(gl, texture, pending[a])
      renderer.state.unbindTexture()
    })
    // The copied images are no longer read by any material: close them (see IMAGE_LIBEREE).
    for (const row of pending) for (const t of row) if (t.userData[IMAGE_LIBEREE]) releaseImage(t)
    this.uploadMs = performance.now() - start
  }

  dispose(): void {
    for (const t of this.textures) t.dispose()
  }
}

const VERTEX_HEAD = /* glsl */ `${LAYER_VERTEX_HEAD}
attribute float cRow;
varying float vRow;`

/** fragmentHead: the merged shader's declarations and sampling, for `arrays` arrays. */
function fragmentHead(arrays: number): string {
  const ids = Array.from({ length: arrays }, (_, a) => a)
  const samplers = ids.map((a) => `uniform highp sampler2DArray uArr${a};`).join('\n')
  const branches = ids.map((a) => `  if (a == ${a}) return textureGrad(uArr${a}, p, dx, dy);`).join('\n')
  return /* glsl */ `
${samplers}
uniform highp sampler2D uParams;
varying float vRow;
#define LAYER_ROWS ${LAYER_ROWS}
// The triangle's composition row in the parameter texture (set by layered()).
int gRow;
#define P_TEXEL(i) texelFetch(uParams, ivec2(i, gRow), 0)
#define L_ROW(k, i) P_TEXEL((k) * LAYER_ROWS + (i))
${LAYER_COMPOSE}
// The layer coordinates' screen-space derivatives, taken outside any branch.
vec2 gDx;
vec2 gDy;
vec2 gMx;
vec2 gMy;

// The map's sample at slot (array, layer); a negative array means no map.
vec4 fromArray(vec2 slot, vec2 uv, vec2 dx, vec2 dy) {
  if (slot.x < 0.0) return vec4(0.0);
  int a = int(slot.x + 0.5);
  vec3 p = vec3(uv, slot.y);
${branches}
  return vec4(0.0);
}

vec4 layerSample(vec2 slot, vec4 xf) { return fromArray(slot, at(xf), gDx * xf.xy, gDy * xf.xy); }
// A map flagged 2 lies on the mask's coordinates (see atOn).
vec4 layerSampleOn(vec2 slot, vec4 xf, float on) {
  return on > 1.5 ? fromArray(slot, atOn(xf, on), gMx * xf.xy, gMy * xf.xy) : layerSample(slot, xf);
}

vec3 layerColor(int k) {
  return colorOf(layerSample(P_TEXEL(${SLOT_TEXEL} + 2 * k).xy, L_XFORM(k)), k);
}

vec3 layerNormal(int k) {
  if (L_HAS_NRM(k) < 0.5) return vec3(0.0, 0.0, 1.0);
  return normalOf(layerSampleOn(P_TEXEL(${SLOT_TEXEL} + 2 * k).zw, L_NXFORM(k), L_HAS_NRM(k)).rg, k);
}

vec3 layerControl(int k) {
  if (L_HAS_CTL(k) < 0.5) return vec3(1.0, ROUGH_DEFAULT, 0.0);
  return controlOf(layerSampleOn(P_TEXEL(${SLOT_TEXEL} + 2 * k + 1).xy, L_CXFORM(k), L_HAS_CTL(k)).rgb, k);
}

Surface layered() {
  gRow = int(vRow + 0.5);
  gDx = dFdx(vCouche);
  gDy = dFdy(vCouche);
  vec2 mdx = dFdx(vMacro);
  vec2 mdy = dFdy(vMacro);
  gMx = mdx;
  gMy = mdy;
  vec4 head = P_TEXEL(${HEAD_TEXEL});
  int count = int(head.x + 0.5);
  vec4 m = head.y > 0.5 ? fromArray(head.zw, vMacro, mdx, mdy) : vec4(0.0);
  bool useHeight = head.y > 0.5 && L_HEIGHT(0).w > 0.5 && L_HAS_CTL(0) > 0.5;
  float h = useHeight ? startHeight(layerSample(P_TEXEL(${SLOT_TEXEL} + 1).xy, L_CXFORM(0)).a, m.a) : 0.0;
  Surface s = Surface(layerColor(0), layerNormal(0), layerControl(0));
  if (count > 1) { float mw = maskWeight(m, 1); float w = useHeight && L_HEIGHT(1).w > 0.5 && L_HAS_CTL(1) > 0.5 ? heightWeight(h, layerSample(P_TEXEL(${SLOT_TEXEL} + 3).xy, L_CXFORM(1)).a, mw, 1) : mw * L_OPACITY(1); stack(s, layerColor(1), layerNormal(1), layerControl(1), w, 1); }
  if (count > 2) { float mw = maskWeight(m, 2); float w = useHeight && L_HEIGHT(2).w > 0.5 && L_HAS_CTL(2) > 0.5 ? heightWeight(h, layerSample(P_TEXEL(${SLOT_TEXEL} + 5).xy, L_CXFORM(2)).a, mw, 2) : mw * L_OPACITY(2); stack(s, layerColor(2), layerNormal(2), layerControl(2), w, 2); }
  if (count > 3) { float mw = maskWeight(m, 3); float w = useHeight && L_HEIGHT(3).w > 0.5 && L_HAS_CTL(3) > 0.5 ? heightWeight(h, layerSample(P_TEXEL(${SLOT_TEXEL} + 7).xy, L_CXFORM(3)).a, mw, 3) : mw * L_OPACITY(3); stack(s, layerColor(3), layerNormal(3), layerControl(3), w, 3); }
  return s;
}`
}

// The composition's own light replaces the material's (set after the layers' surface).
const GLOW_INJECTION = ['#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance = P_TEXEL(${GLOW_TEXEL}).rgb;`] as const

/**
 * mergedMaterial: a merged material, a copy of `base` (drawn face, flat-shaded rendering, fog)
 * whose color, normal, roughness, metalness and own light come from each vertex's row and
 * `atlas`'s arrays. The textures live in the uniforms: the material names them for whoever
 * releases them (`userData.textures`, see mapModel).
 */
export function mergedMaterial(base: THREE.MeshStandardMaterial, atlas: LayeredAtlas): THREE.MeshStandardMaterial {
  const saved = base.userData
  // `clone` copies `userData` via JSON: a layered material's textures live there.
  base.userData = {}
  const m = base.clone()
  base.userData = saved
  m.color.set(1, 1, 1)
  m.emissive.set(0, 0, 0)
  m.emissiveIntensity = 1
  m.userData = { textures: atlas.textures, [MERGED_KEY]: true }
  const uniforms: Record<string, THREE.IUniform> = { uParams: { value: atlas.params } }
  atlas.arrays.forEach((t, a) => (uniforms[`uArr${a}`] = { value: t }))
  const head = fragmentHead(atlas.arrays.length)
  m.onBeforeCompile = (shader, renderer) => {
    if (renderer instanceof THREE.WebGLRenderer) atlas.upload(renderer)
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${VERTEX_HEAD}`)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMacro = cMacro;\nvCouche = cUv;\nvRow = cRow;')
    shader.fragmentShader = [...LAYER_INJECTIONS, GLOW_INJECTION].reduce(
      (s, [from, to]) => s.replace(from, to),
      shader.fragmentShader.replace('#include <common>', `#include <common>${head}`),
    )
  }
  m.customProgramCacheKey = () => `layers-arrays-v3-${atlas.arrays.length}`
  return m
}
