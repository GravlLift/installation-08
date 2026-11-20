// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * heroLightShader3d.ts — A CAMERA SCRIPT'S HERO LIGHTS IN THE SPARTANS' AND WEAPONS' SHADER.
 *
 * three.js lights light every material in the scene (a light's `layers` only decide whether it is
 * collected at all), and adding one changes the light count every program is compiled for: a
 * script that turned three.js lights on would relight the map and recompile it. The hero lights
 * are instead a graft: `graftHeroLights` adds, once, a fixed uniform-driven loop to a Spartan's or
 * weapon's standard material (`spartan3d.copySpartan`, `avatar3d.applyWeaponCoating`,
 * `weaponModels3d.prepareModel`), so only those materials are ever lit by them. With no rig set
 * (`uHeroCount` 0, every unscripted frame) the loop exits at once and the picture is the stock one.
 *
 * Each rig (`heroLights3d`) is three directional lights (key, fill, rim) that reach only fragments
 * near its player's body center (`HERO_REACH_INNER` to `HERO_REACH_OUTER`), through the material's
 * own BRDF (`RE_Direct`, the same path as the sun and the map's lamps): metal shows highlights,
 * dark paint stays dark paint. No shadows. The uniforms are one session-wide set (`heroLightUniforms`)
 * that every grafted material shares by reference: `setHeroRigs` writes them once per frame.
 */
import * as THREE from 'three'

import { HERO_LIGHTS_MAX, HERO_REACH_INNER, HERO_REACH_OUTER, type Vec3 } from './heroLights3d'

/** Lights per rig: key, fill, rim. */
const LIGHTS_PER_RIG = 3

/** One rig ready for the shader: its center, and each light's direction (unit, toward the light) and color × intensity. */
export interface HeroRigUniform {
  center: Vec3
  directions: [Vec3, Vec3, Vec3]
  colors: [Vec3, Vec3, Vec3]
}

/** The session's shared hero-light uniforms (every grafted material holds these objects). */
export const heroLightUniforms = {
  uHeroCount: { value: 0 },
  uHeroCenter: { value: new Float32Array(HERO_LIGHTS_MAX * 3) },
  uHeroDir: { value: new Float32Array(HERO_LIGHTS_MAX * LIGHTS_PER_RIG * 3) },
  uHeroColor: { value: new Float32Array(HERO_LIGHTS_MAX * LIGHTS_PER_RIG * 3) },
}

/** setHeroRigs writes the frame's rigs (at most `HERO_LIGHTS_MAX`, the rest ignored); an empty list turns the lights off. */
export function setHeroRigs(rigs: readonly HeroRigUniform[]): void {
  const n = Math.min(rigs.length, HERO_LIGHTS_MAX)
  const u = heroLightUniforms
  u.uHeroCenter.value.fill(0)
  u.uHeroDir.value.fill(0)
  u.uHeroColor.value.fill(0)
  for (let i = 0; i < n; i++) {
    const rig = rigs[i]
    u.uHeroCenter.value.set(rig.center, i * 3)
    for (let j = 0; j < LIGHTS_PER_RIG; j++) {
      const o = (i * LIGHTS_PER_RIG + j) * 3
      u.uHeroDir.value.set(rig.directions[j], o)
      u.uHeroColor.value.set(rig.colors[j], o)
    }
  }
  u.uHeroCount.value = n
}

/** clearHeroRigs turns every hero light off. */
export function clearHeroRigs(): void { setHeroRigs([]) }

const HEAD = /* glsl */ `
#define HERO_MAX ${HERO_LIGHTS_MAX}
#define HERO_PER_RIG ${LIGHTS_PER_RIG}
uniform int uHeroCount;
uniform vec3 uHeroCenter[HERO_MAX];
uniform vec3 uHeroDir[HERO_MAX * HERO_PER_RIG];
uniform vec3 uHeroColor[HERO_MAX * HERO_PER_RIG];`

export const HERO_APPLY = /* glsl */ `
#if defined( RE_Direct )
for (int heroI = 0; heroI < HERO_MAX; heroI++) {
  if (heroI >= uHeroCount) break;
  vec3 heroCenter = (viewMatrix * vec4(uHeroCenter[heroI], 1.0)).xyz;
  float heroReach = 1.0 - smoothstep(${HERO_REACH_INNER.toFixed(3)}, ${HERO_REACH_OUTER.toFixed(3)}, distance(geometryPosition, heroCenter));
  if (heroReach <= 0.0) continue;
  for (int heroJ = 0; heroJ < HERO_PER_RIG; heroJ++) {
    int heroK = heroI * HERO_PER_RIG + heroJ;
    IncidentLight heroLight;
    heroLight.direction = normalize(mat3(viewMatrix) * uHeroDir[heroK]);
    heroLight.color = uHeroColor[heroK] * heroReach;
    heroLight.visible = true;
    RE_Direct(heroLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
  }
}
#endif`

const grafted = new WeakSet<THREE.Material>()

/**
 * graftHeroLights adds the hero-light loop to a standard material (before it compiles), once; any
 * other material is left alone. It composes with the material's own patches (painted armor, baked
 * light): it only appends after includes it keeps.
 */
export function graftHeroLights(material: THREE.Material): void {
  if (!(material instanceof THREE.MeshStandardMaterial) || grafted.has(material)) return
  grafted.add(material)
  const previous = material.onBeforeCompile
  const previousKey = material.customProgramCacheKey.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    Object.assign(shader.uniforms, heroLightUniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_pars_begin>', `#include <lights_pars_begin>${HEAD}`)
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>${HERO_APPLY}`)
  }
  material.customProgramCacheKey = () => `${previousKey()}|hero-v1`
  material.needsUpdate = true
}

/** isHeroLit: whether `material` carries the hero-light graft. */
export function isHeroLit(material: THREE.Material): boolean { return grafted.has(material) }
