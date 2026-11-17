// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * bakedLightShader.ts — LA LUMIÈRE CUITE DANS LE SHADER DES MATÉRIAUX DE LA CARTE (cf. `bakedLight`).
 *
 * Par pixel : position et normale monde ramenées en axes Halo, puis, des régions les plus
 * prioritaires aux moins prioritaires, l'irradiance de la région (huit sondes voisines, poids
 * trilinéaire × face × sonde active) pondérée par sa rampe de bord ; ce qu'aucune région ne couvre
 * garde l'éclairage indirect de la vue (ciel, sondes capturées), et une région plus sombre que lui
 * en garde une part (`BAKED_LIFT`). La lumière directe (soleil) n'est
 * pas touchée. Les lampes en grille partagent l'atlas et l'interrupteur sans recompilation, et
 * éclairent tout matériau greffé, la carte comme les Spartans.
 */
import * as THREE from 'three'
import { appendLampData, buildLampGrid } from './clusteredLights'
import { LAMP_APPLY, LAMP_HEAD } from './clusteredLightShader'
import type { PlacedLight } from './placedLights'

import { MAX_REGIONS, packAtlas, readBakedRegions, PROBE_INNER, PROBE_TILE, type BakedAtlas, type BakedRegion } from './bakedLight'

// Décalage du point d'échantillonnage le long de la normale (u) : la sonde la plus proche d'un mur
// ne doit pas être celle de l'autre côté.
const NORMAL_BIAS = 0.15
// Part de l'indirect de la vue (ciel, sondes capturées) gardée sous une lumière cuite nulle : le
// jeu rouvre son exposition dans une salle sombre, la vue a une exposition fixe. Une part faible :
// cet indirect porte la teinte froide du ciel de la vue, et les lampes de la carte éclairent déjà
// partout où le jeu éclaire.
export const BAKED_LIFT = 0.3

/** Nombre de vec4 par région dans `uBaked`. */
export const BAKED_ROWS = 3

/**
 * packBakedRegions range les régions dans le tableau unique `uBaked` : par région r, trois vec4
 * à partir de r * BAKED_ROWS :
 * - ligne 0 : min.xyz, base (première sonde de la région) ;
 * - ligne 1 : max.xyz, blend.x (fondu horizontal) ;
 * - ligne 2 : grille.xyz (sondes par axe), blend.y (fondu vertical).
 * Les places sans région valent min = max = 0, grille 1, base 0, fondu 1 (jamais lues : le shader
 * s'arrête à `uBakedCount`). Un seul tableau déjà à plat : un seul envoi par changement de matériau.
 */
export function packBakedRegions(regions: readonly BakedRegion[]): Float32Array {
  const out = new Float32Array(MAX_REGIONS * BAKED_ROWS * 4)
  for (let r = 0; r < MAX_REGIONS; r++) {
    const region = regions[r]
    const o = r * BAKED_ROWS * 4
    if (!region) {
      out.set([0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1], o)
      continue
    }
    out.set([region.min.x, region.min.y, region.min.z, region.base], o)
    out.set([region.max.x, region.max.y, region.max.z, region.blend.x], o + 4)
    out.set([region.count.x, region.count.y, region.count.z, region.blend.y], o + 8)
  }
  return out
}

/**
 * The vertex's world position: through the batch's or the instance's matrix first when the mesh is
 * a `BatchedMesh` or an `InstancedMesh` (the variant layer's batches, `layerBatch3d`), as three's
 * own `worldpos_vertex` does.
 */
const BAKED_WORLD = /* glsl */ `vec4 bakedLocal = vec4(transformed, 1.0);
#ifdef USE_BATCHING
bakedLocal = batchingMatrix * bakedLocal;
#endif
#ifdef USE_INSTANCING
bakedLocal = instanceMatrix * bakedLocal;
#endif
vBakedWorld = (modelMatrix * bakedLocal).xyz;`

const VERTEX_HEAD = /* glsl */ `
varying vec3 vBakedWorld;`

