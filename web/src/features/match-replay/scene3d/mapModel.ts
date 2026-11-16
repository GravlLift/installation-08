/**
 * mapModel.ts — LA CARTE 3D : le GLB du cache local (`cmd/mapfond-build --maillage`), ses
 * matériaux et son index de lancer de rayons.
 *
 * Une primitive glTF par matériau du jeu ; ses extras (mélange, shader, couches) viennent du tag
 * `mat `. Trois familles : la structure, le décor (nœuds `decor*`), et ce que le jeu superpose à
 * ce qui est derrière (cartes lumineuses, décalques : mélange non nul ; vitres : `vitre`). Les nœuds
 * `ombre*` sont des projecteurs et des mandataires d'ombre que le jeu ne dessine pas. La structure,
 * vue de face seulement, a son envers dessiné à part, sombre et reculé (`backFaces3d`).
 *
 * Le calque des objets de la variante du match (`loadLayerModel`) est un GLB au même format : il
 * passe par la même préparation (familles, étiquettes de l'inspecteur, nœuds `ombre*`, index), et
 * reprend la lumière cuite de la carte au lieu d'en porter une.
 */
import * as THREE from 'three'
import { LoadingManager } from 'three'
import { GLTFLoader, type GLTFParser } from 'three/addons/loaders/GLTFLoader.js'
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh'

import { buildBackFaces } from './backFaces3d'
import { intensiteSoleil, lireCiel, sunColorOf } from './ciel3d'
import { loadBakedLight, type BakedLight } from './bakedLightShader'
import { batchLayered } from './layeredBatch3d'
import { layeredMaterial, prepareLayerUVs, type LayeredInfo } from './layeredMaterial'
import { convertLayered, MERGE_LAYERED, type LayeredMerge } from './layeredMerge3d'
import { BATCHED_LIMITS, WEBGL2_LIMITS, type ArrayLimits } from './layeredPlan3d'
import { withKtx2 } from './ktx2Textures3d'
import { BAKED_INTENSITY, glowLevel, guardMaterial, imageGlowLevel } from './lighting'
import { dropMarkerObjects } from './markerObjects3d'
import { readPlacedLights } from './placedLights'
import { sunAngles } from './probes3d'
import { buildShadowProxies } from './shadowProxy3d'
import { tagSurface } from './surfaceProbe3d'

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
THREE.Mesh.prototype.raycast = acceleratedRaycast

// Teintes de repli des surfaces sans couches (pas des couleurs d'interface).
const STRUCTURE_TINT = 0xb4bac2
const DECOR_TINT = 0x5c6166
const GLASS_TINT = 0x9fd4ff
// Teinte de repli des décalques pochoir pour les cartes construites sans leur couleur.
export const DECAL_TINT = 0x4f8fc0

type Family = 'structure' | 'decor' | 'seeThrough'

/**
 * Les shaders du jeu qui ne lisent que l'image déjà rendue (cartes d'effet d'écran, sans texture ni
 * couleur propre) : la vue n'a pas cet effet, leurs surfaces ne se dessinent pas plutôt que de
 * paraître en dalle pleine.
 */
const SCREEN_EFFECT_SHADERS: ReadonlySet<number> = new Set([0xc0146c52])

/**
 * Les shaders du jeu dont la texture est un pochoir : une image blanche sur fond noir sans canal
 * alpha, dont la luminance est la couverture. En jeu, seule la forme blanche est dessinée, d'une
 * couleur, au-dessus du mur derrière ; le noir est entièrement transparent.
 */
const STENCIL_DECAL_SHADERS: ReadonlySet<number> = new Set([3233303146])

interface Pochoir { couleur: [number, number, number]; opacite: number }

/**
 * decalStencilMaterial renvoie le matériau du décalque pochoir pour une texture : un standard
 * teinté dont `alphaMap` est la texture (three lit son canal vert comme couverture), sans `map`.
 * Un matériau par texture, couleur et opacité :
 * il est bâti à la première demande puis servi depuis `cache`. L'objet de texture est réutilisé
 * (jamais cloné) pour conserver la transformation de ses UV (`KHR_texture_transform`).
 */
