// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * lighting.ts — THE 3D VIEW'S PHYSICAL LIGHTING.
 *
 * Materials are standard (roughness, metal). A sun casts shadows; its shadow map is recomputed
 * on every new replay frame, so players and vehicles cast one (nothing while paused). The map's
 * own casters are drawn into it once and kept (shadowSplit3d): each frame redraws only what
 * moves. The environment (reflections and indirect light) is the map itself, captured as a cube
 * from several played points then prefiltered: each triangle takes the nearest probe
 * (`probes3d`). The map's placed lamps light directly, without shadows, through a world grid
 * (`clusteredLights`). The action's brief flashes (muzzles, detonations) have their own fixed
 * set of lights (`flash3d`), placed at construction.
 *
 * The drawer's settings (`Look3d`) apply without recompiling the map for shadows (shadow
 * intensity at zero, shadow map frozen) and game light (baked probes' uniform, shared lamps'
 * uniform); reflections remove materials' probes, and the sky replaces them so shadow doesn't
 * fall to black.
 */
import * as THREE from 'three'

import type { BakedLight } from './bakedLightShader'
import { FlashLights } from './flash3d'
import { ShadowSplit } from './shadowSplit3d'
import type { Look3d } from './look3d'
import { chooseProbes, nearestProbe, probeParts, splitByProbe, type ProbePart } from './probes3d'
import { graftTopShade } from './topDownShade3d'

const SHADOW_SIZE = 4096
// Environment probes: at most PROBE_MAX, spaced at least PROBE_SPACING (u) apart.
const PROBE_MAX = 8
const PROBE_SPACING = 12
// Sky light with no reflections: replaces the light the map gives back.
const HEMI_BARE_INTENSITY = 0.4
// Shadow map depth bias: the GLB carries no vertex normals, so the normal-based bias has no
// effect and this one alone avoids shadow acne.
const SHADOW_BIAS = -0.0002
const ENV_SIZE = 256
// Light given back by the probes, and the sky: tuned on an official capture of Recharge's
// central room (dark walls, a sun pool under the skylight). Any stronger and the interior washes out.
export const ENV_INTENSITY = 1.5
const EXPOSURE = 1.15
const SUN_INTENSITY = 3.2
// Scales from game light (baked probes `bakedLight`, lamps `placedLights`) to three.js, at
// unchanged exposure (the sun stays tuned on its capture): the frame's median luminance, at eye
// height on played points of Recharge, 0.23 against 0.21 on the game's own captures (0.13 at π and 1).
export const BAKED_INTENSITY = 2.5 * Math.PI
// Materials' own light: the game declares strengths from 1 to over 1,000 (HDR values); the view
// compresses them to log2(1 + strength) × GLOW_SCALE.
const GLOW_SCALE = 0.6

/** glowLevel: the three.js emissive intensity for a game strength. */
export function glowLevel(force: number): number {
  return GLOW_SCALE * Math.log2(1 + force)
}

/**
 * The ceiling of a picture's light (a sign, a billboard, a screen, a hologram's emblem): under
 * the bloom threshold (1.5), so the picture stays readable instead of washing out to white. At
 * 1.4, a saturated yellow texel leaves ACES (exposure 1.15) still yellow.
 */
export const IMAGE_GLOW_MAX = 1.4

/**
 * imageGlowLevel: the three emissive intensity of a picture whose brightest channel emits `peak`
 * (game color times force), applied to its color brought to a brightest channel of 1. The level
 * follows the whole light, not the force alone: a sign's dim tint at a high force (0.11 x 59)
 * reads as lit as a bright tint at a low one.
 */
export function imageGlowLevel(peak: number): number {
  return Math.min(IMAGE_GLOW_MAX, glowLevel(Math.max(0, peak)))
}
const HEMI_INTENSITY = 0.25
// Light hues (not UI colors): warm sun, cool sky, brown ground.
const SUN_TINT = 0xfff4e5
const SKY_TINT = 0xdfe8f0
const GROUND_TINT = 0x3a3530
// The game's distance haze: air hue, and density (per u, squared-exponential law).
const HAZE_TINT = 0x4a5a66
const HAZE_DENSITY = 0.02

