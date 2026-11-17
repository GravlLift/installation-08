// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { Sky } from 'three/addons/objects/Sky.js'

// Neutral coverage when the world publishes no usable measurement.
const NEUTRAL_COVERAGE = 0.48
const CLOUD_SPEED = 0.0008
const SKY_DISTANCE = 400
// The atmosphere model outputs values made for a low exposure: this factor, specific to the
// sky, brings it back under the scene's own exposure, without touching the scene's.
const SKY_EXPOSURE = '0.3'
// Luminance of lit clouds, on the same scale as the exposed sky.
const CLOUD_GLOW = '0.95'
// The sky's tint with no direct light (night blue, not a UI color), lighter toward the horizon.
const NIGHT_SKY = 'vec3(0.006, 0.009, 0.02)'
// The weakest sun intensity a full-daylight map declares: from this value up, the view's sun keeps
// its full strength (tuned on Recharge, 9) and the sky stays day; below it both fade toward night.
// The game exposes each map for its own light, so a declared intensity is not a brightness: Origin
// (Forge, fo08_wetland, 2) is bright and sunlit in game, and Fortress at its canvas's 5 drew too
// dark under the former reference of 8. Streets (0.05) stays a night.
const SUN_REFERENCE = 2

/** Direct-light factor: the game's intensity brought back to that of a full-daylight map. */
export function intensiteSoleil(extras: unknown): number {
  const data = extras as { levelupSun?: { intensity?: unknown }; ciel?: { sunIntensity?: unknown } } | null
  const value = data?.levelupSun?.intensity ?? data?.ciel?.sunIntensity
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(value / SUN_REFERENCE, 1) : 1
}

/** sunColorOf: the game's sun color published with the mesh (linear RGB), null when absent or unreadable. */
export function sunColorOf(extras: unknown): [number, number, number] | null {
  const color = (extras as { levelupSun?: { color?: unknown } } | null)?.levelupSun?.color
  return Array.isArray(color) && color.length === 3 && color.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0) ? color as [number, number, number] : null
}

/** Reads the sky's presence and the optional glTF cloud texture. */
export function lireCiel(extras: unknown): { texture: number | null; color: [number, number, number] | null } | null {
  if (!extras || typeof extras !== 'object') return null
  const sky = (extras as { ciel?: unknown }).ciel
  if (!sky || typeof sky !== 'object' || Array.isArray(sky)) return null
  const texture = (sky as { cloudTexture?: unknown }).cloudTexture
  return { texture: typeof texture === 'number' && Number.isSafeInteger(texture) && texture >= 0 ? texture : null, color: sunColorOf(extras) }
}

/**
 * The sky follows the eye and takes part in neither the map's shadows nor its probes. `daylight`
 * is the map's direct-light factor (0 to 1): the sky's and clouds' luminance follow it, with no
 * direct light it drifts toward a night blue.
 */
export function creerCiel(sun: { azimuth: number; elevation: number }, texture: THREE.Texture | null, color: [number, number, number] | null, daylight: number): Sky {
  const sky = new Sky()
  sky.scale.setScalar(SKY_DISTANCE)
  sky.frustumCulled = false
  sky.renderOrder = -1000
  sky.material.depthTest = false
  sky.material.depthWrite = false
  sky.material.fog = false
  const az = THREE.MathUtils.degToRad(sun.azimuth)
  const el = THREE.MathUtils.degToRad(sun.elevation)
  sky.material.uniforms.sunPosition.value.set(Math.cos(el) * Math.cos(az), Math.sin(el), -Math.cos(el) * Math.sin(az)).multiplyScalar(450000)
  sky.material.uniforms.turbidity.value = 3
  sky.material.uniforms.rayleigh.value = 2
  sky.material.uniforms.sunColor = { value: new THREE.Vector3(...(color ?? [1, 1, 1])) }
  sky.material.fragmentShader = sky.material.fragmentShader.replace('void main() {', 'uniform vec3 sunColor;\nvoid main() {')
    .replace('( vSunE * 19000.0 * Fex ) * sundisk', '( vSunE * 19000.0 * Fex ) * sunColor * sundisk')
    .replace('gl_FragColor = vec4( retColor, 1.0 );', `retColor *= ${SKY_EXPOSURE};\ngl_FragColor = vec4( mix(${NIGHT_SKY} * (1.6 - direction.y), retColor, daylight), 1.0 );`)
  sky.material.uniforms.daylight = { value: THREE.MathUtils.clamp(daylight, 0, 1) }
  sky.material.fragmentShader = sky.material.fragmentShader.replace('void main() {', 'uniform float daylight;\nvoid main() {')
  if (texture) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.colorSpace = THREE.NoColorSpace
    texture.needsUpdate = true
    sky.material.uniforms.cloudMask = { value: texture }
    sky.material.uniforms.cloudTime = { value: 0 }
    sky.material.uniforms.cloudCoverage = { value: NEUTRAL_COVERAGE }
    sky.material.fragmentShader = sky.material.fragmentShader.replace('void main() {', 'uniform sampler2D cloudMask;\nuniform float cloudTime;\nuniform float cloudCoverage;\nvoid main() {')
      .replace('gl_FragColor = vec4( mix(${NIGHT_SKY} * (1.6 - direction.y), retColor, daylight), 1.0 );', `
        vec2 cloudUV = direction.xz / max(direction.y + 0.45, 0.3) * 1.4 + vec2(cloudTime, cloudTime * 0.3);
        float mask = 1.0 - texture2D(cloudMask, cloudUV).r;        float clouds = smoothstep(1.0 - cloudCoverage - 0.22, 1.0 - cloudCoverage + 0.22, mask);
        clouds *= smoothstep(0.02, 0.28, direction.y);
        float sunlight = 0.7 + 0.3 * max(dot(direction, vSunDirection), 0.0);
        retColor = mix(retColor, vec3(${CLOUD_GLOW}) * sunlight, clouds * 0.88);
        gl_FragColor = vec4( mix(${NIGHT_SKY} * (1.6 - direction.y), retColor, daylight), 1.0 );`)
  }
  sky.onBeforeRender = (_renderer, _scene, camera) => {
    sky.position.copy(camera.position)
    sky.updateMatrixWorld()
    const seconds = (sky.userData.cloudClockS as number | null | undefined) ?? performance.now() * 0.001
    if (texture) sky.material.uniforms.cloudTime.value = seconds * CLOUD_SPEED
  }
  return sky
}

/**
 * setCloudClock drives the clouds from `seconds` of match time (the video export, which renders
 * off real time), or hands them back to the wall clock (`null`).
 */
export function setCloudClock(sky: THREE.Object3D, seconds: number | null): void {
  sky.userData.cloudClockS = seconds
}
