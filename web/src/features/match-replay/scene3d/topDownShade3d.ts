// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * topDownShade3d.ts — the flat light of the map seen from above, grafted on every map material
 * (`guardMaterial` in `lighting`) and switched on only while a top-down picture is drawn
 * (`topDownStage3d.run`): the 2D view and the 3D view's corner minimap.
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
 * Levels read by height (`heightShade`), on an ABSOLUTE scale fixed for the whole match: the
 * match's highest walked floor takes the full light, its lowest `LOW_SHADE` of it with a cool tint,
 * and the floors between a step for their height. Nothing in it depends on where anyone stands,
 * so the picture never changes during playback.
 *
 * The switch is a uniform shared by every material: turning it on or off recompiles nothing, and
 * the 3D view's light is untouched between top-down draws.
 */
import * as THREE from 'three'

import type { HeightSpan } from './topDownLogic'

/**
 * The flat light's irradiance (linear, white): a mid-gray floor comes out near its own albedo
 * after the view's tone mapping, as bright as the game's lit interiors in the 3D view.
 */
export const FLAT_IRRADIANCE = 2.4
/** The share of the flat light a vertical face takes (1 for a face looking straight up). */
export const WALL_SHARE = 0.6
/** The light the match's lowest walked floor keeps, and the cool tint it takes. */
export const LOW_SHADE = 0.6
export const LOW_TINT: readonly [number, number, number] = [0.85, 0.92, 1]
/** Below this walked span (u) the map is one level: no height shading. */
export const MIN_SPAN = 0.5

/**
 * heightShade — the light factor (r, g, b) of a surface at height `y` (scene Y) on the match's
 * walked span: white at or over its top, `LOW_SHADE` tinted at or under its bottom, linear between;
 * white without a span, or for a span too thin to tell levels apart. The shader's
 * `TOP_SHADE_HEAD` computes the same.
 */
export function heightShade(y: number, span: HeightSpan | null): [number, number, number] {
  if (!span || span.high - span.low < MIN_SPAN) return [1, 1, 1]
  const t = Math.min(Math.max((y - span.low) / (span.high - span.low), 0), 1)
  const shade = LOW_SHADE + (1 - LOW_SHADE) * t
  return LOW_TINT.map((c) => shade * (c + (1 - c) * t)) as [number, number, number]
}

/** The uniforms every map material shares (`guardMaterial` assigns these objects, never copies). */
export const TOP_SHADE_UNIFORMS = {
  uTopFlat: { value: 0 },
  uTopFlatLight: { value: new THREE.Color(FLAT_IRRADIANCE, FLAT_IRRADIANCE, FLAT_IRRADIANCE) },
  /** 1: shade by height over [uTopLow, uTopHigh]; 0: no height shading. */
  uTopRamp: { value: 0 },
  uTopLow: { value: 0 },
  uTopHigh: { value: 1 },
}

const glsl = (v: number) => v.toFixed(3)

/** Declarations, after `#include <common>` of the fragment shader. */
export const TOP_SHADE_HEAD = /* glsl */ `
uniform float uTopFlat;
uniform vec3 uTopFlatLight;
uniform float uTopRamp;
uniform float uTopLow;
uniform float uTopHigh;
vec3 topHeightShade(float y) {
  float t = clamp((y - uTopLow) / max(uTopHigh - uTopLow, 1e-3), 0.0, 1.0);
  float shade = ${glsl(LOW_SHADE)} + ${glsl(1 - LOW_SHADE)} * t;
  return shade * mix(vec3(${LOW_TINT.map(glsl).join(', ')}), vec3(1.0), t);
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
 * flatTopLight — switch the flat light on for the map, shaded by height over the match's walked
 * `span` (null, or too thin: no height shading); returns the switches back to what they were.
 */
export function flatTopLight(span: HeightSpan | null = null): () => void {
  const u = TOP_SHADE_UNIFORMS
  const before = { flat: u.uTopFlat.value, ramp: u.uTopRamp.value, low: u.uTopLow.value, high: u.uTopHigh.value }
  const ramp = span !== null && span.high - span.low >= MIN_SPAN
  u.uTopFlat.value = 1
  u.uTopRamp.value = ramp ? 1 : 0
  if (span) {
    u.uTopLow.value = span.low
    u.uTopHigh.value = span.high
  }
  return () => {
    u.uTopFlat.value = before.flat
    u.uTopRamp.value = before.ramp
    u.uTopLow.value = before.low
    u.uTopHigh.value = before.high
  }
}
