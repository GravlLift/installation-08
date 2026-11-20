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
 *  - each hit the shield absorbs (the break included) is drawn as the game's own shield impact
 *    generator draws it (`shieldGenerator3d`: its parameters, curves and hex-grid noise read from
 *    the game at build time): around the impact point, a sphere of the decoded radius (0.1 u
 *    shrinking to 0.05 u) shows the hit color through the hex pattern, at the decoded strength (90
 *    at the impact, ~19 at 0.10 s, 0 at 1 s, through the view's `glowLevel`), pushed out along the
 *    normal by the generator's extrusion; overlapping hits add up. The hits and their rays come from
 *    the film (`shieldImpacts3d`); the point is where the ray meets the front of the POSED body (a
 *    fixed sample of the skinned vertices, skinned on the CPU at the drawn frame). The game measures
 *    the distance per vertex and interpolates it; the shell measures it per pixel (the same sphere,
 *    without the triangles' facets). A hit with no ray, or with the library's entry not read, is
 *    not drawn: over the whole shell its strength floods the body;
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
import { glowLevel } from './lighting'
import { constantOf, propertyAt, termColor, type ShieldGenerator, type ShieldHitLook } from './shieldGenerator3d'
import { MAX_SHIELD_IMPACTS, type ShieldImpact } from './shieldImpacts3d'
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
  /** The hits on the shield at this frame, the youngest first (`shieldImpacts3d`). */
  impacts: readonly ShieldImpact[]
}

/** No hit. */
export const NO_IMPACTS: readonly ShieldImpact[] = []

export interface BodyShell {
  meshes: THREE.SkinnedMesh[]
  material: THREE.ShaderMaterial
  /** The body's sample points (built on the first hit). */
  samples: BodySamples | null
}

/**
 * A fixed sample of the shell's skinned vertices, skinned on the CPU when a hit needs the posed
 * body: where its ray meets the front of the body.
 */
interface BodySamples {
  mesh: Int32Array
  vertex: Int32Array
  /** World positions at the last skinning, xyz per sample. */
  world: Float32Array
  count: number
}

/**
 * Most vertices sampled: a Spartan's ~0.27 u² of surface (2.5 m²) at ~0.013 u (4 cm) apart, well
 * under the hit's smallest radius (0.05 u). A sample count, not a look: it changes where a hit
 * lands by a few centimeters at most.
 */
const SAMPLE_MAX = 1500
/**
 * How far past the body's sample nearest the ray a sample still counts as on the ray (u): about
 * twice the samples' spacing. Among those, the one nearest the shooter is the impact point.
 */
const FRONT_TUBE = 0.03

const VERTEX = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
uniform float uExtrude;
varying vec3 vView;
varying vec3 vRest;
varying vec3 vWorld;
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
  vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
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
// The hits: impact point (world) and radius, and strength (glowLevel of the hit intensity).
uniform vec4 uImpacts[${MAX_SHIELD_IMPACTS}];
uniform float uImpactGlow[${MAX_SHIELD_IMPACTS}];
uniform int uImpactCount;
varying vec3 vView;
varying vec3 vRest;
varying vec3 vWorld;
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
  // Each hit's sphere around its impact point; each hit is its own additive generator, so they add up.
  float hit = 0.0;
  for (int i = 0; i < ${MAX_SHIELD_IMPACTS}; i++) {
    if (i >= uImpactCount) break;
    hit += clamp(1.0 - distance(vWorld, uImpacts[i].xyz) / uImpacts[i].w, 0.0, 1.0) * uImpactGlow[i];
  }
  return edge * uEdgeCol + uFlatCol + (mix(uCenterCol, uPlasmaEdgeCol, pmask) + uHitCol * hit) * plasma;
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
      uImpacts: { value: Array.from({ length: MAX_SHIELD_IMPACTS }, () => new THREE.Vector4()) },
      uImpactGlow: { value: new Array<number>(MAX_SHIELD_IMPACTS).fill(0) },
      uImpactCount: { value: 0 },
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
  return { meshes, material, samples: null }
}

