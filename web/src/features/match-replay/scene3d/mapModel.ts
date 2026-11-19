// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * mapModel.ts — THE 3D MAP: the GLB from the local cache (`cmd/mapfond-build --maillage`), its
 * materials and its ray-casting index.
 *
 * One glTF primitive per game material; its extras (melange, shader, couches) come from the
 * `mat ` tag. Three families: structure, decor (`decor*` nodes), and what the game layers over
 * what is behind it (light maps, decals: non-zero melange; glass: `vitre`). The `ombre*` nodes
 * are projectors and shadow proxies the game does not draw. Structure, drawn front-face only,
 * has its back drawn separately, dark and pulled back (`backFaces3d`).
 *
 * The match variant's object layer (`loadLayerModel`) is a GLB in the same format: it goes
 * through the same preparation (families, inspector labels, `ombre*` nodes, index), and reuses
 * the map's baked light instead of carrying its own.
 */
import * as THREE from 'three'
import { LoadingManager } from 'three'
import { GLTFLoader, type GLTFParser } from 'three/addons/loaders/GLTFLoader.js'
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh'

import { buildBackFaces } from './backFaces3d'
import { bvhCacheBytes, deserializeBVHCache, MAX_BVH_SIDECAR_BYTES, serializeBVHCache } from './bvhCache'
import { intensiteSoleil, lireCiel, sunColorOf } from './ciel3d'
import { GlowAnimator, readGlowAnim } from './glowAnimation3d'
import { loadBakedLight, type BakedLight } from './bakedLightShader'
import { batchLayered } from './layeredBatch3d'
import { layeredMaterial, prepareLayerUVs, type LayeredInfo } from './layeredMaterial'
import { convertLayered, MERGE_LAYERED, type LayeredMerge } from './layeredMerge3d'
import { BATCHED_LIMITS, WEBGL2_LIMITS, type ArrayLimits } from './layeredPlan3d'
import { withKtx2 } from './ktx2Textures3d'
import { measureDuration, measureSince, now, timed, timedSync } from './perf3d'
import { BAKED_INTENSITY, glowLevel, guardMaterial, imageGlowLevel } from './lighting'
import { dropMarkerObjects } from './markerObjects3d'
import { readPlacedLights } from './placedLights'
import { sunAngles } from './probes3d'
import { buildShadowProxies } from './shadowProxy3d'
import { tagSurface } from './surfaceProbe3d'

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
THREE.Mesh.prototype.raycast = acceleratedRaycast

// Fallback tints for surfaces without layers (not UI colors).
const STRUCTURE_TINT = 0xb4bac2
const DECOR_TINT = 0x5c6166
const GLASS_TINT = 0x9fd4ff
// Fallback tint for stencil decals, for maps built without their color.
export const DECAL_TINT = 0x4f8fc0

type Family = 'structure' | 'decor' | 'seeThrough'

/**
 * The game's shaders that read only the already-rendered image (screen-effect maps, with no
 * texture or color of their own): the view has no such effect, so their surfaces are not drawn
 * at all rather than showing up as a solid slab.
 */
const SCREEN_EFFECT_SHADERS: ReadonlySet<number> = new Set([0xc0146c52])

/**
 * The game's shaders whose texture is a stencil: a white shape on a black background with no
 * alpha channel, whose luminance is the coverage. In game, only the white shape is drawn, in a
 * color, over the wall behind it; the black is fully transparent.
 */
const STENCIL_DECAL_SHADERS: ReadonlySet<number> = new Set([3233303146])

interface Stencil { couleur: [number, number, number]; opacite: number }

/**
 * decalStencilMaterial returns the stencil decal material for a texture: a tinted standard
 * material whose `alphaMap` is the texture (three.js reads its green channel as coverage), with
 * no `map`. One material per texture, color and opacity: it is built on first request then
 * served from `cache`. The texture object is reused (never cloned) to keep its UV transform
 * (`KHR_texture_transform`).
 */
export function decalStencilMaterial(texture: THREE.Texture, cache: Map<string, THREE.MeshStandardMaterial>, pochoir?: Stencil): THREE.MeshStandardMaterial {
  const signature = `${texture.uuid}|${pochoir ? `${pochoir.couleur.join(',')}|${pochoir.opacite}` : 'fallback'}`
  let m = cache.get(signature)
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: DECAL_TINT, alphaMap: texture, transparent: true, depthWrite: false,
      roughness: 0.8, metalness: 0, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    })
    if (pochoir) {
      m.color.setRGB(...pochoir.couleur, THREE.LinearSRGBColorSpace)
      m.opacity = pochoir.opacite
    }
    cache.set(signature, m)
  }
  return m
}

