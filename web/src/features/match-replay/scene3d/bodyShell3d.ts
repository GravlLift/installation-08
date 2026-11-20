// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * bodyShell3d.ts — THE SPARTAN'S ENERGY SHELL: a shield that absorbs hits, breaks, and recharges,
 * an overshield that holds, a trembling camo outline, all drawn on its own geometry.
 *
 * The shell doubles each skinned mesh of the player's copy (same geometry, same skeleton: it
 * follows the pose with no extra computation), with an additive material PER PLAYER. It draws
 * over the armor (same depth, offset toward the camera), hides nothing, and is only placed in the
 * scene when an effect is on.
 *
 *  - an absorbed hit, and the break (the hit that empties the shield), belong to the game's own
 *    shield impact generator (`shieldGenerator3d`: its parameters and hex-grid noise read from the
 *    game at build time), which draws a small sphere around the impact point. With no impact point
 *    the hit is not drawn: over the whole shell its strength floods the body;
 *  - a recharge draws nothing: the game's recharge generator (`efge` 35694cf3, the effect `effe`
 *    a897ba6a) drives its colors and intensities by GPU functions this build does not read, and
 *    no effect is invented in its place (`ShieldFx.recharge` stays computed for when it is);
 *  - the overshield keeps its own shell (its ink, paled toward white) drawn over the top.
 *
 * All intensities come from `BodyFxState`, a function of the frame: the shell keeps no state of
 * its own, and the impact's pattern moves with the replay time (a frozen frame holds still, an
 * export draws what the screen draws). Colors come from the theme's inks.
 */
import * as THREE from 'three'

import type { Allegiance } from '@/lib/replay/filmAllegiance'

import type { EquipFx } from './equip3d'
import { constantOf, hitLevel, termColor, type ShieldHitLook } from './shieldGenerator3d'
import type { ShieldFx } from './shields3d'

/** What the shell shows at one frame. */
export interface BodyFxState {
  shield: ShieldFx
  /** Camo and overshield (`equip3d`). */
  equip: EquipFx
  /** Replay time (s): the impact's pattern, the crackle and the overshield move with it. */
  phase: number
  /** Ally or enemy as seen by the page's player (the outline and the shell take their color from it). */
  ally: Allegiance
  /** The team's color (user settings), the neutral ink when there is no team. */
  teamColor: THREE.Color
  /** The overshield's ink (green paled toward white). */
  overshieldColor: THREE.Color
  /** The camo reflection's ink. */
  camoColor: THREE.Color
  /** The game's shield impact generator, null until the weapon library's entry is read. */
  shieldHit: ShieldHitLook | null
}

export interface BodyShell {
  meshes: THREE.SkinnedMesh[]
  material: THREE.ShaderMaterial
}

const VERTEX = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
uniform float uExtrude;
varying vec3 vView;
varying vec3 vRest;
varying vec2 vUv;
varying float vFacing;
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  // The impact generator's extrusion, along the rest normal (the skin carries it with the pose).
  transformed += normal * uExtrude;
  #include <skinning_vertex>
  #include <project_vertex>
  vView = mvPosition.xyz;
  vRest = position;
  vUv = uv;
  // The generator's facing ratio, per vertex as its vertex shader computes it: N.V, 1 facing the
  // camera, 0 at the silhouette.
  vFacing = dot(normalize(transformedNormal), normalize(-mvPosition.xyz));
}`

const FRAGMENT = /* glsl */ `
uniform float uPhase;
uniform vec3 uOvershieldColor;
uniform float uOvershield;
uniform vec3 uCamoColor;
uniform float uCamo;
// The impact generator (shieldGenerator3d): its band radii, noise, plasma and color terms.
uniform float uGen;
uniform sampler2D uNoise1;
uniform sampler2D uNoise2;
uniform vec4 uEdgeBand;
uniform vec4 uPlasmaBand;
uniform vec4 uNoiseScale;
uniform vec4 uPlasma;
uniform vec4 uPlasmaShape;
uniform int uBlendMode;
uniform vec3 uEdgeCol;
uniform vec3 uFlatCol;
uniform vec3 uCenterCol;
uniform vec3 uPlasmaEdgeCol;
uniform vec3 uHitCol;
varying vec3 vView;
varying vec3 vRest;
varying vec2 vUv;
varying float vFacing;

