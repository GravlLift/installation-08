/**
 * replayScene3d.ts — LA SCÈNE 3D DU REJEU : rendu WebGL, joueurs, caméras.
 *
 * Elle ne possède pas le temps : le lecteur de la page avance son image, la vue appelle
 * `render(frame)` à chaque image d'écran. Trois caméras : à la première personne et à la
 * troisième sur le joueur suivi (le point de vue de la page), et libre (orbite autour de lui).
 *
 * Le rejeu et la carte sont en UNITÉS MONDE Halo (1 u = 3,048 m), pas en mètres : vitesse de
 * course médiane mesurée 2,3 u/s, celle d'un Spartiate. Toutes les tailles ci-dessous sont en u.
 *
 * L'action du match (tirs, vols, morts, objets, véhicules) est posée par les calques d'action
 * (`actionScene3d`) après les joueurs, à chaque image rendue ; le joueur (`avatar3d`) porte l'arme en main.
 *
 * Un calque de surfaces peut se poser sur la carte après elle (`attachLayer` : les objets de la
 * variante du match). Il entre dans tout ce que la carte sert : le sol des calques d'action,
 * l'inspecteur, l'occlusion ambiante, les sondes et les ombres ; il est libéré avec la scène.
 *
 * L'export vidéo la PREND (`beginExport` .. `endExport`, cf. `export/replay3dExportStore`) : rendu
 * à la taille du fichier, caméra et joueur suivi de l'export. Pendant ce temps, ce que la vue
 * d'écran demande (taille, caméra, joueur suivi) est retenu et appliqué au retour, et `render` ne
 * dessine plus rien.
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
import { clesRigsRejeu } from './riggedWeapons3d'
import { GAME_FOV_DEFAULT, verticalFovOf } from '../model/fovLogic'
import { etiquetteDe, specLunette } from '../model/scopeLogic'
import { weaponModelKey, type WeaponModels } from './weaponModels3d'
export type CameraMode3d = 'fp' | 'tp' | 'free'
/** Le joueur suivi : en vie, mort, pas encore apparu, ou aucun joueur suivi. */
export type PovStatus = 'alive' | 'dead' | 'unspawned' | 'none'
// Départ de la caméra libre : derrière le joueur suivi et au-dessus de lui (u).
const FREE_BACK = 3
const FREE_RISE = 1.5
// Aire de jeu : la boîte des positions du rejeu, élargie de PLAY_MARGIN autour et de
// PLAY_HEADROOM au-dessus (toits, passerelles qui ombrent le sol).
const PLAY_MARGIN = 15
const PLAY_HEADROOM = 20
// Soleil d'une carte dont le maillage ne publie pas celui du jeu : choisi à l'œil sur Recharge.
const SUN_FALLBACK = { azimuth: 217, elevation: 58 }
// Ciel et brouillard (pas une couleur d'interface).
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
  private povXuid: string | null = null
  private originAboveFloor = 0
  private lastFrame = 0
  private lastStatus: PovStatus = 'none'
  private readonly exportScene: ReplayExportScene3d
  private readonly cameraPlacement: ReplayCamera3d
  private action: ActionScene3d | null = null
  private bras: BrasPremierePersonne3d | null = null
  private doc: ReplayDocumentReady | null = null
  // Champ de base : le réglage de champ du jeu, 100 horizontaux à 16:9, tourné en vertical.
  private readonly scopeView = new ScopeView3d(verticalFovOf(GAME_FOV_DEFAULT))
  private fps = 30
  private weaponModels: WeaponModels | null = null
  private armory: SpartanArmory | null = null
  /** L'arme du joueur suivi en 1re personne (clé et nom), null sans clé ; `rig` : c'est le rig bras + arme qui est dessiné. */
  inView: { key: string; name: string; rig: boolean } | null = null
  private readonly actionRoot = new THREE.Group()
  // Hauteur de l'origine au-dessus des pieds, mesurée sur tous les joueurs (calques d'action).
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
      get tracks() { return self.tracks }, get povXuid() { return self.povXuid },
      get mode() { return self.mode }, get action() { return self.action },
      get originAboveFloor() { return self.originAboveFloor }, camera: this.camera,
      pickables: () => self.groundSurfaces(), raycaster: this.raycaster,
    })
    this.exportScene = new ReplayExportScene3d({
      renderer: this.renderer, camera: this.camera, orbit: this.orbit, labels: this.labels,
      post: this.post, lighting: this.lighting, avatars: this.avatars,
      get action() { return self.action }, get hasTracks() { return !!self.tracks },
      get mode() { return self.mode }, set mode(value) { self.mode = value },
      get povXuid() { return self.povXuid }, set lastFrame(value) { self.lastFrame = value },
      get lastFrame() { return self.lastFrame },
      applyPov: (xuid) => this.applyPov(xuid), applyMode: (mode) => this.applyMode(mode),
      placeAvatars: (frame) => this.placeAvatars(frame), placeCamera: (frame) => { this.cameraPlacement.placeCamera(frame) },
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
      // La lumière du jeu est active pendant les captures des sondes.
      this.lighting.takeGameLight(model.baked)
      // Les sondes se posent là où des joueurs se sont tenus, à hauteur d'œil. Avant les avatars.
      this.lighting.captureProbes(playPoints.map((p) => p.clone().setY(p.y + EYE_HEIGHT)), model.surfaces)
      this.playTop = playBox.max.y
    }
    if (model.ciel) {
      this.ciel = creerCiel(model.sun ?? SUN_FALLBACK, model.ciel.texture, model.ciel.color, model.sunStrength)
      this.scene.add(this.ciel)
    }
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

  /**
   * enableAction pose les calques d'action (tirs, vols, morts, objets, véhicules...). `inputs` est
   * relu à chaque image : le thème, le tiroir et la langue changent sans reconstruire les calques.
   */
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
      grenadeModel: (rank) => this.weaponModels?.grenade(rank) ?? null,
      spartanModel: () => this.weaponModels?.spartan() ?? null,
      dressOf: (xuid) => this.armory?.dress(xuid) ?? null,
      drawnWeapon: (xuid) => drawnWeapon(this.avatars.get(xuid)),
      firstPersonSlot: (f) => (this.mode === 'fp' && this.povXuid ? tracks.sample(this.povXuid, f)?.slot ?? null : null),
      rigMuzzle: (held, out) => this.bras?.boucheVue(held, out) ?? false,
      rigMuzzleWorld: (pos, axe) => this.bras?.boucheMonde(pos, axe) ?? false,
      scopeMounted: () => this.scopeView.montee,
      flashes: this.lighting.flashes, baked: this.model?.baked ?? null, probeAt: (p) => this.lighting.probeAt(p),
    })
    this.prechargerRigs()
  }

  /** prechargerRigs : le chargement des rigs des armes portées par le match commence pour l'écran de chargement. */
  private prechargerRigs(): void {
    if (this.doc) this.bras?.precharger(clesRigsRejeu(this.doc))
  }

  /**
   * setWeaponModels pose la source des modèles d'arme et du Spartan (la précédente est libérée,
   * les Spartans qui en sont des copies avec elle) ; null : aucune.
   */
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

  /**
   * setSpartanArmory pose l'armure des joueurs du match (`armory3d`), que la scène possède : la
   * précédente est libérée après que les joueurs l'ont rendue ; null : l'armure par défaut pour tous.
   */
  setSpartanArmory(armory: SpartanArmory | null): void {
    const source = this.weaponModels?.spartan() ?? null
    for (const a of this.avatars.values()) wearSpartan(a, source, null, this.model?.baked ?? null)
    this.armory?.dispose()
    this.armory = armory
    this.prepareAvatars()
  }

  /** mapLight : la lumière cuite de la carte posée, que ses calques reprennent ; null sans carte ou sans lumière. */
  get mapLight(): BakedLight | null {
    return this.model?.baked ?? null
  }

  /**
   * attachLayer pose un calque sur la carte (un seul : le précédent est retiré). Faux sans carte
   * posée (scène libérée) : le calque reste à l'appelant, qui le libère.
   */
  attachLayer(layer: SurfaceModel): boolean {
    if (!this.model) return false
    this.detachLayer()
    this.layer = layer
    this.scene.add(layer.root)
    this.lighting.lightLayer(layer.surfaces)
    this.ground?.setPickables(this.groundSurfaces())
    return true
  }

  /** detachLayer retire le calque posé et le libère ; sans calque, rien. */
  detachLayer(): void {
    const layer = this.layer
    if (!layer) return
    this.layer = null
    this.scene.remove(layer.root)
    this.ground?.setPickables(this.groundSurfaces())
    this.lighting.releaseLayer(layer.surfaces)
    layer.dispose()
  }

  /** setLook applique les réglages d'éclairage du tiroir : ombres, reflets, occlusion ambiante. */
  setLook(look: Look3d): void {
    this.lighting.setLook(look)
    this.post.gtao.enabled = look.ambientOcclusion
  }

  /** setFovPreference applique le réglage de champ du jeu (degrés horizontaux à 16:9) : le champ vertical de base de la caméra. */
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

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return
    if (this.exportScene.held) {
      this.exportScene.held.width = width
      this.exportScene.held.height = height
    } else {
      this.exportScene.applySize(width, height, true)
    }
  }

  /** probe rend la surface de la carte (ou du calque) sous le point d'écran (`clientX`, `clientY`), null hors carte. */
  probe(clientX: number, clientY: number): SurfaceProbe | null {
    const box = this.renderer.domElement.getBoundingClientRect()
    if (!this.model || box.width === 0 || box.height === 0) return null
    const ndc = new THREE.Vector2(((clientX - box.left) / box.width) * 2 - 1, -((clientY - box.top) / box.height) * 2 + 1)
    const roots = this.layer ? [this.model.root, this.layer.root] : [this.model.root]
    return probeSurface(roots, this.camera, ndc)
  }

  /** render pose la scène à l'image `frame` (fractionnaire) et la dessine ; rend l'état du joueur suivi. */
  render(frame: number): PovStatus {
    if (this.exportScene.held) return this.lastStatus
    this.lastFrame = frame
    let status: PovStatus = 'none'
    const p = this.profil
    let t = performance.now()
    this.renderer.info.reset()
    if (this.tracks) {
      this.placeAvatars(frame)
      t = marquer(p, 0, t)
      status = this.cameraPlacement.placeCamera(frame)
      // La lunette avant le rig : la contre-échelle du rig lit le champ de l'image en cours.
      this.placerLunette(frame)
      this.bras?.placer(this.camera)
      // Les tirs lisent la bouche du rig posé à la caméra de l'image courante : le calque d'action
      // tourne APRÈS la pose du rig, sinon la gerbe serait d'une image en retard sur le canon dessiné.
      t = marquer(p, 1, t)
      this.action?.update(frame)
    }
    if (this.mode === 'free') {
      this.fly.step(this.camera, this.orbit.target, performance.now())
      this.orbit.update()
    }
    t = marquer(p, 2, t)
    this.lighting.updateShadows(frame)
    t = marquer(p, 3, t)
    this.post.composer.render()
    t = marquer(p, 4, t)
    this.labels.render(this.scene, this.camera)
    marquer(p, 5, t)
    p.appels = this.renderer.info.render.calls
    p.triangles = this.renderer.info.render.triangles
    this.lastStatus = status
    return status
  }

  beginExport(setup: Export3dSetup): void { this.exportScene.beginExport(setup) }
  exportFrame(frame: number): HTMLCanvasElement { return this.exportScene.exportFrame(frame) }
  exportTags(): readonly ExportTag3d[] { return this.exportScene.exportTags() }
  endExport(): void { this.exportScene.endExport() }

  private applyPov(xuid: string | null): void {
    if (xuid === this.povXuid) return
    this.povXuid = xuid
    this.originAboveFloor = xuid && this.tracks ? measureOriginAboveFloor(this.tracks.allPoints(xuid), this.model, this.raycaster) : 0
  }

  /**
   * applyMode change de caméra. La caméra libre part de la vue en cours, reculée derrière le joueur
   * suivi et tournée vers lui : partir d'un point fixe au-dessus de lui la mettait dans le toit
   * dès qu'il était à l'intérieur.
   */
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
      for (const m of [a.body, a.aim, a.gun]) {
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
      }
      a.tag.element.remove()
    }
    this.detachLayer()
    if (this.ciel) { this.scene.remove(this.ciel); this.ciel.geometry.dispose(); this.ciel.material.dispose(); this.ciel = null }
    this.model?.dispose()
    // Plus de carte : un calque arrivé après la libération est refusé (`attachLayer`).
    this.model = null
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
    for (const p of tracks.players) {
      const a = this.avatars.get(p.xuid)
      if (!a) continue
      const s = tracks.sample(p.xuid, f)
      // Embarqué, le bipède ne réplique plus : il suit son véhicule.
      const rider = this.action?.riderAt(p.xuid, f) ?? null
      const firstPerson = p.xuid === this.povXuid && this.mode === 'fp'
      if (!s && !rider) {
        a.group.visible = false
        a.tag.visible = false
        continue
      }
      const feet = rider ?? feetOf(s as PlayerState3d, this.originAboveFloor)
      const h = rider ? this.action?.riderHeadingAt(p.xuid, f) ?? s?.h ?? 0 : s?.h ?? 0
      this.buildAvatar(p.xuid, a)
      // À bord, ni tangage ni locomotion : la vitesse du véhicule ne fait pas marcher le joueur.
      const pose = { h, p: rider ? 0 : s?.p ?? 0, crouch: s?.crouch ?? false, dropOeil: s?.dropOeil ?? 0, mix: this.action?.motion(p.xuid, f, rider !== null, a.mix) ?? null }
      placeBody(a, feet, pose, firstPerson, this.lighting.probeAt(feet))
      const held = s && this.action ? this.action.heldWeapon(s.slot, f) : null
      if (firstPerson) this.bras?.suivre(this.armory, this.povXuid)
      const rigVisible = firstPerson && !rider && !!s && !!this.action && !!this.bras?.montrer(this.camera, held?.key ?? null, this.action.evenementsPremierePersonne(p.xuid, s.slot, f, this.fps), held?.recoil ?? null)
      const modelArme = rigVisible ? null : held?.model ?? null
      // Le modèle d'arme se peint du revêtement du joueur : la peinture part en fond, la copie de
      // l'arme se la pose quand elle est prête et couvrante (`armory3d.coatArme`).
      const cleArme = held?.key ? weaponModelKey(held.key) : null
      if (modelArme && cleArme && this.armory) void this.armory.peindreArme(p.xuid, cleArme, modelArme)
      const coatArme = modelArme && cleArme ? (this.armory?.coatArme(p.xuid, cleArme, modelArme) ?? null) : null
      showWeapon(a, held, modelArme, firstPerson ? viewGripOf(held?.key ?? null) : null, coatArme)
      const fx = this.action?.bodyFx(p.xuid, f) ?? null
      showBodyFx(a, fx)
      // Le contour d'équipe : chaque joueur visible, sauf soi-même en 1re personne.
      if (fx && !firstPerson) this.post.outline.add(a.group, fx)
      if (firstPerson) this.inView = held?.key ? { key: held.key, name: held.name, rig: rigVisible } : null
      // À bord, le joueur suivi en 1re personne ne montre pas d'arme.
      a.group.visible = !(firstPerson && rider)
      placeTag(a.tag, feet, firstPerson ? null : this.camera.position, p.xuid === this.povXuid || !!this.action?.aids().allNameTags)
    }
  }

  /** playerFeet : les pieds d'un joueur (axes three), à bord d'un véhicule compris ; null hors vie. */
  private playerFeet(xuid: string, frame: number): THREE.Vector3 | null {
    const rider = this.action?.riderAt(xuid, frame)
    if (rider) return rider.clone()
    const s = this.tracks?.sample(xuid, frame)
    return s ? feetOf(s, this.feetDrop) : null
  }

  /**
   * placerLunette ajuste le champ du zoom 1re personne (`scopeView3d`) et retire les bras de
   * l'écran quand la lunette optique est montée ; hors 1re personne, le champ de base revient.
   */
  private placerLunette(f: number): void {
    const doc = this.doc
    if (this.mode !== 'fp' || !this.povXuid || !doc) {
      this.scopeView.reposer(this.camera)
      return
    }
    const cle = this.inView?.key ?? null
    const spec = specLunette(cle, cle ? etiquetteDe(doc, cle) : null)
    if (this.scopeView.appliquer(this.camera, doc, this.povXuid, f, spec)) this.bras?.cacher()
  }

  /** groundSurfaces : les surfaces du sol, celles de la carte puis celles du calque posé. */
  private groundSurfaces(): THREE.Mesh[] {
    return [...(this.model?.pickables ?? []), ...(this.layer?.pickables ?? [])]
  }
}

/** feetOf : les pieds d'un joueur en axes three, `drop` sous son origine publiée. */
function feetOf(s: PlayerState3d, drop: number): THREE.Vector3 {
  const [x, , z] = toThree(s.x, s.y, s.z)
  return new THREE.Vector3(x, s.z - drop, z)
}
