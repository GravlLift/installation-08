/**
 * replayScene3d.ts — the 3D replay scene: WebGL render, players, cameras.
 *
 * It owns no time: the page's player advances its image and the view calls `render(frame)`
 * once per screen frame. Cameras: first and third person on the followed player (the page's
 * viewpoint), free (orbit around it), and the orthographic top-down view (`topDownView3d`)
 * drawing the same scene straight down, cut over the followed player; it also draws the 3D view's corner minimap.
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
import { marquer, nouveauProfil } from './profilRendu3d'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { framesPerSecond } from '@/lib/replay/replayLogic'
import { BrasPremierePersonne3d } from './brasPremierePersonne3d'
import { dossierPremierePersonne } from './premierePersonne3d'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import type { Export3dSetup, ExportTag3d, Replay3DExportSource } from '../export/replay3dExportStore'
import type { Action3dInputs } from './action3dInputs'
import { Ground, InkCache } from './actionKit'
import { buildActionScene } from './actionLayers3d'
import type { ActionScene3d } from './actionScene3d'
import type { SpartanArmory } from './armory3d'
import { drawnWeapon, makeAvatar, placeBody, releaseWeapon, showBodyFx, showWeapon, wearSpartan, type Avatar } from './avatar3d'
import { viewGripOf } from './viewGrip3d'
import { BODY_CENTER, EYE_HEIGHT } from './body3d'
import { placeTag } from './nameTags3d'
import { FreeFly } from './freeFly3d'
import { Lighting } from './lighting'
import { creerCiel } from './ciel3d'
import type { Look3d } from './look3d'
import type { BakedLight } from './bakedLightShader'
import type { MapModel, SurfaceModel } from './mapModel'
import { buildPostFx, type PostFx3d } from './postFx3d'
import { prechauffer3d } from './prechauffage3d'
import { serialiser } from './serialiser3d'
import { probeSurface, type SurfaceProbe } from './surfaceProbe3d'
import { aimDirThree, toThree, type PlayerState3d, type Tracks3d } from './tracks3d'
import { ScopeView3d } from './scopeView3d'
import { ReplayExportScene3d } from './replayExportScene3d'
import { measureOriginAboveFloor, ReplayCamera3d } from './replayCamera3d'
import type { SceneView3d } from './topDownLogic'
import { TopDownView3d } from './topDownView3d'
import type { DeadPose, MarkerPose } from './playerMarkers3d'
import { clesRigsRejeu } from './riggedWeapons3d'
import { GAME_FOV_DEFAULT, verticalFovOf } from '../model/fovLogic'
import { etiquetteDe, specLunette } from '../model/scopeLogic'
import { weaponModelKey, type WeaponModels } from './weaponModels3d'
import { readRedReticle, type HeldWeapon } from './redReticle3d'
import type { FilmAllegiance } from '@/lib/replay/filmAllegiance'
export type CameraMode3d = 'fp' | 'tp' | 'free'
/** Le joueur suivi : en vie, mort, pas encore apparu, ou aucun joueur suivi. */
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
export class ReplayScene3d implements Replay3DExportSource {
  private readonly renderer: THREE.WebGLRenderer
  private readonly labels = new CSS2DRenderer()
  private readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  private readonly orbit: OrbitControls
  private readonly fly = new FreeFly()
  /** Le compositeur : occlusion ambiante et contour d'équipe (`postFx3d`). */
  private readonly post: PostFx3d
  private readonly lighting: Lighting
  private readonly raycaster = new THREE.Raycaster()
  private readonly avatars = new Map<string, Avatar>()
  readonly warmUp = serialiser(async () => {
    try {
      this.prepareAvatars()
      this.bras?.preparerRig()
      await prechauffer3d(this.renderer, this.scene, this.camera, { roots: [...Array.from(this.avatars.values(), (a) => a.group), ...(this.action?.prepareCorpses() ?? []), ...(this.bras?.racinesChargees() ?? [])], detaches: this.weaponModels?.sourcesChargees() ?? [], composer: this.post.composer, avatars: [...this.avatars.values()], outline: this.post.outline })
    } catch (erreur) { console.warn('rejeu 3D : préchauffage indisponible', erreur) }
  })
  private model: MapModel | null = null
  private ciel: ReturnType<typeof creerCiel> | null = null
  private layer: SurfaceModel | null = null
  private ground: Ground | null = null
  private tracks: Tracks3d | null = null
  private mode: CameraMode3d = 'fp'
  /** The drawing view: perspective (3D) or the orthographic top-down (`topDownView3d`). */
  private view: SceneView3d = '3d'
  /** The top-down view, built when the map is attached; null without a map. */
  private top: TopDownView3d | null = null
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
  private bras: BrasPremierePersonne3d | null = null
  private doc: ReplayDocumentReady | null = null
  private readonly scopeView = new ScopeView3d(verticalFovOf(GAME_FOV_DEFAULT))
  private fps = 30
  private weaponModels: WeaponModels | null = null
  private armory: SpartanArmory | null = null
  /** L'arme du joueur suivi en 1re personne (clé et nom), null sans clé ; `rig` : c'est le rig bras + arme qui est dessiné. */
  inView: { key: string; name: string; rig: boolean } | null = null
  private readonly actionRoot = new THREE.Group()
  private feetDrop = 0
  private playTop = 0
  players: readonly { xuid: string; name: string }[] = []
  readonly profil = nouveauProfil()
  constructor(host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.info.autoReset = false
    // Pendant un export, la toile rend au format du fichier sans changer de boîte (image entière à l'écran).
    this.renderer.domElement.style.objectFit = 'contain'
    host.appendChild(this.renderer.domElement)
    Object.assign(this.labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' })
    host.appendChild(this.labels.domElement)
    this.scene.background = new THREE.Color(SKY_TINT)
    this.scene.fog = new THREE.Fog(SKY_TINT, FOG_NEAR, FOG_FAR)
    this.lighting = new Lighting(this.renderer, this.scene)
    this.camera = new THREE.PerspectiveCamera(verticalFovOf(GAME_FOV_DEFAULT), 1, 0.02, 700)
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement)
    this.orbit.enabled = false
    this.post = buildPostFx(this.renderer, this.scene, this.camera)
    const self = this
    this.cameraPlacement = new ReplayCamera3d({
      get tracks() { return self.tracks }, get povXuid() { return self.povXuid }, get mode() { return self.mode },
      get action() { return self.action }, get originAboveFloor() { return self.originAboveFloor },
      camera: this.camera, pickables: () => self.groundSurfaces(), raycaster: this.raycaster,
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
      placeAvatars: (frame) => this.placeAvatars(frame), placeCamera: (frame) => this.cameraPlacement.placeCamera(frame),
      placeFirstPerson: (frame) => { this.placerLunette(frame); this.bras?.placer(this.camera) },
    })
  }
  /** attach pose la carte et les joueurs, éclaire l'aire de jeu et capture l'environnement. */
  attach(model: MapModel, tracks: Tracks3d, colorOf: (xuid: string) => THREE.Color): void {
    this.model = model
    this.tracks = tracks
    this.scene.add(model.root)
    this.lighting.setSunStrength(model.sunStrength)
    const playPoints = tracks.players
      .flatMap((p) => tracks.allPoints(p.xuid))
      .map((p) => new THREE.Vector3(...toThree(p.x, p.y, p.z)))
    if (playPoints.length > 0) {
      const playBox = new THREE.Box3().setFromPoints(playPoints).expandByScalar(PLAY_MARGIN)
      playBox.max.y += PLAY_HEADROOM
      this.lighting.fit(playBox)
      const sun = model.sun ?? SUN_FALLBACK
      this.lighting.setSun(sun.azimuth, sun.elevation)
      this.lighting.takeGameLight(model.baked) // game light active during the probe captures
      this.lighting.captureProbes(playPoints.map((p) => p.clone().setY(p.y + EYE_HEIGHT)), model.surfaces)
      this.playTop = playBox.max.y
      this.top = new TopDownView3d({ scene: this.scene, renderer: this.renderer, sun: this.lighting.sun, heights: playPoints.map((p) => p.y), walked: new THREE.Box3().setFromPoints(playPoints) })
    }
    if (model.ciel) {
      this.ciel = creerCiel(model.sun ?? SUN_FALLBACK, model.ciel.texture, model.ciel.color, model.sunStrength)
      this.scene.add(this.ciel)
    }
    this.top?.sync(this.ciel, this.mapRoots())
    // Après l'attribution des sondes : les surfaces de même matériau se dessinent ensemble.
    model.batchDraws()
    for (const p of tracks.players) {
      const a = makeAvatar(this.scene, p.name, colorOf(p.xuid))
      a.group.visible = false; this.avatars.set(p.xuid, a)
    }
    this.players = tracks.players.map((p) => ({ xuid: p.xuid, name: p.name }))
    this.feetDrop = measureOriginAboveFloor(tracks.players.flatMap((p) => tracks.allPoints(p.xuid)), this.model, this.raycaster)
    this.scene.add(this.actionRoot); this.prepareAvatars()
  }

