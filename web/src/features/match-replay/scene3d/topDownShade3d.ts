/**
 * topDownShade3d.ts — the flat light of the map seen from above, grafted on every map material
 * (`guardMaterial` in `lighting`) and switched on only while a top-down image is drawn
 * (`topDownStage3d.run`): the 2D view, its floors-above ghost and the 3D view's corner minimap.
 *
 * Seen straight down, the 3D view's light reads as the map's colors: the game's placed lamps put a
 * hot spot under each one, the baked light and the reflections of the probes put bright pools under
 * every skylight. A tactical map wants the opposite, every floor evenly lit, so a level reads by its
 * own colors. With the switch on, a map surface drops all of its direct light (sun, lamps, action
 * flashes) and its game and probe light, and takes one flat light instead: full on a face that looks
 * up, `WALL_SHARE` of it on a wall, so rooms keep their outline. Metals reflect that same flat light
 * (radiance = irradiance / pi, what a white diffuse floor sends back), so a metal floor is neither
 * black nor a white slab. Self-lit surfaces keep their own light.
 *
 * The switch is a uniform shared by every material: turning it on or off recompiles nothing, and
 * the 3D view's light is untouched between top-down draws.
 */
import * as THREE from 'three'

/**
 * The flat light's irradiance (linear, white): a mid-gray floor comes out near its own albedo
 * after the view's tone mapping, as bright as the game's lit interiors in the 3D view.
 */
export const FLAT_IRRADIANCE = 2.4
/** The share of the flat light a vertical face takes (1 for a face looking straight up). */
export const WALL_SHARE = 0.6

/** The uniforms every map material shares (`guardMaterial` assigns these objects, never copies). */
export const TOP_SHADE_UNIFORMS = {
  uTopFlat: { value: 0 },
  uTopFlatLight: { value: new THREE.Color(FLAT_IRRADIANCE, FLAT_IRRADIANCE, FLAT_IRRADIANCE) },
}

/** Declarations, after `#include <common>` of the fragment shader. */
export const TOP_SHADE_HEAD = /* glsl */ `
uniform float uTopFlat;
uniform vec3 uTopFlatLight;`

/**
 * The flat light, before `#include <lights_fragment_end>`: the direct light gathered so far is
 * dropped, the indirect terms are replaced. A material without lights has no such include.
 */
export const TOP_SHADE_APPLY = /* glsl */ `
#if defined( RE_IndirectDiffuse )
if (uTopFlat > 0.5) {
  vec3 topUp = normalize(mat3(viewMatrix) * vec3(0.0, 1.0, 0.0));
  float topFacing = mix(${WALL_SHARE.toFixed(2)}, 1.0, max(dot(geometryNormal, topUp), 0.0));
  reflectedLight.directDiffuse = vec3(0.0);
  reflectedLight.directSpecular = vec3(0.0);
  irradiance = uTopFlatLight * topFacing;
  iblIrradiance = vec3(0.0);
  #if defined( RE_IndirectSpecular )
  radiance = irradiance * RECIPROCAL_PI;
  #endif
}
#endif
`

/** graftTopShade — add the flat light to a material's compiled shader (called from its `onBeforeCompile`). */
export function graftTopShade(shader: { uniforms: Record<string, THREE.IUniform>; fragmentShader: string }): void {
  Object.assign(shader.uniforms, TOP_SHADE_UNIFORMS)
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>${TOP_SHADE_HEAD}`)
    .replace('#include <lights_fragment_end>', `${TOP_SHADE_APPLY}#include <lights_fragment_end>`)
}

/** flatTopLight — switch the flat light on for the map; returns the switch back to what it was. */
export function flatTopLight(): () => void {
  const u = TOP_SHADE_UNIFORMS.uTopFlat
  const before = u.value
  u.value = 1
  return () => {
    u.value = before
  }
}