export function decalStencilMaterial(texture: THREE.Texture, cache: Map<string, THREE.MeshStandardMaterial>, pochoir?: Pochoir): THREE.MeshStandardMaterial {
  const signature = `${texture.uuid}|${pochoir ? `${pochoir.couleur.join(',')}|${pochoir.opacite}` : 'repli'}`
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
  /** GlobalID du shader de matériau du jeu. */
  shader?: number
  /** Vitre du jeu : dessinée par réfraction, son mélange reste opaque. */
  vitre?: boolean
  couches?: LayeredInfo
  pochoir?: Pochoir
  /** Couleur à plat (RVB linéaire) d'un matériau sans couches : l'objet posé d'une variante Forge. */
  teinte?: [number, number, number]
  /** Its light is a picture (sign, screen, hologram), not a light mask (`glowOf`). */
  emissionImage?: boolean
}

/** Les surfaces d'un GLB de la vue (la carte, ou un calque posé sur elle), matériaux de la vue posés. */
export interface SurfaceModel {
  root: THREE.Object3D
  /** Les surfaces opaques de structure : celles que le rayon vers le sol interroge. */
  pickables: THREE.Mesh[]
  /** Les surfaces translucides : exclues de l'occlusion ambiante. */
  seeThrough: THREE.Mesh[]
  /** Toutes les surfaces dessinées : celles que les sondes d'environnement éclairent. */
  surfaces: THREE.Mesh[]
  /** Libère géométries, index et matériaux du modèle (pas la lumière cuite qu'il a reprise). */
  dispose(): void
}

export interface MapModel extends SurfaceModel {
  ciel: { texture: THREE.Texture | null; color: [number, number, number] | null } | null
  sunStrength: number
  /** The game's sun color published with the mesh (`sunColorOf`, linear RGB), null when absent. */
  sunColor: [number, number, number] | null
  /** Le soleil du jeu publié dans le maillage (cf. `sunAngles`), null s'il n'y est pas. */
  sun: { azimuth: number; elevation: number } | null
  /** La lumière cuite du jeu, greffée sur les matériaux de la carte ; null si le GLB n'en porte pas. */
  baked: BakedLight | null
  /**
   * batchDraws dessine en un maillage les surfaces à matériau fusionné d'un même nœud et d'un même
   * matériau (`batchLayered`) ; une fois, après la capture des sondes. Sans fusion, rien.
   */
  batchDraws(): void
}

type Step = 'materials' | 'index'

/**
 * Le rapport de progression d'une étape : `done` / `total` sont les unités déjà traitées sur le
 * total connu (images décodées pour `materials`, index de rayons bâtis pour `index`). Sans compte,
 * l'étape n'est qu'un repère (début de bande).
 */
export type StepCallback = (step: Step, done?: number, total?: number) => void

/** Un GLB décodé, ses surfaces rangées par famille et les matériaux de la vue qu'il possède. */
interface Prepared {
  scene: THREE.Object3D
  groups: Record<Family, THREE.Mesh[]>
  owned: THREE.Material[]
  /** La fusion des matériaux en couches (`convertLayered`), null sans fusion. */
  merge: LayeredMerge | null
  /**
   * Le décodeur du GLB (`GLTFParser`) : la seule référence qui tient les données de la
   * pré-fusion en vie (JSON, chunk binaire, buffer principal, accessors, images décodées).
   * Lu par `prepareSurfaces` et `loadBakedLight` seul ; jamais retenu par le modèle rendu,
   * pour que ces données soient ramassables dès que le modèle est bâti.
   */
  parser: GLTFParser
}

/** emits : le matériau glTF porte une lumière propre (`emissiveFactor`, force par extension). */
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

/** applyGlow recopie la lumière propre du matériau du jeu, sa force ramenée à l'échelle de la vue. */
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
 * teinteVerreTeint moyenne la couleur de la première couche d'un matériau en couches (`bas`,
 * `milieu` et `haut`, ceux qui sont présents, en RVB linéaire) : la teinte de la vitre sombre du
 * jeu. Null sans couche lisible ni couleur (la vitre garde alors le verre clair).
 */
