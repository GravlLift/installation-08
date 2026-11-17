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
 * The shield speaks the team's color (the same one as the team outline, `outline3d`):
 *  - an absorbed hit floods the whole body, stronger at the edge (a grazing reflection), scaled to
 *    the drop; sustained fire keeps it lit;
 *  - a break is a brief flash, then cells that crackle and go out one by one;
 *  - a recharge is a bright band that sweeps up the body once, when the recharge begins.
 * The overshield keeps its own shell (its ink, paled toward white) drawn over the top.
 *
 * All intensities come from `BodyFxState`, a function of the frame: the shell keeps no state of
 * its own. Colors come from the theme's inks (no value is hardcoded here).
 */
import * as THREE from 'three'

import type { Allegiance } from '@/lib/replay/filmAllegiance'

import type { EquipFx } from './equip3d'
import type { ShieldFx } from './shields3d'

/** What the shell shows at one frame. */
export interface BodyFxState {
  shield: ShieldFx
  /** Camo and overshield (`equip3d`). */
  equip: EquipFx
  /** Replay time (s): the crackle and the overshield move with it. */
  phase: number
  /** Ally or enemy as seen by the page's player (the outline and the shell take their color from it). */
  ally: Allegiance
  /** The team's color (user settings), the neutral ink when there is no team. */
  teamColor: THREE.Color
  /** The overshield's ink (green paled toward white). */
  overshieldColor: THREE.Color
  /** The camo reflection's ink. */
  camoColor: THREE.Color
}

export interface BodyShell {
  meshes: THREE.SkinnedMesh[]
  material: THREE.ShaderMaterial
}

/** The recharge band's sweep, from feet to head (s). */
export const RECHARGE_SWEEP_SECONDS = 0.6

const VERTEX = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
varying vec3 vView;
varying vec3 vRest;
void main() {
  #include <skinbase_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vView = mvPosition.xyz;
  vRest = position;
}`

const FRAGMENT = /* glsl */ `
uniform vec3 uTeam;
uniform float uHit;
uniform float uBreak;
uniform float uBreakAge;
uniform float uRecharge;
uniform float uRechargeAge;
uniform vec2 uSpan;
uniform float uPhase;
uniform vec3 uOvershieldColor;
uniform float uOvershield;
uniform vec3 uCamoColor;
uniform float uCamo;
varying vec3 vView;
varying vec3 vRest;

// The grid: ~6cm hexagons on the body's cylinder (angle around the axis, height).
const float HEX = 0.022;
float hexDist(vec2 p) {
  p = abs(p);
  return max(dot(p, vec2(0.5, 0.8660254)), p.x);
}
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
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
  float cell = hash(floor((uv - gv) * 2.0 + 0.5));

  // The hit: the whole body in the team's color, stronger at the edge.
  float hit = uHit * (0.3 + 1.6 * rim);
  // The break: a brief flash, then cells that crackle and go out one by one.
  float flash = max(0.0, 1.0 - uBreakAge / 0.06);
  float crackle = step(cell, uBreak) * (0.4 + 0.6 * line) * (0.5 + 0.5 * sin(uPhase * 90.0 + cell * 40.0));
  float pop = uBreak * (2.5 * flash * (0.6 + rim) + 1.4 * crackle);
  // The recharge: a bright band that sweeps up the body.
  float h = (vRest.y - uSpan.x) / max(1e-4, uSpan.y - uSpan.x);
  float d = (h - (uRechargeAge / ${RECHARGE_SWEEP_SECONDS.toFixed(2)}) * 1.2 + 0.1) / 0.08;
  float charge = uRecharge * exp(-d * d) * (0.5 + 1.2 * rim);
  vec3 col = uTeam * (hit + pop + charge);
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
      uTeam: { value: new THREE.Color() },
      uHit: { value: 0 },
      uBreak: { value: 0 },
      uBreakAge: { value: 0 },
      uRecharge: { value: 0 },
      uRechargeAge: { value: 0 },
      uSpan: { value: new THREE.Vector2(0, 1) },
      uPhase: { value: 0 },
      uOvershieldColor: { value: new THREE.Color() },
      uOvershield: { value: 0 },
      uCamoColor: { value: new THREE.Color() },
      uCamo: { value: 0 },
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
  ;(material.uniforms.uSpan.value as THREE.Vector2).copy(restSpan(sources))
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

/** restSpan: the rest height from feet to head (bottom, top) of the `sources` meshes. */
function restSpan(sources: readonly THREE.SkinnedMesh[]): THREE.Vector2 {
  const box = new THREE.Box3()
  for (const s of sources) {
    if (!s.geometry.boundingBox) s.geometry.computeBoundingBox()
    if (s.geometry.boundingBox) box.union(s.geometry.boundingBox)
  }
  return box.isEmpty() ? new THREE.Vector2(0, 1) : new THREE.Vector2(box.min.y, box.max.y)
}

/** releaseShell removes the shell and disposes its material (the geometry belongs to the source). */
export function releaseShell(shell: BodyShell): void {
  for (const m of shell.meshes) m.removeFromParent()
  shell.material.dispose()
}

/** shellLit: one of the shell's effects is on (otherwise it is not placed in the scene). */
export function shellLit(fx: BodyFxState): boolean {
  const s = fx.shield
  const sweeping = s.recharge > 0 && s.rechargeAge < RECHARGE_SWEEP_SECONDS
  return s.hit > 0 || s.broke > 0 || sweeping || fx.equip.camo > 0 || fx.equip.overshield > 0
}

/** showShell sets the frame's intensities `fx` on the shell, or turns it off (null, or nothing lit). */
export function showShell(shell: BodyShell, fx: BodyFxState | null): void {
  const on = fx !== null && shellLit(fx)
  for (const m of shell.meshes) m.visible = on
  if (!on || !fx) return
  const u = shell.material.uniforms
  ;(u.uTeam.value as THREE.Color).copy(fx.teamColor)
  u.uHit.value = fx.shield.hit
  u.uBreak.value = fx.shield.broke
  u.uBreakAge.value = Math.max(0, fx.shield.breakAge)
  const sweeping = fx.shield.recharge > 0 && fx.shield.rechargeAge < RECHARGE_SWEEP_SECONDS
  u.uRecharge.value = sweeping ? 1 : 0
  u.uRechargeAge.value = Math.max(0, fx.shield.rechargeAge)
  u.uPhase.value = fx.phase
  ;(u.uOvershieldColor.value as THREE.Color).copy(fx.overshieldColor)
  u.uOvershield.value = fx.equip.overshield
  ;(u.uCamoColor.value as THREE.Color).copy(fx.camoColor)
  u.uCamo.value = fx.equip.camo
}
