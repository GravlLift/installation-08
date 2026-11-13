/**
 * layeredMaterial.ts — LES MATÉRIAUX EN COUCHES DU GLB (`extras.couches`, écrits par
 * libs/himap/himap/glb_couches.go).
 *
 * Jusqu'à quatre couches ; le masque macro (2e jeu de coordonnées) pose les couches 2, 3, 4 sur
 * la première ; les couches se répètent sur le jeu `jeuCouches` (3e pour un shader de niveau, 1er
 * pour un diffus, qui n'a qu'une couche).
 * - Couche « couleur » : carte sRGB × teinte. Couche « dégradé » : le rouge de sa carte choisit
 *   entre haut (0), milieu (0,5) et bas (1). Les teintes sont linéaires.
 * - Relief : chaque couche a sa carte normale tangente (convention DirectX : +Y suit la
 *   coordonnée v, vers le bas de l'image) et son occlusion (vert de sa carte de contrôle),
 *   mélangées avec les mêmes poids que la couleur. Le GLB ne porte pas de tangentes : le repère
 *   tangent se déduit des dérivées écran de la position et des coordonnées des couches.
 * - Matière : rugosité (bleu du contrôle) et métal (rouge du contrôle d'une couche couleur),
 *   mélangés de même, remplacent celles du matériau standard de base.
 */
import * as THREE from 'three'
import type { GLTFParser } from 'three/addons/loaders/GLTFLoader.js'

/** Nombre de couches lues par matériau (les suivantes sont ignorées). */
export const MAX_LAYERS = 4

/** Nombre de vec4 par couche dans `uLayer`. */
export const LAYER_ROWS = 10

/** Une couche telle que le GLB la décrit (`extras.couches.couches[]`). */
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
}

/** La composition d'un matériau (`extras.couches`). */
export interface LayeredInfo {
  couches: LayerInfo[]
  masque: number
  jeuMasque: number
  jeuCouches: number
}

/** Les attributs et varyings des couches, communs au shader par matériau et au shader fusionné. */
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
uniform int uCount;
// Les constantes des couches, LAYER_ROWS vec4 par couche (cf. packLayers).
#define LAYER_ROWS ${LAYER_ROWS}
uniform vec4 uLayer[${MAX_LAYERS} * LAYER_ROWS];
#define L_ROW(k, i) uLayer[(k) * LAYER_ROWS + (i)]`