  /** enableAction poses the action layers (shots, flights, deaths, objects, vehicles); `inputs` is re-read each frame. */
  enableAction(doc: ReplayDocumentReady, inputs: () => Action3dInputs): void {
    const tracks = this.tracks
    if (!tracks || !this.model || this.action) return
    this.doc = doc
    this.fps = framesPerSecond(doc)
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
      drawnWeapon: (xuid) => drawnWeapon(this.avatars.get(xuid)),
      firstPersonSlot: (f) => (this.mode === 'fp' && this.povXuid ? tracks.sample(this.povXuid, f)?.slot ?? null : null),
      rigMuzzle: (held, out) => this.bras?.boucheVue(held, out) ?? false,
      rigMuzzleWorld: (pos, axe) => this.bras?.boucheMonde(pos, axe) ?? false, firstPersonLeftHand: (out) => this.bras?.mainGaucheMonde(out) ?? null,
      scopeMounted: () => this.scopeView.montee,
      flashes: this.lighting.flashes, baked: this.model?.baked ?? null, probeAt: (p) => this.lighting.probeAt(p),
    })
    this.prechargerRigs()
  }

  /** prechargerRigs: start loading the rigs of the weapons the match carries, for the loading screen. */
  private prechargerRigs() { if (this.doc) this.bras?.precharger(clesRigsRejeu(this.doc)) }

  /** setWeaponModels poses the source of the weapon and Spartan models (the previous one, and the Spartans copying it, is released); null: none. */
  setWeaponModels(models: WeaponModels | null): void {
    for (const a of this.avatars.values()) wearSpartan(a, null)
    this.weaponModels?.dispose()
    this.weaponModels = models
    this.bras?.dispose()
    this.bras = models ? new BrasPremierePersonne3d(this.scene, dossierPremierePersonne(models.base), models.gate, this.model?.baked ?? null, (p) => this.lighting.probeAt(p)) : null
    if (this.bras) { const loading = this.bras.charger(); void (models?.gate?.track(loading) ?? loading) }
    this.prechargerRigs()
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

  /** mapLight: the baked light of the posed map that its layers reuse; null without a map or a light. */
  get mapLight(): BakedLight | null { return this.model?.baked ?? null }

  /** attachLayer poses one layer on the map (the previous one is removed); false without a posed map: the layer stays with the caller, who releases it. */
  attachLayer(layer: SurfaceModel): boolean {
    if (!this.model) return false
    this.detachLayer()
    this.layer = layer
    this.scene.add(layer.root)
    this.lighting.lightLayer(layer.surfaces)
    this.ground?.setPickables(this.groundSurfaces())
    this.top?.sync(this.ciel, this.mapRoots())
    return true
  }

  /** detachLayer removes and releases the posed layer; nothing without one. */
  detachLayer(): void {
    const layer = this.layer
    if (!layer) return
    this.layer = null
    this.scene.remove(layer.root)
    this.ground?.setPickables(this.groundSurfaces())
    this.top?.sync(this.ciel, this.mapRoots())
    this.lighting.releaseLayer(layer.surfaces)
    layer.dispose()
  }

  /** setLook applies the drawer's lighting settings: shadows, reflections, ambient occlusion. */
  setLook(look: Look3d): void {
    this.lighting.setLook(look)
    this.post.gtao.enabled = look.ambientOcclusion
  }

  /** setFovPreference applies the game's field-of-view setting (horizontal degrees at 16:9): the camera's base vertical field. */
  setFovPreference(gameFovDeg: number): void {
    this.scopeView.changerBase(this.camera, verticalFovOf(gameFovDeg))
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

  /** setTopFollowed: the player the top-down view's cut follows; null (free camera): the living players' median. */
  setTopFollowed(xuid: string | null): void { this.topFollowed = xuid }
  /** setMinimap shows or hides the corner minimap over the 3D view (first and third person). */
  setMinimap(on: boolean): void { this.top?.setMinimap(on) }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return
    if (this.exportScene.held) {
      this.exportScene.held.width = width
      this.exportScene.held.height = height
    } else {
      this.exportScene.applySize(width, height, true)
    }
  }

  /** probe renders the map (or layer) surface under the screen point (`clientX`, `clientY`); null off the map. */
  probe(clientX: number, clientY: number): SurfaceProbe | null {
    const box = this.renderer.domElement.getBoundingClientRect()
    if (!this.model || box.width === 0 || box.height === 0) return null
    const ndc = new THREE.Vector2(((clientX - box.left) / box.width) * 2 - 1, -((clientY - box.top) / box.height) * 2 + 1)
    const roots = this.layer ? [this.model.root, this.layer.root] : [this.model.root]
    return probeSurface(roots, this.camera, ndc)
  }

  /** render poses the scene at frame `frame` (fractional) and draws it; returns the followed player's status. */
  render(frame: number): PovStatus {
    if (this.exportScene.held) return this.lastStatus
    this.lastFrame = frame
    let status: PovStatus = 'none'
    const p = this.profil
    let t = performance.now(); this.renderer.info.reset()
    if (this.tracks) {
      this.placeAvatars(frame)
      t = marquer(p, 0, t)
      status = this.cameraPlacement.placeCamera(frame)
      this.placerLunette(frame)
      this.bras?.placer(this.camera)
      t = marquer(p, 1, t)
      this.action?.update(frame)
    }
    if (this.mode === 'free') {
      this.fly.step(this.camera, this.orbit.target, performance.now())
      this.orbit.update()
    }
    t = marquer(p, 2, t)
    const top = this.view === 'top' ? this.top : null
    this.orbit.enabled = this.mode === 'free' && !top // the top-down view has its own gestures on the canvas
    if (!top) this.lighting.updateShadows(frame) // seen from above the sun casts no shadow (`topDownStage3d`)
    t = marquer(p, 3, t)
    if (top) top.draw({ composer: this.post.composer, players: this.topPlayers, dead: this.topDead, followed: this.topFollowed })
    else { this.top?.idle(); this.post.composer.render(); this.top?.drawMinimap({ players: this.topPlayers, followed: this.mode === 'free' ? null : this.povXuid }) }
    t = marquer(p, 4, t)
    this.labels.render(this.scene, top ? top.camera : this.camera)
    marquer(p, 5, t)
    p.appels = this.renderer.info.render.calls
    p.triangles = this.renderer.info.render.triangles
    this.lastStatus = status
    return status
  }

  beginExport(setup: Export3dSetup): void { this.exportScene.beginExport(setup) }
  redReticle(frame: number, allegiance: Pick<FilmAllegiance, 'ofXuid'>, held: HeldWeapon | null): boolean {
    return this.mode === 'fp' && readRedReticle({ tracks: this.tracks, frame, xuid: this.povXuid, camera: this.camera, drop: this.originAboveFloor, allegiance, surfaces: this.groundSurfaces(), raycaster: this.raycaster, riderAt: (xuid, f) => this.action?.riderAt(xuid, f) ?? null, range: held ? this.weaponModels?.reticleRange(held.weaponId, held.zoomLevel) ?? null : null })
  }
  exportFrame(frame: number): HTMLCanvasElement { return this.exportScene.exportFrame(frame) }
  exportTags(): readonly ExportTag3d[] { return this.exportScene.exportTags() }
  endExport(): void { this.exportScene.endExport() }

  private applyPov(xuid: string | null): void {
    if (xuid === this.povXuid) return
    this.povXuid = xuid
    this.originAboveFloor = xuid && this.tracks ? measureOriginAboveFloor(this.tracks.allPoints(xuid), this.model, this.raycaster) : 0
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
    this.orbit.dispose()
    this.fly.dispose()
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
    this.model?.dispose()
    this.model = null // no map: a layer arriving after release is refused (`attachLayer`)
    this.top = null
    this.doc = null
    this.lighting.dispose()
    this.post.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
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
    this.bras?.cacher()
    this.post.outline.begin()
    this.topPlayers.length = 0
    this.topDead.length = 0
    const eye = this.view === 'top' && this.top ? this.top.camera.position : this.camera.position // the name-tag eye: the drawing camera
    for (const p of tracks.players) {
      const a = this.avatars.get(p.xuid)
      if (!a) continue
      const s = tracks.sample(p.xuid, f)
      const rider = this.action?.riderAt(p.xuid, f) ?? null // aboard, the biped stops replicating: it follows its vehicle
      const firstPerson = p.xuid === this.povXuid && this.mode === 'fp' && this.view === '3d'
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
      const pose = { h, p: rider ? 0 : s?.p ?? 0, crouch: s?.crouch ?? false, dropOeil: s?.dropOeil ?? 0, mix: this.action?.motion(p.xuid, f, rider !== null, a.mix) ?? null } // aboard: no roll, no locomotion
      placeBody(a, feet, pose, firstPerson, this.lighting.probeAt(feet))
      const held = s && this.action ? this.action.heldWeapon(s.slot, f) : null
      if (firstPerson) this.bras?.suivre(this.armory, this.povXuid)
      const rigVisible = firstPerson && !rider && !!s && !!this.action && !!this.bras?.montrer(this.camera, held?.key ?? null, this.action.evenementsPremierePersonne(p.xuid, s.slot, f, this.fps), held?.recoil ?? null)
      const modelArme = rigVisible ? null : held?.model ?? null
      const cleArme = held?.key ? weaponModelKey(held.key) : null
      if (modelArme && cleArme && this.armory) void this.armory.peindreArme(p.xuid, cleArme, modelArme)
      const coatArme = modelArme && cleArme ? (this.armory?.coatArme(p.xuid, cleArme, modelArme) ?? null) : null
      showWeapon(a, held, modelArme, firstPerson ? viewGripOf(held?.key ?? null) : null, coatArme)
      const fx = this.action?.bodyFx(p.xuid, f) ?? null
      showBodyFx(a, fx)
      if (fx && !firstPerson) this.post.outline.add(a.group, fx) // team outline: every visible player, self excepted in first person
      if (firstPerson) this.inView = held?.key ? { key: held.key, name: held.name, rig: rigVisible } : null
      a.group.visible = !(firstPerson && rider) // aboard in first person: no weapon shown
      placeTag(a.tag, feet, firstPerson ? null : eye, this.view === 'top' || p.xuid === this.povXuid || !!this.action?.aids().allNameTags) // top: every tag, a map key
      this.topPlayers.push({ xuid: p.xuid, feet, heading: h, avatar: a })
    }
  }

  /** playerFeet: a player's feet (three axes), aboard a vehicle included; null out of life. */
  private playerFeet(xuid: string, frame: number): THREE.Vector3 | null {
    const rider = this.action?.riderAt(xuid, frame)
    if (rider) return rider.clone()
    const s = this.tracks?.sample(xuid, frame)
    return s ? feetOf(s, this.feetDrop) : null
  }

  /** placerLunette adjusts the first-person zoom's field (`scopeView3d`) and takes the arms off screen when the optic sight is mounted; out of first person, the base field returns. */
  private placerLunette(f: number): void {
    const doc = this.doc
    if (this.mode !== 'fp' || !this.povXuid || !doc) {
      this.scopeView.reposer(this.camera)
      return
    }
    const cle = this.inView?.key ?? null
    const spec = specLunette(cle, cle ? etiquetteDe(doc, cle) : null)
    const mags = cle ? this.weaponModels?.reticles.magnifications(cle) ?? null : null
    if (this.scopeView.appliquer(this.camera, doc, this.povXuid, f, spec, mags)) this.bras?.cacher()
  }

  /** mapRoots: the posed map's root and its layer's. */
  private mapRoots(): THREE.Object3D[] { return [this.model?.root, this.layer?.root].filter((r): r is THREE.Object3D => !!r) }
  /** groundSurfaces: the ground surfaces, the map's then the posed layer's. */
  private groundSurfaces(): THREE.Mesh[] {
    return [...(this.model?.pickables ?? []), ...(this.layer?.pickables ?? [])]
  }
}

/** feetOf: a player's feet in three axes, `drop` below his published origin. */
function feetOf(s: PlayerState3d, drop: number): THREE.Vector3 {
  const [x, , z] = toThree(s.x, s.y, s.z)
  return new THREE.Vector3(x, s.z - drop, z)
}