export function teinteVerreTeint(couches: LayeredInfo): [number, number, number] | null {
  const couche = couches.couches[0]
  if (!couche) return null
  const couleurs = [couche.bas, couche.milieu, couche.haut].filter((c): c is [number, number, number] => c !== undefined)
  if (couleurs.length === 0) return null
  const somme = [0, 0, 0]
  for (const c of couleurs) for (let i = 0; i < 3; i++) somme[i] += c[i]
  return [somme[0] / couleurs.length, somme[1] / couleurs.length, somme[2] / couleurs.length]
}

/**
 * loadMapModel décode le GLB de la carte et prépare ses matériaux ; `onStep` dit l'étape en cours.
 * `ktx2`: the renderer's KTX2 loader (`createKtx2Loader`), for a GLB with compressed textures.
 */
export async function loadMapModel(buffer: ArrayBuffer, onStep: StepCallback, ktx2: KTX2Loader | null = null): Promise<MapModel> {
  const prepared = await prepareSurfaces(buffer, onStep, MERGE_LAYERED ? WEBGL2_LIMITS : null, ktx2)
  const { scene, parser, owned, merge } = prepared
  // Dernière lecture du décodeur : après elle, le modèle n'en retient aucune référence et
  // les données de la pré-fusion qu'il tient (cf. `Prepared.parser`) sont ramassables.
  const lamps = readPlacedLights(scene.userData)
  const cielInfo = lireCiel(scene.userData)
  const ciel = cielInfo ? { color: cielInfo.color, texture: cielInfo.texture === null ? null : await parser.getDependency('texture', cielInfo.texture) as THREE.Texture } : null
  const baked = await loadBakedLight(scene.userData, parser, BAKED_INTENSITY, lamps)
  if (baked) for (const m of owned) baked.apply(m)
  const model = await indexSurfaces(prepared, onStep)
  let unbatch: (() => void) | null = null
  return {
    ...model,
    sunStrength: intensiteSoleil(scene.userData),
    sunColor: sunColorOf(scene.userData),
    ciel,
    sun: sunAngles(scene.userData),
    baked,
    batchDraws() {
      if (merge && !unbatch) unbatch = batchLayered(merge, model.surfaces, tightenBounds)
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
 * loadLayerModel décode un calque posé sur la carte (les objets de la variante du match), préparé
 * comme elle. Il n'a pas de lumière propre : la lumière cuite de la carte (`light`, null si elle
 * n'en porte pas) est greffée sur ses matériaux, et reste à la carte qui la libère. `ktx2`: as for
 * `loadMapModel`.
 */
export async function loadLayerModel(buffer: ArrayBuffer, light: BakedLight | null, onStep: StepCallback = quiet, ktx2: KTX2Loader | null = null): Promise<SurfaceModel> {
  // Merged like the map's, two arrays short: its surfaces are drawn as batches (layerBatch3d).
  const prepared = await prepareSurfaces(buffer, onStep, MERGE_LAYERED ? BATCHED_LIMITS : null, ktx2)
  if (light) for (const m of prepared.owned) light.apply(m)
  return indexSurfaces(prepared, onStep)
}

function quiet(): void {}

/**
 * prepareSurfaces décode le GLB, range ses surfaces par famille, leur pose les matériaux de la vue
 * (couches, découpes, lumière propre) et les étiquette pour l'inspecteur ; les nœuds `ombre*` sont
 * cachés. `mergeLimits` : les matériaux en couches opaques passent aux matériaux fusionnés
 * (`convertLayered`).
 */
/** Les matériaux de famille, les surfaces qu'ils porteront, et la liste des matériaux possédés. */
function familyMaterials(): { mats: Record<Family, THREE.MeshStandardMaterial>; groups: Record<Family, THREE.Mesh[]>; owned: THREE.Material[] } {
  const surface = { roughness: 0.8, metalness: 0, flatShading: true, side: THREE.DoubleSide }
  const mats: Record<Family, THREE.MeshStandardMaterial> = {
    // Vue de face seulement, comme en jeu : deux surfaces coplanaires dos à dos (un panneau et
    // l'envers d'une autre) ne se disputent pas les mêmes pixels. Son envers se dessine à part
    // (`buildBackFaces`), sombre et reculé : il bouche les jours sans passer devant une face.
    structure: new THREE.MeshStandardMaterial({ ...surface, color: STRUCTURE_TINT, side: THREE.FrontSide }),
    // Le décor grossier (coques extérieures, fonds) n'est vu que de face, comme en jeu : une coque
    // vue de l'intérieur ne couvre pas une verrière.
    decor: new THREE.MeshStandardMaterial({ ...surface, color: DECOR_TINT, side: THREE.FrontSide }),
    seeThrough: new THREE.MeshStandardMaterial({
      color: GLASS_TINT, roughness: 0.1, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide,
    }),
  }
  return { mats, groups: { structure: [], decor: [], seeThrough: [] }, owned: Object.values(mats) }
}

/** Le contexte de pose des matériaux pendant le parcours des surfaces du GLB. */
interface MaterialContext {
  mats: Record<Family, THREE.MeshStandardMaterial>
  owned: THREE.Material[]
  /** Un matériau à couches par composition, sa promesse partagée entre les surfaces de même composition. */
  layered: Map<string, Promise<THREE.MeshStandardMaterial>>
  /** Les promesses de pose des matériaux à couches, attendues à la fin du parcours. */
  jobs: Promise<void>[]
  /** Le décodeur du GLB, lu par les matériaux à couches avant la fin de `prepareSurfaces`. */
  parser: GLTFParser
  glowCopy(base: THREE.MeshStandardMaterial, source: THREE.MeshStandardMaterial, image: boolean): THREE.MeshStandardMaterial
  /** A see-through emitter of the game, one per game material (`seeThroughGlowMaterial`). */
  seeThroughGlow(source: THREE.MeshStandardMaterial, extras: MaterialExtras): THREE.MeshBasicMaterial
  tintCopy(base: THREE.MeshStandardMaterial, source: THREE.MeshStandardMaterial, teinte: [number, number, number]): THREE.MeshStandardMaterial
  /** La vitre teintée du jeu : elle multiplie ce qui est derrière elle par `teinte`, sans éclairage ni reflet. */
  verreTeint(teinte: [number, number, number]): THREE.MeshBasicMaterial
  /** Le décalque pochoir du jeu, partagé par texture, couleur et opacité. */
  decalStencil(texture: THREE.Texture, pochoir?: Pochoir): THREE.MeshStandardMaterial
}

/**
 * placeMaterial pose le matériau de la vue sur une surface : à découpe (garde la texture du jeu),
 * copie lumineuse, copie teintée, ou matériau à couches (promesse partagée par composition, posée
 * à sa résolution dans `ctx.jobs`). Un matériau en couches à découpe porte le masque dans l'alpha
 * de sa couleur de base : le matériau de couches applique un alpha test sur sa texture, au lieu
 * de passer par un matériau MASK à part.
 */
function placeMaterial(o: THREE.Mesh, source: THREE.MeshStandardMaterial, extras: MaterialExtras, key: Family, ctx: MaterialContext): void {
  const image = extras.emissionImage === true
  if (source.alphaTest > 0 && source.map && !extras.couches) {
    // Matériau à découpe sans couches (glTF `MASK`) : il garde sa texture, ses trous se voient.
    const m = ctx.mats[key].clone()
    m.color.set(1, 1, 1)
    m.map = source.map
    m.alphaTest = source.alphaTest
    applyGlow(m, source, image)
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
    // Un décalque pochoir du jeu (logos et marquages de mur) : sa texture n'est pas une image
    // opaque mais une carte de masque ; on la pose teintée au-dessus du mur derrière. Sans texture
    // de base, il garde le comportement de famille d'aujourd'hui.
    o.material = ctx.decalStencil(source.map, extras.pochoir)
    return
  }
  o.material = emits(source) ? ctx.glowCopy(ctx.mats[key], source, image) : ctx.mats[key]
  if (key === 'seeThrough' && extras.vitre && extras.couches && !emits(source)) {
    const teinte = teinteVerreTeint(extras.couches)
    // Below 0.25 linear brightness, multiply blending obscures the view rather than reading as a tint.
    if (teinte && (teinte[0] + teinte[1] + teinte[2]) / 3 >= 0.25) o.material = ctx.verreTeint(teinte)
  }
  if (extras.teinte && !extras.couches && key !== 'seeThrough' && !emits(source)) o.material = ctx.tintCopy(ctx.mats[key], source, extras.teinte)
  // A light masked by a texture stays on its lit copy (`glowCopy`): the layered shader's thirteen
  // samplers plus the lighting maps leave no texture unit for the mask under WebGL 2's sixteen.
  if (extras.couches && key !== 'seeThrough' && !source.emissiveMap && prepareLayerUVs(o.geometry, extras.couches)) {
    // Un matériau à couches par composition distincte (famille, couches, lumière propre, découpe)
    // : les surfaces de même composition le partagent, et le dessin ne change de matériau qu'entre
    // elles.
    const glow = emits(source) ? `${source.emissive.getHex()}:${source.emissiveIntensity}:${image}` : ''
    const alphaTest = source.alphaTest > 0 ? `|a${source.alphaTest}` : ''
    const signature = `${key}|${glow}|${alphaTest}|${JSON.stringify(extras.couches)}`
    let shared = ctx.layered.get(signature)
    if (!shared) {
      shared = layeredMaterial(ctx.mats[key], extras.couches, ctx.parser).then((m) => {
        applyGlow(m, source, image)
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
 * prepareSurfaces décode le GLB, range ses surfaces par famille, leur pose les matériaux de la vue
 * (couches, découpes, lumière propre) et les étiquette pour l'inspecteur ; les nœuds `ombre*` sont
 * cachés. `mergeLimits` : les matériaux en couches opaques passent aux matériaux fusionnés
 * (`convertLayered`).
 */
async function prepareSurfaces(buffer: ArrayBuffer, onStep: StepCallback, mergeLimits: ArrayLimits | null, ktx2: KTX2Loader | null): Promise<Prepared> {
  // L'étape « matériaux » : le décodage des images du GLB en est l'attente longue. Le gestionnaire
  // de chargement les compte (itemStart / itemEnd, une par image) pour que la barre avance image
  // après image ; sans image, elle reste au début de la bande.
  const manager = new LoadingManager()
  manager.onProgress = (_url, done, total) => onStep('materials', done, total)
  onStep('materials', 0, 0)
  const gltf = await withKtx2(new GLTFLoader(manager), ktx2).parseAsync(buffer, '')
  dropMarkerObjects(gltf.scene)
  const { mats, groups, owned } = familyMaterials()
  // Une copie lumineuse d'un matériau de famille par matériau du jeu qui émet.
  const glowing = new Map<THREE.Material, THREE.MeshStandardMaterial>()
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
      owned.push(m)
      seeThroughGlowing.set(source, m)
    }
    return m
  }
  // Une copie teintée d'un matériau de famille par couleur à plat distincte (rugosité et métal du jeu).
  const tinted = new Map<string, THREE.MeshStandardMaterial>()
  const tintCopy = (base: THREE.MeshStandardMaterial, source: THREE.MeshStandardMaterial, teinte: [number, number, number]) => {
    const signature = `${base.uuid}|${teinte.join(',')}|${source.roughness}|${source.metalness}`
    let m = tinted.get(signature)
    if (!m) {
      m = base.clone()
      m.color.setRGB(teinte[0], teinte[1], teinte[2], THREE.LinearSRGBColorSpace)
      m.roughness = source.roughness
      m.metalness = source.metalness
      owned.push(m)
      tinted.set(signature, m)
    }
    return m
  }
  // Une vitre teintée par teinte distincte : le verre sombre du jeu (matériau `vitre` en couches),
  // posée à l'opacité de la vitre teintée au lieu du verre clair de famille.
  const verreTeint = new Map<string, THREE.MeshBasicMaterial>()
  const verreTeintCopy = (teinte: [number, number, number]) => {
    const signature = teinte.map((v) => Math.round(v * 1000) / 1000).join(',')
    let m = verreTeint.get(signature)
    if (!m) {
      m = new THREE.MeshBasicMaterial({ blending: THREE.MultiplyBlending, premultipliedAlpha: true, transparent: true, depthWrite: false, side: THREE.DoubleSide })
      m.color.setRGB(teinte[0], teinte[1], teinte[2], THREE.LinearSRGBColorSpace)
      owned.push(m)
      verreTeint.set(signature, m)
    }
    return m
  }
  // Un décalque pochoir par texture, couleur et opacité distinctes.
  const decalStencil = new Map<string, THREE.MeshStandardMaterial>()
  const decalStencilCopy = (texture: THREE.Texture, pochoir?: Pochoir) => decalStencilMaterial(texture, decalStencil, pochoir)
  const ctx: MaterialContext = { mats, owned, layered: new Map(), jobs: [], parser: gltf.parser, glowCopy, seeThroughGlow, tintCopy, verreTeint: verreTeintCopy, decalStencil: decalStencilCopy }
  const instanced: THREE.InstancedMesh[] = []
  gltf.scene.traverse((o) => {
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
    o.castShadow = key !== 'seeThrough'
    o.receiveShadow = true
  })
  await Promise.all(ctx.jobs)
  // A clump's cards are seen from both sides, as in the game. Their layered materials are theirs
  // alone (the composition names their cutout and gradient).
  const familyShared = new Set<THREE.Material>(Object.values(mats))
  for (const o of instanced) for (const m of [o.material].flat()) if (!familyShared.has(m)) m.side = THREE.DoubleSide
  for (const m of decalStencil.values()) owned.push(m)
  const drawn = [...groups.structure, ...groups.decor]
  const merge = mergeLimits ? convertLayered(drawn, [...drawn, ...groups.seeThrough], owned, mergeLimits) : null
  for (const m of owned) guardMaterial(m)
  return { scene: gltf.scene, groups, owned, merge, parser: gltf.parser }
}

/**
 * tightenBounds mesure la boîte et la sphère englobantes d'une surface sur les seuls sommets que
 * son index référence. Les surfaces d'un GLB partagent un tampon de sommets : la mesure par défaut
 * de three porte sur le tampon entier, donne à chaque surface les bornes de la carte, et plus rien
 * hors champ n'est écarté du dessin.
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
 * geometriesOf rend les géométries distinctes de `meshes` : les objets d'une variante posent une
 * même géométrie à plusieurs endroits (des nœuds qui partagent un maillage glTF), et son index de
 * rayons comme ses bornes, pris dans son repère propre, valent pour toutes ses poses.
 */
export function geometriesOf(meshes: readonly THREE.Mesh[]): THREE.BufferGeometry[] {
  return [...new Set(meshes.map((m) => m.geometry))]
}

/** indexSurfaces construit l'index de lancer de rayons (structure, translucides) et rend le modèle. */
async function indexSurfaces({ scene, groups, owned }: Prepared, onStep: StepCallback): Promise<SurfaceModel> {
  const bvh = geometriesOf([...groups.structure, ...groups.seeThrough])
  onStep('index', 0, bvh.length)
  await new Promise((r) => setTimeout(r, 0))
  // Un index de rayons par géométrie : la construction se compte, et un passage au navigateur tous
  // les quelques géométries laisse la barre se peindre sans ralentir le calcul (dix-neuf passes au
  // plus pour toute la carte).
  const pas = Math.max(1, Math.ceil(bvh.length / 19))
  for (let i = 0; i < bvh.length; i++) {
    bvh[i].computeBoundsTree()
    onStep('index', i + 1, bvh.length)
    if ((i + 1) % pas === 0) await new Promise((r) => setTimeout(r, 0))
  }
  for (const g of geometriesOf([...groups.structure, ...groups.decor, ...groups.seeThrough])) tightenBounds(g)
  const shadows = buildShadowProxies(scene, [...groups.structure, ...groups.decor])
  // Après la fusion des matériaux : l'envers lit les sommets et les index définitifs des surfaces.
  const backs = buildBackFaces(scene, groups.structure, tightenBounds)

  return {
    root: scene,
    pickables: groups.structure,
    seeThrough: groups.seeThrough,
    surfaces: [...groups.structure, ...groups.decor, ...groups.seeThrough],
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