/**
 * Les champs d'une couche, lus par `L_ROW(k, i)` (la ligne i de la couche k), que chaque shader
 * définit avant : un tableau d'uniformes ici, une texture de paramètres pour le shader fusionné.
 * Puis le décodage des échantillons et la composition des couches, communs aux deux.
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
#define L_HEIGHT(k) L_ROW(k, 8)
#define L_MAT(k) L_ROW(k, 9)
varying vec2 vMacro;
varying vec2 vCouche;

vec2 at(vec4 x) { return vCouche * x.xy + x.zw; }

// Couleur d'une couche à partir de l'échantillon de sa carte.
vec3 colorOf(vec4 s, int k) {
  if (L_KIND(k) < 0.5) return s.rgb * L_TINT(k);
  float g = s.r;
  vec3 low = mix(L_MID(k), L_BOT(k), clamp(g * 2.0 - 1.0, 0.0, 1.0));
  return mix(low, L_TOP(k), clamp(1.0 - g * 2.0, 0.0, 1.0));
}

// Normale tangente d'une couche à partir du rouge et du vert de sa carte normale.
vec3 normalOf(vec2 rg, int k) {
  vec2 xy = rg * 2.0 - 1.0;
  float z = sqrt(max(0.0, 1.0 - dot(xy, xy)));
  return normalize(vec3(xy * L_NINT(k), z));
}

// Contrôle d'une couche : occlusion, rugosité, métal (rouge de l'image pour une couche couleur,
// dont il est l'alpha d'origine ; un dégradé n'a pas de métal).
#define ROUGH_DEFAULT 0.6
vec3 controlOf(vec3 c, int k) {
  vec4 p = L_MAT(k);
  return vec3(c.g, p.w > 0.5 ? mix(p.y, p.x, c.b) : c.b, p.w > 0.5 ? p.z : (L_KIND(k) < 0.5 ? c.r : 0.0));
}

vec3 overlay(vec3 a, vec3 b) {
  return mix(2.0 * a * b, 1.0 - 2.0 * (1.0 - a) * (1.0 - b), step(0.5, a));
}

// Mode de normale 1 : le relief de la couche s'ajoute à celui du dessous (mélange « whiteout »).
vec3 stackNormal(vec3 n, vec3 m, float w, int k) {
  vec3 target = L_NBLEND(k) > 0.5 ? normalize(vec3(n.xy + m.xy, n.z * m.z)) : m;
  return normalize(mix(n, target, w));
}

// ctl : occlusion, rugosité, métal.
struct Surface { vec3 color; vec3 normal; vec3 ctl; };

void stack(inout Surface s, vec3 c, vec3 n, vec3 ctl, float mw, int k) {
  float w = clamp(mw, 0.0, 1.0);
  s.color = mix(s.color, L_BLEND(k) > 0.5 ? overlay(s.color, c) : c, w);
  s.normal = stackNormal(s.normal, n, w, k);
  s.ctl = mix(s.ctl, ctl, w);
}

// Mélange de hauteur : équations de référence Ekur, layer_blending et heightblend.
float startHeight(float c, float mask) {
  return clamp(L_HEIGHT(0).x * (c + mask - 1.0), 0.0, 4.0);
}
float heightWeight(inout float h, float c, float mask, int k) {
  vec4 p = L_HEIGHT(k);
  float next = clamp(p.x * (c + mask - 1.0) + float(k) * mask, 0.0, 4.0);
  float threshold = min(float(k), h - 0.5 * p.y);
  float x = clamp((next - threshold) / max(p.y, 0.0001), 0.0, 1.0);
  float w = (L_OPACITY(k) < 0.0 ? 1.0 - x : x) * L_OPACITY(k);
  h += p.z * (max(h, next) - h);
  return w;
}
// Repère tangent par dérivées (Schuler, « Normal Mapping Without Precomputed Tangents ») ; une
// surface dont les coordonnées ne varient pas garde sa normale.
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

// L'échantillonnage du shader par matériau : une unité de texture par carte.
const PER_MATERIAL_SAMPLING = /* glsl */ `
vec3 layerColor(sampler2D t, int k) {
  return colorOf(texture2D(t, at(L_XFORM(k))), k);
}

vec3 layerNormal(sampler2D t, int k) {
  if (L_HAS_NRM(k) < 0.5) return vec3(0.0, 0.0, 1.0);
  return normalOf(texture2D(t, at(L_NXFORM(k))).rg, k);
}

vec3 layerControl(sampler2D t, int k) {
  if (L_HAS_CTL(k) < 0.5) return vec3(1.0, ROUGH_DEFAULT, 0.0);
  return controlOf(texture2D(t, at(L_CXFORM(k))).rgb, k);
}

Surface layered() {
  vec4 m = uHasMask > 0.5 ? texture2D(uMask, vMacro) : vec4(0.0);
  bool useHeight = uHasMask > 0.5 && L_HEIGHT(0).w > 0.5 && L_HAS_CTL(0) > 0.5;
  float h = useHeight ? startHeight(texture2D(uCtl0, at(L_CXFORM(0))).a, m.a) : 0.0;
  Surface s = Surface(layerColor(uTex0, 0), layerNormal(uNrm0, 0), layerControl(uCtl0, 0));
  if (uCount > 1) { float w = useHeight && L_HEIGHT(1).w > 0.5 && L_HAS_CTL(1) > 0.5 ? heightWeight(h, texture2D(uCtl1, at(L_CXFORM(1))).a, m.r, 1) : m.r * L_OPACITY(1); stack(s, layerColor(uTex1, 1), layerNormal(uNrm1, 1), layerControl(uCtl1, 1), w, 1); }
  if (uCount > 2) { float w = useHeight && L_HEIGHT(2).w > 0.5 && L_HAS_CTL(2) > 0.5 ? heightWeight(h, texture2D(uCtl2, at(L_CXFORM(2))).a, m.g, 2) : m.g * L_OPACITY(2); stack(s, layerColor(uTex2, 2), layerNormal(uNrm2, 2), layerControl(uCtl2, 2), w, 2); }
  if (uCount > 3) { float w = useHeight && L_HEIGHT(3).w > 0.5 && L_HAS_CTL(3) > 0.5 ? heightWeight(h, texture2D(uCtl3, at(L_CXFORM(3))).a, m.b, 3) : m.b * L_OPACITY(3); stack(s, layerColor(uTex3, 3), layerNormal(uNrm3, 3), layerControl(uCtl3, 3), w, 3); }
  return s;
}`

const FRAGMENT_HEAD = UNIFORMS_HEAD + LAYER_COMPOSE + PER_MATERIAL_SAMPLING

/**
 * LAYER_INJECTIONS : les remplacements, dans le shader standard de three, qui posent la surface
 * des couches (`layered()`) à la place de la couleur, de la rugosité, du métal et de la normale.
 */
export const LAYER_INJECTIONS: readonly (readonly [string, string])[] = [
  ['#include <map_fragment>', '#include <map_fragment>\nSurface surf = layered();\ndiffuseColor.rgb = surf.color * surf.ctl.x;\n#ifdef USE_ALPHATEST\ndiffuseColor.a = texture2D(uTex0, at(L_XFORM(0))).a;\n#endif'],
  ['#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = surf.ctl.y;'],
  ['#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = surf.ctl.z;'],
  ['#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = perturb(normal, -vViewPosition, vCouche, surf.normal);'],
]