/**
 * sunLightColor: the view's sun color for the game's sun color `game` (linear RGB): its hue, at the
 * luminance of SUN_TINT, on which the sun's strength is tuned (Recharge's own sun color, (1, 0.91,
 * 0.80), is SUN_TINT within 3%). A Forge map's Sunlight color override (Origin's warm orange,
 * (1, 0.712, 0.410)) is the light's hue in game, not only the sun disc's. SUN_TINT when `game` is
 * null or black.
 */
export function sunLightColor(game: readonly [number, number, number] | null): THREE.Color {
  const tint = new THREE.Color(SUN_TINT)
  if (!game) return tint
  const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b
  const l = lum(game[0], game[1], game[2])
  if (!(l > 0)) return tint
  const k = lum(tint.r, tint.g, tint.b) / l
  return new THREE.Color().setRGB(game[0] * k, game[1] * k, game[2] * k, THREE.LinearSRGBColorSpace)
}

/** farthestCorner: the distance from `center` to the farthest corner of `box`; 0 for an empty box. */
export function farthestCorner(box: THREE.Box3, center: THREE.Vector3): number {
  if (box.isEmpty()) return 0
  const dx = Math.max(Math.abs(box.min.x - center.x), Math.abs(box.max.x - center.x))
  const dy = Math.max(Math.abs(box.min.y - center.y), Math.abs(box.max.y - center.y))
  const dz = Math.max(Math.abs(box.min.z - center.z), Math.abs(box.max.z - center.z))
  return Math.hypot(dx, dy, dz)
}

/**
 * hazeDensity: the haze's density for a layer that reaches `reach` (u) from the play area's center,
 * the play area reaching `playReach` (its half diagonal). HAZE_DENSITY is the native maps' haze:
 * their world mesh is cut to the play area and a margin (mapmesh.FrameOf), and their variant layer
 * stays inside it. A layer that reaches further thins the haze in proportion, so its edge takes the
 * haze the play area's edge takes: a Forge map's own backdrop (cliffs and hills, 80 to 91% of the
 * placed surface area past 100 u on Origin, Fortress and Vacancy) drew as flat haze color (98% haze
 * at 100 u) where the game shows it sunlit.
 */
export function hazeDensity(playReach: number, reach: number): number {
  if (!(playReach > 0) || !(reach > playReach)) return HAZE_DENSITY
  return (HAZE_DENSITY * playReach) / reach
}

// Share of the sun's diffuse light the open sky adds, on a map without baked light (Forge
// canvases publish no probes). The view's background (a display color, linear luminance about
// 0.44) was captured into the probes as radiance: under ENV_INTENSITY an open-sky surface took
// about 0.65 x albedo of flat blue-grey fill, as much as Fortress's sun gives (5/8 of SUN_INTENSITY,
// 0.64 x albedo x cos): the walls, the floor and the first-person weapon came out washed out and
// desaturated. A clear sky adds a fraction of the sun.
export const SKY_FILL_SHARE = 0.25

/**
 * captureSkyScale: the factor on the background color `sky` while the probes are captured, so
 * that an open sky lights a surface with SKY_FILL_SHARE of the sun's diffuse light (intensity
 * `sunIntensity`); at most 1 (never brighter than the background shown). 0 for a black sky.
 */
export function captureSkyScale(sunIntensity: number, sky: THREE.Color): number {
  const luminance = 0.2126 * sky.r + 0.7152 * sky.g + 0.0722 * sky.b
  if (!(luminance > 0) || !(sunIntensity > 0)) return 0
  return Math.min(1, (SKY_FILL_SHARE * sunIntensity) / Math.PI / (luminance * ENV_INTENSITY))
}

const guarded = new WeakSet<THREE.Material>()

/** The constant vertex normal given to surfaces whose GLB carries none (`giveFiniteNormal`). */
export const FINITE_NORMAL: readonly number[] = [0, 1, 0]