interface MaterialExtras {
  melange?: number
  /** GlobalID of the game's material shader. */
  shader?: number
  /** The game's glass: drawn by refraction, its melange stays opaque. */
  vitre?: boolean
  couches?: LayeredInfo
  pochoir?: Stencil
  /** Flat color (linear RGB) of a layerless material: a Forge variant's placed object. */
  teinte?: [number, number, number]
  /** Its light is a picture (sign, screen, hologram), not a light mask (`glowOf`). */
  emissionImage?: boolean
  /** The game's animated parameters of its light (`glowAnimation3d`), absent when it is still. */
  emissionAnim?: unknown
  /** The game material's GlobalID. */
  id?: number
  /**
   * A dark pane's stand-in (himap `vitres_sombres.go`): the GlobalID of the glass the game draws
   * there. Drawn dark and opaque, but the game's glass lets the sun through.
   */
  vitreSombre?: number
}

/** A view GLB's surfaces (the map, or a layer placed over it), with the view's materials placed. */
export interface SurfaceModel {
  root: THREE.Object3D
  /** The opaque structure surfaces: the ones the ground ray queries. */
  pickables: THREE.Mesh[]
  /** The translucent surfaces: excluded from ambient occlusion. */
  seeThrough: THREE.Mesh[]
  /** All drawn surfaces: the ones environment probes light. */
  surfaces: THREE.Mesh[]
  /** The self-lit materials whose light the game animates (`glowAnimation3d`); empty for a still map. */
  glowAnimation: GlowAnimator
  /**
   * Packs the freshly built ray index for upload (`bvhCache.serializeBVHCache`), when
   * `indexSurfaces` had to build it (no cache was given, or it did not match); null when a
   * supplied cache was used as-is, so nothing new needs to be stored server-side. A function, not
   * the packed bytes themselves: packing ~2000 trees is itself real main-thread work (Streets), so
   * the caller runs it off the critical path (after the first frame, an idle callback), never
   * before — calling this is exactly as expensive whenever it happens, only the timing differs.
   */
  bvhUpload: (() => ArrayBuffer) | null
  /** Releases the model's geometries, index and materials (not the baked light it reused). */
  dispose(): void
}

export interface MapModel extends SurfaceModel {
  ciel: { texture: THREE.Texture | null; color: [number, number, number] | null } | null
  sunStrength: number
  /** The game's sun color published with the mesh (`sunColorOf`, linear RGB), null when absent. */
  sunColor: [number, number, number] | null
  /** The game's sun published in the mesh (see `sunAngles`), null when it is not there. */
  sun: { azimuth: number; elevation: number } | null
  /** The game's baked light, grafted onto the map's materials; null if the GLB carries none. */
  baked: BakedLight | null
  /**
   * batchDraws draws the merged-material surfaces of a given node and material as one mesh
   * (`batchLayered`), after every probe capture: a reattach's probes give the surfaces new
   * materials and new probe parts, and the previous batch is released first. Every other
   * surface split between probes is drawn one mesh per part, merge or not.
   */
  batchDraws(): void
}

type Step = 'materials' | 'index'

/**
 * A step's progress report: `done` / `total` are the units already processed out of the known
 * total (images decoded for `materials`, ray indexes built for `index`). With no count, the step
 * is just a marker (start of the progress bar).
 */
export type StepCallback = (step: Step, done?: number, total?: number) => void

/** A decoded GLB, its surfaces sorted by family, and the view materials it owns. */
interface Prepared {
  scene: THREE.Object3D
  groups: Record<Family, THREE.Mesh[]>
  owned: THREE.Material[]
  /** The layered-material merge (`convertLayered`), null with no merge. */
  merge: LayeredMerge | null
  glowAnimation: GlowAnimator
  /**
   * The GLB's decoder (`GLTFParser`): the only reference keeping the pre-merge data alive (JSON,
   * the binary chunk's copy, the downloaded GLB through its loading manager, accessors, decoded
   * images: about 1 GB for Aquarius, 2026-11-18 heap snapshot). Read by `prepareSurfaces` and
   * `readSkyAndLight` only, then cleared (`releaseParser`), so that data is collectable as soon as
   * the model is built. It must never be named in a function that also creates the model's
   * methods: V8 keeps every variable an inner closure uses in one shared context, so the model's
   * `dispose` held the decoder, and the GLB with it, for the whole session.
   */
  parser: GLTFParser | null
}

/** releaseParser drops `prepared`'s decoder (see `Prepared.parser`). */
function releaseParser(prepared: Prepared): void {
  prepared.parser = null
}

/**
 * readSkyAndLight reads the sky's texture and the baked light through the decoder, then releases
 * it. A function of its own so that `loadMapModel`, whose closures become the model's methods,
 * never names the decoder.
 */