const FRAGMENT_HEAD = /* glsl */ `
#define BAKED_REGIONS ${MAX_REGIONS}
#define BAKED_ROWS ${BAKED_ROWS}
uniform sampler2D uBakedIrr;
uniform float uBakedColumns;
uniform vec2 uBakedSize;
uniform int uBakedCount;
// Par région : min.xyz + base, max.xyz + fondu x, grille.xyz + fondu y (cf. packBakedRegions).
uniform vec4 uBaked[BAKED_REGIONS * BAKED_ROWS];
uniform float uBakedOn;
uniform float uBakedIntensity;
varying vec3 vBakedWorld;

// Le codage octaédrique du jeu, axes Halo : centre = +Z, colonnes +X, lignes +Y.
vec2 bakedOct(vec3 n) {
  n /= abs(n.x) + abs(n.y) + abs(n.z);
  vec2 p = n.xy;
  if (n.z < 0.0) p = (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
  return p;
}

vec3 bakedProbe(float k, vec2 oct) {
  vec2 tile = vec2(mod(k, uBakedColumns), floor(k / uBakedColumns));
  vec2 px = tile * ${PROBE_TILE}.0 + 1.0 + (oct * 0.5 + 0.5) * ${PROBE_INNER}.0;
  vec2 texel = px - 0.5;
  ivec2 p = ivec2(floor(texel));
  vec2 f = fract(texel);
  vec3 a = mix(texelFetch(uBakedIrr, p, 0).rgb, texelFetch(uBakedIrr, p + ivec2(1, 0), 0).rgb, f.x);
  vec3 b = mix(texelFetch(uBakedIrr, p + ivec2(0, 1), 0).rgb, texelFetch(uBakedIrr, p + ivec2(1, 1), 0).rgb, f.x);
  return mix(a, b, f.y);
}

// L'alpha de la tuile : 1 sonde active, 0 sonde enfouie.
float bakedActive(float k) {
  ivec2 tile = ivec2(int(mod(k, uBakedColumns)), int(floor(k / uBakedColumns)));
  return texelFetch(uBakedIrr, tile * ${PROBE_TILE} + 1, 0).a;
}

// Irradiance de la région r au point p (normale n, axes Halo) ; w = sa part (0 hors de la boîte,
// rampe sur le bord de fondu, 0 si aucune des huit sondes n'est active).
vec3 bakedRegion(int r, vec3 p, vec3 n, vec2 oct, out float w) {
  vec4 row0 = uBaked[r * BAKED_ROWS];
  vec4 row1 = uBaked[r * BAKED_ROWS + 1];
  vec4 row2 = uBaked[r * BAKED_ROWS + 2];
  vec3 lo = row0.xyz;
  vec3 hi = row1.xyz;
  vec3 c = row2.xyz;
  float base = row0.w;
  vec3 inside = min(p - lo, hi - p);
  vec2 b = max(vec2(row1.w, row2.w), vec2(1e-3));
  w = clamp(min(inside.x, inside.y) / b.x, 0.0, 1.0) * clamp(inside.z / b.y, 0.0, 1.0);
  if (w <= 0.0) return vec3(0.0);
  // Sondes au centre des cellules : la sonde i est à lo + (i + 0.5) * spacing.
  vec3 spacing = (hi - lo) / c;
  vec3 last = c - 1.0;
  vec3 g = clamp((p - lo) / max(spacing, vec3(1e-4)) - 0.5, vec3(0.0), last);
  vec3 g0 = min(floor(g), max(c - 2.0, vec3(0.0)));
  vec3 f = g - g0;
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < 8; i++) {
    vec3 off = vec3(float(i & 1), float((i >> 1) & 1), float((i >> 2) & 1));
    vec3 q = min(g0 + off, last);
    float k = base + q.x + c.x * (q.y + c.y * q.z);
    if (bakedActive(k) <= 0.0) continue;
    vec3 tri = mix(1.0 - f, f, off);
    vec3 probe = lo + (q + 0.5) * spacing;
    vec3 toProbe = probe - p;
    float d = length(toProbe);
    float face = d > 1e-4 ? (dot(toProbe / d, n) + 1.0) * 0.5 : 1.0;
    float weight = tri.x * tri.y * tri.z * (face * face + 0.2);
    sum += weight * bakedProbe(k, oct);
    total += weight;
  }
  if (total < 1e-5) {
    w = 0.0;
    return vec3(0.0);
  }
  return sum / total;
}

// Irradiance cuite au point (repère three) ; rest = la part qu'aucune région ne couvre.
vec3 bakedIrradiance(vec3 pThree, vec3 nThree, out float rest) {
  vec3 n = normalize(vec3(nThree.x, -nThree.z, nThree.y));
  vec3 p = vec3(pThree.x, -pThree.z, pThree.y) + n * ${NORMAL_BIAS};
  vec2 oct = bakedOct(n);
  vec3 sum = vec3(0.0);
  rest = 1.0;
  for (int r = 0; r < BAKED_REGIONS; r++) {
    if (r >= uBakedCount || rest < 1e-3) break;
    float w;
    vec3 e = bakedRegion(r, p, n, oct, w);
    sum += rest * w * e;
    rest *= 1.0 - w;
  }
  return sum * uBakedIntensity;
}`

