// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * lightVolume3d.ts — THE GAME'S LIGHT VOLUMES: a beam drawn as a stack of soft camera-facing
 * "profiles" (Go `weapons.LightVolume`, `internal/weapons/light_volume.go`, decoded from the
 * generator's own shaders). Per volume, at an origin with an axis:
 *
 *   count     = min(floor(length * profileDensity), maxCount)
 *   profile i = origin + axis * (profileOffset + i / profileDensity), t = i / (count - 1) (0 for one)
 *   quad      = facing the camera; width thickness(t) across the axis; length lerp(thickness,
 *               profileLength, sin(view ray to axis)) along the axis's screen direction
 *   light     = color * intensity(t) * alpha * brightnessRatio, added to the frame
 *   pixel     = light * saturate(centerOffset * (1 - r^2)) ^ volumeFalloff (r: 0 center, 1 edge)
 *   far fade  = from farFade[0] to farFade[1] (camera to origin)
 *
 * Not drawn: the soft fade against the scene depth (`depthFadeRange`) and the material's manual
 * exposure; a property whose curve was not read counts as 0 (nothing drawn for it).
 */
import * as THREE from 'three'

import { evalCurve, type GeneratorCurve, type GeneratorProperty, propertyAt } from './shieldGenerator3d'

export interface GeneratorColor extends GeneratorProperty {
  from: [number, number, number]
  to: [number, number, number]
}

export interface LightVolume {
  maxCount: number
  length: GeneratorProperty
  profileLength: GeneratorProperty
  profileDensity: GeneratorProperty
  profileThickness: GeneratorProperty
  profileColor: GeneratorColor
  profileAlpha: GeneratorProperty
  profileIntensity: GeneratorProperty
  profileOffset: GeneratorProperty
  centerOffset: number
  volumeFalloff: number
  brightnessRatio: number
  farFade: [number, number]
  additive: boolean
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}
function isProp(v: unknown): v is GeneratorProperty {
  return isRecord(v) && (typeof v.constant === 'number' || typeof v.input === 'string')
}
function isTriple(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number')
}

/** parseLightVolume: one served light volume, null when malformed. */
export function parseLightVolume(v: unknown): LightVolume | null {
  if (!isRecord(v)) return null
  const props = ['length', 'profileLength', 'profileDensity', 'profileThickness', 'profileAlpha', 'profileIntensity', 'profileOffset', 'profileColor']
  if (!props.every((k) => isProp(v[k]))) return null
  const c = v.profileColor as Record<string, unknown>
  if (!isTriple(c.from) || !isTriple(c.to)) return null
  if (!['maxCount', 'centerOffset', 'volumeFalloff', 'brightnessRatio'].every((k) => typeof v[k] === 'number')) return null
  if (!Array.isArray(v.farFade) || v.farFade.length !== 2) return null
  return v as unknown as LightVolume
}

/** The engine inputs a volume's properties read, besides the profile position. */
export interface VolumeInputs {
  /** Seconds since the generator started. */
  systemAge: number
}

function inputOf(p: GeneratorProperty, t: number, inputs: VolumeInputs): number {
  return p.input === 'systemAge' ? inputs.systemAge : t
}

/** valueAt: a property at profile position `t`; 0 for a function whose curve was not read. */
export function valueAt(p: GeneratorProperty, t: number, inputs: VolumeInputs): number {
  return propertyAt(p, inputOf(p, t, inputs)) ?? 0
}

/** profileCount: how many profiles the volume draws. */
export function profileCount(v: LightVolume, inputs: VolumeInputs): number {
  const n = Math.floor(valueAt(v.length, 0, inputs) * valueAt(v.profileDensity, 0, inputs) + 1e-4)
  return Math.max(0, Math.min(n, v.maxCount))
}

/** colorAt: the volume's color (linear RGB) at profile position `t`, written in `out`. */
export function colorAt(v: LightVolume, t: number, inputs: VolumeInputs, out: THREE.Color): THREE.Color {
  const c = v.profileColor
  const curve = c.curve as GeneratorCurve | undefined
  const k = c.constant ?? (curve ? evalCurve(curve, inputOf(c, t, inputs)) : 0)
  return out.setRGB(c.from[0] + (c.to[0] - c.from[0]) * k, c.from[1] + (c.to[1] - c.from[1]) * k, c.from[2] + (c.to[2] - c.from[2]) * k, THREE.LinearSRGBColorSpace)
}

const VERTEX = /* glsl */ `
attribute vec3 light;
varying vec2 vUv;
varying vec3 vLight;
void main() {
  vUv = uv;
  vLight = light;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`

const FRAGMENT = /* glsl */ `
uniform float centerOffset;
uniform float volumeFalloff;
varying vec2 vUv;
varying vec3 vLight;
void main() {
  vec2 d = vUv * 2.0 - 1.0;
  float k = pow(clamp(centerOffset * (1.0 - dot(d, d)), 0.0, 1.0), volumeFalloff);
  gl_FragColor = vec4(vLight * k, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

/** One drawn light volume: its quads, rebuilt every frame for the camera. */
export class LightVolumeMesh {
  readonly mesh: THREE.Mesh
  private readonly volume: LightVolume
  private readonly origin: THREE.Vector3
  private readonly axis: THREE.Vector3
  private readonly positions: Float32Array
  private readonly lights: Float32Array
  private readonly geometry = new THREE.BufferGeometry()
  private readonly color = new THREE.Color()
  private readonly p = new THREE.Vector3()
  private readonly v = new THREE.Vector3()
  private readonly s = new THREE.Vector3()
  private readonly u = new THREE.Vector3()

  constructor(volume: LightVolume, origin: THREE.Vector3, axis: THREE.Vector3) {
    this.volume = volume
    this.origin = origin.clone()
    this.axis = axis.clone().normalize()
    const max = Math.max(1, volume.maxCount)
    this.positions = new Float32Array(max * 4 * 3)
    this.lights = new Float32Array(max * 4 * 3)
    const uvs = new Float32Array(max * 4 * 2)
    const index: number[] = []
    for (let i = 0; i < max; i++) {
      uvs.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8)
      const b = i * 4
      index.push(b, b + 1, b + 2, b, b + 2, b + 3)
    }
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setAttribute('light', new THREE.BufferAttribute(this.lights, 3).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    this.geometry.setIndex(index)
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { centerOffset: { value: volume.centerOffset }, volumeFalloff: { value: volume.volumeFalloff } },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      side: THREE.DoubleSide,
    })
    this.mesh = new THREE.Mesh(this.geometry, material)
    this.mesh.frustumCulled = false
  }

  /** update rebuilds the profiles for `camera` with the engine inputs `inputs`; hidden when nothing shows. */
  update(camera: THREE.Camera, inputs: VolumeInputs): void {
    const vol = this.volume
    const cam = camera.position
    const fade = fadeBetween(cam.distanceTo(this.origin), vol.farFade[0], vol.farFade[1])
    const count = fade > 0 ? profileCount(vol, inputs) : 0
    const density = valueAt(vol.profileDensity, 0, inputs)
    const offset = valueAt(vol.profileOffset, 0, inputs)
    const profileLength = valueAt(vol.profileLength, 0, inputs)
    const alpha = valueAt(vol.profileAlpha, 0, inputs)
    let drawn = 0
    for (let i = 0; i < count && density > 0; i++) {
      // The shader's 0 / 0 for a single profile saturates to 0.
      const t = count > 1 ? i / (count - 1) : 0
      const thickness = valueAt(vol.profileThickness, t, inputs)
      const k = valueAt(vol.profileIntensity, t, inputs) * alpha * vol.brightnessRatio * fade
      if (thickness <= 0 || k <= 0) continue
      colorAt(vol, t, inputs, this.color).multiplyScalar(k)
      this.p.copy(this.origin).addScaledVector(this.axis, offset + i / density)
      this.v.subVectors(this.p, cam).normalize()
      this.s.crossVectors(this.v, this.axis)
      const sin = this.s.length()
      if (sin < 1e-6) this.s.set(1, 0, 0).cross(this.v)
      this.s.normalize()
      this.u.crossVectors(this.s, this.v)
      const along = (thickness + (profileLength - thickness) * sin) / 2
      const across = thickness / 2
      const o = drawn * 12
      for (const [c, [a, b]] of [[-1, -1], [1, -1], [1, 1], [-1, 1]].entries()) {
        this.positions[o + c * 3] = this.p.x + this.s.x * a * across + this.u.x * b * along
        this.positions[o + c * 3 + 1] = this.p.y + this.s.y * a * across + this.u.y * b * along
        this.positions[o + c * 3 + 2] = this.p.z + this.s.z * a * across + this.u.z * b * along
        this.lights.set([this.color.r, this.color.g, this.color.b], o + c * 3)
      }
      drawn++
    }
    this.geometry.setDrawRange(0, drawn * 6)
    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.light.needsUpdate = true
    this.mesh.visible = drawn > 0
  }

  dispose(): void {
    this.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}

/** 1 below `begin`, 0 past `end`, linear between; 1 for an empty range. */
function fadeBetween(x: number, begin: number, end: number): number {
  if (!(end > begin)) return 1
  return Math.min(1, Math.max(0, (end - x) / (end - begin)))
}