/**
 * giveFiniteNormal gives `material` a constant vertex normal (`FINITE_NORMAL`) for geometries
 * that carry no `normal` attribute (the map's GLB, and Spartan, armor and weapon GLBs built before
 * they carried the game's normals). Without it the attribute reads WebGL's generic vertex value,
 * (0, 0, 0) unless another program left something at that location: three's shadow pass
 * normalizes it (`shadowmap_vertex`, `shadowWorldNormal`), the sun's shadow coordinate becomes
 * NaN, and the sun's shadow test on that surface is undefined (the GPU's compiler decides: never
 * shadowed, or always shadowed). Shading never reads it: faceted rendering takes its normal from
 * screen-space derivatives, and the shadow's normal bias is zero, so any finite normal gives the
 * true shadow lookup.
 *
 * It never overrides a geometry's own normals: three binds a material's default attribute value
 * only for an attribute the geometry lacks (`WebGLBindingStates.setupVertexAttributes`), so a
 * material shared by geometries with and without normals is safe.
 */
export function giveFiniteNormal(material: THREE.Material): void {
  const withDefaults = material as THREE.Material & { defaultAttributeValues?: Record<string, readonly number[]> }
  withDefaults.defaultAttributeValues = { ...withDefaults.defaultAttributeValues, normal: FINITE_NORMAL }
}

/**
 * shadesFaceted: whether a model's surface is shaded per face (screen-space derivative normals)
 * rather than from its vertex normals. The tool writes the game's own vertex normals into the
 * Spartan, armor, attachment, first-person and weapon GLBs (himap `geometry_normales.go`); a GLB
 * built before that carries none and keeps the faceted look.
 */
export function shadesFaceted(geometry: THREE.BufferGeometry): boolean {
  return !geometry.hasAttribute('normal')
}

/**
 * guardMaterial prepares a map material for lighting.
 * - Constant vertex normal (`giveFiniteNormal`): the GLB carries none, and the missing attribute
 *   reads as (0, 0, 0), whose normalization yields NaN in the shadow coordinate. Faceted
 *   rendering derives its normals from screen-space derivatives, not this attribute.
 * - A non-finite pixel is written black: degenerate game triangles give a NaN faceted normal;
 *   invisible on screen, a few of them in the environment capture are enough to poison the
 *   whole prefilter, and so every reflection.
 * - The flat light of the top-down views (`topDownShade3d`), off outside them.
 */
export function guardMaterial(material: THREE.Material | undefined): void {
  if (!material || guarded.has(material)) return
  guarded.add(material)
  giveFiniteNormal(material)
  const previous = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    graftTopShade(shader)
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      '#include <dithering_fragment>\nif (any(isnan(gl_FragColor)) || any(isinf(gl_FragColor))) gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);',
    )
  }
}

