// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * replayScene3d.ts — the 3D replay scene: WebGL render, players, cameras.
 *
 * It owns no time: the page's player advances its image and the view calls `render(frame)`
 * once per screen frame. Cameras: first and third person on the followed player (the page's
 * viewpoint), free (orbit around it), and the orthographic top-down view (`topDownView3d`)
 * drawing the same scene straight down as one fixed map picture; it also draws the 3D view's corner minimap.
 *
 * The replay and the map are in Halo world units (1 u = 3.048 m), not meters: measured
 * median run speed 2.3 u/s, that of a Spartan. All sizes below are in u.
 *
 * The match action (shots, flights, deaths, objects, vehicles) is placed by the action
 * layers (`actionScene3d`) at each rendered frame; a surface layer can be posed on the map
 * after it (`attachLayer`) and is released with the scene.
 *
 * The video export takes the scene (`beginExport` .. `endExport`, cf. `export/replay3dExportStore`):
 * it renders at the file's size and camera, holds what the screen view asks in the meantime,
 * and `render` draws nothing while it runs.
 */
import * as THREE from 'three'
import { markStep, newProfile } from './renderProfile3d'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { framesPerSecond, frameToMs } from '@/lib/replay/replayLogic'
import { FirstPersonArms3d } from './firstPersonArms3d'
import { firstPersonFolder } from './firstPersonRig3d'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import type { Export3dSetup, ExportCamera3d, ExportTag3d, Replay3DExportSource } from '../export/replay3dExportStore'
import type { Action3dInputs } from './action3dInputs'
import { Ground, InkCache } from './actionKit'
import { buildActionScene } from './actionLayers3d'
import type { ActionScene3d } from './actionScene3d'
import type { SpartanArmory } from './armory3d'
import { attachBoneOf, drawnWeapon, makeAvatar, placeBody, releaseWeapon, showBodyFx, showWeapon, wearSpartan, type Avatar } from './avatar3d'
import { viewGripOf } from './viewGrip3d'
import { BODY_CENTER, EYE_HEIGHT } from './body3d'
import { placeTag } from './nameTags3d'
import { FreeFly } from './freeFly3d'
import { attachRenderer, detachRenderer, getSessionKtx2Loader } from './sessionRenderer3d'
import { farthestCorner, Lighting } from './lighting'
import { creerCiel, setCloudClock } from './ciel3d'
import type { Look3d } from './look3d'
import type { BakedLight } from './bakedLightShader'
import type { MapModel, SurfaceModel } from './mapModel'
import { buildPostFx, PASS_NAMES, type PostFx3d } from './postFx3d'
import { currentPerfToggles, installPerfToggles, PERF_TOGGLES_DEFAULT, type PerfToggles } from './perfToggles3d'
import { screenPixelRatio, SettledResize } from './settledResize3d'
import { GpuTimer } from './gpuTimer3d'
import { BACK_FACE_NAME } from './backFaces3d'
import { batchCulling, batchLayer, type LayerBatches } from './layerBatch3d'
import { drawnBy } from './surfaceProbe3d'
import { warmUp3d } from './warmup3d'
import { serialize } from './serialiser3d'
import { now, measureDuration, timedSync } from './perf3d'
import { probeSurface, type SurfaceProbe } from './surfaceProbe3d'
import { aimDirThree, toThree, type PlayerState3d, type Tracks3d } from './tracks3d'
import { scriptClockOf, type CameraScript, type ScriptClockView, type ScriptSubjects } from './cameraScript3d'
import { activeHolds, holdStateAt, lerpHeading, type Hold, type HoldState } from './hold3d'
import { holdMix } from './holdPose3d'
import { NO_SHIELD_FX } from './shields3d'
import { type ClipMix } from './clipSample3d'
import { PoseClips } from './poseClips3d'
import { type SpartanClip } from './clips3d'
import { ScopeView3d } from './scopeView3d'
import { ReplayExportScene3d } from './replayExportScene3d'
import { measureOriginAboveFloor, ReplayCamera3d } from './replayCamera3d'
import type { SceneView3d } from './topDownLogic'
import { TopDownView3d } from './topDownView3d'
import type { DeadPose, MarkerPose } from './playerMarkers3d'
import { clesRigsRejeu } from './riggedWeapons3d'
import { GAME_FOV_DEFAULT, verticalFovOf } from '../model/fovLogic'
import { labelKeyOf, magsForWeapon, scopeOf } from '../model/scopeLogic'
import { weaponModelKey, type WeaponModels } from './weaponModels3d'
import { readRedReticle, type HeldWeapon } from './redReticle3d'
import type { FilmAllegiance } from '@/lib/replay/filmAllegiance'
export type CameraMode3d = 'fp' | 'tp' | 'free'
/** The followed player: alive, dead, not yet spawned, or no followed player. */
export type PovStatus = 'alive' | 'dead' | 'unspawned' | 'none'
// Free camera start: behind and above the followed player (u).
const FREE_BACK = 3
const FREE_RISE = 1.5
// Play area: the replay positions' box, grown by PLAY_MARGIN around and PLAY_HEADROOM above (roofs, bridges).
const PLAY_MARGIN = 15
const PLAY_HEADROOM = 20
// Sun for a map whose mesh does not publish the game's: chosen by eye on Recharge.
const SUN_FALLBACK = { azimuth: 217, elevation: 58 }
const SKY_TINT = 0x9fb4c8
const FOG_NEAR = 60
const FOG_FAR = 220
/** How long the video export waits, per frame, for a model a frame asked for (ms). */
const EXPORT_LOAD_WAIT_MS = 20_000
export class ReplayScene3d implements Replay3DExportSource {
  private readonly renderer: THREE.WebGLRenderer
  private readonly labels = new CSS2DRenderer()
  private readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  private readonly orbit: OrbitControls
  private readonly fly = new FreeFly()
  /** The compositor: ambient occlusion and team outline (`postFx3d`). */
  private readonly post: PostFx3d
  private readonly lighting: Lighting
  private readonly raycaster = new THREE.Raycaster()
  private readonly avatars = new Map<string, Avatar>()
  /**
   * warmUp compiles the scene and warms the first frame's draw (shaders, textures, outline passes).
   * It no longer rebuilds the avatars (the first frame's pose, `placeAvatars`, already builds them)
   * nor pre-poses the corpse copies (`Corpses3d.take` makes each copy lazily at the death; the
   * hidden pre-copies are fronted by `prepCorpses` after the first frame is on screen).
   */
  readonly warmUp = serialize(async () => {
    try {
      await warmUp3d(this.renderer, this.scene, this.camera, { roots: [...Array.from(this.avatars.values(), (a) => a.group), ...(this.arms?.loadedRoots() ?? [])], detaches: this.weaponModels?.loadedSources() ?? [], composer: this.post.composer, avatars: [...this.avatars.values()], outline: this.post.outline })
    } catch (error) { console.warn('3D replay: prewarming unavailable', error) }
  })
  /** The posed map: session-cached (`sessionAssetCache3d`) by its served path, not owned by this scene. */
  private model: MapModel | null = null
  private ciel: ReturnType<typeof creerCiel> | null = null
  private layer: SurfaceModel | null = null
  /** The play area's center (three axes) and its half diagonal (u), for the haze (`Lighting.fitHaze`). */
  private playCenter: THREE.Vector3 | null = null
  private playReach = 0
  /** The posed layer's batches (layerBatch3d), released with it. */
  private layerBatches: LayerBatches | null = null
  private ground: Ground | null = null
  private tracks: Tracks3d | null = null
  private mode: CameraMode3d = 'fp'
  /** The drawing view: perspective (3D) or the orthographic top-down (`topDownView3d`). */
  private view: SceneView3d = '3d'
  /** The top-down view, built when the map is attached; null without a map. */
  private top: TopDownView3d | null = null
  /** The player drawn for each biped slot at the posed frame, and whether he is the first-person view (ttachBone). */
  private readonly drawnSlots = new Map<number, { xuid: string; firstPerson: boolean }>()
  private topPlayers: MarkerPose[] = []; private topDead: DeadPose[] = [] // the living and the dead, posed for the top-down view and the minimap
  /** The player the top-down view follows and rings: the page's viewpoint, null in free camera. */
  private topFollowed: string | null = null
  private povXuid: string | null = null
  private originAboveFloor = 0
  private lastFrame = 0
  private lastStatus: PovStatus = 'none'
  private readonly exportScene: ReplayExportScene3d
  private readonly cameraPlacement: ReplayCamera3d
  private action: ActionScene3d | null = null
  private arms: FirstPersonArms3d | null = null
  /** The first-person prep (`arms.preparePlayer`) already started for the followed player. */
  private armsPlayerReady: string | null = null
  /** The hidden corpse copies have been fronted (`prepCorpses`); they are otherwise made lazily per death. */
  private corpsesPrepped = false
  private doc: ReplayDocumentReady | null = null
  private readonly scopeView = new ScopeView3d(verticalFovOf(GAME_FOV_DEFAULT))
  /** The game's FOV setting (horizontal degrees at 16:9): the camera's base field and a camera script's base. */
  private gameFovDeg = GAME_FOV_DEFAULT
  /** The players' feet for a camera script's player anchors (`scriptSubjectAt`). */
  private readonly scriptSubjects: ScriptSubjects = { feetAt: (xuid, docMs) => this.scriptSubjectAt(xuid, docMs / this.msPerFrame) }
  /** The pose clips on demand (`poseClips3d`), for a held player (docs/design/hold.md); disposed with the scene. */
  private readonly poseClips = new PoseClips()
  /** The script clocks, built once per set script object (`scriptClockOf`). */
  private readonly scriptClocks = new WeakMap<CameraScript, ScriptClockView>()
  /** The holds active at the current script time, cached on (script, time) by `currentHolds`. */
  private holdsCache: { script: CameraScript | null; sMs: number; holds: Map<string, Hold> } | null = null
  private fps = 30
  private weaponModels: WeaponModels | null = null
  private armory: SpartanArmory | null = null
  /** The followed player's first-person weapon (key and name), null with no key; `rig`: the arms+weapon rig is what's drawn. */
  inView: { key: string; name: string; rig: boolean } | null = null
  private readonly actionRoot = new THREE.Group()
  private feetDrop = 0
  private playTop = 0
  players: readonly { xuid: string; name: string }[] = []
  readonly profile = newProfile()
  /** The console's performance knobs (perfToggles3d), read at each frame. */
  private readonly knobs: PerfToggles = { ...PERF_TOGGLES_DEFAULT }
  private lookOcclusion = true
  /** The look's glow animation (`Look3d.glowAnimation`): off, the self-lit surfaces stay still and nothing runs per frame. */
  private lookGlow = true
  /** The match duration of a document frame (ms), the glow animation's clock (`frameToMs`). */
  private msPerFrame = 1000 / 30
  /** The match duration of a document frame (ms). */
  get frameMs(): number { return this.msPerFrame }
  private readonly gpu: GpuTimer
  /** Frames drawn by `render`, for the bloom's GPU timing on every other one. */
  private frameCount = 0
  private readonly minimapCost = { calls: 0, triangles: 0 }
  /** The back-face meshes of the map and layer (the `backFaces` knob), found when a root is attached. */
  private backFaces: THREE.Object3D[] = []
  private backFacesShown = true
  constructor(host: HTMLElement) {
    // One WebGLRenderer for the whole session (`sessionRenderer3d`): its compiled shader programs
    // and uploaded GPU buffers and textures survive this scene's own teardown, for the next match.
    this.renderer = attachRenderer(host)
    // During an export, the canvas renders at the file's format without changing box (full image on screen).
    this.renderer.domElement.style.objectFit = 'contain'
    Object.assign(this.labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' })
    host.appendChild(this.labels.domElement)
    this.scene.background = new THREE.Color(SKY_TINT)
    this.scene.fog = new THREE.Fog(SKY_TINT, FOG_NEAR, FOG_FAR)
    // The scene never moves: without its own update each frame, `freezeStatic` roots are skipped by the matrix walk.
    this.scene.matrixAutoUpdate = false
    this.lighting = new Lighting(this.renderer, this.scene)
    this.camera = new THREE.PerspectiveCamera(verticalFovOf(GAME_FOV_DEFAULT), 1, 0.02, 700)
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement)
    this.orbit.enabled = false
    this.post = buildPostFx(this.renderer, this.scene, this.camera)
    this.gpu = new GpuTimer(this.renderer)
    installPerfToggles()
    const self = this
    this.cameraPlacement = new ReplayCamera3d({
      get tracks() { return self.tracks }, get povXuid() { return self.povXuid }, get mode() { return self.mode },
      get action() { return self.action }, get originAboveFloor() { return self.originAboveFloor },
      get subjects() { return self.scriptSubjects }, get gameFov() { return self.gameFovDeg },
      camera: this.camera, pickables: () => self.groundSurfaces(), raycaster: this.raycaster,
      setLens: (lens) => self.post.setLens(lens), // a playing script's depth of field, screen and export alike
    })
    this.exportScene = new ReplayExportScene3d({
      renderer: this.renderer, camera: this.camera, orbit: this.orbit, labels: this.labels,
      post: this.post, lighting: this.lighting, avatars: this.avatars,
      get action() { return self.action }, get hasTracks() { return !!self.tracks },
      get mode() { return self.mode }, set mode(value) { self.mode = value },
      get view() { return self.view }, set view(value) { self.view = value },
      get povXuid() { return self.povXuid }, set lastFrame(value) { self.lastFrame = value },
      get lastFrame() { return self.lastFrame },
      applyPov: (xuid) => this.applyPov(xuid), applyMode: (mode) => this.applyMode(mode),
      placeAvatars: (frame) => this.placeAvatars(frame), placeCamera: (frame, dt) => this.cameraPlacement.placeCamera(frame, dt),
      placeFirstPerson: (frame) => { this.placeScope(frame); this.arms?.place(this.camera) },
      retagTags: () => this.retagTags(),
      setSkyClock: (seconds) => { if (this.ciel) setCloudClock(this.ciel, seconds) },
      setGlowClock: (seconds) => this.animateGlow(seconds),
      hideTopDown: () => this.top?.idle(),
    })
  }
  /** attach poses the map and the players, lights the play area, and captures the environment. */
  attach(model: MapModel, tracks: Tracks3d, colorOf: (xuid: string) => THREE.Color): void {
    this.model = model
    this.tracks = tracks
    model.glowAnimation.setEnabled(this.lookGlow)
    // it3d:map:attach:* splits the attach phase into named parts so the 4.7 s can be read piece by
    // piece in the Timings track (scene graph add, the probe captures that render the map, the sky,
    // the batched draw setup, the avatars, and the floor raycast that places the camera).
    const seg = (name: string, run: () => void): void => {
      const t0 = now()
      run()
      measureDuration(`map:attach:${name}`, now() - t0)
    }
    seg('scene', () => {
      this.scene.add(model.root)
      this.lighting.setStaticCasters(this.mapRoots())
      this.lighting.setSunStrength(model.sunStrength)
      this.lighting.setSunColor(model.sunColor)
    })
    const playPoints = tracks.players
      .flatMap((p) => tracks.allPoints(p.xuid))
      .map((p) => new THREE.Vector3(...toThree(p.x, p.y, p.z)))
    if (playPoints.length > 0) {
      const playBox = new THREE.Box3().setFromPoints(playPoints).expandByScalar(PLAY_MARGIN)
      playBox.max.y += PLAY_HEADROOM
      this.playCenter = playBox.getCenter(new THREE.Vector3())
      this.playReach = farthestCorner(playBox, this.playCenter)
      this.lighting.fit(playBox)
      const sun = model.sun ?? SUN_FALLBACK
      this.lighting.setSun(sun.azimuth, sun.elevation)
      this.lighting.takeGameLight(model.baked) // game light active during the probe captures
      seg('probes', () => {
        // A model reused from the session cache keeps its previous match's probe copies until
        // this reset: without it `adoptCopies` would pile new ones on top on every reattach.
        model.glowAnimation.resetCopies()
        this.lighting.captureProbes(playPoints.map((p) => p.clone().setY(p.y + EYE_HEIGHT)), model.surfaces)
        model.glowAnimation.adoptCopies(model.surfaces) // the probes copied shared materials
      })
      this.playTop = playBox.max.y
      this.top = new TopDownView3d({ scene: this.scene, renderer: this.renderer, sun: this.lighting.sun, heights: playPoints.map((p) => p.y), walked: new THREE.Box3().setFromPoints(playPoints) })
    }
    if (model.ciel) {
      this.ciel = creerCiel(model.sun ?? SUN_FALLBACK, model.ciel.texture, model.ciel.color, model.sunStrength)
      this.scene.add(this.ciel)
    }
    this.top?.sync(this.ciel, this.mapRoots())
    seg('batch', () => {
      // After the probes are assigned: surfaces sharing a material are drawn together.
      model.batchDraws()
      freezeStatic(model.root)
      this.findBackFaces()
    })
    seg('avatars', () => {
      for (const p of tracks.players) {
        const a = makeAvatar(this.scene, p.name, colorOf(p.xuid))
        a.group.visible = false; this.avatars.set(p.xuid, a)
      }
    })
    this.players = tracks.players.map((p) => ({ xuid: p.xuid, name: p.name }))
    const allPoints = tracks.players.flatMap((p) => tracks.allPoints(p.xuid))
    seg('origin', () => {
      // The map's structure alone: the layer is posed later (`attachLayer`), which re-measures the
      // drop against the map and the layer so a Forge map's players land on the layer's floor.
      this.feetDrop = measureOriginAboveFloor(allPoints, this.groundSurfaces(), this.raycaster)
    })
    this.scene.add(this.actionRoot); this.prepareAvatars()
  }