async function readSkyAndLight(prepared: Prepared, lamps: ReturnType<typeof readPlacedLights>) {
  const { scene, parser, owned } = prepared
  if (!parser) throw new Error('3D replay: the map decoder was already released')
  const cielInfo = lireCiel(scene.userData)
  const ciel = cielInfo ? { color: cielInfo.color, texture: cielInfo.texture === null ? null : await parser.getDependency('texture', cielInfo.texture) as THREE.Texture } : null
  const baked = await timed('map:baked-light', () => loadBakedLight(scene.userData, parser, BAKED_INTENSITY, lamps))
  if (baked) for (const m of owned) baked.apply(m)
  releaseParser(prepared)
  return { ciel, baked }
}

/** emits: the glTF material carries its own light (`emissiveFactor`, strengthened by extension). */
function emits(source: THREE.MeshStandardMaterial): boolean {
  return source.emissive.getHex() !== 0 && source.emissiveIntensity > 0
}

/**
 * glowOf: the view's light of a game material that emits. A light mask (neon, strips, lamps) keeps
 * its color at the compressed force (`glowLevel`); a picture (`image`: a sign, a screen, a
 * hologram) gets its color brought to a brightest channel of 1, at the level of its whole light,
 * capped so it stays readable (`imageGlowLevel`).
 */
export function glowOf(source: THREE.MeshStandardMaterial, image: boolean): { color: THREE.Color; level: number } {
  const color = source.emissive.clone()
  if (!image) return { color, level: glowLevel(source.emissiveIntensity) }
  const brightest = Math.max(color.r, color.g, color.b)
  if (!(brightest > 0)) return { color, level: 0 }
  return { color: color.multiplyScalar(1 / brightest), level: imageGlowLevel(brightest * source.emissiveIntensity) }
}

/** applyGlow copies over the game material's own light, its strength brought to the view's scale. */
function applyGlow(target: THREE.MeshStandardMaterial, source: THREE.MeshStandardMaterial, image = false): void {
  if (!emits(source)) return
  const { color, level } = glowOf(source, image)
  target.emissive.copy(color)
  target.emissiveIntensity = level
  // The game's self-illumination texture masks the light (weapon pads: thin strips on a dark pad).
  target.emissiveMap = source.emissiveMap
}

/** The game's `maximum` blend rank (`alpha blend mode` 6): each channel keeps the brighter of the two. */
const MELANGE_MAXIMUM = 6

/**
 * The multiply ranks (`multiply` 2, `double multiply` 4): they darken what is behind, so an
 * emitter drawn with one keeps the glass placeholder. Every other see-through rank that emits
 * (additive 1, alpha blends 3 and 5, add-times-alpha 9 of Streets' hologram) is drawn added.
 */
const MULTIPLY_BLENDS: ReadonlySet<number> = new Set([2, 4])

/**
 * seeThroughGlowMaterial: what the game adds over what is behind it (a holographic sign, a
 * billboard, a hologram's emblem, an additive light strip): its picture (the emissive texture, alpha
 * already folded in by the build) times its light, added (or kept at the brighter, `maximum` blend)
 * without lighting, depth writes or fog. Drawn as the glass placeholder, a stack of such planes read
 * as a solid pale blob.
 */
export function seeThroughGlowMaterial(source: THREE.MeshStandardMaterial, extras: { melange?: number; emissionImage?: boolean }): THREE.MeshBasicMaterial {
  const { color, level } = glowOf(source, extras.emissionImage === true)
  const m = new THREE.MeshBasicMaterial({ map: source.emissiveMap, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false })
  m.color.copy(color).multiplyScalar(level)
  if (extras.melange === MELANGE_MAXIMUM) {
    m.blending = THREE.CustomBlending
    m.blendEquation = THREE.MaxEquation
    m.blendSrc = THREE.OneFactor
    m.blendDst = THREE.OneFactor
  } else {
    m.blending = THREE.AdditiveBlending
  }
  return m
}

/**
 * glassTintOf averages the color of a layered material's first layer (`bas`, `milieu` and
 * `haut`, whichever are present, in linear RGB): the game's dark glass tint. Null with no
 * readable layer or color (the glass then keeps the clear glass).
 */
export function glassTintOf(couches: LayeredInfo): [number, number, number] | null {
  const layer = couches.couches[0]
  if (!layer) return null
  const colors = [layer.bas, layer.milieu, layer.haut].filter((c): c is [number, number, number] => c !== undefined)
  if (colors.length === 0) return null
  const sum = [0, 0, 0]
  for (const c of colors) for (let i = 0; i < 3; i++) sum[i] += c[i]
  return [sum[0] / colors.length, sum[1] / colors.length, sum[2] / colors.length]
}

/**
 * loadMapModel decodes the map's GLB and prepares its materials; `onStep` reports the current step.
 * `ktx2`: the renderer's KTX2 loader (`createKtx2Loader`), for a GLB with compressed textures.
 */
