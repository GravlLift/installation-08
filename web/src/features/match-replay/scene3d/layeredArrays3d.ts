// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * layeredArrays3d.ts — LES TABLEAUX DE TEXTURES ET LE SHADER DES MATÉRIAUX EN COUCHES FUSIONNÉS.
 *
 * `LayeredAtlas` porte les tableaux (un par taille et réglages, cf. `planArrays`) et la texture de
 * paramètres (une ligne de ROW_TEXELS texels par composition, cf. `packRow`). Les tableaux reçoivent
 * leurs images à la première compilation d'un matériau fusionné, qui seule a le moteur de rendu : three
 * alloue chaque tableau sans transfert (`dataReady` faux), puis chaque image décodée y est copiée par
 * `texSubImage3D` et les niveaux de détail sont générés une fois par tableau. The maps of a KTX2 GLB
 * are GPU-compressed: their arrays are compressed arrays of the same format, filled level by level
 * with `compressedTexSubImage3D` (the levels come from the file, none are generated).
 *
 * Le shader fusionné est celui des couches (`LAYER_COMPOSE`), ses uniformes remplacés par la ligne
 * du sommet (`cRow`) lue dans la texture de paramètres, ses cartes par un tableau choisi par
 * emplacement. Les trois sommets d'un triangle portent la même ligne (`assignVertexRows`) : la
 * ligne passe par un varying ordinaire, arrondi : un varying `flat` suit la convention du dernier
 * sommet, que le moteur D3D d'ANGLE peut devoir émuler. Le choix du tableau change d'un triangle à l'autre d'un même dessin :
 * les échantillons prennent des dérivées explicites, calculées hors de tout branchement.
 */
import * as THREE from 'three'

import { releaseTexels } from './ktx2Textures3d'
import { LAYER_COMPOSE, LAYER_INJECTIONS, LAYER_ROWS, LAYER_VERTEX_HEAD } from './layeredMaterial'
import { GLOW_TEXEL, HEAD_TEXEL, ROW_TEXELS, SLOT_TEXEL, type PlannedArray } from './layeredPlan3d'

/** La clé de `userData` qui marque un matériau fusionné (copies par sonde comprises, qui la partagent). */
const MERGED_KEY = 'couchesFusionnees'

/**
 * La clé de `userData` qui marque une carte dont l'image, copiée dans un tableau de textures, n'est
 * tenue par aucun matériau conservé : `LayeredAtlas.upload` ferme l'image après la copie, et seul.
 */
export const IMAGE_LIBEREE = 'imageLiberee'

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

/** isMergedMaterial : le matériau est un matériau en couches fusionné (`mergedMaterial`) ou une de ses copies. */
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
  // three alloue le tableau sans rien y transférer : `upload` y copie les images.
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
    console.warn('rejeu 3D : format compressé non pris en charge par le GPU, tableau des couches vide', texture.format, texture.colorSpace)
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

/** Les cartes fusionnées d'une carte : tableaux de textures et texture de paramètres. */
export class LayeredAtlas {
  readonly arrays: ArrayTexture[]
  readonly params: THREE.DataTexture
  private pending: readonly (readonly THREE.Texture[])[] | null
  /** Durée du transfert des images (ms), null tant qu'il n'a pas eu lieu. */
  uploadMs: number | null = null

  /** `rows` : `rowCount` lignes de ROW_TEXELS texels RGBA (cf. `packRow`). */
  constructor(arrays: readonly PlannedArray<THREE.Texture>[], rows: Float32Array<ArrayBuffer>, rowCount: number) {
    this.arrays = arrays.map(arrayTexture)
    this.pending = arrays.map((a) => a.members)
    this.params = new THREE.DataTexture(rows, ROW_TEXELS, rowCount, THREE.RGBAFormat, THREE.FloatType)
    this.params.needsUpdate = true
  }

  /** Les textures à libérer avec la carte. */
  get textures(): THREE.Texture[] {
    return [...this.arrays, this.params]
  }

  /**
   * upload copie les images dans les tableaux, une fois. Les réglages de transfert sont ceux que three
   * pose pour chaque carte d'origine (retournement, prémultiplication, alignement ; aucune conversion
   * de couleur : sRGB et linéaire ont les primaires de l'espace de travail). A compressed array
   * receives each map's encoded levels as they are (no decode, no generated levels).
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
        console.warn('rejeu 3D : tableau de textures des couches non alloué', texture.image.width, texture.image.height)
        return
      }
      renderer.state.bindTexture(gl.TEXTURE_2D_ARRAY, handle)
      if (isCompressed(texture)) uploadCompressed(renderer, gl, texture, pending[a])
      else uploadDecoded(gl, texture, pending[a])
      renderer.state.unbindTexture()
    })
    // Les images copiées ne sont plus lues par aucun matériau : on les ferme (cf. IMAGE_LIBEREE).
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

/** fragmentHead : les déclarations et l'échantillonnage du shader fusionné, pour `arrays` tableaux. */
function fragmentHead(arrays: number): string {
  const ids = Array.from({ length: arrays }, (_, a) => a)
  const samplers = ids.map((a) => `uniform highp sampler2DArray uArr${a};`).join('\n')
  const branches = ids.map((a) => `  if (a == ${a}) return textureGrad(uArr${a}, p, dx, dy);`).join('\n')
  return /* glsl */ `
${samplers}
uniform highp sampler2D uParams;
varying float vRow;
#define LAYER_ROWS ${LAYER_ROWS}
// La ligne de la composition du triangle dans la texture de paramètres (posée par layered()).
int gRow;
#define P_TEXEL(i) texelFetch(uParams, ivec2(i, gRow), 0)
#define L_ROW(k, i) P_TEXEL((k) * LAYER_ROWS + (i))
${LAYER_COMPOSE}
// Les dérivées écran des coordonnées des couches, prises hors de tout branchement.
vec2 gDx;
vec2 gDy;
vec2 gMx;
vec2 gMy;

// L'échantillon de la carte à l'emplacement slot (tableau, couche) ; tableau négatif : pas de carte.
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

// La lumière propre de la composition remplace celle du matériau (posée après la surface des couches).
const GLOW_INJECTION = ['#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance = P_TEXEL(${GLOW_TEXEL}).rgb;`] as const

/**
 * mergedMaterial : un matériau fusionné, copie de `base` (face dessinée, rendu en facettes,
 * brouillard) dont la couleur, la normale, la rugosité, le métal et la lumière propre viennent de la
 * ligne de chaque sommet et des tableaux de `atlas`. Les textures vivent dans les uniformes : le
 * matériau les nomme pour qui le libère (`userData.textures`, cf. mapModel).
 */
export function mergedMaterial(base: THREE.MeshStandardMaterial, atlas: LayeredAtlas): THREE.MeshStandardMaterial {
  const saved = base.userData
  // `clone` recopie `userData` par JSON : les textures d'un matériau en couches y vivent.
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
  m.customProgramCacheKey = () => `couches-tableaux-v3-${atlas.arrays.length}`
  return m
}