  /** enableAction poses the action layers (shots, flights, deaths, objects, vehicles); `inputs` is re-read each frame. */
  enableAction(doc: ReplayDocumentReady, inputs: () => Action3dInputs): void {
    const tracks = this.tracks
    if (!tracks || !this.model || this.action) return
    this.doc = doc
    this.fps = framesPerSecond(doc)
    this.msPerFrame = frameToMs(1, doc)
    this.ground = new Ground(this.groundSurfaces(), this.playTop)
    this.action = buildActionScene({
      doc,
      tracks,
      ground: this.ground,
      ink: new InkCache(new THREE.Color(0.8, 0.8, 0.8)),
      root: this.actionRoot,
      originAboveFloor: this.feetDrop,
      inputs,
      playerFeet: (xuid, frame) => this.playerFeet(xuid, frame),
      slotState: (slot, frame) => tracks.sampleSlot(slot, frame),
      weaponModel: (id) => this.weaponModels?.model(id) ?? null,
      flagModel: (id, team, ink) => this.weaponModels?.flagModel(id, team, ink) ?? null,
      grenadeModel: (rank) => this.weaponModels?.grenade(rank) ?? null,
      spartanModel: () => this.weaponModels?.spartan() ?? null,
      dressOf: (xuid) => this.armory?.dress(xuid) ?? null,
      armory: () => this.armory,
      drawnWeapon: (xuid) => drawnWeapon(this.avatars.get(xuid)),
      firstPersonSlot: (f) => (this.mode === 'fp' && this.povXuid ? tracks.sample(this.povXuid, f)?.slot ?? null : null),
      rigMuzzle: (held, out) => this.arms?.muzzleView(held, out) ?? false,
      rigMuzzleWorld: (pos, axe) => this.arms?.muzzleWorld(pos, axe) ?? false, firstPersonLeftHand: (out) => this.arms?.leftHandWorld(out) ?? null,
      scopeMounted: () => this.scopeView.mounted,
      attachBone: (slot, node, out) => {
        const d = this.drawnSlots.get(slot)
        return d ? attachBoneOf(this.avatars.get(d.xuid), node, d.firstPerson, this.arms ? (name, m) => this.arms?.boneWorld(name, m) ?? false : null, out) : 'none'
      },
      weaponLibrary: () => this.weaponModels?.base ?? null,
      firstPersonEffectAnchor: (key, marker, out, instance) => this.arms?.effectAnchor(key, marker, out, instance) ?? false,
      firstPersonAnchorMiss: () => (this.arms ? this.arms.anchorMiss : 'no first-person arms'),
      weaponClipSeconds: (key, action) => this.arms?.clipDuration(key, action) ?? null,
      flashes: this.lighting.flashes, baked: this.model?.baked ?? null, probeAt: (p) => this.lighting.probeAt(p),
    })
    this.preloadRigs()
  }