export async function loadMapModel(buffer: ArrayBuffer, onStep: StepCallback, ktx2: KTX2Loader | null = null, bvhCache: ArrayBuffer | null = null): Promise<MapModel> {
  const prepared = await prepareSurfaces(buffer, onStep, MERGE_LAYERED ? WEBGL2_LIMITS : null, ktx2, 'map')
  const { scene, merge } = prepared
  // The decoder's last reads, in a function of its own (see `Prepared.parser`): after this the
  // pre-merge data it holds is collectable.
  const { ciel, baked } = await readSkyAndLight(prepared, readPlacedLights(scene.userData))
  const model = await indexSurfaces(prepared, onStep, 'map', bvhCache)
  // Entries `adoptCopies` adds later (environment-probe copies) are this attach's own: a session
  // cache reattaching this model on a later match resets them first (`resetCopies`).
  model.glowAnimation.markBaseline()
  let unbatch: (() => void) | null = null
  return {
    ...model,
    sunStrength: intensiteSoleil(scene.userData),
    sunColor: sunColorOf(scene.userData),
    ciel,
    sun: sunAngles(scene.userData),
    baked,
    batchDraws() {
      unbatch?.()
      unbatch = batchLayered(merge, model.surfaces, tightenBounds)
    },
    dispose() {
      unbatch?.()
      baked?.dispose()
      ciel?.texture?.dispose()
      model.dispose()
    },
  }
}

/**
 * loadLayerModel decodes a layer placed over the map (the match variant's objects), prepared the
 * same way. It carries no light of its own: the map's baked light (`light`, null if it carries
 * none) is grafted onto its materials, and stays owned by the map, which releases it. `ktx2`: as
 * for `loadMapModel`.
 */
export async function loadLayerModel(buffer: ArrayBuffer, light: BakedLight | null, onStep: StepCallback = quiet, ktx2: KTX2Loader | null = null, bvhCache: ArrayBuffer | null = null): Promise<SurfaceModel> {
  // Merged like the map's, two arrays short: its surfaces are drawn as batches (layerBatch3d).
  const prepared = await prepareSurfaces(buffer, onStep, MERGE_LAYERED ? BATCHED_LIMITS : null, ktx2, 'variant')
  releaseParser(prepared) // a layer reads nothing more through it (see `Prepared.parser`)
  if (light) for (const m of prepared.owned) light.apply(m)
  const model = await indexSurfaces(prepared, onStep, 'variant', bvhCache)
  model.glowAnimation.markBaseline() // see loadMapModel: bounds what a reattach's adoptCopies may add
  return model
}

function quiet(): void {}

/**
 * prepareSurfaces decodes the GLB, sorts its surfaces by family, places the view's materials on
 * them (layers, cutouts, own light) and tags them for the inspector; `ombre*` nodes are hidden.
 * `mergeLimits`: opaque layered materials get converted to merged materials (`convertLayered`).
 */
/** The family materials, the surfaces they will carry, and the list of owned materials. */
function familyMaterials(): { mats: Record<Family, THREE.MeshStandardMaterial>; groups: Record<Family, THREE.Mesh[]>; owned: THREE.Material[] } {
  const surface = { roughness: 0.8, metalness: 0, flatShading: true, side: THREE.DoubleSide }
  const mats: Record<Family, THREE.MeshStandardMaterial> = {
    // Front-face only, as in the game: two coplanar back-to-back surfaces (a panel and another's
    // back) do not fight over the same pixels. Its back is drawn separately (`buildBackFaces`),
    // dark and pulled back: it plugs the gaps without appearing in front of a face.
    structure: new THREE.MeshStandardMaterial({ ...surface, color: STRUCTURE_TINT, side: THREE.FrontSide }),
    // Coarse decor (outer shells, backdrops) is seen front-face only, as in the game: a shell
    // seen from the inside does not cover a window.
    decor: new THREE.MeshStandardMaterial({ ...surface, color: DECOR_TINT, side: THREE.FrontSide }),
    seeThrough: new THREE.MeshStandardMaterial({
      color: GLASS_TINT, roughness: 0.1, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide,
    }),
  }
  return { mats, groups: { structure: [], decor: [], seeThrough: [] }, owned: Object.values(mats) }
}

