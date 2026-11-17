// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * armorMaterial3d.ts — LE MATÉRIAU PEINT D'UNE PIÈCE D'ARMURE : le matériau standard de la pièce
 * (éclairage, ombres, brouillard, reflets de la scène inchangés), dont la couleur, la rugosité, le
 * métal et l'émission sont calculés par pixel depuis les masques bruts de la pièce
 * (`extras.surfaceBrute` : ASG, masque 0, masque 1) et la peinture du joueur (`armorCoating3d`).
 *
 * Composition (celle du nœud « Halo Infinite Shader » du greffon Blender Ekur, The Halo Archive,
 * réimplémentée sans en reprendre le code) :
 *   - zone k : le rouge de son dégradé choisit bas (0), milieu (0,5), haut (1) ; son bleu mêle la
 *     rugosité du noir au blanc, multipliée par l'exposant / 4 ;
 *   - zones posées l'une sur l'autre : base, puis R, V, B du masque 0, puis du masque 1 ;
 *   - rayures : vers la couleur, la rugosité et le métal de rayure des zones, là où le vert de l'ASG
 *     dépasse 1 - quantité de rayures ; salissure : vers son nuancier là où le bleu dépasse
 *     1 - quantité de salissure ; occlusion : le rouge de l'ASG multiplie la couleur.
 *   - Approximé : pas de normales de détail des nuanciers, émission = couleur × quantité.
 *
 * UN programme pour toutes les pièces de tous les joueurs : la peinture vit dans des uniformes
 * (`packPaint`), les dégradés dans la texture à couches de la session (`armorGradients3d`), le cache
 * de programme ne dépend pas d'eux. Le camp ne se lit pas sur l'armure : le contour d'équipe est
 * tracé après la scène (`outline3d`).
 */
import * as THREE from 'three'

import { ZONES, type CoatingSwatch, type MaterialPaint, type PaintNote } from './armorCoating3d'

/** Emplacements de nuancier : sept zones puis la salissure. */
export const PAINT_SLOTS = ZONES + 1
/** Vecteurs de quatre flottants par emplacement (`packPaint`). */
export const VEC4_PER_SLOT = 6
export const ARMURE_NEUTRE = 0.18
export const RUGOSITE_ARMURE_NEUTRE = 0.6
const GRIME_SLOT = ZONES
const NO_GRADIENT = -1

/** La peinture d'un matériau, prête pour les uniformes. */
export interface PackedPaint {
  /**
   * `PAINT_SLOTS` × `VEC4_PER_SLOT` vecteurs : (allumé, couche du dégradé, échelle x, y), (haut,
   * émission), (milieu, métal), (bas, exposant / 4), (rayure, métal de rayure), (rugosité noir,
   * blanc, de rayure, 0).
   */
  data: Float32Array
  /** Salissure, rayures, densité de texels x, y. */
  globals: [number, number, number, number]
  offset: [number, number]
}

/** gradientsOf : les dégradés que nomme la peinture `p` (zones et salissure), une fois chacun. */
export function gradientsOf(p: MaterialPaint): string[] {
  const ids = [...p.zones, p.grime].map((s) => s?.gradient).filter((g): g is string => !!g)
  return [...new Set(ids)]
}

/**
 * packPaint range la peinture `p` ; `layerOf` rend la couche d'un dégradé chargé
 * (`armorGradients3d`), un dégradé non chargé devient neutre (nommé).
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

/** Les masques bruts d'une pièce (textures du GLB). */
export interface ArmorMaps {
  asg: THREE.Texture | null
  mask0: THREE.Texture | null
  mask1: THREE.Texture | null
}

/** Le nom de l'attribut de coordonnées lu par le matériau (alias de `uv`, sans copie). */
const UV_ATTRIBUTE = 'armorUv'

/** prepareArmorUVs expose `uv` sous le nom du matériau ; faux si la géométrie n'en a pas. */
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

/** Le programme commun : la peinture ne change que des uniformes. */
const PROGRAM_KEY = 'armure-revetement-v1'

/** Ce qu'il faut pour peindre une copie de matériau. */
export interface ArmorPaintInput {
  maps: ArmorMaps
  paint: PackedPaint
  /** L'uniforme commun des dégradés de la session (`GradientAtlas.uniform`), partagé tel quel. */
  gradients: THREE.IUniform<THREE.Texture>
}

/**
 * armorMaterial : une copie de `base` (matériau standard de la pièce) peinte par `input`. Elle ne
 * possède aucune texture (masques et dégradés appartiennent à la bibliothèque).
 */
export function armorMaterial(base: THREE.MeshStandardMaterial, input: ArmorPaintInput): THREE.MeshStandardMaterial {
  const m = base.clone()
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
