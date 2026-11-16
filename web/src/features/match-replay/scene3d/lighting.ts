/**
 * lighting.ts — L'ÉCLAIRAGE PHYSIQUE DE LA VUE 3D.
 *
 * Les matériaux sont standard (rugosité, métal). Un soleil porte des ombres ; sa carte d'ombre se
 * recalcule à chaque nouvelle image du rejeu, pour que les joueurs et les véhicules en portent
 * (rien à l'arrêt). The map's own casters are drawn into it once and kept (shadowSplit3d): each
 * frame redraws only what moves. L'environnement (reflets et lumière indirecte) est la carte elle-même,
 * capturée en cube depuis plusieurs points joués puis préfiltrée : chaque surface prend la sonde
 * la plus proche (`probes3d`). Les lampes posées de la carte éclairent directement, sans ombre,
 * par une grille mondiale (`clusteredLights`). Les éclairs brefs de l'action (bouches,
 * détonations) ont leur jeu fixe de lumières (`flash3d`), posé dès la construction.
 *
 * Les réglages du tiroir (`Look3d`) s'appliquent sans recompiler la carte pour les ombres
 * (intensité de l'ombre à zéro, carte d'ombre figée) et la lumière du jeu (uniforme des sondes
 * cuites, uniforme partagé des lampes) ; les reflets retirent les sondes des matériaux, et le ciel les remplace
 * pour que l'ombre ne tombe pas au noir.
 */
import * as THREE from 'three'

import type { BakedLight } from './bakedLightShader'
import { FlashLights } from './flash3d'
import { ShadowSplit } from './shadowSplit3d'
import type { Look3d } from './look3d'
import { chooseProbes, nearestProbe } from './probes3d'
import { graftTopShade } from './topDownShade3d'

const SHADOW_SIZE = 4096
// Sondes d'environnement : au plus PROBE_MAX, espacées d'au moins PROBE_SPACING (u).
const PROBE_MAX = 8
const PROBE_SPACING = 12
// Lumière du ciel sans reflets : remplace la lumière renvoyée par la carte.
const HEMI_BARE_INTENSITY = 0.4
// Biais de profondeur de la carte d'ombre : le GLB n'a pas de normales de sommet, le biais selon
// la normale n'a donc aucun effet et seul celui-ci évite l'acné.
const SHADOW_BIAS = -0.0002
const ENV_SIZE = 256
// Lumière renvoyée par les sondes, et ciel : réglés sur une capture officielle de la salle centrale de
// Recharge (murs sombres, flaque de soleil sous la verrière). Plus fort, l'intérieur se délave.
export const ENV_INTENSITY = 1.5
const EXPOSURE = 1.15
const SUN_INTENSITY = 3.2
// Échelles de la lumière du jeu (sondes cuites `bakedLight`, lampes `placedLights`) vers three, à
// exposition inchangée (le soleil reste réglé sur sa capture) : luminance médiane du cadre, à hauteur
// d'œil sur des points joués de Recharge, 0,23 contre 0,21 sur les captures du jeu (0,13 à π et 1).
export const BAKED_INTENSITY = 2.5 * Math.PI
// Lumière propre des matériaux : le jeu déclare des forces de 1 à plus de 1 000 (valeurs HDR) ;
// la vue les comprime en log2(1 + force) × GLOW_SCALE.
const GLOW_SCALE = 0.6

/** glowLevel : l'intensité émissive three d'une force du jeu. */
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
// Teintes de la lumière (pas des couleurs d'interface) : soleil chaud, ciel froid, sol brun.
const SUN_TINT = 0xfff4e5
const SKY_TINT = 0xdfe8f0
const GROUND_TINT = 0x3a3530
// Brume de distance du jeu : teinte de l'air, et densité (par u, loi exponentielle au carré).
const HAZE_TINT = 0x4a5a66
const HAZE_DENSITY = 0.02

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