/** The context for placing materials while walking the GLB's surfaces. */
interface MaterialContext {
  mats: Record<Family, THREE.MeshStandardMaterial>
  owned: THREE.Material[]
  /** One layered material per composition, its promise shared by surfaces of the same composition. */
  layered: Map<string, Promise<THREE.MeshStandardMaterial>>
  /** The pending layered-material placements, awaited at the end of the walk. */
  jobs: Promise<void>[]
  /** The GLB's decoder, read by layered materials before `prepareSurfaces` finishes. */
  parser: GLTFParser
  glowCopy(base: THREE.MeshStandardMaterial, source: THREE.MeshStandardMaterial, image: boolean): THREE.MeshStandardMaterial
  /** Registers a view material drawing the light of `source` with the animator, when the game animates it. */
  animateGlow(material: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial, source: THREE.MeshStandardMaterial, image: boolean): void
  /** A see-through emitter of the game, one per game material (`seeThroughGlowMaterial`). */
  seeThroughGlow(source: THREE.MeshStandardMaterial, extras: MaterialExtras): THREE.MeshBasicMaterial
  tintCopy(base: THREE.MeshStandardMaterial, source: THREE.MeshStandardMaterial, tint: [number, number, number]): THREE.MeshStandardMaterial
  /** The game's tinted glass: it multiplies what is behind it by `tint`, with no lighting or reflection. */
  tintedGlass(tint: [number, number, number]): THREE.MeshBasicMaterial
  /** The game's stencil decal, shared by texture, color and opacity. */
  decalStencil(texture: THREE.Texture, pochoir?: Stencil): THREE.MeshStandardMaterial
}

/**
 * placeMaterial places the view's material on a surface: a cutout (keeps the game's texture), a
 * lit copy, a tinted copy, or a layered material (a promise shared by composition, placed on
 * resolution in `ctx.jobs`). A cutout layered material carries the mask in its base color's
 * alpha: the layered material applies an alpha test on its texture, instead of going through a
 * separate MASK material.
 */
function placeMaterial(o: THREE.Mesh, source: THREE.MeshStandardMaterial, extras: MaterialExtras, key: Family, ctx: MaterialContext): void {
  const image = extras.emissionImage === true
  if (source.alphaTest > 0 && source.map && !extras.couches) {
    // A layerless cutout material (glTF `MASK`): it keeps its texture, its holes show.
    const m = ctx.mats[key].clone()
    m.color.set(1, 1, 1)
    m.map = source.map
    m.alphaTest = source.alphaTest
    applyGlow(m, source, image)
    if (emits(source)) ctx.animateGlow(m, source, image)
    ctx.owned.push(m)
    o.material = m
    return
  }
  if (key === 'seeThrough' && !extras.vitre && emits(source) && !MULTIPLY_BLENDS.has(extras.melange ?? 0)) {
    // A see-through emitter (holographic sign, hologram): added over what is behind it, not glass.
    o.material = ctx.seeThroughGlow(source, extras)
    return
  }
  if (extras.shader !== undefined && STENCIL_DECAL_SHADERS.has(extras.shader) && source.map) {
    // One of the game's stencil decals (wall logos and markings): its texture is not an opaque
    // image but a mask map; it is placed tinted over the wall behind it. With no base texture, it
    // keeps today's family behavior.
    o.material = ctx.decalStencil(source.map, extras.pochoir)
    return
  }
  o.material = emits(source) ? ctx.glowCopy(ctx.mats[key], source, image) : ctx.mats[key]
  if (key === 'seeThrough' && extras.vitre && extras.couches && !emits(source)) {
    const tint = glassTintOf(extras.couches)
    // Below 0.25 linear brightness, multiply blending obscures the view rather than reading as a tint.
    if (tint && (tint[0] + tint[1] + tint[2]) / 3 >= 0.25) o.material = ctx.tintedGlass(tint)
  }
  if (extras.teinte && !extras.couches && key !== 'seeThrough' && !emits(source)) o.material = ctx.tintCopy(ctx.mats[key], source, extras.teinte)
  // A light masked by a texture stays on its lit copy (`glowCopy`): the layered shader's thirteen
  // samplers plus the lighting maps leave no texture unit for the mask under WebGL 2's sixteen.
  if (extras.couches && key !== 'seeThrough' && !source.emissiveMap && prepareLayerUVs(o.geometry, extras.couches)) {
    // One layered material per distinct composition (family, layers, own light, cutout): surfaces
    // of the same composition share it, and drawing only changes material between them.
    // An animated light has its own material: its light moves alone (`glowAnimation3d`).
    const anim = emits(source) && readGlowAnim(extras) ? `:${source.uuid}` : ''
    const glow = emits(source) ? `${source.emissive.getHex()}:${source.emissiveIntensity}:${image}${anim}` : ''
    const alphaTest = source.alphaTest > 0 ? `|a${source.alphaTest}` : ''
    const signature = `${key}|${glow}|${alphaTest}|${JSON.stringify(extras.couches)}`
    let shared = ctx.layered.get(signature)
    if (!shared) {
      shared = layeredMaterial(ctx.mats[key], extras.couches, ctx.parser).then((m) => {
        applyGlow(m, source, image)
        if (emits(source)) ctx.animateGlow(m, source, image)
        if (source.alphaTest > 0) m.alphaTest = source.alphaTest
        ctx.owned.push(m)
        return m
      })
      ctx.layered.set(signature, shared)
    }
    ctx.jobs.push(shared.then((m) => {
      o.material = m
    }))
  }
}

