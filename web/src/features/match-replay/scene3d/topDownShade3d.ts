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
 * Levels read by height (`heightShade`): around the followed player's floor the light is full; a
 * surface under it darkens and cools with its depth, down to `BELOW_SHADE`, so each floor below is
 * one step darker than the one over it; a surface over it (a wall top, a crate, a ramp going up)
 * is a little lighter, so the room's outline stands out. The ghost of the floors above takes no
 * ramp (`floorY` null): it is one even image.
 *
 * The switch is a uniform shared by every material: turning it on or off recompiles nothing, and
 * the 3D view's light is untouched between top-down draws.
 */
import * as THREE from 'three'

import { CUT_HEADROOM } from './topDownLogic'

/**
 * The flat light's irradiance (linear, white): a mid-gray floor comes out near its own albedo
 * after the view's tone mapping, as bright as the game's lit interiors in the 3D view.
 */
export const FLAT_IRRADIANCE = 2.4
/** The share of the flat light a vertical face takes (1 for a face looking straight up). */
export const WALL_SHARE = 0.6

/** How far under the floor (u) the darkening starts: a few steps down still read as his floor. */
export const SHADE_START = 0.5
/** The depth (u) over which a lower surface darkens to `BELOW_SHADE`: about three storeys. */
export const SHADE_DEPTH = 8
/** The light kept at the bottom of the ramp, and the cool tint it takes there. */
export const BELOW_SHADE = 0.45
export const BELOW_TINT: readonly [number, number, number] = [0.82, 0.9, 1]
/** The extra light at the cut's height over the floor (a head and a clearance up). */
export const ABOVE_LIFT = 0.2

/**
 * heightShade — the light factor (r, g, b) of a surface at height `y` against the followed
 * player's floor `floorY` (scene Y); white when there is no floor (the ghost). The shader's
 * `TOP_SHADE_APPLY` computes the same.
 */
export function heightShade(y: number, floorY: number | null): [number, number, number] {
  if (floorY === null) return [1, 1, 1]
  const dy = y - floorY
  if (dy >= 0) {
    const lift = 1 + ABOVE_LIFT * Math.min(dy / CUT_HEADROOM, 1)
    return [lift, lift, lift]
  }
  const k = Math.min(Math.max((-dy - SHADE_START) / SHADE_DEPTH, 0), 1)
  const shade = 1 - (1 - BELOW_SHADE) * k
  return BELOW_TINT.map((t) => shade * (1 - k + k * t)) as [number, number, number]
}

/** The uniforms every map material shares (`guardMaterial` assigns these objects, never copies). */
export const TOP_SHADE_UNIFORMS = {
  uTopFlat: { value: 0 },
  uTopFlatLight: { value: new THREE.Color(FLAT_IRRADIANCE, FLAT_IRRADIANCE, FLAT_IRRADIANCE) },
  /** 1: shade by height around `uTopFloorY`; 0: no ramp (the ghost). */
  uTopRamp: { value: 0 },
  uTopFloorY: { value: 0 },
}

const glsl = (v: number) => v.toFixed(3)

/** Declarations, after `#include <common>` of the fragment shader. */
export const TOP_SHADE_HEAD = /* glsl */ `
uniform float uTopFlat;
uniform vec3 uTopFlatLight;
uniform float uTopRamp;
uniform float uTopFloorY;
vec3 topHeightShade(float y) {
  float dy = y - uTopFloorY;
  if (dy >= 0.0) return vec3(1.0 + ${glsl(ABOVE_LIFT)} * min(dy / ${glsl(CUT_HEADROOM)}, 1.0));
  float k = clamp((-dy - ${glsl(SHADE_START)}) / ${glsl(SHADE_DEPTH)}, 0.0, 1.0);
  float shade = 1.0 - ${glsl(1 - BELOW_SHADE)} * k;
  return shade * mix(vec3(1.0), vec3(${BELOW_TINT.map(glsl).join(', ')}), k);
}`

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
  if (uTopRamp > 0.5) {
    // The view matrix is rigid: its rotation's transpose takes the view position back to the world.
    vec3 topWorld = cameraPosition + transpose(mat3(viewMatrix)) * geometryPosition;
    irradiance *= topHeightShade(topWorld.y);
  }
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

/**
 * flatTopLight — switch the flat light on for the map, shaded by height around `floorY` (scene Y
 * of the followed player's floor; null: no ramp); returns the switches back to what they were.
 */
export function flatTopLight(floorY: number | null = null): () => void {
  const u = TOP_SHADE_UNIFORMS
  const before = { flat: u.uTopFlat.value, ramp: u.uTopRamp.value, floorY: u.uTopFloorY.value }
  u.uTopFlat.value = 1
  u.uTopRamp.value = floorY === null ? 0 : 1
  u.uTopFloorY.value = floorY ?? 0
  return () => {
    u.uTopFlat.value = before.flat
    u.uTopRamp.value = before.ramp
    u.uTopFloorY.value = before.floorY
  }
}