  /** preloadRigs: record the weapons the match carries for the first-person preload (no download yet). */
  private preloadRigs() { if (this.doc) this.arms?.preload(clesRigsRejeu(this.doc)) }

  /** startRigPreload: arm the recorded first-person preload; called once the load gate is idle so it starts after the first frame. */
  startRigPreload(): void { this.arms?.armPreload() }

  /**
   * warmUpPlayer: starts the first-person prep (piece loads, then the arm paint) for EVERY
   * weapon rig the followed player carries during the film, not only the one in hand, so a
   * weapon switch finds its coat ready instead of dropping the arms to the static gun for the
   * whole compute. Runs once after the first frame is on screen; a followed-player change is
   * picked up by placeAvatars (the armsPlayerReady guard).
   */
  warmUpPlayer(): void {
    const arms = this.arms
    const xuid = this.povXuid
    if (!arms || !xuid) return
    arms.preparePlayer(xuid)
  }

  /**
   * setWeaponModels poses the source of the weapon and Spartan models; null: none. The models are
   * session-cached (`sessionAssetCache3d`) by their served path and are NOT disposed here: the
   * caller (`Replay3DView`) releases its hold, which disposes them only when evicted.
   */
  setWeaponModels(models: WeaponModels | null): void {
    for (const a of this.avatars.values()) wearSpartan(a, null)
    this.weaponModels = models
    this.arms?.dispose()
    this.arms = models ? new FirstPersonArms3d(this.scene, firstPersonFolder(models.base), models.gate, this.model?.baked ?? null, (p) => this.lighting.probeAt(p), this.textureLoader) : null
    if (this.arms) { const loading = this.arms.load(); void (models?.gate?.track(loading) ?? loading) }
    this.armsPlayerReady = null
    this.preloadRigs()
    this.prepareAvatars()
  }