// The overshield's grid: ~6cm hexagons on the body's cylinder (angle around the axis, height).
const float HEX = 0.022;
float hexDist(vec2 p) {
  p = abs(p);
  return max(dot(p, vec2(0.5, 0.8660254)), p.x);
}
// The generator's fade band on the facing ratio: (outer, inner, scaleOuter, scaleInner).
float band(float nv, vec4 b) {
  return clamp(min(b.z * (nv - b.x), b.w * (nv - b.y)), 0.0, 1.0);
}
vec3 generator() {
  float nv = vFacing;
  float e = band(nv, uEdgeBand);
  float edge = e * e * e * e;
  float pmask = band(nv, uPlasmaBand);
  float s = uPhase * uPlasmaShape.y;
  vec2 uv1 = vUv * uPlasmaShape.x * uNoiseScale.xy + s * vec2(1.0 / 24.0, 1.0 / 26.0);
  vec2 uv2 = vUv * uPlasmaShape.x * uNoiseScale.zw + s * vec2(-1.0 / 22.0, 1.0 / 34.0);
  float p1 = pow(max(texture2D(uNoise1, uv1).r, 1e-6), uPlasma.y) * uPlasma.x;
  float p2 = pow(max(texture2D(uNoise2, uv2).r, 1e-6), uPlasma.w) * uPlasma.z;
  float plasma = 0.0;
  if (uBlendMode == 0) plasma = pow(max(clamp(1.0 - abs(p1 - p2), 0.0, 1.0), 1e-6), mix(uPlasmaShape.z, uPlasmaShape.w, pmask));
  else if (uBlendMode == 1) plasma = clamp(p1 + p2, 0.0, 1.0);
  else if (uBlendMode == 2) plasma = clamp(p1 - p2, 0.0, 1.0);
  else if (uBlendMode == 3) plasma = clamp(p1 * p2, 0.0, 1.0);
  else if (uBlendMode == 4) plasma = clamp(p1, 0.0, 1.0);
  // The hit's sphere around the impact point is the whole shell: the film carries no impact point.
  return edge * uEdgeCol + uFlatCol + (mix(uCenterCol, uPlasmaEdgeCol, pmask) + uHitCol) * plasma;
}
void main() {
  vec3 n = normalize(cross(dFdx(vView), dFdy(vView)));
  float rim = 1.0 - abs(dot(n, normalize(-vView)));
  rim *= rim;
  float around = atan(vRest.z, vRest.x) * 0.12;
  vec2 uv = vec2(around, vRest.y) / HEX;
  vec2 r = vec2(1.0, 1.7320508);
  vec2 a = mod(uv, r) - 0.5 * r;
  vec2 b = mod(uv - 0.5 * r, r) - 0.5 * r;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  float line = 1.0 - smoothstep(0.0, 0.07, 0.5 - hexDist(gv));

  vec3 col = uGen > 0.5 ? generator() : vec3(0.0);
  // The overshield: a continuous shell, brighter at the edge, that the grid barely breathes through.
  float breathe = 0.85 + 0.15 * sin(uPhase * 3.0 + vRest.y * 20.0);
  col += uOvershieldColor * uOvershield * (0.14 + 0.55 * rim) * (0.7 + 0.3 * line) * breathe;
  // The camo: only the body's outline remains, in waves that drift like trembling air.
  float wave = 0.5 + 0.5 * sin(vRest.y * 70.0 + around * 50.0 - uPhase * 5.0);
  col += uCamoColor * uCamo * rim * (0.12 + 0.3 * wave);
  gl_FragColor = vec4(col, 1.0);
}`

/**
 * makeShell doubles `root`'s skinned meshes (a Spartan copy) with an energy shell.
 * The shell's meshes carry `userData.noOutline`: the team outline does not trace them.
 */
export function makeShell(root: THREE.Object3D): BodyShell {
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uPhase: { value: 0 },
      uOvershieldColor: { value: new THREE.Color() },
      uOvershield: { value: 0 },
      uCamoColor: { value: new THREE.Color() },
      uCamo: { value: 0 },
      uExtrude: { value: 0 },
      uGen: { value: 0 },
      uNoise1: { value: null },
      uNoise2: { value: null },
      uEdgeBand: { value: new THREE.Vector4() },
      uPlasmaBand: { value: new THREE.Vector4() },
      uNoiseScale: { value: new THREE.Vector4() },
      uPlasma: { value: new THREE.Vector4() },
      uPlasmaShape: { value: new THREE.Vector4() },
      uBlendMode: { value: 0 },
      uEdgeCol: { value: new THREE.Color() },
      uFlatCol: { value: new THREE.Color() },
      uCenterCol: { value: new THREE.Color() },
      uPlasmaEdgeCol: { value: new THREE.Color() },
      uHitCol: { value: new THREE.Color() },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    toneMapped: false,
  })
  const sources: THREE.SkinnedMesh[] = []
  root.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh) sources.push(o)
  })
  const meshes = sources.map((src) => {
    const shell = new THREE.SkinnedMesh(src.geometry, material)
    shell.position.copy(src.position)
    shell.quaternion.copy(src.quaternion)
    shell.scale.copy(src.scale)
    shell.castShadow = false
    shell.receiveShadow = false
    shell.visible = false
    shell.userData.noOutline = true
    src.parent?.add(shell)
    shell.bind(src.skeleton, src.bindMatrix)
    return shell
  })
  return { meshes, material }
}

/** releaseShell removes the shell and disposes its material (the geometry belongs to the source). */
export function releaseShell(shell: BodyShell): void {
  for (const m of shell.meshes) m.removeFromParent()
  shell.material.dispose()
}

/** shellLit: one of the shell's effects is on (otherwise it is not placed in the scene). */
export function shellLit(fx: BodyFxState): boolean {
  return fx.equip.camo > 0 || fx.equip.overshield > 0
}

/** showShell sets the frame's intensities `fx` on the shell, or turns it off (null, or nothing lit). */
export function showShell(shell: BodyShell, fx: BodyFxState | null): void {
  const on = fx !== null && shellLit(fx)
  for (const m of shell.meshes) m.visible = on
  if (!on || !fx) return
  const u = shell.material.uniforms
  u.uPhase.value = fx.phase
  ;(u.uOvershieldColor.value as THREE.Color).copy(fx.overshieldColor)
  u.uOvershield.value = fx.equip.overshield
  ;(u.uCamoColor.value as THREE.Color).copy(fx.camoColor)
  u.uCamo.value = fx.equip.camo
  showImpact(u, fx)
}

/**
 * showImpact sets the impact generator's uniforms. The game draws the hit as a small sphere around
 * the impact point; over the whole shell (no impact point) its strength floods the body, so the
 * hit is not drawn until impact points are placed.
 */
const WHOLE_SHELL_HIT = false
function showImpact(u: THREE.ShaderMaterial['uniforms'], fx: BodyFxState): void {
  const look = fx.shieldHit
  const level = hitLevel(fx.shield)
  const on = WHOLE_SHELL_HIT && look !== null && level > 0
  u.uGen.value = on ? 1 : 0
  u.uExtrude.value = 0
  if (!on || !look) return
  const g = look.gen
  u.uExtrude.value = constantOf(g.extrusionDistance, 0)
  u.uNoise1.value = look.noise1
  u.uNoise2.value = look.noise2
  ;(u.uEdgeBand.value as THREE.Vector4).set(g.edgeOuterFadeRadius, g.edgeInnerFadeRadius, g.edgeScaleOuter, g.edgeScaleInner)
  ;(u.uPlasmaBand.value as THREE.Vector4).set(g.plasmaOuterFadeRadius, g.plasmaInnerFadeRadius, g.plasmaEdgeScaleOuter, g.plasmaEdgeScaleInner)
  ;(u.uNoiseScale.value as THREE.Vector4).set(g.noise1UScale, g.noise1VScale, g.noise2UScale, g.noise2VScale)
  ;(u.uPlasma.value as THREE.Vector4).set(g.plasma0Intensity, g.plasma0Sharpness, g.plasma1Intensity, g.plasma1Sharpness)
  ;(u.uPlasmaShape.value as THREE.Vector4).set(g.plasmaTileScale, g.plasmaScrollSpeed, g.plasmaCenterSharpness, g.plasmaEdgeSharpness)
  u.uBlendMode.value = g.noiseBlendMode
  const team = fx.teamColor
  // An undecoded function-driven intensity draws nothing, except the hit's: the film's level.
  termColor(g, g.edgeColorMode, constantOf(g.edgeGlowIntensity, 0), team, u.uEdgeCol.value as THREE.Color)
  termColor(g, g.plasmaCenterColorMode, constantOf(g.plasmaCenterIntensity, 0), team, u.uCenterCol.value as THREE.Color)
  termColor(g, g.plasmaEdgeColorMode, constantOf(g.plasmaEdgeIntensity, 0), team, u.uPlasmaEdgeCol.value as THREE.Color)
  termColor(g, g.hitColorMode, constantOf(g.hitIntensity, level), team, u.uHitCol.value as THREE.Color)
  termColor(g, g.flatColorMode, constantOf(g.flatColorIntensity, 0), team, u.uFlatCol.value as THREE.Color)
}
