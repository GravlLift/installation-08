// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * outlineShaders3d.ts — THE TEAM OUTLINE'S SHADERS (`outline3d`).
 *
 * The outline is X-ray: it sees through the map, as in the game's theater. Neither shader reads
 * the scene's depth; a player hidden behind a wall is still traced.
 *
 * The mask is a half-resolution target, read with linear filtering: every covered texel carries
 * (ally, enemy, flare, player depth), an empty texel (0, 0, 0, 0). Read between texels, it gives
 * a soft coverage (ally + enemy) whose 0.5 level line is the silhouette's edge, and coverage-weighted
 * averages (flare / coverage, depth / coverage). The line is measured from that edge to the half
 * pixel: it comes out smooth, not stair-stepped, and keeps its thickness on screen.
 */

/** The flare's color pulls toward white, more so at full strength. */
const FLARE_WHITE = 0.45
/** Directions and rings sampled around a pixel (the step follows the thickness at full strength). */
const DIRS = 12
const RINGS = 5

export const QUAD_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

export const SUBJECT_VERTEX = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
varying float vDepth;
void main() {
  #include <skinbase_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vDepth = -mvPosition.z;
}`

/** The player in the mask: their side, their flare, their depth; the mask keeps them even hidden. */
export const SUBJECT_FRAGMENT = /* glsl */ `
uniform vec3 uSide;
varying float vDepth;
void main() {
  gl_FragColor = vec4(uSide, vDepth);
}`

/**
 * The line, at full resolution, over the image (X-ray: a wall in front does not stop it). Outside
 * the silhouette: in each direction, the first covered sample gives the edge (interpolated
 * between it and the previous one) and the player's reach (thickness + flare); the most covering
 * direction wins. Inside the silhouette, the line's inner edge fades out over `uSoft`: it covers
 * the body's stair-stepping without biting into it.
 */
export const LINE_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tMask;
uniform vec2 uTexel;
uniform float uBase;
uniform float uFlare;
uniform float uSoft;
uniform float uMaskPx;
uniform vec3 uAlly;
uniform vec3 uEnemy;
varying vec2 vUv;
vec3 inkOf(vec4 q) {
  float c = q.r + q.g;
  vec3 ink = q.r >= q.g ? uAlly : uEnemy;
  return mix(ink, vec3(1.0), ${FLARE_WHITE.toFixed(2)} * q.b / c);
}
void main() {
  vec4 base = texture2D(tDiffuse, vUv);
  gl_FragColor = base;
  vec4 here = texture2D(tMask, vUv);
  float c0 = here.r + here.g;
  if (c0 >= 0.5) {
    // Coverage rises from 0 to 1 over one mask texel (uMaskPx pixels).
    float inside = (c0 - 0.5) * uMaskPx;
    float a = clamp(1.0 - inside / uSoft, 0.0, 1.0);
    if (a > 0.0) gl_FragColor = vec4(mix(base.rgb, inkOf(here), a), base.a);
    return;
  }
  float step = (uBase + uFlare) / float(${RINGS});
  float best = 0.0;
  vec4 hit = vec4(0.0);
  for (int i = 0; i < ${DIRS}; i++) {
    float t = float(i) * ${((2 * Math.PI) / DIRS).toFixed(6)};
    vec2 dir = vec2(cos(t), sin(t)) * uTexel;
    float prev = c0;
    for (int k = 1; k <= ${RINGS}; k++) {
      float d = float(k) * step;
      vec4 q = texture2D(tMask, vUv + dir * d);
      float c = q.r + q.g;
      if (c < 0.5) {
        prev = c;
        continue;
      }
      float edge = d - step * (c - 0.5) / max(c - prev, 1e-3);
      float reach = uBase + uFlare * q.b / c;
      float a = clamp((reach - edge) / uSoft + 0.5, 0.0, 1.0);
      if (a > best) {
        best = a;
        hit = q;
      }
      break;
    }
  }
  if (best <= 0.0) return;
  gl_FragColor = vec4(mix(base.rgb, inkOf(hit), best), base.a);
}`