  /** magnifications is the zoom magnifications of the weapon of model key `key` from the weapon index, or null when it has none (yet, or at all). */
  magnifications(key: string): number[] | null {
    return this.weaponModels?.reticles.magnifications(key) ?? null
  }

  /** setSpartanArmory poses the match players' armor (`armory3d`), owned by the scene; the previous one is released after the players return it; null: the default armor for all. */
  setSpartanArmory(armory: SpartanArmory | null): void {
    const source = this.weaponModels?.spartan() ?? null
    for (const a of this.avatars.values()) wearSpartan(a, source, null, this.model?.baked ?? null)
    this.armory?.dispose()
    this.armory = armory
    this.prepareAvatars()
  }

  /**
   * textureLoader: the session's KTX2 loader (`sessionRenderer3d`, bound to the shared renderer),
   * used by the map and the layers posed on it for GLBs whose textures are GPU-compressed.
   */
  get textureLoader(): KTX2Loader { return getSessionKtx2Loader() }

  /** mapLight: the baked light of the posed map that its layers reuse; null without a map or a light. */
  get mapLight(): BakedLight | null { return this.model?.baked ?? null }

  /** attachLayer poses one layer on the map (the previous one is removed); false without a posed map: the layer stays with the caller, who releases it. */
  attachLayer(layer: SurfaceModel): boolean {
    if (!this.model) return false
    this.detachLayer()
    this.layer = layer
    layer.glowAnimation.setEnabled(this.lookGlow)
    this.scene.add(layer.root)
    if (this.playCenter) {
      const reach = farthestCorner(new THREE.Box3().setFromObject(layer.root), this.playCenter)
      this.lighting.fitHaze(this.playReach, reach)
    }
    this.lighting.setStaticCasters(this.mapRoots())
    this.lighting.lightLayer(layer.surfaces)
    // See `attach`: a layer reused from the session cache keeps its previous match's probe copies
    // until this reset.
    layer.glowAnimation.resetCopies()
    layer.glowAnimation.adoptCopies(layer.surfaces)
    // After the probes chose each surface's material: the batches share it.
    this.layerBatches = batchLayer(layer.root)
    freezeStatic(layer.root)
    this.findBackFaces()
    this.ground?.setPickables(this.groundSurfaces())
    this.remeasureFloorDrop()
    this.top?.sync(this.ciel, this.mapRoots())
    return true
  }

  /**
   * detachLayer removes the posed layer from the scene; nothing without one. The layer itself is
   * session-cached (`sessionAssetCache3d`) by its served path and is NOT disposed here: its owner
   * (`useVariantLayer`) releases its hold on the cache entry, which disposes it only when evicted.
   */
  detachLayer(): void {
    const layer = this.layer
    if (!layer) return
    this.layer = null
    this.layerBatches?.dispose()
    this.layerBatches = null
    this.scene.remove(layer.root)
    this.lighting.fitHaze(this.playReach, this.playReach)
    this.lighting.setStaticCasters(this.mapRoots())
    this.ground?.setPickables(this.groundSurfaces())
    this.remeasureFloorDrop()
    this.top?.sync(this.ciel, this.mapRoots())
    this.lighting.releaseLayer(layer.surfaces)
  }

  /** setLook applies the drawer's lighting settings: shadows, reflections, ambient occlusion, bloom. */
  setLook(look: Look3d): void {
    this.lighting.setLook(look)
    this.lookOcclusion = look.ambientOcclusion
    this.post.gtao.enabled = look.ambientOcclusion
    // Off, the pass leaves the composer: the video export (same composer) follows the drawer too.
    this.post.setBloom(look.bloom)
    // Off, the still light is written back once; the export reads the same flag (`animateGlow`).
    this.lookGlow = look.glowAnimation
    this.model?.glowAnimation.setEnabled(look.glowAnimation)
    this.layer?.glowAnimation.setEnabled(look.glowAnimation)
  }

  /**
   * animateGlow poses the game's animated self-lit surfaces at MATCH `seconds` (the screen's frame
   * and the export's frame alike, never a wall clock); nothing while the look turns it off.
   */
  private animateGlow(seconds: number): void {
    if (!this.lookGlow) return
    this.model?.glowAnimation.update(seconds)
    this.layer?.glowAnimation.update(seconds)
  }

  /** setFovPreference applies the game's field-of-view setting (horizontal degrees at 16:9): the camera's base vertical field. */
  setFovPreference(gameFovDeg: number): void {
    this.gameFovDeg = gameFovDeg
    this.scopeView.setBaseFov(this.camera, verticalFovOf(gameFovDeg))
  }

  /** setCameraScript sets the camera script driving the free camera, or null to stop it. */
  setCameraScript(script: CameraScript | null): void { this.cameraPlacement.setScript(script) }
  /** setCameraScriptTime sets the script's current time (script ms). */
  setCameraScriptTime(sMs: number): void { this.cameraPlacement.setScriptTime(sMs) }

  /**
   * captureCamera: the camera's eye and look target in GAME coordinates (z up) and its vertical
   * field of view in degrees, for a camera script's key.
   */
  captureCamera(): { position: [number, number, number]; target: [number, number, number]; verticalFov: number } {
    const p = this.camera.position
    const t = this.orbit.target
    return { position: [p.x, -p.z, p.y], target: [t.x, -t.z, t.y], verticalFov: this.camera.fov }
  }

  /**
   * currentHolds: the holds active at the current script time, by xuid (`activeHolds`); empty when
   * the camera is not scripted. Cached on (script, time) so a frame's many reads resolve once.
   */
  private currentHolds(): Map<string, Hold> {
    const script = this.cameraPlacement.activeScript()
    const sMs = this.cameraPlacement.scriptTime()
    const c = this.holdsCache
    if (c && c.script === script && c.sMs === sMs) return c.holds
    const holds = script ? activeHolds(script.holds ?? [], sMs) : new Map<string, Hold>()
    this.holdsCache = { script, sMs, holds }
    return holds
  }

  /** scriptClock: the script's clock view, built once per script object. */
  private scriptClock(script: CameraScript): ScriptClockView {
    let c = this.scriptClocks.get(script)
    if (!c) {
      c = scriptClockOf(script)
      this.scriptClocks.set(script, c)
    }
    return c
  }

  /**
   * holdOf: a player's hold at the current script time: the hold, the film's sample at the hold's
   * start frame (`at`), the start frame itself, and the pose state (`holdStateAt`); null when the
   * camera is not scripted, the player is not held, the film has no sample at the start (the
   * player falls back to the film), or the rejoin blend has fully run out.
   */
  private holdOf(xuid: string): { hold: Hold; held: PlayerState3d; atFrame: number; state: HoldState } | null {
    const script = this.cameraPlacement.activeScript()
    if (!script || !this.tracks) return null
    const hold = this.currentHolds().get(xuid)
    if (!hold) return null
    const atFrame = this.scriptClock(script).docMsAt(hold.at) / this.msPerFrame
    const held = this.tracks.sample(xuid, atFrame) ?? this.tracks.lastLifeBefore(xuid, atFrame)
    if (!held) return null
    const state = holdStateAt(hold, this.cameraPlacement.scriptTime(), { h: held.h, p: held.p })
    if (!state) return null
    return { hold, held, atFrame, state }
  }

