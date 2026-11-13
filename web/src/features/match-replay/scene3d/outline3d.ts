/**
 * outline3d.ts — LE CONTOUR D'ÉQUIPE : une ligne pleine, à la couleur du camp (allié ou adverse vu
 * du joueur de la page), autour de la silhouette entière de chaque joueur en vie, arme en main
 * comprise, d'épaisseur constante à l'écran et cachée par la carte, comme le jeu la trace.
 *
 * Deux passes du compositeur :
 *  1. LE MASQUE, juste après le rendu de la scène (dont il lit la profondeur) : une cible à elle, à
 *     demi-résolution, où chaque texel couvert porte (allié, adverse, éclat, profondeur du joueur).
 *     Les joueurs y sont rendus avec un matériau de masque (os et poses ceux de l'image), un pixel
 *     caché par la carte est jeté : seule la part visible d'un joueur entre au masque. Un joueur hors
 *     du champ n'y entre pas ; un joueur lointain y entre par sa silhouette en bâtons posée sur ses
 *     os (`outlineStand3d`, un appel de dessin au lieu des pièces de son armure et de son arme), sa
 *     silhouette n'y faisant que quelques texels (`maskDrawOf`).
 *  2. LA LIGNE, en dernier (après le passage aux couleurs de l'écran, pour que la couleur du camp
 *     sorte telle que les réglages la donnent), à pleine résolution, depuis le bord lissé du masque
 *     (`outlineShaders3d`) : un pixel hors silhouette prend la couleur du joueur le plus proche dans
 *     le rayon de la ligne, si ce qu'il montre est derrière ce joueur (un mur devant ne reçoit pas
 *     de ligne).
 *
 * L'éclat du bouclier touché (`BodyFxState.shield`) épaissit et éclaircit la ligne du joueur ; la
 * coque d'énergie (`bodyShell3d`) inonde son corps de la même couleur. Rien n'est gardé d'une image
 * à l'autre : la scène redonne les joueurs à chaque image (`begin`, `add`).
 */
import * as THREE from 'three'
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js'

import { BODY_CENTER } from './body3d'
import type { BodyFxState } from './bodyShell3d'
import { LINE_FRAGMENT, QUAD_VERTEX, SUBJECT_FRAGMENT, SUBJECT_VERTEX } from './outlineShaders3d'
import { skeletonOf, StandFigure } from './outlineStand3d'

/** L'épaisseur de la ligne (px CSS) : nette d'un coup d'œil aux distances de jeu. */
export const OUTLINE_PX = 1.5
/** Ce que l'éclat du bouclier y ajoute au plus fort (px CSS). */
export const FLARE_PX = 2.5
/** La largeur du fondu des bords de la ligne (px CSS) : l'anticrénelage. */
const SOFT_PX = 1
/** Le masque est rendu à 1 / MASK_SCALE de la résolution de l'écran, de chaque côté. */
const MASK_SCALE = 2
/**
 * Le rayon de la sphère qui contient un joueur debout (u), centrée sur son groupe (le centre du
 * corps) : les pieds et la tête à `BODY_CENTER`, l'arme tendue, les bras d'un clip.
 */
export const AVATAR_RADIUS = 0.6
/** La hauteur d'un joueur debout (u) : la taille qu'il fait à l'écran se mesure sur elle. */
const AVATAR_HEIGHT = 2 * BODY_CENTER
/**
 * Sous cette hauteur à l'écran (px de la cible), un joueur entre au masque par sa silhouette en
 * bâtons : il y tient en moins de seize texels, où l'armure et les bâtons ne se distinguent plus sous
 * une ligne de 1,5 px. Au-dessus, les bâtons s'écartent de l'armure (arme, buste tordu) : entier.
 */
export const STAND_BELOW_PX = 32

/** Comment un joueur entre au masque : pas du tout (hors du champ), en bâtons, ou entier. */
export type MaskDraw = 'skip' | 'stand' | 'whole'

/**
 * maskDrawOf : comment entre au masque un joueur dans le champ ou non (`inView`), qui fait `heightPx`
 * de haut à l'écran, avec ou sans squelette pour sa silhouette en bâtons (`hasStand`).
 */
