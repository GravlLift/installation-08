// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * armorMaterial3d.ts — AN ARMOR PIECE'S PAINTED MATERIAL: the piece's standard material
 * (lighting, shadows, fog, scene reflections unchanged), whose color, roughness, metalness
 * and emission are computed per pixel from the piece's raw masks (`extras.surfaceBrute`: ASG,
 * mask 0, mask 1) and the player's paint (`armorCoating3d`).
 *
 * Composition (that of the "Halo Infinite Shader" node of the Ekur Blender plugin, The Halo
 * Archive, reimplemented here without reusing its code):
 *   - zone k: its gradient's red picks low (0), mid (0.5), high (1); its blue mixes roughness
 *     from black to white, multiplied by the exponent / 4;
 *   - zones stacked on each other: base, then R, G, B of mask 0, then of mask 1;
 *   - scratches: toward the zones' scratch color, roughness and metalness, wherever the ASG's
 *     green exceeds 1 - scratch amount; grime: toward its swatch wherever the blue exceeds
 *     1 - grime amount; occlusion: the ASG's red multiplies the color.
 *   - Approximated: no swatch detail normals, emission = color × amount.
 *
 * ONE program for every piece of every player: the paint lives in uniforms (`packPaint`), the
 * gradients in the session's layered texture (`armorGradients3d`), the program cache does not
 * depend on them. Team is not read off the armor: the team outline is drawn after the scene
 * (`outline3d`).
 */
import * as THREE from 'three'

import { ZONES, type CoatingSwatch, type MaterialPaint, type PaintNote } from './armorCoating3d'
import { cloneMaterial } from './cloneMaterial3d'

/** Swatch slots: seven zones then the grime. */
export const PAINT_SLOTS = ZONES + 1
/** Four-float vectors per slot (`packPaint`). */
export const VEC4_PER_SLOT = 6
export const ARMURE_NEUTRE = 0.18
export const RUGOSITE_ARMURE_NEUTRE = 0.6
const GRIME_SLOT = ZONES
const NO_GRADIENT = -1

/** A material's paint, ready for the uniforms. */
export interface PackedPaint {
  /**
   * `PAINT_SLOTS` × `VEC4_PER_SLOT` vectors: (on, gradient layer, scale x, y), (high,
   * emission), (mid, metalness), (low, exponent / 4), (scratch, scratch metalness), (black
   * roughness, white, scratch, 0).
   */
  data: Float32Array
  /** Grime, scratches, texel density x, y. */
  globals: [number, number, number, number]
  offset: [number, number]
}

/** gradientsOf: the gradients named by paint `p` (zones and grime), each once. */
export function gradientsOf(p: MaterialPaint): string[] {
  const ids = [...p.zones, p.grime].map((s) => s?.gradient).filter((g): g is string => !!g)
  return [...new Set(ids)]
}

/**
 * packPaint packs paint `p`; `layerOf` returns the layer of a loaded gradient
 * (`armorGradients3d`), an unloaded gradient becomes neutral (named).
 */
export function packPaint(p: MaterialPaint, layerOf: (id: string) => number | undefined, note: PaintNote): PackedPaint {
  const data = new Float32Array(PAINT_SLOTS * VEC4_PER_SLOT * 4)
  const layer = (g: string | undefined): number => {
    if (!g) return NO_GRADIENT
    const l = layerOf(g)
    if (l === undefined) note('gradient_missing', g)
    return l ?? NO_GRADIENT
  }
  const put = (slot: number, s: CoatingSwatch | null) => {
    if (!s) return
    const o = slot * VEC4_PER_SLOT * 4
    data.set([1, layer(s.gradient), s.gradient_scale[0], s.gradient_scale[1]], o)
    data.set([...s.top, s.emissive], o + 4)
    data.set([...s.mid, s.metallic], o + 8)
    data.set([...s.bot, s.roughness / 4], o + 12)
    data.set([...s.scratch_color, s.scratch_metallic], o + 16)
    data.set([s.roughness_black, s.roughness_white, s.scratch_roughness, 0], o + 20)
  }
  p.zones.forEach((z, k) => put(k, z))
  put(GRIME_SLOT, p.grime)
  return { data, globals: [p.grime ? p.grimeAmount : 0, p.scratchAmount, p.density[0], p.density[1]], offset: p.offset }
}

/** A piece's raw masks (GLB textures). */
export interface ArmorMaps {
  asg: THREE.Texture | null
  mask0: THREE.Texture | null
  mask1: THREE.Texture | null
}

/** The name of the coordinate attribute the material reads (alias of `uv`, no copy). */
const UV_ATTRIBUTE = 'armorUv'

/** prepareArmorUVs exposes `uv` under the material's name; false if the geometry has none. */
export function prepareArmorUVs(geometry: THREE.BufferGeometry): boolean {
  const uv = geometry.getAttribute('uv')
  if (!uv) return false
  if (!geometry.getAttribute(UV_ATTRIBUTE)) geometry.setAttribute(UV_ATTRIBUTE, uv)
  return true
}

const VERTEX_HEAD = /* glsl */ `
attribute vec2 ${UV_ATTRIBUTE};
varying vec2 vArmorUv;`