/** Noms des jeux de coordonnées chez GLTFLoader (TEXCOORD_n). */
export const UV_NAMES: readonly string[] = ['uv', 'uv1', 'uv2']

/**
 * prepareLayerUVs expose le jeu du masque macro et celui des couches (`jeuMasque`,
 * `jeuCouches`) sous des noms propres au shader, pour ne pas croiser les attributs de three.
 * Sans masque, le jeu du masque n'est pas lu (il peut manquer).
 */
export function prepareLayerUVs(geometry: THREE.BufferGeometry, info: LayeredInfo): boolean {
  const layer = geometry.getAttribute(UV_NAMES[info.jeuCouches] ?? '')
  const macro = info.masque >= 0 ? geometry.getAttribute(UV_NAMES[info.jeuMasque] ?? '') : layer
  if (!macro || !layer) return false
  geometry.setAttribute('cMacro', macro)
  geometry.setAttribute('cUv', layer)
  return true
}

/** Index de texture glTF -> texture three (null pour une carte absente, index négatif). */
async function load(parser: GLTFParser, index: number | undefined, colorSpace: THREE.ColorSpace) {
  if (index === undefined || index < 0) return null
  const t = (await parser.getDependency('texture', index)) as THREE.Texture
  t.colorSpace = colorSpace
  return t
}

const xform = (scale?: [number, number], offset?: [number, number]) => [scale?.[0] ?? 1, scale?.[1] ?? 1, offset?.[0] ?? 0, offset?.[1] ?? 0]

const rgb = (c?: [number, number, number]) => c ?? [0, 0, 0]

/**
 * packLayers range les constantes des couches dans le tableau unique `uLayer` : par couche k,
 * LAYER_ROWS vec4 à partir de k * LAYER_ROWS :
 * - 0 : échelle.xy, décalage.xy de la couleur ; 1 : idem de la normale ; 2 : idem du contrôle ;
 * - 3 : teinte.rgb, sorte (0 couleur, 1 dégradé) ; 4 : haut.rgb, mélange ;
 * - 5 : milieu.rgb, opacité ; 6 : bas.rgb, intensité de la normale ;
 * - 7 : a une normale, mode de normale, a un contrôle, 0.
 * Une couche absente vaut transformations neutres (1, 1, 0, 0) et zéro partout ailleurs.
 * `hasNormal[k]` / `hasControl[k]` : la carte de la couche k est chargée.
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
      hasNormal[k] ? 1 : 0, l.melangeNormale ?? 0, hasControl[k] ? 1 : 0, 0,
      ...(l.hauteur ?? [0, 0, 0]), l.hauteur ? 1 : 0,
      ...(l.matiere ?? [0, 0, 0]), l.matiere ? 1 : 0,
    ], o)
  }
  return out
}

/**
 * layeredMaterial clone `base` (même éclairage, même brouillard) et remplace sa couleur, sa
 * normale, sa rugosité et son métal par la composition des couches de `info`.
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
    uCount: { value: layers.length },
    // Un seul tableau déjà à plat : three l'envoie tel quel à chaque changement de matériau (un
    // tableau d'uniforme n'a pas de cache, chaque tableau coûte un envoi).
    uLayer: { value: packLayers(layers, normals.map((t) => t !== null), controls.map((t) => t !== null)) },
  }
  for (let k = 0; k < MAX_LAYERS; k++) {
    uniforms[`uTex${k}`] = { value: maps[k] ?? null }
    uniforms[`uNrm${k}`] = { value: normals[k] ?? null }
    uniforms[`uCtl${k}`] = { value: controls[k] ?? null }
  }

  const m = base.clone()
  m.color.set(1, 1, 1)
  // Les textures des couches vivent dans les uniformes, hors des champs que three libère :
  // le matériau les nomme pour qui le libère (mapModel).
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
  m.customProgramCacheKey = () => 'couches-v4'
  compositions.set(m, { info, layers, maps, normals, controls, mask })
  return m
}

/** La composition d'un matériau en couches : ses couches et la carte chargée de chaque emplacement. */
export interface LayeredComposition {
  info: LayeredInfo
  /** Les couches lues (au plus MAX_LAYERS). */
  layers: readonly LayerInfo[]
  maps: readonly (THREE.Texture | null)[]
  normals: readonly (THREE.Texture | null)[]
  controls: readonly (THREE.Texture | null)[]
  mask: THREE.Texture | null
}

const compositions = new WeakMap<THREE.Material, LayeredComposition>()

/**
 * layeredComposition rend la composition d'un matériau fait par `layeredMaterial` (undefined pour
 * tout autre matériau) : la fusion des matériaux de la carte (`layeredMerge3d`) la relit.
 */
export function layeredComposition(material: THREE.Material): LayeredComposition | undefined {
  return compositions.get(material)
}