export function maskDrawOf(inView: boolean, heightPx: number, hasStand: boolean): MaskDraw {
  if (!inView) return 'skip'
  return hasStand && heightPx < STAND_BELOW_PX ? 'stand' : 'whole'
}

/**
 * projectedHeightPx : la hauteur à l'écran (px) d'un joueur debout à la profondeur `viewDepth` (u,
 * le long de l'axe de la caméra), sous un champ vertical `fovDeg` sur `viewHeightPx` pixels.
 */
export function projectedHeightPx(viewDepth: number, fovDeg: number, viewHeightPx: number): number {
  if (viewDepth <= 0) return Infinity
  return (AVATAR_HEIGHT / (2 * viewDepth * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2))) * viewHeightPx
}

/**
 * Un joueur à tracer à l'image : sa racine (corps et arme), son squelette (null sans Spartan, relevé
 * par `plan`), son camp, l'éclat de son bouclier.
 */
interface Subject {
  root: THREE.Object3D
  skeleton: THREE.Skeleton | null
  ally: boolean
  flare: number
}

export class Outline3d {
  /** La passe du masque, à poser juste après le rendu de la scène. */
  readonly maskPass: Pass
  /** La passe de la ligne, à poser en dernier. */
  readonly linePass: Pass
  private readonly camera: THREE.PerspectiveCamera
  private readonly mask = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
  })
  private readonly lineQuad: FullScreenQuad
  private readonly subjects: Subject[] = []
  private count = 0
  private preparedPlan: 'whole' | 'stand' | null = null
  /** Un matériau de masque par joueur de l'image (le camp et l'éclat sont ses uniformes). */
  private readonly materials: THREE.ShaderMaterial[] = []
  private readonly swapped: { mesh: THREE.Mesh; material: THREE.Mesh['material'] }[] = []
  private readonly hidden: THREE.Object3D[] = []
  /** Les silhouettes en bâtons des joueurs lointains, rendues ensemble. */
  private readonly stands = new THREE.Group()
  private readonly figures: StandFigure[] = []
  private readonly clear = new THREE.Color()
  /** Les couleurs des camps, en couleurs d'écran (le compositeur les a déjà converties). */
  private readonly ally = new THREE.Color()
  private readonly enemy = new THREE.Color()
  private readonly frustum = new THREE.Frustum()
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), AVATAR_RADIUS)
  private readonly viewProj = new THREE.Matrix4()
  private readonly center = new THREE.Vector3()

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera
    this.stands.matrixWorldAutoUpdate = false
    this.lineQuad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        vertexShader: QUAD_VERTEX,
        fragmentShader: LINE_FRAGMENT,
        uniforms: {
          tDiffuse: { value: null },
          tMask: { value: this.mask.texture },
          tDepth: { value: null },
          uNear: { value: 0 },
          uFar: { value: 1 },
          uTexel: { value: new THREE.Vector2() },
          uBase: { value: 1 },
          uFlare: { value: 1 },
          uSoft: { value: 1 },
          uMaskPx: { value: MASK_SCALE },
          uAlly: { value: this.ally },
          uEnemy: { value: this.enemy },
        },
        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending,
      }),
    )
    this.maskPass = new OutlinePass((renderer, read) => this.drawMask(renderer, read), false)
    this.linePass = new OutlinePass((renderer, read, write, screen) => this.drawLine(renderer, read, write, screen), true)
  }

  /** begin vide la liste des joueurs de l'image. */
  begin(): void {
    this.count = 0
  }

  /**
   * add trace le joueur de racine `root` à l'état `fx` ; sans camp ou sous le camouflage, rien (le
   * jeu ne trace pas un joueur invisible). Le joueur doit être visible : un groupe caché ne trace rien.
   */
  add(root: THREE.Object3D, fx: BodyFxState): void {
    if (fx.ally === null || fx.equip.camo > 0) return
    // La couleur d'écran du camp : celle des réglages, telle que l'étiquette la montre.
    ;(fx.ally ? this.ally : this.enemy).copy(fx.teamColor).convertLinearToSRGB()
    const s = this.subjects[this.count] ?? (this.subjects[this.count] = { root, skeleton: null, ally: false, flare: 0 })
    s.root = root
    s.skeleton = null
    s.ally = fx.ally
    s.flare = Math.min(1, Math.max(fx.shield.hit, fx.shield.broke))
    this.count++
  }

  /** subjectsOf : les joueurs posés à l'image (tests). */
  subjectsOf(): readonly { root: THREE.Object3D; ally: boolean; flare: number }[] {
    return this.subjects.slice(0, this.count).map((s) => ({ root: s.root, ally: s.ally, flare: s.flare }))
  }

  /** Dessine les deux formes du masque pour les racines préparées, puis rend les sujets de l'image. */
  avecSujetsPrepares(roots: readonly THREE.Object3D[], rendre: (plan: (mode: 'whole' | 'stand') => void) => void): void {
    const sujets = this.subjects.splice(0)
    const count = this.count
    const enabled = this.maskPass.enabled
    const visibilites = this.stands.children.map((o) => o.visible)
    this.subjects.push(...roots.map((root) => ({ root, skeleton: null, ally: true, flare: 0 })))
    this.count = roots.length
    this.maskPass.enabled = true
    try { rendre((mode) => { this.preparedPlan = mode }) } finally {
      this.subjects.splice(0, this.subjects.length, ...sujets)
      this.count = count
      this.maskPass.enabled = enabled
      this.preparedPlan = null
      this.stands.children.forEach((o, i) => { o.visible = visibilites[i] ?? false })
    }
  }

  /**
   * plan : comment chaque joueur de l'image entre au masque, vu de la caméra (matrices à jour) sur
   * une cible de `viewHeightPx` pixels de haut.
   */
  plan(viewHeightPx: number): MaskDraw[] {
    const cam = this.camera
    this.viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.viewProj)
    const out: MaskDraw[] = []
    for (let i = 0; i < this.count; i++) {
      const s = this.subjects[i]
      if (this.preparedPlan) {
        s.skeleton = this.preparedPlan === 'stand' ? skeletonOf(s.root) : null
        out.push(s.skeleton ? 'stand' : 'whole')
        continue
      }
      this.sphere.center.setFromMatrixPosition(s.root.matrixWorld)
      const inView = this.frustum.intersectsSphere(this.sphere)
      const depth = -this.center.copy(this.sphere.center).applyMatrix4(cam.matrixWorldInverse).z
      const heightPx = projectedHeightPx(depth, cam.fov, viewHeightPx)
      s.skeleton = inView && heightPx < STAND_BELOW_PX ? skeletonOf(s.root) : null
      out.push(maskDrawOf(inView, heightPx, s.skeleton !== null))
    }
    return out
  }

  dispose(): void {
    this.mask.dispose()
    this.lineQuad.dispose()
    for (const m of this.materials) m.dispose()
    for (const f of this.figures) f.mesh.dispose()
  }

  private drawMask(renderer: THREE.WebGLRenderer, read: THREE.WebGLRenderTarget): void {
    const depth = read.depthTexture
    if (!depth) return
    const w = Math.max(1, Math.ceil(read.width / MASK_SCALE))
    const h = Math.max(1, Math.ceil(read.height / MASK_SCALE))
    if (this.mask.width !== w || this.mask.height !== h) this.mask.setSize(w, h)
    // La ligne lit la profondeur de la scène à pleine résolution (le compositeur la garde intacte jusque-là, `postFx3d`).
    ;(this.lineQuad.material as THREE.ShaderMaterial).uniforms.tDepth.value = depth
    const before = renderer.getRenderTarget()
    const autoClear = renderer.autoClear
    renderer.getClearColor(this.clear)
    const clearAlpha = renderer.getClearAlpha()
    renderer.setRenderTarget(this.mask)
    renderer.setClearColor(0x000000, 0)
    renderer.clear(true, true, false)
    renderer.autoClear = false
    try {
      const plan = this.plan(read.height)
      let stands = 0
      for (let i = 0; i < this.count; i++) {
        if (plan[i] === 'skip') continue
        const s = this.subjects[i]
        const m = this.materialOf(i, depth)
        if (plan[i] === 'stand') {
          this.placeStand(stands++, s.skeleton as THREE.Skeleton, m)
          continue
        }
        this.wear(s.root, m)
        try { renderer.render(s.root, this.camera) } finally { this.undress() }
      }
      for (let i = 0; i < this.stands.children.length; i++) this.stands.children[i].visible = i < stands
      if (stands > 0) renderer.render(this.stands, this.camera)
    } finally {
      renderer.autoClear = autoClear
      renderer.setClearColor(this.clear, clearAlpha)
      renderer.setRenderTarget(before)
    }
  }

  private drawLine(renderer: THREE.WebGLRenderer, read: THREE.WebGLRenderTarget, write: THREE.WebGLRenderTarget, screen: boolean): void {
    const u = (this.lineQuad.material as THREE.ShaderMaterial).uniforms
    const ratio = renderer.getPixelRatio()
    u.tDiffuse.value = read.texture
    u.uNear.value = this.camera.near
    u.uFar.value = this.camera.far
    ;(u.uTexel.value as THREE.Vector2).set(1 / read.width, 1 / read.height)
    u.uBase.value = OUTLINE_PX * ratio
    u.uFlare.value = FLARE_PX * ratio
    u.uSoft.value = SOFT_PX * ratio
    renderer.setRenderTarget(screen ? null : write)
    this.lineQuad.render(renderer)
  }

  /** materialOf : le matériau de masque du joueur `i` de l'image, à son camp et à son éclat. */
  private materialOf(i: number, depth: THREE.DepthTexture): THREE.ShaderMaterial {
    const m = this.materials[i] ?? (this.materials[i] = subjectMaterial())
    const s = this.subjects[i]
    m.uniforms.tDepth.value = depth
    m.uniforms.uSize.value.set(this.mask.width, this.mask.height)
    m.uniforms.uNear.value = this.camera.near
    m.uniforms.uFar.value = this.camera.far
    m.uniforms.uSide.value.set(s.ally ? 1 : 0, s.ally ? 0 : 1, s.flare)
    return m
  }

  /** placeStand pose la silhouette en bâtons de rang `k` sur `skeleton`, au matériau `m`. */
  private placeStand(k: number, skeleton: THREE.Skeleton, m: THREE.Material): void {
    let figure = this.figures[k]
    if (!figure) {
      figure = this.figures[k] = new StandFigure()
      this.stands.add(figure.mesh)
    }
    figure.pose(skeleton)
    figure.mesh.material = m
  }

  /**
   * wear habille du matériau de masque les maillages visibles de `root` ; la coque d'énergie
   * (`noOutline`) est cachée le temps du masque, où son propre nuanceur écrirait sa couleur.
   */
  private wear(root: THREE.Object3D, m: THREE.Material): void {
    root.traverseVisible((o) => {
      if (!(o instanceof THREE.Mesh)) return
      if (o.userData.noOutline) {
        o.visible = false
        this.hidden.push(o)
        return
      }
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      if (!mats.some((x: THREE.Material) => x.visible)) return
      this.swapped.push({ mesh: o, material: o.material })
      o.material = m
    })
  }

  private undress(): void {
    for (const s of this.swapped) s.mesh.material = s.material
    for (const o of this.hidden) o.visible = true
    this.swapped.length = 0
    this.hidden.length = 0
  }
}

/** subjectMaterial : le matériau de masque d'un joueur (os de l'image, profondeur de la scène). */
function subjectMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SUBJECT_VERTEX,
    fragmentShader: SUBJECT_FRAGMENT,
    uniforms: {
      tDepth: { value: null },
      uSize: { value: new THREE.Vector2(1, 1) },
      uSide: { value: new THREE.Vector3() },
      uNear: { value: 0 },
      uFar: { value: 1 },
    },
    side: THREE.DoubleSide,
    blending: THREE.NoBlending,
  })
}

type PassBody = (renderer: THREE.WebGLRenderer, read: THREE.WebGLRenderTarget, write: THREE.WebGLRenderTarget, screen: boolean) => void

/** OutlinePass : une passe du compositeur qui délègue au contour. */
class OutlinePass extends Pass {
  private readonly body: PassBody

  constructor(body: PassBody, swap: boolean) {
    super()
    this.body = body
    this.needsSwap = swap
  }

  render(renderer: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    this.body(renderer, read, write, this.renderToScreen)
  }
}