const FRAGMENT_APPLY = /* glsl */ `
#if defined( RE_IndirectDiffuse )
if (uBakedOn > 0.5) {
  float bakedRest;
  vec3 baked = bakedIrradiance(vBakedWorld, inverseTransformDirection(geometryNormal, viewMatrix), bakedRest);
  // Là où la lumière cuite est plus faible que l'indirect de la vue, la vue en garde une part.
  float dim = clamp(1.0 - luminance(baked) / max(luminance(irradiance + iblIrradiance), 1e-4), 0.0, 1.0);
  float keep = bakedRest + (1.0 - bakedRest) * ${BAKED_LIFT.toFixed(2)} * dim;
  irradiance = baked + keep * irradiance;
  iblIrradiance *= keep;
}
#endif`

/** La lumière cuite d'une carte, prête à être greffée sur ses matériaux. */
export class BakedLight {
  readonly regions: readonly BakedRegion[]
  readonly atlas: BakedAtlas
  private readonly uniforms: Record<string, THREE.IUniform>
  private readonly hasLamps: boolean

  constructor(regions: readonly BakedRegion[], atlas: BakedAtlas, intensity: number, lamps: readonly PlacedLight[] = []) {
    const grid = buildLampGrid(lamps)
    const offsets = lamps.length ? appendLampData(atlas, grid, lamps) : null
    this.hasLamps = offsets !== null
    // Les plus prioritaires d'abord : le shader s'arrête quand elles couvrent tout.
    this.regions = [...regions].sort((a, b) => b.priority - a.priority).slice(0, MAX_REGIONS)
    this.atlas = atlas
    this.uniforms = {
      uBakedIrr: { value: atlas.irradiance },
      uLampMin: { value: grid.min },
      uLampDims: { value: grid.dims },
      uLampCellSize: { value: grid.size },
      uLampOffsets: { value: offsets ? new THREE.Vector3(offsets.table, offsets.list, offsets.records) : new THREE.Vector3() },
      uBakedColumns: { value: atlas.columns },
      uBakedSize: { value: new THREE.Vector2(atlas.irradiance.image.width, atlas.irradiance.image.height) },
      uBakedCount: { value: this.regions.length },
      // Les régions en un seul tableau à plat : three l'envoie tel quel à chaque changement de
      // matériau (un tableau d'uniforme n'a pas de cache, chaque tableau coûte un envoi). Pas de
      // texture : les matériaux à couches occupent déjà les 16 unités de texture d'un GPU courant
      // avec le reflet et l'ombre du soleil.
      uBaked: { value: packBakedRegions(this.regions) },
      uBakedOn: { value: 1 },
      uBakedIntensity: { value: intensity },
    }
  }

  /**
   * apply greffe la lumière cuite sur un matériau standard (à faire avant sa compilation) : la
   * carte, son calque, et tout ce qui s'y tient (Spartans, corps, bras et arme à la première
   * personne). The map's placed lamps come with it on every material: on a night map (Streets
   * declares a sun of 0.05 against the 8 of a day map) they are almost all of the light on the
   * ground, and a Spartan without them stood near black on a lamp-lit street.
   */
  apply(material: THREE.Material): void {
    const previous = material.onBeforeCompile
    const previousKey = material.customProgramCacheKey.bind(material)
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer)
      Object.assign(shader.uniforms, this.uniforms)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>${VERTEX_HEAD}`)
        .replace('#include <project_vertex>', `#include <project_vertex>\n${BAKED_WORLD}`)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>${FRAGMENT_HEAD}`)
        .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>${FRAGMENT_APPLY}`)
      if (this.hasLamps) {
        shader.fragmentShader = shader.fragmentShader.replace('#include <lights_pars_begin>', `#include <lights_pars_begin>${LAMP_HEAD}`).replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>${LAMP_APPLY}`)
      }
    }
    material.customProgramCacheKey = () => `${previousKey()}|cuite-v3|lampes-${this.hasLamps}`
  }

  set enabled(on: boolean) {
    this.uniforms.uBakedOn.value = on ? 1 : 0
  }

  dispose(): void {
    this.atlas.irradiance.dispose()
  }
}

/** Lit les sondes et les lampes de la carte ; null si les deux sont absentes. */
export async function loadBakedLight(extras: unknown, parser: Parameters<typeof readBakedRegions>[1], intensity: number, lamps: readonly PlacedLight[] = []): Promise<BakedLight | null> {
  const regions = await readBakedRegions(extras, parser)
  if (!regions && !lamps.length) return null
  return new BakedLight(regions ?? [], packAtlas(regions ?? []), intensity, lamps)
}