/** releaseShell removes the shell and disposes its material (the geometry belongs to the source). */
export function releaseShell(shell: BodyShell): void {
  for (const m of shell.meshes) m.removeFromParent()
  shell.material.dispose()
}

// The lit hits of the frame (`litImpacts`): their strength (glowLevel) and radius, by index into `fx.impacts`.
const HIT_GLOW = new Array<number>(MAX_SHIELD_IMPACTS).fill(0)
const HIT_RADIUS = new Array<number>(MAX_SHIELD_IMPACTS).fill(0)
const HIT_INDEX = new Array<number>(MAX_SHIELD_IMPACTS).fill(0)

/**
 * litImpacts: the hits of `impacts` the generator still draws, their strength and radius read
 * from its curves at each hit's impact time (age times `inverseHitTime`), written in HIT_GLOW,
 * HIT_RADIUS and HIT_INDEX; the count. A hit whose intensity or radius curve was not read draws
 * nothing.
 */
export function litImpacts(g: ShieldGenerator, impacts: readonly ShieldImpact[]): number {
  let n = 0
  for (let i = 0; i < impacts.length && n < MAX_SHIELD_IMPACTS; i++) {
    const x = impacts[i].age * g.inverseHitTime
    // Past an impact time of 1 the input is saturated and the curves hold their end (the hit's
    // intensity ~2e-5): the hit is over.
    if (x >= 1) continue
    const intensity = propertyAt(g.hitIntensity, x)
    const radius = propertyAt(g.hitRadius, x)
    if (intensity === null || radius === null || !(intensity > 0) || !(radius > 0)) continue
    HIT_GLOW[n] = glowLevel(intensity)
    HIT_RADIUS[n] = radius
    HIT_INDEX[n] = i
    n++
  }
  return n
}

/** shellLit: one of the shell's effects is on (otherwise it is not placed in the scene). */
export function shellLit(fx: BodyFxState): boolean {
  const hit = fx.shieldHit !== null && litImpacts(fx.shieldHit.gen, fx.impacts) > 0
  return hit || fx.equip.camo > 0 || fx.equip.overshield > 0
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
  showImpact(shell, fx)
}

/** buildSamples: every k-th vertex of the shell's skinned meshes, SAMPLE_MAX at most. */
function buildSamples(meshes: readonly THREE.SkinnedMesh[]): BodySamples {
  const counts = meshes.map((m) => (m.geometry.attributes.skinIndex && m.geometry.attributes.skinWeight ? m.geometry.attributes.position?.count ?? 0 : 0))
  const total = counts.reduce((a, b) => a + b, 0)
  const stride = Math.max(1, Math.ceil(total / SAMPLE_MAX))
  const size = Math.ceil(total / stride)
  const mesh = new Int32Array(size)
  const vertex = new Int32Array(size)
  let n = 0
  let base = 0
  for (let k = 0; k < meshes.length; k++) {
    for (let g = Math.ceil(base / stride) * stride; g < base + counts[k] && n < size; g += stride) {
      mesh[n] = k
      vertex[n] = g - base
      n++
    }
    base += counts[k]
  }
  return { mesh, vertex, world: new Float32Array(n * 3), count: n }
}

const SKIN = new THREE.Vector3()

/**
 * skinSamples: the samples' world positions on the posed body, as the GPU skins it (the skeleton's
 * bones and the meshes' world matrices brought up to date first).
 */
function skinSamples(meshes: readonly THREE.SkinnedMesh[], s: BodySamples): void {
  const skeletons = new Set<THREE.Skeleton>()
  for (const m of meshes) {
    m.updateWorldMatrix(true, false)
    skeletons.add(m.skeleton)
  }
  for (const sk of skeletons) {
    for (const b of sk.bones) if (!(b.parent instanceof THREE.Bone)) b.updateWorldMatrix(true, true)
  }
  for (let i = 0; i < s.count; i++) {
    const m = meshes[s.mesh[i]]
    m.getVertexPosition(s.vertex[i], SKIN).applyMatrix4(m.matrixWorld)
    s.world[i * 3] = SKIN.x
    s.world[i * 3 + 1] = SKIN.y
    s.world[i * 3 + 2] = SKIN.z
  }
}