/**
 * guardMaterial prépare un matériau de la carte à l'éclairage.
 * - Normale de sommet constante : le GLB n'en porte pas, et l'attribut absent vaut (0, 0, 0),
 *   dont la normalisation donne NaN dans la coordonnée d'ombre : tout serait éclairé. Le rendu
 *   en facettes tire ses normales des dérivées écran, pas de cet attribut.
 * - Pixel non fini écrit en noir : des triangles dégénérés du jeu donnent une normale en facette
 *   NaN ; invisibles à l'écran, quelques-uns dans la capture d'environnement suffisent à
 *   empoisonner tout le préfiltrage, donc tous les reflets.
 * - The flat light of the top-down views (`topDownShade3d`), off outside them.
 */
export function guardMaterial(material: THREE.Material | undefined): void {
  if (!material || guarded.has(material)) return
  guarded.add(material)
  const withDefaults = material as THREE.Material & { defaultAttributeValues?: Record<string, number[]> }
  withDefaults.defaultAttributeValues = { ...withDefaults.defaultAttributeValues, normal: [0, 1, 0] }
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
  /** Les éclairs brefs de l'action (bouches, détonations), un jeu fixe de lumières (`flash3d`). */
  readonly flashes: FlashLights
  private readonly hemi: THREE.HemisphereLight
  private readonly haze = new THREE.FogExp2(HAZE_TINT, HAZE_DENSITY)
  private readonly box = new THREE.Box3()
  /** Boîte d'un point, pour `probeAt` (une sonde au point, pas à une boîte de surface). */
  private readonly pointBox = new THREE.Box3()
  private probes: THREE.Texture[] = []
  /** Les points de capture des sondes (repère three), dans l'ordre de `probes`. */
  private spots: THREE.Vector3[] = []
  /** La sonde de chaque matériau de la carte (copies par sonde comprises). */
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
    // Avant toute compilation : le nombre de lumières entre dans les programmes.
    this.flashes = new FlashLights(scene)
  }

  /**
   * fit borne la caméra d'ombre à `box` (repère three). Une carte porte un décor lointain sur des
   * milliers d'unités : la boîte est celle de l'aire de jeu, pas celle du maillage.
   */
  fit(box: THREE.Box3): void {
    this.box.copy(box)
    this.box.getCenter(this.sun.target.position)
  }

  /** Règle la lumière directe selon l'intensité publiée par la carte. */
  setSunStrength(factor: number): void { this.sun.intensity = SUN_INTENSITY * factor }

  /**
   * setSun oriente le soleil (azimut depuis +X vers -Z, élévation, en degrés) et recadre sa
   * caméra d'ombre sur les coins de l'aire de jeu vus depuis lui.
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
    // near au soleil : ce qui dépasse de la boîte vers lui (décor haut) porte encore son ombre.
    Object.assign(cam, { left: lo.x, right: hi.x, bottom: lo.y, top: hi.y, near: 0.1, far: -lo.z })
    cam.updateProjectionMatrix()
    this.split.invalidate()
    this.renderer.shadowMap.needsUpdate = true
  }

  /**
   * captureProbes capture la carte en cube depuis des points joués (`eyes`, à hauteur d'œil) et
   * donne à chaque surface de `meshes` la sonde la plus proche. Un matériau partagé par des
   * surfaces de sondes différentes est copié par sonde. À appeler une fois, avant de poser les
   * joueurs. Rend le nombre de sondes.
   */
  captureProbes(eyes: readonly THREE.Vector3[], meshes: readonly THREE.Mesh[]): number {
    this.spots = chooseProbes(eyes, PROBE_MAX, PROBE_SPACING)
    // Toutes les captures voient la carte sans environnement : aucune sonde ne se reflète dans une autre.
    this.scene.environment = null
    // Et sans brume : elle appartient à l'œil, pas à la lumière renvoyée.
    this.scene.fog = null
    // Without baked light, the sky seen by the probes is the sky's share of the sun's light, not
    // the background's display color (SKY_FILL_SHARE).
    const background = this.scene.background
    if (!(this.baked && this.baked.regions.length > 0) && background instanceof THREE.Color) {
      this.scene.background = background.clone().multiplyScalar(captureSkyScale(this.sun.intensity, background))
    }
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.probes = this.spots.map((spot) => this.capture(spot, pmrem))
    pmrem.dispose()
    this.scene.background = background
    this.scene.fog = this.haze
    if (this.probes.length === 0) return 0
    this.assignProbes(meshes)
    this.applyReflections()
    return this.probes.length
  }

  /**
   * lightLayer éclaire un calque posé sur la carte après la capture (les objets de la variante) :
   * chaque surface prend la sonde la plus proche, et la carte d'ombre se refait. Les sondes déjà
   * capturées ne voient pas le calque.
   */
  lightLayer(meshes: readonly THREE.Mesh[]): void {
    if (this.probes.length > 0) {
      for (const m of this.assignProbes(meshes)) this.reflect(m)
    }
    this.shadowFrame = Number.NaN
  }

  /** releaseLayer retire des sondes les surfaces d'un calque retiré, et libère les copies faites pour lui. */
  releaseLayer(meshes: readonly THREE.Mesh[]): void {
    for (const mesh of meshes) {
      const m = mesh.material
      if (!(m instanceof THREE.MeshStandardMaterial) || !this.envOf.delete(m)) continue
      const i = this.copies.indexOf(m)
      if (i < 0) continue
      this.copies.splice(i, 1)
      m.dispose()
    }
    this.shadowFrame = Number.NaN
  }

  /**
   * takeGameLight prend la lumière du jeu de la carte (sondes cuites, lampes posées) que le tiroir
   * allume ou éteint ; une fois, avant le premier rendu.
   */
  takeGameLight(baked: BakedLight | null): void {
    this.baked = baked
    this.applyGameLight()
  }

  /**
   * probeAt : la sonde la plus proche du point `position` (repère three), comme `assignProbes` pour
   * une surface — les joueurs y prennent leur environnement ; null si les reflets sont éteints ou
   * sans capture.
   */
  probeAt(position: THREE.Vector3): THREE.Texture | null {
    if (!this.reflections || this.probes.length === 0) return null
    this.pointBox.min.copy(position)
    this.pointBox.max.copy(position)
    return this.probes[nearestProbe(this.pointBox, this.spots)] ?? null
  }

  /** setLook applique les réglages du tiroir (l'occlusion ambiante est une passe de la scène). */
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

  /** updateShadows : la carte d'ombre suit l'image `frame` (joueurs, véhicules) ; rien à l'arrêt. */
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
   * assignProbes donne à chaque surface de `meshes` la sonde la plus proche ; un matériau partagé
   * par des surfaces de sondes différentes est copié par sonde. Rend les matériaux assignés.
   */
  private assignProbes(meshes: readonly THREE.Mesh[]): Set<THREE.MeshStandardMaterial> {
    const perProbe = new Map<THREE.MeshStandardMaterial, Map<number, THREE.MeshStandardMaterial>>()
    const assigned = new Set<THREE.MeshStandardMaterial>()
    const box = new THREE.Box3()
    for (const mesh of meshes) {
      const source = mesh.material
      if (!(source instanceof THREE.MeshStandardMaterial)) continue
      const k = nearestProbe(box.setFromObject(mesh), this.spots)
      let variants = perProbe.get(source)
      if (!variants) perProbe.set(source, (variants = new Map([[k, source]])))
      let m = variants.get(k)
      if (!m) {
        m = copyPerProbe(source)
        variants.set(k, m)
        this.copies.push(m)
      }
      mesh.material = m
      m.envMapIntensity = ENV_INTENSITY
      this.envOf.set(m, this.probes[k])
      assigned.add(m)
    }
    return assigned
  }

  /** reflect pose (ou retire, reflets éteints) la sonde d'un matériau. */
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
 * copyPerProbe : une copie du matériau pour une autre sonde, qui garde sa préparation à la
 * compilation (garde, couches) et partage ses textures sans les recopier.
 */
function copyPerProbe(source: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const { userData } = source
  // `clone` recopie `userData` par JSON : les textures des couches y vivent.
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