const FRAGMENT_HEAD = /* glsl */ `
uniform sampler2D uArmorAsg;
uniform sampler2D uArmorMask0;
uniform sampler2D uArmorMask1;
uniform highp sampler2DArray uArmorGradients;
uniform vec4 uArmorHas;
uniform vec4 uPaint[${PAINT_SLOTS * VEC4_PER_SLOT}];
uniform vec4 uPaintGlobal;
uniform vec2 uPaintOffset;
varying vec2 vArmorUv;

struct ArmorZone { vec3 col; float rough; float metal; vec3 scol; float srough; float smetal; float emis; };

vec2 armorGradient(float layer, vec2 uv) {
  if (layer < -0.5) return vec2(0.5);
  return texture(uArmorGradients, vec3(uv, layer)).rg;
}

ArmorZone armorZone(int k) {
  int o = k * ${VEC4_PER_SLOT};
  vec4 a = uPaint[o];
  vec2 g = armorGradient(a.y, vArmorUv * uPaintGlobal.zw * a.zw + uPaintOffset);
  vec3 low = mix(uPaint[o + 2].rgb, uPaint[o + 1].rgb, clamp(2.0 * g.x - 1.0, 0.0, 1.0));
  vec3 col = mix(low, uPaint[o + 3].rgb, clamp(1.0 - 2.0 * g.x, 0.0, 1.0));
  vec4 r = uPaint[o + 5];
  return ArmorZone(col, mix(r.x, r.y, g.y) * uPaint[o + 3].a, uPaint[o + 2].a,
    uPaint[o + 4].rgb, r.z, uPaint[o + 4].a, uPaint[o + 1].a);
}

void armorStack(inout ArmorZone s, ArmorZone z, float w) {
  s.col = mix(s.col, z.col, w);
  s.rough = mix(s.rough, z.rough, w);
  s.metal = mix(s.metal, z.metal, w);
  s.scol = mix(s.scol, z.scol, w);
  s.srough = mix(s.srough, z.srough, w);
  s.smetal = mix(s.smetal, z.smetal, w);
  s.emis = mix(s.emis, z.emis, w);
}

#define ARMOR_NEUTRAL ArmorZone(vec3(${ARMURE_NEUTRE}), ${RUGOSITE_ARMURE_NEUTRE}, 0.0, vec3(${ARMURE_NEUTRE}), ${RUGOSITE_ARMURE_NEUTRE}, 0.0, 0.0)

ArmorZone armorPaint() {
  vec3 m0 = uArmorHas.y > 0.5 ? texture2D(uArmorMask0, vArmorUv).rgb : vec3(0.0);
  vec3 m1 = uArmorHas.z > 0.5 ? texture2D(uArmorMask1, vArmorUv).rgb : vec3(0.0);
  vec3 asg = uArmorHas.x > 0.5 ? texture2D(uArmorAsg, vArmorUv).rgb : vec3(1.0, 0.0, 0.0);
  float w[${ZONES}] = float[${ZONES}](1.0, m0.r, m0.g, m0.b, m1.r, m1.g, m1.b);
  ArmorZone s = ARMOR_NEUTRAL;
  for (int k = 0; k < ${ZONES}; k++) {
    if (uPaint[k * ${VEC4_PER_SLOT}].x > 0.5) armorStack(s, armorZone(k), w[k]);
  }
  float scratch = clamp(asg.g + uPaintGlobal.y - 1.0, 0.0, 1.0);
  s.col = mix(s.col, s.scol, scratch);
  s.rough = mix(s.rough, s.srough, scratch);
  s.metal = mix(s.metal, s.smetal, scratch);
  if (uPaint[${GRIME_SLOT * VEC4_PER_SLOT}].x > 0.5) {
    ArmorZone g = armorZone(${GRIME_SLOT});
    float grime = clamp(asg.b + uPaintGlobal.x - 1.0, 0.0, 1.0);
    s.col = mix(s.col, g.col, grime);
    s.rough = mix(s.rough, g.rough, grime);
    s.metal = mix(s.metal, g.metal, grime);
  }
  s.col *= asg.r;
  return s;
}`

/** The shared program: paint only changes uniforms. */
const PROGRAM_KEY = 'armure-revetement-v1'

/** What's needed to paint a material copy. */
export interface ArmorPaintInput {
  maps: ArmorMaps
  paint: PackedPaint
  /** The session's shared gradient uniform (`GradientAtlas.uniform`), shared as is. */
  gradients: THREE.IUniform<THREE.Texture>
}

/**
 * armorMaterial: a copy of `base` (the piece's standard material) painted by `input`. It owns
 * no texture (masks and gradients belong to the library).
 */
export function armorMaterial(base: THREE.MeshStandardMaterial, input: ArmorPaintInput): THREE.MeshStandardMaterial {
  const m = cloneMaterial(base)
  m.color.set(1, 1, 1)
  m.map = null
  const { maps, paint } = input
  const uniforms: Record<string, THREE.IUniform> = {
    uArmorAsg: { value: maps.asg },
    uArmorMask0: { value: maps.mask0 },
    uArmorMask1: { value: maps.mask1 },
    uArmorGradients: input.gradients,
    uArmorHas: { value: new THREE.Vector4(maps.asg ? 1 : 0, maps.mask0 ? 1 : 0, maps.mask1 ? 1 : 0, 0) },
    uPaint: { value: paint.data },
    uPaintGlobal: { value: new THREE.Vector4(...paint.globals) },
    uPaintOffset: { value: new THREE.Vector2(...paint.offset) },
  }
  m.userData = { ...m.userData, armorUniforms: uniforms }
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${VERTEX_HEAD}`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>\nvArmorUv = ${UV_ATTRIBUTE};`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>${FRAGMENT_HEAD}`)
      .replace('#include <map_fragment>', '#include <map_fragment>\nArmorZone armor = armorPaint();\ndiffuseColor.rgb = armor.col;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(armor.rough, 0.04, 1.0);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = clamp(armor.metal, 0.0, 1.0);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += armor.col * armor.emis;')
  }
  m.customProgramCacheKey = () => PROGRAM_KEY
  return m
}