/**
 * frontPoint: where the ray from `o` along unit `d` meets the front of the body sampled in `world`
 * (`count` points): of the samples ahead of `o`, those within FRONT_TUBE of the ray's nearest one,
 * the one nearest the shooter. `out` filled; false with no sample ahead.
 */
export function frontPoint(world: Float32Array, count: number, o: THREE.Vector3, d: THREE.Vector3, out: THREE.Vector3): boolean {
  let nearest = Number.POSITIVE_INFINITY
  for (let i = 0; i < count; i++) {
    const x = world[i * 3] - o.x
    const y = world[i * 3 + 1] - o.y
    const z = world[i * 3 + 2] - o.z
    const t = x * d.x + y * d.y + z * d.z
    if (t <= 0) continue
    nearest = Math.min(nearest, x * x + y * y + z * z - t * t)
  }
  if (!Number.isFinite(nearest)) return false
  const reach = Math.sqrt(Math.max(0, nearest)) + FRONT_TUBE
  const limit = reach * reach
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < count; i++) {
    const x = world[i * 3] - o.x
    const y = world[i * 3 + 1] - o.y
    const z = world[i * 3 + 2] - o.z
    const t = x * d.x + y * d.y + z * d.z
    if (t <= 0 || t >= best || x * x + y * y + z * z - t * t > limit) continue
    best = t
    out.set(world[i * 3], world[i * 3 + 1], world[i * 3 + 2])
  }
  return true
}

const POINT = new THREE.Vector3()

/** showImpact sets the impact generator's uniforms: its hits, or off (no generator, no lit hit). */
function showImpact(shell: BodyShell, fx: BodyFxState): void {
  const u = shell.material.uniforms
  const look = fx.shieldHit
  const lit = look ? litImpacts(look.gen, fx.impacts) : 0
  let n = 0
  if (look && lit > 0) {
    shell.samples ??= buildSamples(shell.meshes)
    const s = shell.samples
    skinSamples(shell.meshes, s)
    const points = u.uImpacts.value as THREE.Vector4[]
    const glow = u.uImpactGlow.value as number[]
    for (let k = 0; k < lit; k++) {
      const hit = fx.impacts[HIT_INDEX[k]]
      if (!frontPoint(s.world, s.count, hit.origin, hit.dir, POINT)) continue
      points[n].set(POINT.x, POINT.y, POINT.z, HIT_RADIUS[k])
      glow[n] = HIT_GLOW[k]
      n++
    }
  }
  u.uImpactCount.value = n
  u.uGen.value = n > 0 ? 1 : 0
  u.uExtrude.value = 0
  if (!look || n === 0) return
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
  // A function-driven intensity other than the hit's is not drawn (none is, on the shield impact:
  // all are constants of 0). The hit's color is its slot's; its strength is per hit (uImpactGlow).
  termColor(g, g.edgeColorMode, constantOf(g.edgeGlowIntensity, 0), team, u.uEdgeCol.value as THREE.Color)
  termColor(g, g.plasmaCenterColorMode, constantOf(g.plasmaCenterIntensity, 0), team, u.uCenterCol.value as THREE.Color)
  termColor(g, g.plasmaEdgeColorMode, constantOf(g.plasmaEdgeIntensity, 0), team, u.uPlasmaEdgeCol.value as THREE.Color)
  termColor(g, g.hitColorMode, 1, team, u.uHitCol.value as THREE.Color)
  termColor(g, g.flatColorMode, constantOf(g.flatColorIntensity, 0), team, u.uFlatCol.value as THREE.Color)
}