/**
 * prepareSurfaces decodes the GLB, sorts its surfaces by family, places the view's materials on
 * them (layers, cutouts, own light) and tags them for the inspector; `ombre*` nodes are hidden.
 * `mergeLimits`: opaque layered materials get converted to merged materials (`convertLayered`).
 */
/**
 * stepManager: a loading manager that reports the "materials" step. Decoding the GLB's images is
 * its long wait; the manager counts them (itemStart / itemEnd, one per image) so the bar advances
 * image by image, and with no image it stays at the start of the bar. A function of its own: the
 * decoder keeps its manager, and the progress closure must hold `onStep` only, never the GLB.
 */
function stepManager(onStep: StepCallback): LoadingManager {
  const manager = new LoadingManager()
  manager.onProgress = (_url, done, total) => onStep('materials', done, total)
  return manager
}

/** parseGlb decodes the GLB; the buffer is named here only, never in `prepareSurfaces`'s closures. */
function parseGlb(buffer: ArrayBuffer, onStep: StepCallback, ktx2: KTX2Loader | null, label: string) {
  onStep('materials', 0, 0)
  const loader = withKtx2(new GLTFLoader(stepManager(onStep)), ktx2)
  return timed(`${label}:gltf-parse`, () => loader.parseAsync(buffer, ''))
}