  /**
   * holdClip: a hold's clip for player `a`: a gameplay clip of the Spartan's own catalog, else a
   * pose clip from the pose catalog (null while it loads; the film's pose is held until it does).
   */
  private holdClip(a: Avatar, name: string): SpartanClip | null {
    return a.spartan?.rig.clips?.clips.get(name) ?? this.poseClips.get(name) ?? null
  }

  /**
   * scriptSubjectAt: a player's feet in GAME coordinates (z up) and heading in game degrees at a
   * frame, for a camera script's player anchors (aboard a vehicle, the vehicle's position);
   * null when the player has no state there. A held player answers with the held body (feet at
   * the hold's start, the hold's heading), so a key anchored on them orbits a body that stays put.
   */
  scriptSubjectAt(xuid: string, frame: number): { x: number; y: number; z: number; h: number } | null {
    const held = this.holdOf(xuid)
    // The feet use the drop the bodies are drawn with (`placeAvatars`: `originAboveFloor`), so an
    // anchor lines up with the body on screen.
    if (held) return { x: held.held.x, y: held.held.y, z: held.held.z - this.originAboveFloor, h: held.state.heading }
    const tracks = this.tracks
    if (!tracks) return null
    const s = tracks.sample(xuid, frame) ?? tracks.lastLifeBefore(xuid, frame) ?? tracks.firstLifeAfter(xuid, frame)
    const rider = this.action?.riderAt(xuid, frame)
    if (rider) {
      const action = this.action
      return { x: rider.x, y: -rider.z, z: rider.y, h: action?.riderHeadingAt(xuid, frame) ?? (s?.h ?? 0) }
    }
    if (!s) return null
    return { x: s.x, y: s.y, z: s.z - this.originAboveFloor, h: s.h }
  }
  setPov(xuid: string | null): void {
    if (this.exportScene.held) this.exportScene.held.pov = xuid
    else this.applyPov(xuid)
  }
  setMode(mode: CameraMode3d): void {
    if (this.exportScene.held) this.exportScene.held.mode = mode
    else this.applyMode(mode)
  }

  /** setView chooses the drawing view: the perspective 3D view or the orthographic top-down. */
  setView(view: SceneView3d) { if (this.exportScene.held) this.exportScene.held.view = view; else this.view = view }