export class Lighting {
  readonly sun: THREE.DirectionalLight
  /** The action's brief flashes (muzzles, detonations), a fixed set of lights (`flash3d`). */
  readonly flashes: FlashLights
  private readonly hemi: THREE.HemisphereLight
  private readonly haze = new THREE.FogExp2(HAZE_TINT, HAZE_DENSITY)
  private readonly box = new THREE.Box3()
  /** A point's box, for `probeAt` (a probe at the point, not at a surface's box). */
  private readonly pointBox = new THREE.Box3()
  private probes: THREE.Texture[] = []
  /** The probes' capture points (three.js frame), in the order of `probes`. */
  private spots: THREE.Vector3[] = []
  /** Each map material's probe (copies per probe included). */
  private readonly envOf = new Map<THREE.MeshStandardMaterial, THREE.Texture>()
  private readonly copies: THREE.Material[] = []
  private shadows = true
  private reflections = true
  private shadowFrame = Number.NaN
  private baked: BakedLight | null = null
  private gameLight = true
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  /** The static map's casters, kept; what moves is redrawn over them (shadowSplit3d). */
  readonly split: ShadowSplit
  /** Off: the shadow map is no longer updated (it keeps its last state), for A/B measurements. */
  shadowUpdates = true

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    this.renderer = renderer
    this.scene = scene
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = EXPOSURE
    scene.environmentIntensity = ENV_INTENSITY
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.shadowMap.autoUpdate = false
    this.hemi = new THREE.HemisphereLight(SKY_TINT, GROUND_TINT, HEMI_INTENSITY)
    this.sun = new THREE.DirectionalLight(SUN_TINT, SUN_INTENSITY)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE)
    this.sun.shadow.bias = SHADOW_BIAS
    scene.add(this.hemi, this.sun, this.sun.target)
    this.split = new ShadowSplit(renderer, scene, this.sun)
    scene.fog = this.haze
    // Before any compilation: the number of lights enters the shader programs.
    this.flashes = new FlashLights(scene)
  }

  /**
   * fit bounds the shadow camera to `box` (three.js frame). A map carries distant scenery over
   * thousands of units: the box is the play area's, not the mesh's.
   */
  fit(box: THREE.Box3): void {
    this.box.copy(box)
    this.box.getCenter(this.sun.target.position)
  }

  /** Sets direct light according to the intensity the map publishes. */
  setSunStrength(factor: number): void { this.sun.intensity = SUN_INTENSITY * factor }

  /** setSunColor gives the sun the game's sun color (`sunLightColor`); null keeps SUN_TINT. */
  setSunColor(game: readonly [number, number, number] | null): void { this.sun.color.copy(sunLightColor(game)) }

  /** fitHaze sets the haze for a layer reaching `reach` (u) from a play area reaching `playReach` (`hazeDensity`). */
  fitHaze(playReach: number, reach: number): void { this.haze.density = hazeDensity(playReach, reach) }

  /** The haze's current density (per u). */
  get hazeDensity(): number { return this.haze.density }

  /**
   * setSun orients the sun (azimuth from +X toward -Z, elevation, in degrees) and reframes its
   * shadow camera on the play area's corners as seen from it.
   */
  setSun(azDeg: number, elDeg: number): void {
    const az = THREE.MathUtils.degToRad(azDeg)
    const el = THREE.MathUtils.degToRad(elDeg)
    const dir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), -Math.cos(el) * Math.sin(az))
    const center = this.sun.target.position
    const radius = this.box.getSize(new THREE.Vector3()).length() / 2
    this.sun.position.copy(center).addScaledVector(dir, radius * 1.5)
    this.sun.updateMatrixWorld()
    this.sun.target.updateMatrixWorld()
    const cam = this.sun.shadow.camera
    cam.position.copy(this.sun.position)
    cam.lookAt(center)
    cam.updateMatrixWorld()
    const view = cam.matrixWorldInverse
    const lo = new THREE.Vector3(Infinity, Infinity, Infinity)
    const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
    const { min, max } = this.box
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).applyMatrix4(view)
      lo.min(p)
      hi.max(p)
    }
    // Near, toward the sun: whatever extends past the box toward it (tall scenery) still casts its shadow.
    Object.assign(cam, { left: lo.x, right: hi.x, bottom: lo.y, top: hi.y, near: 0.1, far: -lo.z })
    cam.updateProjectionMatrix()
    this.split.invalidate()
    this.renderer.shadowMap.needsUpdate = true
  }

  /**
   * captureProbes captures the map as a cube from played points (`eyes`, at eye height) and
   * gives each triangle of `meshes` the nearest probe. A material shared by surfaces with
   * different probes is copied per probe. Call once, before placing players. Returns the
   * number of probes.
   */
  captureProbes(eyes: readonly THREE.Vector3[], meshes: readonly THREE.Mesh[]): number {
    this.spots = chooseProbes(eyes, PROBE_MAX, PROBE_SPACING)
    this.probes = this.captureAll()
    if (this.probes.length === 0) return 0
    this.assignProbes(meshes)
    this.applyReflections()
    return this.probes.length
  }

  /**
   * recaptureProbes captures the probes again at the same spots, with what the scene holds now
   * (the map AND the layer posed on it), and swaps each new capture in for the old one on every
   * material that used it: the surfaces keep their probe, only its picture changes. Without it, a
   * Forge map's surfaces took their indirect light from the bare canvas captured before its
   * variant layer existed: AIMBOTZ's closed white arena was lit by an open blue-grey sky.
   */
  recaptureProbes(): void {
    if (this.probes.length === 0) return
    const old = this.probes
    this.probes = this.captureAll()
    const swap = new Map(old.map((t, k) => [t, this.probes[k]]))
    for (const [m, t] of this.envOf) {
      const next = swap.get(t)
      if (next) this.envOf.set(m, next)
    }
    for (const t of old) t.dispose()
    this.applyReflections()
  }

  /** captureAll captures one probe per spot, the scene set up the way every capture sees it. */
  private captureAll(): THREE.Texture[] {
    // Every capture sees the map with no environment: no probe reflects into another.
    this.scene.environment = null
    const own = [...this.envOf.keys()].filter((m) => m.envMap)
    for (const m of own) m.envMap = null
    // And with no haze: it belongs to the eye, not to light given back.
    this.scene.fog = null
    // Without baked light, the sky seen by the probes is the sky's share of the sun's light, not
    // the background's display color (SKY_FILL_SHARE).
    const background = this.scene.background
    if (!(this.baked && this.baked.regions.length > 0) && background instanceof THREE.Color) {
      this.scene.background = background.clone().multiplyScalar(captureSkyScale(this.sun.intensity, background))
    }
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    const probes = this.spots.map((spot) => this.capture(spot, pmrem))
    pmrem.dispose()
    this.scene.background = background
    this.scene.fog = this.haze
    for (const m of own) this.reflect(m)
    return probes
  }

  /**
   * lightLayer lights a layer placed on the map after the capture (the variant's objects): each
   * surface takes the nearest probe, and the shadow map is redone. Already-captured probes
   * don't see the layer.
   */
  lightLayer(meshes: readonly THREE.Mesh[]): void {
    if (this.probes.length > 0) {
      for (const m of this.assignProbes(meshes)) this.reflect(m)
    }
    this.shadowFrame = Number.NaN
  }

  /** releaseLayer removes a removed layer's surfaces from the probes, and frees the copies made for it. */
  releaseLayer(meshes: readonly THREE.Mesh[]): void {
    for (const mesh of meshes) {
      const materials = [mesh.material, ...(probeParts.get(mesh)?.map((p) => p.material) ?? [])]
      probeParts.delete(mesh)
      for (const m of materials) {
        if (!(m instanceof THREE.MeshStandardMaterial) || !this.envOf.delete(m)) continue
        const i = this.copies.indexOf(m)
        if (i < 0) continue
        this.copies.splice(i, 1)
        m.dispose()
      }
    }
    this.shadowFrame = Number.NaN
  }

  /**
   * takeGameLight takes the map's game light (baked probes, placed lamps) that the drawer turns
   * on or off; once, before the first render.
   */
  takeGameLight(baked: BakedLight | null): void {
    this.baked = baked
    this.applyGameLight()
  }

  /**
   * probeAt: the probe nearest point `position` (three.js frame), the same way `assignProbes`
   * picks one for a surface — players take their environment from it; null if reflections are
   * off or there's no capture.
   */
  probeAt(position: THREE.Vector3): THREE.Texture | null {
    if (!this.reflections || this.probes.length === 0) return null
    this.pointBox.min.copy(position)
    this.pointBox.max.copy(position)
    return this.probes[nearestProbe(this.pointBox, this.spots)] ?? null
  }

  /** setLook applies the drawer's settings (ambient occlusion is a scene pass). */
  setLook(look: Look3d): void {
    if (look.shadows !== this.shadows) {
      this.shadows = look.shadows
      this.sun.shadow.intensity = look.shadows ? 1 : 0
      this.shadowFrame = Number.NaN
    }
    if (look.reflections !== this.reflections) {
      this.reflections = look.reflections
      this.applyReflections()
    }
    if (look.gameLight !== this.gameLight) {
      this.gameLight = look.gameLight
      this.applyGameLight()
    }
  }

  /**
   * setStaticCasters: the roots whose casters never move (the map and its layer), drawn once into
   * the kept shadow map; the map is redone at the next update.
   */
  setStaticCasters(roots: readonly THREE.Object3D[]): void {
    this.split.setStatic(roots)
    this.shadowFrame = Number.NaN
  }

  /** invalidateStaticShadows: the static casters changed (visibility), the kept map is redone. */
  invalidateStaticShadows(): void {
    this.split.invalidate()
    this.shadowFrame = Number.NaN
  }

  /** updateShadows: the shadow map follows frame `frame` (players, vehicles); nothing while paused. */
  updateShadows(frame: number): void {
    if (!this.shadows || !this.shadowUpdates || frame === this.shadowFrame) return
    this.shadowFrame = frame
    this.renderer.shadowMap.needsUpdate = true
  }

  dispose(): void {
    for (const t of this.probes) t.dispose()
    for (const m of this.copies) m.dispose()
    this.sun.shadow.map?.dispose()
    this.split.dispose()
    this.flashes.dispose()
  }

  private capture(spot: THREE.Vector3, pmrem: THREE.PMREMGenerator): THREE.Texture {
    const target = new THREE.WebGLCubeRenderTarget(ENV_SIZE, { type: THREE.HalfFloatType })
    const cube = new THREE.CubeCamera(0.05, 500, target)
    cube.position.copy(spot)
    this.scene.add(cube)
    cube.update(this.renderer, this.scene)
    this.scene.remove(cube)
    const texture = pmrem.fromCubemap(target.texture).texture
    target.dispose()
    return texture
  }

  private applyGameLight(): void {
    if (this.baked) this.baked.enabled = this.gameLight
  }

  /**
   * assignProbes gives each triangle of `meshes` the nearest probe (`splitByProbe`); a material
   * shared by surfaces or parts with different probes is copied per probe. A surface split
   * between probes keeps its largest part's material and publishes its parts (`probeParts`),
   * which `batchLayered` draws each with its own. Returns the assigned materials.
   */
  private assignProbes(meshes: readonly THREE.Mesh[]): Set<THREE.MeshStandardMaterial> {
    const perProbe = new Map<THREE.MeshStandardMaterial, Map<number, THREE.MeshStandardMaterial>>()
    const assigned = new Set<THREE.MeshStandardMaterial>()
    for (const mesh of meshes) {
      const source = mesh.material
      if (!(source instanceof THREE.MeshStandardMaterial)) continue
      let variants = perProbe.get(source)
      const materialFor = (k: number): THREE.MeshStandardMaterial => {
        if (!variants) perProbe.set(source, (variants = new Map([[k, source]])))
        let m = variants.get(k)
        if (!m) {
          m = copyPerProbe(source)
          variants.set(k, m)
          this.copies.push(m)
        }
        m.envMapIntensity = ENV_INTENSITY
        this.envOf.set(m, this.probes[k])
        assigned.add(m)
        return m
      }
      // Each triangle takes its nearest probe; the mesh itself draws with its largest share's.
      const shares = splitByProbe(mesh, this.spots)
      const parts = shares.map((s) => ({ material: materialFor(s.probe), index: s.index }))
      mesh.material = parts[0].material
      if (parts.length > 1) probeParts.set(mesh, parts as ProbePart[])
      else probeParts.delete(mesh)
    }
    return assigned
  }

  /** reflect applies (or removes, reflections off) a material's probe. */
  private reflect(m: THREE.MeshStandardMaterial): void {
    m.envMap = this.reflections ? (this.envOf.get(m) ?? null) : null
    m.needsUpdate = true
  }

  private applyReflections(): void {
    const on = this.reflections
    for (const m of this.envOf.keys()) this.reflect(m)
    this.scene.environment = on ? (this.probes[0] ?? null) : null
    this.hemi.intensity = on ? HEMI_INTENSITY : HEMI_BARE_INTENSITY
  }
}

/**
 * copyPerProbe: a copy of the material for another probe, which keeps its compile-time
 * preparation (guard, layers) and shares its textures without recopying them.
 */
function copyPerProbe(source: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const { userData } = source
  // `clone` copies `userData` through JSON: the layers' textures live there.
  source.userData = {}
  const copy = source.clone()
  source.userData = userData
  copy.userData = userData
  copy.onBeforeCompile = source.onBeforeCompile
  copy.customProgramCacheKey = source.customProgramCacheKey
  const defaults = (source as THREE.Material & { defaultAttributeValues?: unknown }).defaultAttributeValues
  Object.assign(copy, { defaultAttributeValues: defaults })
  return copy
}