async function prepareSurfaces(buffer: ArrayBuffer, onStep: StepCallback, mergeLimits: ArrayLimits | null, ktx2: KTX2Loader | null, label: string): Promise<Prepared> {
  const gltf = await parseGlb(buffer, onStep, ktx2, label)
  const materialsStart = now()
  timedSync(`${label}:markers`, () => dropMarkerObjects(gltf.scene))
  const { mats, groups, owned } = familyMaterials()
  // One lit copy of a family material per emitting game material.
  const glowing = new Map<THREE.Material, THREE.MeshStandardMaterial>()
  const glowAnimation = new GlowAnimator()
  const animateGlow = (material: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial, source: THREE.MeshStandardMaterial, image: boolean) => {
    const extras = (source.userData ?? {}) as MaterialExtras
    const specs = readGlowAnim(extras)
    if (specs) glowAnimation.add(material, source, specs, image, extras.id ?? 0)
  }
  const glowCopy = (base: THREE.MeshStandardMaterial, source: THREE.MeshStandardMaterial, image: boolean) => {
    let m = glowing.get(source)
    if (!m) {
      m = base.clone()
      applyGlow(m, source, image)
      if (source.emissiveMap) {
        // Its game color under the mask: the glTF base color, the material's first layer.
        m.map = source.map
        m.color.copy(source.color)
      }
      animateGlow(m, source, image)
      owned.push(m)
      glowing.set(source, m)
    }
    return m
  }
  // One additive (or maximum) material per game material that emits over what is behind it.
  const seeThroughGlowing = new Map<THREE.Material, THREE.MeshBasicMaterial>()
  const seeThroughGlow = (source: THREE.MeshStandardMaterial, extras: MaterialExtras) => {
    let m = seeThroughGlowing.get(source)
    if (!m) {
      m = seeThroughGlowMaterial(source, extras)
      animateGlow(m, source, extras.emissionImage === true)
      owned.push(m)
      seeThroughGlowing.set(source, m)
    }
    return m
  }
  // One tinted copy of a family material per distinct flat color (the game's roughness and metal).
  const tinted = new Map<string, THREE.MeshStandardMaterial>()
  const tintCopy = (base: THREE.MeshStandardMaterial, source: THREE.MeshStandardMaterial, tint: [number, number, number]) => {
    const signature = `${base.uuid}|${tint.join(',')}|${source.roughness}|${source.metalness}`
    let m = tinted.get(signature)
    if (!m) {
      m = base.clone()
      m.color.setRGB(tint[0], tint[1], tint[2], THREE.LinearSRGBColorSpace)
      m.roughness = source.roughness
      m.metalness = source.metalness
      owned.push(m)
      tinted.set(signature, m)
    }
    return m
  }
  // One tinted glass per distinct tint: the game's dark glass (a layered `vitre` material),
  // placed at the tinted glass's opacity instead of the family's clear glass.
  const tintedGlass = new Map<string, THREE.MeshBasicMaterial>()
  const tintedGlassCopy = (tint: [number, number, number]) => {
    const signature = tint.map((v) => Math.round(v * 1000) / 1000).join(',')
    let m = tintedGlass.get(signature)
    if (!m) {
      m = new THREE.MeshBasicMaterial({ blending: THREE.MultiplyBlending, premultipliedAlpha: true, transparent: true, depthWrite: false, side: THREE.DoubleSide })
      m.color.setRGB(tint[0], tint[1], tint[2], THREE.LinearSRGBColorSpace)
      owned.push(m)
      tintedGlass.set(signature, m)
    }
    return m
  }
  // One stencil decal per distinct texture, color and opacity.
  const decalStencil = new Map<string, THREE.MeshStandardMaterial>()
  const decalStencilCopy = (texture: THREE.Texture, pochoir?: Stencil) => decalStencilMaterial(texture, decalStencil, pochoir)
  const ctx: MaterialContext = { mats, owned, layered: new Map(), jobs: [], parser: gltf.parser, glowCopy, animateGlow, seeThroughGlow, tintCopy, tintedGlass: tintedGlassCopy, decalStencil: decalStencilCopy }
  const instanced: THREE.InstancedMesh[] = []
  timedSync(`${label}:traverse`, () => gltf.scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const source = o.material as THREE.MeshStandardMaterial
    const extras = (source.userData ?? {}) as MaterialExtras
    const node = o.parent?.name || o.name
    if (node.startsWith('ombre') || (extras.shader !== undefined && SCREEN_EFFECT_SHADERS.has(extras.shader))) {
      o.visible = false
      return
    }
    if (o instanceof THREE.InstancedMesh) {
      // A terrain's scattered clumps (grass, `decorHerbe*`): tens of thousands of copies of one
      // small cutout mesh. They get their material and receive shadows, and stay out of the
      // families' passes (ray index, shadow proxies, merging), which read one copy only.
      tagSurface(o, source, extras.shader, 'decor')
      placeMaterial(o, source, extras, 'decor', ctx)
      instanced.push(o)
      o.castShadow = false
      o.receiveShadow = true
      return
    }
    const key: Family = (extras.melange ?? 0) !== 0 || extras.vitre ? 'seeThrough' : node.startsWith('decor') ? 'decor' : 'structure'
    tagSurface(o, source, extras.shader, key)
    placeMaterial(o, source, extras, key, ctx)
    groups[key].push(o)
    // A dark pane stands in for glass: as in the game, the sun crosses it (Recharge's skylight
    // casts its girder lattice on the floor, not one solid shadow).
    o.castShadow = key !== 'seeThrough' && extras.vitreSombre === undefined
    o.receiveShadow = true
  }))
  await timed(`${label}:layered`, () => Promise.all(ctx.jobs))
  measureSince(`${label}:materials`, materialsStart)
  // A clump's cards are seen from both sides, as in the game. Their layered materials are theirs
  // alone (the composition names their cutout and gradient).
  const familyShared = new Set<THREE.Material>(Object.values(mats))
  for (const o of instanced) for (const m of [o.material].flat()) if (!familyShared.has(m)) m.side = THREE.DoubleSide
  for (const m of decalStencil.values()) owned.push(m)
  const drawn = [...groups.structure, ...groups.decor]
  const merge = mergeLimits ? timedSync(`${label}:merge`, () => convertLayered(drawn, [...drawn, ...groups.seeThrough], owned, mergeLimits)) : null
  for (const m of owned) guardMaterial(m)
  return { scene: gltf.scene, groups, owned, merge, parser: gltf.parser, glowAnimation }
}

/**
 * tightenBounds measures a surface's bounding box and sphere over only the vertices its index
 * references. A GLB's surfaces share one vertex buffer: three.js's default measurement covers the
 * whole buffer, giving every surface the map's own bounds, so nothing out of view gets culled
 * from drawing.
 */
export function tightenBounds(geometry: THREE.BufferGeometry): void {
  const index = geometry.index
  const position = geometry.getAttribute('position')
  if (!index || !position || index.count === 0) return
  const box = new THREE.Box3()
  const v = new THREE.Vector3()
  for (let i = 0; i < index.count; i++) box.expandByPoint(v.fromBufferAttribute(position, index.getX(i)))
  const sphere = new THREE.Sphere()
  box.getCenter(sphere.center)
  let farthest = 0
  for (let i = 0; i < index.count; i++) {
    farthest = Math.max(farthest, sphere.center.distanceToSquared(v.fromBufferAttribute(position, index.getX(i))))
  }
  sphere.radius = Math.sqrt(farthest)
  geometry.boundingBox = box
  geometry.boundingSphere = sphere
}

/**
 * geometriesOf returns the distinct geometries of `meshes`: a variant's objects place the same
 * geometry in several spots (nodes sharing a glTF mesh), and its ray index as well as its bounds,
 * taken in its own frame, hold for all of its placements.
 */