  /** setTopFollowed: the player the top-down view rings and tells floors against; null (free camera): the living players' median. */
  setTopFollowed(xuid: string | null): void { this.topFollowed = xuid }
  /** setMinimap shows or hides the corner minimap over the 3D view (first and third person). */
  setMinimap(on: boolean): void { this.top?.setMinimap(on) }
  /** minimapHit — a canvas point (x, y in CSS px from the canvas's top left) on the corner minimap, while it is drawn. */
  minimapHit(x: number, y: number): boolean { return this.top?.minimapHit(x, y) ?? false }
  /** The canvas the renderer draws to; the page lays its chrome over it. */
  get canvas(): HTMLCanvasElement { return this.renderer.domElement }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return
    if (this.exportScene.held) {
      this.sizer.cancel()
      this.holdSize(width, height)
    } else {
      this.sizer.request(width, height)
    }
  }

  /** The buffers follow the window once its size settles (`settledResize3d`); the box and aspect at once. */
  private readonly sizer = new SettledResize(
    (width, height) => {
      const style = this.renderer.domElement.style
      style.width = `${width}px`
      style.height = `${height}px`
      this.camera.aspect = width / height
      this.camera.updateProjectionMatrix()
      this.labels.setSize(width, height)
    },
    (width, height) => {
      if (this.exportScene.held) this.holdSize(width, height)
      else this.exportScene.applySize(width, height, true)
    },
  )

  /** holdSize: an on-screen size reported during an export, applied when the export ends. */
  private holdSize(width: number, height: number): void {
    const held = this.exportScene.held
    if (!held) return
    held.width = width
    held.height = height
  }

  /** probe renders the map (or layer) surface under the screen point (`clientX`, `clientY`); null off the map. */
  probe(clientX: number, clientY: number): SurfaceProbe | null {
    const box = this.renderer.domElement.getBoundingClientRect()
    if (!this.model || box.width === 0 || box.height === 0) return null
    const ndc = new THREE.Vector2(((clientX - box.left) / box.width) * 2 - 1, -((clientY - box.top) / box.height) * 2 + 1)
    const roots = this.layer ? [this.model.root, this.layer.root] : [this.model.root]
    return probeSurface(roots, this.camera, ndc)
  }

  /**
   * primeFirstFrame poses the scene at frame `frame` WITHOUT drawing it: `render`'s pose half, run
   * under the loading screen. It starts the loads the first frame shows (the held first-person rig,
   * gated) and compiles the scene's shaders in the background (`compileAsync`), so the first real
   * draw no longer pays a synchronous shader compile. The draw itself is skipped: nothing drawn
   * here is ever seen.
   */
  primeFirstFrame(frame: number): void {
    if (this.exportScene.held) return
    this.lastFrame = frame
    this.animateGlow((frame * this.msPerFrame) / 1000)
    if (this.tracks) {
      timedSync('prime-avatars', () => this.placeAvatars(frame))
      timedSync('prime-camera', () => {
        this.cameraPlacement.placeCamera(frame)
        this.placeScope(frame)
        this.arms?.place(this.camera)
      })
      timedSync('prime-retag', () => this.retagTags())
      timedSync('prime-action', () => this.action?.update(frame))
    }
    if (this.mode === 'free') {
      if (this.cameraPlacement.scripted()) {
        this.scriptedFreeCamera()
      } else {
        this.fly.step(this.camera, this.orbit.target, performance.now())
        this.orbit.update()
      }
    }
    timedSync('prime-compile', () => { void this.renderer.compileAsync(this.scene, this.camera).catch(() => undefined) })
  }

  /**
   * prepCorpses fronts the hidden corpse copies that `Corpses3d.take` would otherwise pay lazily at
   * each death. Called once, after the first frame is drawn, so the load is not slowed by copies no
   * early frame shows.
   */
  prepCorpses(): void {
    if (this.corpsesPrepped || !this.action) return
    this.corpsesPrepped = true
    timedSync('corpses-prep', () => { this.action?.prepareCorpses() })
  }

  /** render poses the scene at frame `frame` (fractional) and draws it; returns the followed player's status. */
  render(frame: number): PovStatus {
    if (this.exportScene.held) return this.lastStatus
    this.lastFrame = frame
    this.animateGlow((frame * this.msPerFrame) / 1000)
    let status: PovStatus = 'none'
    const p = this.profile
    let t = performance.now(); this.renderer.info.reset()
    const knobs = this.applyKnobs()
    this.post.resetCosts()
    const shadowCost = this.lighting.split.cost
    shadowCost.calls = shadowCost.triangles = 0
    if (this.tracks) {
      this.placeAvatars(frame)
      t = markStep(p, 0, t)
      status = this.cameraPlacement.placeCamera(frame)
      this.placeScope(frame)
      this.arms?.place(this.camera)
      this.retagTags() // tags must measure from the camera now placed, not the previous frame's
      t = markStep(p, 1, t)
      this.action?.update(frame)
    }
    if (this.mode === 'free') {
      if (this.cameraPlacement.scripted()) {
        this.scriptedFreeCamera()
      } else {
        this.fly.step(this.camera, this.orbit.target, performance.now())
        this.orbit.update()
      }
    }
    t = markStep(p, 2, t)
    const top = this.view === 'top' ? this.top : null
    this.orbit.enabled = this.mode === 'free' && !top && !this.cameraPlacement.scripted() // the top-down view has its own gestures on the canvas
    if (!top) this.lighting.updateShadows(frame) // seen from above the sun casts no shadow (`topDownStage3d`)
    t = markStep(p, 3, t)
    // Every other frame with bloom drawn, its pass is timed alone and the frame's timer rests: two
    // timer queries cannot nest. The frame time still counts the bloom on the frames it measures.
    const timeBloom = !top && this.post.bloom?.enabled === true && (this.frameCount++ & 1) === 1
    this.post.timeBloom = timeBloom
    if (!timeBloom) this.gpu.begin()
    const minimap = this.minimapCost
    minimap.calls = minimap.triangles = 0
    if (top) top.draw({ composer: this.post.composer, players: this.topPlayers, dead: this.topDead, followed: this.topFollowed })
    else {
      this.top?.idle()
      this.post.composer.render()
      const calls = this.renderer.info.render.calls
      const triangles = this.renderer.info.render.triangles
      if (knobs.minimap) this.top?.drawMinimap({ players: this.topPlayers, followed: this.mode === 'free' ? null : this.povXuid })
      minimap.calls = this.renderer.info.render.calls - calls
      minimap.triangles = this.renderer.info.render.triangles - triangles
    }
    this.gpu.end()
    this.post.timeBloom = false
    t = markStep(p, 4, t)
    this.labels.domElement.style.display = knobs.labels ? '' : 'none'
    if (knobs.labels) this.labels.render(this.scene, top ? top.camera : this.camera)
    markStep(p, 5, t)
    this.notePassCosts(minimap)
    p.gpuMs = this.gpu.ms
    p.bloomGpuMs = this.post.bloom ? this.post.bloomGpu.ms : null
    p.calls = this.renderer.info.render.calls
    p.triangles = this.renderer.info.render.triangles
    p.geometries = this.renderer.info.memory.geometries
    p.textures = this.renderer.info.memory.textures
    p.pixelRatio = this.renderer.getPixelRatio()
    p.width = this.renderer.domElement.width
    p.height = this.renderer.domElement.height
    this.lastStatus = status
    return status
  }

  /**
   * applyKnobs reads the console's knobs (perfToggles3d) and applies them: passes, layers, shadow
   * updates, pixel ratio. At their defaults the view draws as it always does.
   */
  private applyKnobs(): PerfToggles {
    const k = currentPerfToggles(this.knobs)
    const fx = k.postFx
    this.post.outline.maskPass.enabled = fx && k.outline
    this.post.outline.linePass.enabled = fx && k.outline
    this.post.gtao.enabled = fx && k.ao && this.lookOcclusion
    if (this.post.bloom) this.post.bloom.enabled = fx && k.bloom
    if (this.post.dof) this.post.dof.enabled = fx
    this.post.output.enabled = fx
    this.post.grade.enabled = fx
    this.post.smaa.enabled = fx && k.smaa
    this.lighting.shadowUpdates = k.shadows
    this.lighting.split.split = k.shadowSplit
    batchCulling.fog = k.fogCull
    if (this.model && this.model.root.visible !== k.map) { this.model.root.visible = k.map; this.lighting.invalidateStaticShadows() }
    if (this.layer && this.layer.root.visible !== k.variant) { this.layer.root.visible = k.variant; this.lighting.invalidateStaticShadows() }
    if (k.backFaces !== this.backFacesShown) {
      this.backFacesShown = k.backFaces
      for (const o of this.backFaces) o.visible = k.backFaces
    }
    // Compared with the renderer's own ratio each frame: a move to a monitor of another display
    // scale changes devicePixelRatio, and the view then draws at that monitor's density.
    const ratio = screenPixelRatio(k.pixelRatio, window.devicePixelRatio)
    if (ratio !== this.renderer.getPixelRatio()) {
      this.renderer.setPixelRatio(ratio)
      this.post.composer.setPixelRatio(ratio)
    }
    return k
  }

  /** findBackFaces lists the back-face meshes under the map and layer roots, shown as the knob says. */
  private findBackFaces(): void {
    this.backFaces = []
    for (const root of this.mapRoots()) root.traverse((o) => { if (o.name === BACK_FACE_NAME && !drawnBy(o)) this.backFaces.push(o) })
    for (const o of this.backFaces) o.visible = this.backFacesShown
  }

  /** notePassCosts copies what each pass drew this frame into the profile (the shadow updates out of the scene pass). */
  private notePassCosts(minimap: { calls: number; triangles: number }): void {
    const passes = this.profile.passes
    const shadow = this.lighting.split.cost
    for (const name of PASS_NAMES) {
      const cost = this.post.costs[name]
      const out = passes[name]
      out.calls = cost.calls - (name === 'scene' ? shadow.calls : 0)
      out.triangles = cost.triangles - (name === 'scene' ? shadow.triangles : 0)
    }
    passes.shadow.calls = shadow.calls
    passes.shadow.triangles = shadow.triangles
    passes.minimap.calls = minimap.calls
    passes.minimap.triangles = minimap.triangles
  }

  beginExport(setup: Export3dSetup): void { this.exportScene.beginExport(setup) }
  redReticle(frame: number, allegiance: Pick<FilmAllegiance, 'ofXuid'>, held: HeldWeapon | null): boolean {
    return this.mode === 'fp' && readRedReticle({ tracks: this.tracks, frame, xuid: this.povXuid, camera: this.camera, drop: this.originAboveFloor, allegiance, surfaces: this.groundSurfaces(), raycaster: this.raycaster, riderAt: (xuid, f) => this.action?.riderAt(xuid, f) ?? null, range: held ? this.weaponModels?.reticleRange(held.weaponId, held.zoomLevel) ?? null : null })
  }
  exportFrame(frame: number): HTMLCanvasElement { return this.exportScene.exportFrame(frame) }
  exportTags(): readonly ExportTag3d[] { return this.exportScene.exportTags() }
  exportCamera(): ExportCamera3d {
    // three.js is y up with world y on -z (`toThree`): back to world [x, y, z] = [a, -c, b].
    const w = (v: { x: number; y: number; z: number }): [number, number, number] => [v.x, -v.z, v.y]
    const d = this.camera.getWorldDirection(new THREE.Vector3())
    const t = this.cameraPlacement.lastScriptPose?.target
    return {
      pos: w(this.camera.position),
      dir: w(d),
      fov: this.camera.fov,
      target: t ? w({ x: t[0], y: t[1], z: t[2] }) : null,
    }
  }
  /**
   * Loads still in flight: one gate counts the weapon models, armor and rigs (cf. `loadGate3d`),
   * and a held player's pose clip loads on its own (`poseClips`). Resolves true on a timeout.
   */
  exportPendingLoads(): Promise<boolean> | null {
    const gate = this.weaponModels?.gate
    const gateWait = gate && gate.pending > 0 ? gate.idle(EXPORT_LOAD_WAIT_MS).then((r) => r.timedOut) : null
    const poses = this.poseClips.pending()
    if (!poses) return gateWait
    const poseWait = Promise.race([
      poses.then(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), EXPORT_LOAD_WAIT_MS)),
    ])
    return gateWait ? Promise.all([gateWait, poseWait]).then(([a, b]) => a || b) : poseWait
  }
  endExport(): void { this.exportScene.endExport() }

  private applyPov(xuid: string | null): void {
    if (xuid === this.povXuid) return
    this.povXuid = xuid
    this.originAboveFloor = xuid && this.tracks ? measureOriginAboveFloor(this.tracks.allPoints(xuid), this.groundSurfaces(), this.raycaster) : 0
    this.armsPlayerReady = null
  }

  /** applyMode changes camera. The free camera starts from the current view, pulled behind the followed player and turned to it: a fixed point above him put it in the roof as soon as he was inside. */
  private applyMode(mode: CameraMode3d): void {
    this.mode = mode
    this.orbit.enabled = mode === 'free'
    if (mode !== 'free' || !this.tracks || !this.povXuid) return
    const { state } = this.cameraPlacement.povState(this.lastFrame)
    if (state) {
      const [x, y, z] = toThree(state.x, state.y, state.z)
      const body = new THREE.Vector3(x, y - this.originAboveFloor + BODY_CENTER, z)
      const d = new THREE.Vector3(...aimDirThree(state.h, 0))
      this.orbit.target.copy(body)
      this.camera.position.copy(body).addScaledVector(d, -FREE_BACK).add(new THREE.Vector3(0, FREE_RISE, 0))
    }
    this.orbit.update()
  }

  dispose(): void {
    this.sizer.cancel()
    this.orbit.dispose()
    this.fly.dispose()
    this.poseClips.dispose()
    this.action?.dispose()
    this.setSpartanArmory(null)
    this.setWeaponModels(null)
    for (const a of this.avatars.values()) {
      releaseWeapon(a)
      for (const m of [a.body, a.aim, a.gun]) m.geometry.dispose(), (m.material as THREE.Material).dispose()
      a.tag.element.remove()
    }
    this.detachLayer()
    this.top?.dispose()
    if (this.ciel) { this.scene.remove(this.ciel); this.ciel.geometry.dispose(); this.ciel.material.dispose(); this.ciel = null }
    // The map itself is session-cached by its served path (`sessionAssetCache3d`): only removed from
    // this scene, not disposed — the caller (`Replay3DView`) releases its hold, which disposes it
    // only when evicted.
    if (this.model) this.scene.remove(this.model.root)
    this.model = null // no map: a layer arriving after release is refused (`attachLayer`)
    this.top = null
    this.doc = null
    this.lighting.dispose()
    this.post.dispose()
    this.gpu.dispose()
    // The renderer (and its KTX2 loader) is shared for the whole session (`sessionRenderer3d`): the
    // canvas is detached from this host, never disposed, so the next match's scene can reuse its
    // compiled shader programs and uploaded GPU buffers.
    detachRenderer()
    this.labels.domElement.remove()
  }

  private buildAvatar(xuid: string, a: Avatar): void { wearSpartan(a, this.weaponModels?.spartan() ?? null, this.armory?.dress(xuid) ?? null, this.model?.baked ?? null) }

  private prepareAvatars(): void {
    if (!this.tracks || !this.weaponModels || !this.armory) return
    for (const [xuid, a] of this.avatars) this.buildAvatar(xuid, a)
  }
  private placeAvatars(f: number): void {
    const tracks = this.tracks as Tracks3d
    this.inView = null
    this.arms?.hide()
    this.post.outline.begin()
    this.topPlayers.length = 0
    this.topDead.length = 0
    this.drawnSlots.clear()
    const eye = this.view === 'top' && this.top ? this.top.camera.position : this.camera.position // the name-tag eye: the drawing camera
    const holds = this.currentHolds() // the holds active at the current script time (empty when not scripted)
    const sMs = holds.size > 0 ? this.cameraPlacement.scriptTime() : 0
    for (const p of tracks.players) {
      const a = this.avatars.get(p.xuid)
      if (!a) continue
      const s = tracks.sample(p.xuid, f)
      const rider = this.action?.riderAt(p.xuid, f) ?? null // aboard, the biped stops replicating: it follows its vehicle
      const firstPerson = !rider && p.xuid === this.povXuid && this.mode === 'fp' && this.view === '3d'
      const heldInfo = holds.size > 0 ? this.holdOf(p.xuid) : null // a held player leaves the film at the hold's start
      if (heldInfo) {
        // A held player is drawn even if the film kills them after `at`: their state is the film's
        // at the start frame, posed on script time; from `until` the film at f blends back in by
        // the hold's weight (dead at f, the held branch keeps running until the weight runs out).
        const { hold, held, atFrame, state } = heldInfo
        const clip = this.holdClip(a, hold.clip)
        const w = state.weight
        const rejoining = hold.until !== null && sMs >= hold.until
        let feet: THREE.Vector3
        let h: number
        let pitch: number
        let mix: ClipMix | null
        if (rejoining && s) {
          const liveFeet = rider ?? feetOf(s, this.originAboveFloor)
          feet = feetOf(held, this.originAboveFloor).lerp(liveFeet, 1 - w) // its own vector: topPlayers keeps it
          h = lerpHeading(state.heading, rider ? this.action?.riderHeadingAt(p.xuid, f) ?? s.h : s.h, 1 - w)
          pitch = s.p
          const film = this.action?.motion(p.xuid, f, rider !== null, a.mix) ?? null
          mix = film ? holdMix(film, clip, state, hold.loop) : null
        } else {
          feet = feetOf(held, this.originAboveFloor)
          h = state.heading
          pitch = state.pitch
          const film = this.action?.motion(p.xuid, atFrame, false, a.mix) ?? null
          mix = film ? holdMix(film, clip, state, hold.loop) : null
        }
        this.buildAvatar(p.xuid, a)
        placeBody(a, feet, { h, p: pitch, crouch: false, eyeDrop: 0, mix }, firstPerson, this.lighting.probeAt(feet))
        this.drawnSlots.set(held.slot, { xuid: p.xuid, firstPerson })
        const heldWeapon = hold.weapon === 'hide' ? null : this.action?.heldWeapon(held.slot, atFrame) ?? null // the weapon held at `at`, or none
        // A held player has left the film: the shield's hit glow, break and recharge belong to the
        // film's fight and stay there (frozen at `at`, a hit's flood would light the whole hold).
        // Camo and overshield are the player's own state and are kept.
        const filmFx = this.action?.bodyFx(p.xuid, atFrame) ?? null
        const fx = filmFx ? { ...filmFx, shield: NO_SHIELD_FX } : null
        const weaponModel = heldWeapon?.model ?? null
        const weaponKey = heldWeapon?.key ? weaponModelKey(heldWeapon.key) : null
        if (weaponModel && weaponKey && this.armory) void this.armory.paintWeapon(p.xuid, weaponKey, weaponModel)
        const weaponCoat = weaponModel && weaponKey ? (this.armory?.weaponCoat(p.xuid, weaponKey, weaponModel) ?? null) : null
        showWeapon(a, heldWeapon, weaponModel, firstPerson ? viewGripOf(heldWeapon?.key ?? null) : null, weaponCoat)
        showBodyFx(a, fx)
        if (fx && !firstPerson) this.post.outline.add(a.group, fx) // team outline: every visible player, self excepted in first person
        a.group.visible = true
        a.tagOpacity = placeTag(a.tag, feet, firstPerson ? null : eye, this.view === 'top' || p.xuid === this.povXuid || !!this.action?.aids().allNameTags) // top: every tag, a map key
        this.topPlayers.push({ xuid: p.xuid, feet, heading: h, avatar: a })
        continue
      }
      if (!s && !rider) {
        a.group.visible = false
        a.tag.visible = false
        const fell = tracks.firstLifeAfter(p.xuid, f) ? tracks.lastLifeBefore(p.xuid, f) : null // dead, coming back: a cross where he fell
        if (fell) this.topDead.push({ xuid: p.xuid, feet: feetOf(fell, this.originAboveFloor), avatar: a })
        continue
      }
      const feet = rider ?? feetOf(s as PlayerState3d, this.originAboveFloor)
      const h = rider ? this.action?.riderHeadingAt(p.xuid, f) ?? s?.h ?? 0 : s?.h ?? 0
      this.buildAvatar(p.xuid, a)
      const pose = { h, p: rider ? 0 : s?.p ?? 0, crouch: s?.crouch ?? false, eyeDrop: s?.dropOeil ?? 0, mix: this.action?.motion(p.xuid, f, rider !== null, a.mix) ?? null } // aboard: no roll, no locomotion
      placeBody(a, feet, pose, firstPerson, this.lighting.probeAt(feet))
      if (s) this.drawnSlots.set(s.slot, { xuid: p.xuid, firstPerson })
      const held = s && this.action ? this.action.heldWeapon(s.slot, f) : null
      if (firstPerson) this.arms?.follow(this.armory, this.povXuid)
      const fx = this.action?.bodyFx(p.xuid, f) ?? null // the camo fades his own first-person arms and weapon too
      if (firstPerson && !rider && p.xuid === this.povXuid && this.armsPlayerReady !== p.xuid) {
        this.armsPlayerReady = p.xuid
        this.arms?.preparePlayer(p.xuid)
      }
      const rigVisible = firstPerson && !rider && !!s && !!this.action && !!this.arms?.show(this.camera, held?.key ?? null, this.action.firstPersonFrameEvents(p.xuid, s.slot, f, this.fps), held?.recoil ?? null, fx?.equip.camo ?? 0, this.action.magazineInHand(p.xuid, f))
      const weaponModel = rigVisible ? null : held?.model ?? null
      const weaponKey = held?.key ? weaponModelKey(held.key) : null
      if (weaponModel && weaponKey && this.armory) void this.armory.paintWeapon(p.xuid, weaponKey, weaponModel)
      const weaponCoat = weaponModel && weaponKey ? (this.armory?.weaponCoat(p.xuid, weaponKey, weaponModel) ?? null) : null
      showWeapon(a, held, weaponModel, firstPerson ? viewGripOf(held?.key ?? null) : null, weaponCoat)
      showBodyFx(a, fx)
      if (fx && !firstPerson) this.post.outline.add(a.group, fx) // team outline: every visible player, self excepted in first person
      if (firstPerson) this.inView = held?.key ? { key: held.key, name: held.name, rig: rigVisible } : null
      a.group.visible = !(firstPerson && rider) // aboard in first person: no weapon shown
      a.tagOpacity = placeTag(a.tag, feet, firstPerson ? null : eye, this.view === 'top' || p.xuid === this.povXuid || !!this.action?.aids().allNameTags) // top: every tag, a map key
      this.topPlayers.push({ xuid: p.xuid, feet, heading: h, avatar: a })
    }
  }

  /**
   * retagTags recomputes each name tag's visibility and opacity from the camera AS PLACED FOR
   * `frame`. `placeAvatars` must run first (it poses the bodies the camera follows, so the camera
   * cannot be placed first), and it tags against the PREVIOUS frame's camera: fine on screen,
   * where the camera creeps, but in an export the camera moves fast or jumps between frames, and
   * the stale distances made a random assortment of tags appear. The followed player in first
   * person keeps the null eye (no self tag).
   */
  private retagTags(): void {
    const eye = this.view === 'top' && this.top ? this.top.camera.position : this.camera.position
    for (const m of this.topPlayers) {
      const firstPerson = m.xuid === this.povXuid && this.mode === 'fp' && this.view === '3d'
      m.avatar.tagOpacity = placeTag(m.avatar.tag, m.feet, firstPerson ? null : eye, this.view === 'top' || m.xuid === this.povXuid || !!this.action?.aids().allNameTags)
    }
  }

  /** playerFeet: a player's feet (three axes), aboard a vehicle included; null out of life. */
  private playerFeet(xuid: string, frame: number): THREE.Vector3 | null {
    const rider = this.action?.riderAt(xuid, frame)
    if (rider) return rider.clone()
    const s = this.tracks?.sample(xuid, frame)
    return s ? feetOf(s, this.feetDrop) : null
  }

  /** scriptedFreeCamera: the free camera is on the script; the free flight and orbit rest, and the orbit keeps the script's target so stopping it leaves the free camera orbiting what it looked at. */
  private scriptedFreeCamera(): void {
    this.orbit.enabled = false
    const pose = this.cameraPlacement.lastScriptPose
    if (pose) this.orbit.target.set(pose.target[0], pose.target[1], pose.target[2])
  }

  /** placeScope adjusts the first-person zoom's field (`scopeView3d`) and takes the arms off screen when the optic sight is mounted; out of first person, the base field returns (a playing camera script poses its own). */
  private placeScope(f: number): void {
    const doc = this.doc
    if (this.mode !== 'fp' || !this.povXuid || !doc) {
      const pose = this.cameraPlacement.lastScriptPose
      if (this.cameraPlacement.scripted() && pose) this.scopeView.hold(this.camera, pose.verticalFov)
      else this.scopeView.reset(this.camera)
      return
    }
    const key = this.inView?.key ?? null
    const spec = scopeOf(key, key ? labelKeyOf(doc, key) : null)
    // The same resolution the HUD uses (`magsForWeapon`): the index's own zoom when it carries one,
    // else the hand table. The Shock Rifle and both Bandits carry [1] in the index, so reading the
    // raw values left the camera unzoomed while the HUD showed 1.6x / 2.5x.
    const mags = magsForWeapon(key, key ? this.weaponModels?.reticles.magnifications(key) ?? null : null)
    if (this.scopeView.apply(this.camera, doc, this.povXuid, f, spec, mags)) this.arms?.hide()
  }

  /** mapRoots: the posed map's root and its layer's. */
  private mapRoots(): THREE.Object3D[] { return [this.model?.root, this.layer?.root].filter((r): r is THREE.Object3D => !!r) }
  /** groundSurfaces: the ground surfaces, the map's then the posed layer's. */
  private groundSurfaces(): THREE.Mesh[] {
    return [...(this.model?.pickables ?? []), ...(this.layer?.pickables ?? [])]
  }

  /**
   * remeasureFloorDrop re-measures the players' drop against the ground surfaces as they stand now
   * (the layer arrives after the map, and detaches before it). A Forge map's floor lives in the
   * layer, so the drop must follow the layer's presence; without this a spawn near the canvas's
   * ground would be left on it when the layer poses (and popped back to it when it detaches).
   */
  private remeasureFloorDrop(): void {
    const tracks = this.tracks
    if (!tracks) return
    this.feetDrop = measureOriginAboveFloor(tracks.players.flatMap((p) => tracks.allPoints(p.xuid)), this.groundSurfaces(), this.raycaster)
    this.originAboveFloor = this.povXuid ? measureOriginAboveFloor(tracks.allPoints(this.povXuid), this.groundSurfaces(), this.raycaster) : 0
  }
}

/**
 * freezeStatic: a root that never moves (the map, a variant layer) gets its world matrices once, and
 * three's per-render matrix walk skips it (Fortress's layer: about ten thousand objects per frame).
 */
function freezeStatic(root: THREE.Object3D): void {
  root.updateMatrixWorld(true)
  root.matrixWorldAutoUpdate = false
}

/** feetOf: a player's feet in three axes, `drop` below his published origin. */
function feetOf(s: PlayerState3d, drop: number): THREE.Vector3 {
  const [x, , z] = toThree(s.x, s.y, s.z)
  return new THREE.Vector3(x, s.z - drop, z)
}
