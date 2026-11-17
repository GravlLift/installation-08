// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * layeredMaterial.ts — THE GLB'S LAYERED MATERIALS (`extras.couches`, written by
 * libs/himap/himap/glb_couches.go).
 *
 * Up to four layers; the macro mask (2nd coordinate set) lays layers 2, 3, 4 onto the first;
 * layers repeat on the `jeuCouches` set (3rd for a terrain shader, 1st for a diffuse one, which
 * has only one layer).
 * - A "couleur" layer: an sRGB map × tint. A "degrade" layer: its map's red channel picks
 *   between bottom (0), middle (0.5) and top (1). Tints are linear.
 * - Relief: each layer has its own tangent-space normal map (DirectX convention: +Y follows the
 *   v coordinate, toward the bottom of the image) and its own occlusion (the green channel of
 *   its control map), blended with the same weights as the color. The GLB carries no tangents:
 *   the tangent frame is derived from the screen-space derivatives of position and layer
 *   coordinates.
 * - Material: roughness (the control's blue channel) and metal (the red channel of a "couleur"
 *   layer's control, which is the metal source there), blended the same way, replace those of
 *   the base standard material.
 */
import * as THREE from 'three'
import type { GLTFParser } from 'three/addons/loaders/GLTFLoader.js'

/** Number of layers read per material (further ones are ignored). */
export const MAX_LAYERS = 4

/** Number of vec4 per layer in `uLayer`. */
export const LAYER_ROWS = 10

/** A layer as the GLB describes it (`extras.couches.couches[]`). */
export interface LayerInfo {
  sorte: 'couleur' | 'degrade'
  texture?: number
  normale?: number
  controle?: number
  echelle?: [number, number]
  decalage?: [number, number]
  teinte?: [number, number, number]
  haut?: [number, number, number]
  milieu?: [number, number, number]
  bas?: [number, number, number]
  hauteur?: [number, number, number]
  matiere?: [number, number, number]
  melange?: number
  opacite?: number
  echelleNormale?: [number, number]
  decalageNormale?: [number, number]
  intensiteNormale?: number
  melangeNormale?: number
  echelleControle?: [number, number]
  decalageControle?: [number, number]
  /**
   * Template rank of the layer (0..3), present only when it differs from the layer's position: a
   * shader can skip a template layer (Live Fire's boulders declare layers 1, 2 and 4). The rank
   * picks the macro mask channel and the height blend index.
   */
  rang?: number
  /**
   * The normal / control map is the object's own (a Forge material's normal map and ASG), unwrapped
   * once on the mask's coordinates (`jeuMasque`), not repeated on the layer's.
   */
  normaleMacro?: boolean
  controleMacro?: boolean
}

/** A material's composition (`extras.couches`). */
export interface LayeredInfo {
  couches: LayerInfo[]
  masque: number
  jeuMasque: number
  jeuCouches: number
  /** The cutout's alpha is the mask's alpha, on its coordinates (a Forge style decal). */
  decoupeMasque?: boolean
}

/** usesMaskSet : the composition reads the mask's coordinates (a mask, or a map laid on them). */
export function usesMaskSet(info: LayeredInfo): boolean {
  return info.masque >= 0 || info.couches.some((l) => l.normaleMacro || l.controleMacro)
}

/** The layers' attributes and varyings, shared by the per-material shader and the merged shader. */
export const LAYER_VERTEX_HEAD = /* glsl */ `
attribute vec2 cMacro;
attribute vec2 cUv;
varying vec2 vMacro;
varying vec2 vCouche;`

const UNIFORMS_HEAD = /* glsl */ `
uniform sampler2D uMask;
uniform sampler2D uTex0;
uniform sampler2D uTex1;
uniform sampler2D uTex2;
uniform sampler2D uTex3;
uniform sampler2D uNrm0;
uniform sampler2D uNrm1;
uniform sampler2D uNrm2;
uniform sampler2D uNrm3;
uniform sampler2D uCtl0;
uniform sampler2D uCtl1;
uniform sampler2D uCtl2;
uniform sampler2D uCtl3;
uniform float uHasMask;
uniform float uMaskCut;
uniform int uCount;
// The layers' constants, LAYER_ROWS vec4 per layer (see packLayers).
#define LAYER_ROWS ${LAYER_ROWS}
uniform vec4 uLayer[${MAX_LAYERS} * LAYER_ROWS];
#define L_ROW(k, i) uLayer[(k) * LAYER_ROWS + (i)]`

/**
 * A layer's fields, read by `L_ROW(k, i)` (row i of layer k), which each shader defines up
 * front: a uniform array here, a parameter texture for the merged shader. Then the sample
 * decoding and layer composition, shared by both.
 */
export const LAYER_COMPOSE = /* glsl */ `
#define L_XFORM(k) L_ROW(k, 0)
#define L_NXFORM(k) L_ROW(k, 1)
#define L_CXFORM(k) L_ROW(k, 2)
#define L_TINT(k) L_ROW(k, 3).rgb
#define L_KIND(k) L_ROW(k, 3).a
#define L_TOP(k) L_ROW(k, 4).rgb
#define L_BLEND(k) L_ROW(k, 4).a
#define L_MID(k) L_ROW(k, 5).rgb
#define L_OPACITY(k) L_ROW(k, 5).a
#define L_BOT(k) L_ROW(k, 6).rgb
#define L_NINT(k) L_ROW(k, 6).a
#define L_HAS_NRM(k) L_ROW(k, 7).x
#define L_NBLEND(k) L_ROW(k, 7).y
#define L_HAS_CTL(k) L_ROW(k, 7).z
#define L_RANK(k) L_ROW(k, 7).w
#define L_HEIGHT(k) L_ROW(k, 8)
#define L_MAT(k) L_ROW(k, 9)
varying vec2 vMacro;
varying vec2 vCouche;

// Weight of layer k in the macro mask: the channel of its template rank (2: R, 3: G, 4: B).
float maskWeight(vec4 m, int k) {
  float r = L_RANK(k);
  return r < 1.5 ? m.r : (r < 2.5 ? m.g : m.b);
}

vec2 at(vec4 x) { return vCouche * x.xy + x.zw; }
// A map flagged 2 (has-normal / has-control row) lies on the mask's coordinates.
vec2 atOn(vec4 x, float on) { return (on > 1.5 ? vMacro : vCouche) * x.xy + x.zw; }

// A layer's color from its map's sample. A gradient runs from the bottom
// color (0) through the middle (0.5) to the top (1), as Ekur's ColorMixer node does.
vec3 colorOf(vec4 s, int k) {
  if (L_KIND(k) < 0.5) return s.rgb * L_TINT(k);
  float g = s.r;
  vec3 low = mix(L_MID(k), L_BOT(k), clamp(1.0 - g * 2.0, 0.0, 1.0));
  return mix(low, L_TOP(k), clamp(g * 2.0 - 1.0, 0.0, 1.0));
}

// A layer's tangent-space normal from the red and green of its normal map.
vec3 normalOf(vec2 rg, int k) {
  vec2 xy = rg * 2.0 - 1.0;
  float z = sqrt(max(0.0, 1.0 - dot(xy, xy)));
  return normalize(vec3(xy * L_NINT(k), z));
}

// A layer's control: occlusion, roughness, metal (the image's red channel for a "couleur" layer,
// whose original alpha it is; a gradient layer has no metal).
#define ROUGH_DEFAULT 0.6
vec3 controlOf(vec3 c, int k) {
  vec4 p = L_MAT(k);
  return vec3(c.g, p.w > 0.5 ? mix(p.y, p.x, c.b) : c.b, p.w > 0.5 ? p.z : (L_KIND(k) < 0.5 ? c.r : 0.0));
}

vec3 overlay(vec3 a, vec3 b) {
  return mix(2.0 * a * b, 1.0 - 2.0 * (1.0 - a) * (1.0 - b), step(0.5, a));
}

// Normal mode 1: the layer's relief adds to the one below it (a "whiteout" blend).
vec3 stackNormal(vec3 n, vec3 m, float w, int k) {
  vec3 target = L_NBLEND(k) > 0.5 ? normalize(vec3(n.xy + m.xy, n.z * m.z)) : m;
  return normalize(mix(n, target, w));
}

// ctl: occlusion, roughness, metal.
struct Surface { vec3 color; vec3 normal; vec3 ctl; };

void stack(inout Surface s, vec3 c, vec3 n, vec3 ctl, float mw, int k) {
  float w = clamp(mw, 0.0, 1.0);
  s.color = mix(s.color, L_BLEND(k) > 0.5 ? overlay(s.color, c) : c, w);
  s.normal = stackNormal(s.normal, n, w, k);
  s.ctl = mix(s.ctl, ctl, w);
}

// Height blend: reference equations from Ekur, layer_blending and heightblend.
float startHeight(float c, float mask) {
  return clamp(L_HEIGHT(0).x * (c + mask - 1.0), 0.0, 4.0);
}
float heightWeight(inout float h, float c, float mask, int k) {
  vec4 p = L_HEIGHT(k);
  float rank = L_RANK(k);
  float next = clamp(p.x * (c + mask - 1.0) + rank * mask, 0.0, 4.0);
  float threshold = min(rank, h - 0.5 * p.y);
  float x = clamp((next - threshold) / max(p.y, 0.0001), 0.0, 1.0);
  float w = (L_OPACITY(k) < 0.0 ? 1.0 - x : x) * L_OPACITY(k);
  h += p.z * (max(h, next) - h);
  return w;
}
// Tangent frame from derivatives (Schuler, "Normal Mapping Without Precomputed Tangents"); a
// surface whose coordinates do not vary keeps its normal.
vec3 perturb(vec3 n, vec3 p, vec2 uv, vec3 t) {
  vec3 dp1 = dFdx(p), dp2 = dFdy(p);
  vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, n), dp1perp = cross(n, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float len2 = max(dot(T, T), dot(B, B));
  if (len2 < 1e-24) return n;
  float inv = inversesqrt(len2);
  vec3 r = mat3(T * inv, B * inv, n) * t;
  return dot(r, r) > 1e-12 ? normalize(r) : n;
}`

// The per-material shader's sampling: one texture unit per map.
const PER_MATERIAL_SAMPLING = /* glsl */ `
vec3 layerColor(sampler2D t, int k) {
  return colorOf(texture2D(t, at(L_XFORM(k))), k);
}

vec3 layerNormal(sampler2D t, int k) {
  if (L_HAS_NRM(k) < 0.5) return vec3(0.0, 0.0, 1.0);
  return normalOf(texture2D(t, atOn(L_NXFORM(k), L_HAS_NRM(k))).rg, k);
}

vec3 layerControl(sampler2D t, int k) {
  if (L_HAS_CTL(k) < 0.5) return vec3(1.0, ROUGH_DEFAULT, 0.0);
  return controlOf(texture2D(t, atOn(L_CXFORM(k), L_HAS_CTL(k))).rgb, k);
}

Surface layered() {
  vec4 m = uHasMask > 0.5 ? texture2D(uMask, vMacro) : vec4(0.0);
  bool useHeight = uHasMask > 0.5 && L_HEIGHT(0).w > 0.5 && L_HAS_CTL(0) > 0.5;
  float h = useHeight ? startHeight(texture2D(uCtl0, at(L_CXFORM(0))).a, m.a) : 0.0;
  Surface s = Surface(layerColor(uTex0, 0), layerNormal(uNrm0, 0), layerControl(uCtl0, 0));
  if (uCount > 1) { float mw = maskWeight(m, 1); float w = useHeight && L_HEIGHT(1).w > 0.5 && L_HAS_CTL(1) > 0.5 ? heightWeight(h, texture2D(uCtl1, at(L_CXFORM(1))).a, mw, 1) : mw * L_OPACITY(1); stack(s, layerColor(uTex1, 1), layerNormal(uNrm1, 1), layerControl(uCtl1, 1), w, 1); }
  if (uCount > 2) { float mw = maskWeight(m, 2); float w = useHeight && L_HEIGHT(2).w > 0.5 && L_HAS_CTL(2) > 0.5 ? heightWeight(h, texture2D(uCtl2, at(L_CXFORM(2))).a, mw, 2) : mw * L_OPACITY(2); stack(s, layerColor(uTex2, 2), layerNormal(uNrm2, 2), layerControl(uCtl2, 2), w, 2); }
  if (uCount > 3) { float mw = maskWeight(m, 3); float w = useHeight && L_HEIGHT(3).w > 0.5 && L_HAS_CTL(3) > 0.5 ? heightWeight(h, texture2D(uCtl3, at(L_CXFORM(3))).a, mw, 3) : mw * L_OPACITY(3); stack(s, layerColor(uTex3, 3), layerNormal(uNrm3, 3), layerControl(uCtl3, 3), w, 3); }
  return s;
}`

const FRAGMENT_HEAD = UNIFORMS_HEAD + LAYER_COMPOSE + PER_MATERIAL_SAMPLING

/**
 * LAYER_INJECTIONS: the replacements, in three.js's standard shader, that place the layers'
 * surface (`layered()`) in place of the color, roughness, metal and normal.
 */
export const LAYER_INJECTIONS: readonly (readonly [string, string])[] = [
  ['#include <map_fragment>', '#include <map_fragment>\nSurface surf = layered();\ndiffuseColor.rgb = surf.color * surf.ctl.x;\n#ifdef USE_ALPHATEST\ndiffuseColor.a = uMaskCut > 0.5 ? texture2D(uMask, vMacro).a : texture2D(uTex0, at(L_XFORM(0))).a;\n#endif'],
  ['#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = surf.ctl.y;'],
  ['#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = surf.ctl.z;'],
  ['#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = perturb(normal, -vViewPosition, L_HAS_NRM(0) > 1.5 ? vMacro : vCouche, surf.normal);'],
]

/** Names of GLTFLoader's coordinate sets (TEXCOORD_n). */
export const UV_NAMES: readonly string[] = ['uv', 'uv1', 'uv2']

/**
 * prepareLayerUVs exposes the macro mask's set and the layers' set (`jeuMasque`,
 * `jeuCouches`) under names of the shader's own, to avoid crossing three.js's attributes.
 * With no mask, the mask's set is not read (it may be missing). A map laid on the mask's set reads
 * the layer's set on a geometry without it (Ekur keeps the active map when UV1 is missing).
 */
export function prepareLayerUVs(geometry: THREE.BufferGeometry, info: LayeredInfo): boolean {
  const layer = geometry.getAttribute(UV_NAMES[info.jeuCouches] ?? '')
  const own = usesMaskSet(info) ? geometry.getAttribute(UV_NAMES[info.jeuMasque] ?? '') : undefined
  const macro = info.masque >= 0 ? own : (own ?? layer)
  if (!macro || !layer) return false
  geometry.setAttribute('cMacro', macro)
  geometry.setAttribute('cUv', layer)
  return true
}

/** glTF texture index -> three.js texture (null for an absent map, negative index). */
async function load(parser: GLTFParser, index: number | undefined, colorSpace: THREE.ColorSpace) {
  if (index === undefined || index < 0) return null
  const t = (await parser.getDependency('texture', index)) as THREE.Texture
  t.colorSpace = colorSpace
  return t
}

const xform = (scale?: [number, number], offset?: [number, number]) => [scale?.[0] ?? 1, scale?.[1] ?? 1, offset?.[0] ?? 0, offset?.[1] ?? 0]

const rgb = (c?: [number, number, number]) => c ?? [0, 0, 0]

/**
 * packLayers files the layers' constants into the single `uLayer` array: per layer k,
 * LAYER_ROWS vec4 starting at k * LAYER_ROWS:
 * - 0: color's echelle.xy, decalage.xy; 1: same for the normal; 2: same for the control;
 * - 3: teinte.rgb, sorte (0 couleur, 1 degrade); 4: haut.rgb, melange;
 * - 5: milieu.rgb, opacite; 6: bas.rgb, normal intensity;
 * - 7: has a normal, normal mode, has a control, template rank (`rang`, defaulting to k); a
 *   normal or control laid on the mask's coordinates (`normaleMacro`, `controleMacro`) counts 2;
 * - 8: hauteur; 9: matiere.
 * A missing layer gets neutral transforms (1, 1, 0, 0) and zero everywhere else.
 * `hasNormal[k]` / `hasControl[k]`: layer k's map is loaded.
 */
export function packLayers(layers: readonly LayerInfo[], hasNormal: readonly boolean[], hasControl: readonly boolean[]): Float32Array {
  const out = new Float32Array(MAX_LAYERS * LAYER_ROWS * 4)
  for (let k = 0; k < MAX_LAYERS; k++) {
    const l = layers[k]
    const o = k * LAYER_ROWS * 4
    if (!l) {
      out.set([...xform(), ...xform(), ...xform()], o)
      continue
    }
    out.set([
      ...xform(l.echelle, l.decalage),
      ...xform(l.echelleNormale, l.decalageNormale),
      ...xform(l.echelleControle, l.decalageControle),
      ...rgb(l.teinte), l.sorte === 'couleur' ? 0 : 1,
      ...rgb(l.haut), l.melange ?? 0,
      ...rgb(l.milieu), l.opacite ?? 0,
      ...rgb(l.bas), l.intensiteNormale ?? 1,
      hasNormal[k] ? (l.normaleMacro ? 2 : 1) : 0, l.melangeNormale ?? 0, hasControl[k] ? (l.controleMacro ? 2 : 1) : 0, l.rang ?? k,
      ...(l.hauteur ?? [0, 0, 0]), l.hauteur ? 1 : 0,
      ...(l.matiere ?? [0, 0, 0]), l.matiere ? 1 : 0,
    ], o)
  }
  return out
}

/**
 * layeredMaterial clones `base` (same lighting, same fog) and replaces its color, normal,
 * roughness and metal with the layer composition from `info`.
 */
export async function layeredMaterial(
  base: THREE.MeshStandardMaterial,
  info: LayeredInfo,
  parser: GLTFParser,
): Promise<THREE.MeshStandardMaterial> {
  const layers = info.couches.slice(0, MAX_LAYERS)
  const color = (l: LayerInfo) => (l.sorte === 'couleur' ? THREE.SRGBColorSpace : THREE.NoColorSpace)
  const [maps, normals, controls, mask] = await Promise.all([
    Promise.all(layers.map((l) => load(parser, l.texture, color(l)))),
    Promise.all(layers.map((l) => load(parser, l.normale, THREE.NoColorSpace))),
    Promise.all(layers.map((l) => load(parser, l.controle, THREE.NoColorSpace))),
    load(parser, info.masque, THREE.NoColorSpace),
  ])

  const uniforms: Record<string, THREE.IUniform> = {
    uMask: { value: mask },
    uHasMask: { value: mask ? 1 : 0 },
    uMaskCut: { value: mask && info.decoupeMasque ? 1 : 0 },
    uCount: { value: layers.length },
    // A single, already-flat array: three.js sends it as-is on every material change (a uniform
    // array has no cache, every array costs a send).
    uLayer: { value: packLayers(layers, normals.map((t) => t !== null), controls.map((t) => t !== null)) },
  }
  for (let k = 0; k < MAX_LAYERS; k++) {
    uniforms[`uTex${k}`] = { value: maps[k] ?? null }
    uniforms[`uNrm${k}`] = { value: normals[k] ?? null }
    uniforms[`uCtl${k}`] = { value: controls[k] ?? null }
  }

  const m = base.clone()
  m.color.set(1, 1, 1)
  // The layers' textures live in uniforms, outside the fields three.js disposes: the material
  // names them for whoever releases it (mapModel).
  m.userData.textures = [...maps, ...normals, ...controls, mask].filter((t): t is THREE.Texture => t !== null)
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${LAYER_VERTEX_HEAD}`)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMacro = cMacro;\nvCouche = cUv;')
    shader.fragmentShader = LAYER_INJECTIONS.reduce(
      (s, [from, to]) => s.replace(from, to),
      shader.fragmentShader.replace('#include <common>', `#include <common>${FRAGMENT_HEAD}`),
    )
  }
  m.customProgramCacheKey = () => 'couches-v6'
  compositions.set(m, { info, layers, maps, normals, controls, mask })
  return m
}

/** A layered material's composition: its layers and the loaded map for each slot. */
export interface LayeredComposition {
  info: LayeredInfo
  /** The layers read (at most MAX_LAYERS). */
  layers: readonly LayerInfo[]
  maps: readonly (THREE.Texture | null)[]
  normals: readonly (THREE.Texture | null)[]
  controls: readonly (THREE.Texture | null)[]
  mask: THREE.Texture | null
}

const compositions = new WeakMap<THREE.Material, LayeredComposition>()

/**
 * layeredComposition returns the composition of a material made by `layeredMaterial` (undefined
 * for any other material): the map's material merge (`layeredMerge3d`) reads it back.
 */
export function layeredComposition(material: THREE.Material): LayeredComposition | undefined {
  return compositions.get(material)
}