export function geometriesOf(meshes: readonly THREE.Mesh[]): THREE.BufferGeometry[] {
  return [...new Set(meshes.map((m) => m.geometry))]
}

/**
 * indexSurfaces builds the ray-casting index (structure, translucent) and returns the model.
 * `bvhCache`, when given, is tried first (`deserializeBVHCache`): on a match it replaces the whole
 * build loop below. On any mismatch (format, library version, build options, geometry counts) or
 * when absent, the index is built as before, and the model's `bvhUpload` is a function the caller
 * runs later (off the critical path) to pack the freshly built one for upload; a used cache leaves
 * `bvhUpload` null. Packing itself is NOT done here: for a map the size of Streets (~2000
 * geometries) it is real main-thread work on its own, so it must never run before the first frame.
 */
async function indexSurfaces({ scene, groups, owned, glowAnimation }: Prepared, onStep: StepCallback, label: string, bvhCache: ArrayBuffer | null = null): Promise<SurfaceModel> {
  const bvhStart = now()
  const bvh = geometriesOf([...groups.structure, ...groups.seeThrough])
  onStep('index', 0, bvh.length)
  let bvhUpload: (() => ArrayBuffer) | null = null
  const loadedFromCache = bvhCache ? timedSync(`${label}:bvh-load`, () => deserializeBVHCache(bvhCache, bvh)) : false
  if (!loadedFromCache) {
    await new Promise((r) => setTimeout(r, 0))
    // One ray index per geometry: the build is counted, and yielding to the browser every few
    // geometries lets the bar paint without slowing the computation down (nineteen yields at
    // most for the whole map).
    // Diagnostics: the structure index is the one raycasts query; the see-through one is tallied
    // apart to see if it earns its build time.
    const structGeos = new Set(geometriesOf(groups.structure))
    let structMs = 0
    let seeThroughMs = 0
    const step = Math.max(1, Math.ceil(bvh.length / 19))
    for (let i = 0; i < bvh.length; i++) {
      const geoStart = now()
      // Coarser leaves (100 triangles, not 10): the ground and reticle rays are short and sparse,
      // so the hit test pays only a little more per ray, while the build drops a level of sorting
      // for every doubling (Streets: ~3.3 s to ~1.9 s over its two thousand structure geometries).
      bvh[i].computeBoundsTree({ maxLeafTris: 100 })
      const dt = now() - geoStart
      if (structGeos.has(bvh[i])) structMs += dt
      else seeThroughMs += dt
      onStep('index', i + 1, bvh.length)
      if ((i + 1) % step === 0) await new Promise((r) => setTimeout(r, 0))
    }
    measureSince(`${label}:bvh`, bvhStart)
    measureDuration(`${label}:bvh-structure`, structMs)
    measureDuration(`${label}:bvh-see-through`, seeThroughMs)
    // Deferred: `serializeBVHCache` walks every tree in `bvh` again: left as a thunk, run by the
    // caller once the scene is shown, not here on the cold load's critical path.
    // A sidecar over the server's cap is refused: none is packed (see `bvhCacheBytes`).
    if (bvh.length > 0) {
      const bytes = bvhCacheBytes(bvh)
      if (bytes <= MAX_BVH_SIDECAR_BYTES) bvhUpload = () => serializeBVHCache(bvh)
      else console.info(`3D replay: ${label} ray index ${(bytes / 1048576).toFixed(0)} MiB, over the sidecar cap: not stored`)
    }
  }
  onStep('index', bvh.length, bvh.length)
  timedSync(`${label}:bounds`, () => {
    for (const g of geometriesOf([...groups.structure, ...groups.decor, ...groups.seeThrough])) tightenBounds(g)
  })
  const shadows = timedSync(`${label}:shadow-proxies`, () => buildShadowProxies(scene, [...groups.structure, ...groups.decor]))
  // After the material merge: the back reads surfaces' final vertices and indexes.
  const backs = timedSync(`${label}:back-faces`, () => buildBackFaces(scene, groups.structure, tightenBounds))

  return {
    root: scene,
    pickables: groups.structure,
    seeThrough: groups.seeThrough,
    surfaces: [...groups.structure, ...groups.decor, ...groups.seeThrough],
    glowAnimation,
    bvhUpload,
    dispose() {
      shadows.dispose()
      backs.dispose()
      const geometries = new Set<THREE.BufferGeometry>()
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) geometries.add(o.geometry)
      })
      for (const g of geometries) {
        g.disposeBoundsTree?.()
        g.dispose()
      }
      for (const m of owned) {
        const layerTextures = (m.userData.textures ?? []) as THREE.Texture[]
        for (const v of [...Object.values(m), ...layerTextures]) if (v instanceof THREE.Texture) v.dispose()
        m.dispose()
      }
    },
  }
}
