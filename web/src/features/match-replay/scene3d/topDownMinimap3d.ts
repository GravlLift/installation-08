/**
 * topDownMinimap3d.ts — the corner minimap over the 3D view: the painted top-down map around the
 * followed player, north-up like the 2D top-down view (`SCREEN_UP_HEADING_DEG`), with a dot per
 * living player, in a square at the top right, under the top strip's place (`minimapRect`). The
 * math is `minimapLogic`.
 *
 * It never renders the map at the screen's rate: the map around the player is rendered into a
 * cached image, staged like the 2D view's picture (the same fixed cut over the highest walked
 * floor, the same flat light and height shading by world height), only when he has strayed from
 * its center, at most twice a second (`minimapStale`). The map it shows is the same picture
 * wherever he goes; only the window moves. Each frame draws one textured square that reads its
 * turned window out of that image, and the dots, in the corner of the screen after the 3D frame.
 */
import * as THREE from 'three'

import { cssColor } from './cssColor'
import { MINIMAP_IMAGE_SPAN_U, SCREEN_UP_HEADING_DEG, minimapAngle, minimapHit, minimapPoint, minimapRect, minimapStale, minimapUvRows, type MinimapImage, type MinimapPose, type MinimapRect } from './minimapLogic'
import type { MarkerPose } from './playerMarkers3d'
import { DIMMED_MARKER_OPACITY, MARKER_RADIUS_PX, floorOf } from './playerMarkers3d_logic'
import { GRADE_GAIN } from './postFx3d'
import { renderTopImage, topTarget } from './topDownImage3d'
import { CutFollower } from './topDownLogic'
import type { Insets, Viewport } from './topDownNavLogic'
import type { TopDownStage } from './topDownStage3d'

/** The cached image's side (px): about 13 px per unit, sharp on the minimap at a pixel ratio of 2. */
const IMAGE_PX = 1024
/** A dot's radius on the minimap, as a share of the top-down view's marker (CSS px). */
const DOT_SHARE = 0.6
/** The dark halo under a dot, in dot radii. */
const DOT_HALO = 1.4
/** The frame around the minimap (CSS px). */
const FRAME_PX = 1.5
/** Dot layers: halo under the disc, the disc and its wedge over it. */
const ORDER_HALO = 1
const ORDER_DOT = 2

/** What the minimap draws at a frame. */
export interface MinimapDraw {
  /** One pose per living player. */
  players: readonly MarkerPose[]
  /** The player it centers on; null hides it (no player, free camera). */
  followed: string | null
}

/** What it is built on: shared with the top-down view. */
export interface MinimapSetup {
  renderer: THREE.WebGLRenderer
  stage: TopDownStage
  /** The picture's fixed cut and bottom (scene Y), the 2D view's. */
  topY: number
  lowestY: number
}

interface Dot {
  halo: THREE.Mesh
  disc: THREE.Mesh
  wedge: THREE.Mesh
  material: THREE.MeshBasicMaterial
}

const VERTEX = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
const FRAGMENT = `
uniform sampler2D map; uniform vec3 rowU; uniform vec3 rowV; uniform vec3 studio; uniform vec3 frameColor; uniform vec3 gain; uniform float frame;
varying vec2 vUv;
void main() {
  vec2 st = vec2(dot(rowU, vec3(vUv, 1.0)), dot(rowV, vec3(vUv, 1.0)));
  bool inside = st.x >= 0.0 && st.x <= 1.0 && st.y >= 0.0 && st.y <= 1.0;
  gl_FragColor = inside ? vec4(texture2D(map, st).rgb, 1.0) : vec4(studio, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb *= gain;
  if (min(min(vUv.x, vUv.y), min(1.0 - vUv.x, 1.0 - vUv.y)) < frame) gl_FragColor = vec4(frameColor, 1.0);
}`

export class TopDownMinimap {
  /** Shown over the 3D view (the viewer's setting). */
  enabled = false
  private readonly s: MinimapSetup
  private readonly target = topTarget(IMAGE_PX)
  private readonly imageCamera = new THREE.OrthographicCamera()
  private image: MinimapImage | null = null
  private readonly cut: CutFollower
  /** Where the minimap looks: the followed player, or where he was last seen alive. */
  private pose: { xuid: string; pose: MinimapPose } | null = null
  private readonly overlay = new THREE.Scene()
  /** The minimap's square on the canvas (CSS px), set while it draws; null while it is not. */
  private rect: MinimapRect | null = null
  private readonly camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -1, 1)
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  private readonly dots = new Map<string, Dot>()
  private readonly geo = { disc: new THREE.CircleGeometry(1, 20), wedge: wedgeGeometry() }
  private readonly haloMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false })
  /** The frame color, the page's `--air` token, set once. */
  private frameRead = false

  constructor(s: MinimapSetup) {
    this.s = s
    this.cut = new CutFollower(s.lowestY)
    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: this.target.texture },
        rowU: { value: new THREE.Vector3() },
        rowV: { value: new THREE.Vector3() },
        studio: { value: new THREE.Color() },
        frameColor: { value: new THREE.Color() },
        gain: { value: new THREE.Vector3(...GRADE_GAIN) },
        frame: { value: 0 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
    })
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
    this.overlay.add(this.quad)
  }

  /** The scene graph changed: the cached image is redone at the next draw. */
  invalidate(): void {
    this.image = null
  }

  /** Draw the minimap in its corner of the screen, over the frame already there. */
  draw(d: MinimapDraw, view: Viewport, insets: Insets): void {
    const pose = this.enabled ? this.poseOf(d) : null
    if (!pose || !d.followed) {
      this.rect = null
      return
    }
    const now = performance.now()
    const me = d.players.find((p) => p.xuid === d.followed)
    // His floor only dims the dots of players on another one; the picture keeps its fixed cut.
    const cutY = this.cut.step(now, d.followed, me ? me.feet.y : null, d.players.map((p) => p.feet.y))
    const want: MinimapImage = { center: pose.center, cutY: this.s.topY, at: now, followed: d.followed }
    if (minimapStale(this.image, want)) this.renderImage(want)
    const image = this.image as MinimapImage
    const rect = minimapRect(view, insets)
    this.rect = rect
    this.paint(pose, image, rect.side)
    this.placeDots(d, pose, cutY, rect.side)
    this.renderOverlay(view, rect)
  }

  /** minimapHit — a canvas point (x, y in CSS px from the canvas's top left) on the drawn minimap. */
  hit(x: number, y: number): boolean {
    return this.rect !== null && minimapHit(this.rect, x, y)
  }

  dispose(): void {
    this.rect = null
    this.target.dispose()
    this.quad.geometry.dispose()
    this.quad.material.dispose()
    for (const dot of this.dots.values()) dot.material.dispose()
    this.haloMaterial.dispose()
    this.geo.disc.dispose()
    this.geo.wedge.dispose()
  }

  /** The followed player's pose, his last one while he is out of life; null before he is ever seen. */
  private poseOf(d: MinimapDraw): MinimapPose | null {
    if (!d.followed) return null
    const me = d.players.find((p) => p.xuid === d.followed)
    // North-up, like the 2D top-down view: the map does not turn with him; his own wedge does.
    if (me) this.pose = { xuid: me.xuid, pose: { center: [me.feet.x, me.feet.z], heading: SCREEN_UP_HEADING_DEG } }
    return this.pose?.xuid === d.followed ? this.pose.pose : null
  }

  /** Render the map around the player into the cached image (map only, at the picture's fixed cut). */
  private renderImage(want: MinimapImage): void {
    const { renderer, stage, lowestY } = this.s
    renderTopImage({ renderer, stage, camera: this.imageCamera, target: this.target, square: { center: want.center, side: MINIMAP_IMAGE_SPAN_U }, cutY: want.cutY, lowestY, clear: true })
    this.image = want
  }

  /** Set the square's uniforms: the turned window of the image, the colors, the frame width. */
  private paint(pose: MinimapPose, image: MinimapImage, side: number): void {
    const u = this.quad.material.uniforms
    const [rowU, rowV] = minimapUvRows(pose, image.center)
    ;(u.rowU.value as THREE.Vector3).set(...rowU)
    ;(u.rowV.value as THREE.Vector3).set(...rowV)
    const studio = this.s.stage.studioColor()
    if (studio) (u.studio.value as THREE.Color).copy(studio)
    if (!this.frameRead) {
      this.frameRead = true
      // Written after the color space conversion: the frame takes the token's sRGB values as they are.
      const air = getComputedStyle(document.documentElement).getPropertyValue('--air').trim()
      if (air) (u.frameColor.value as THREE.Color).setRGB(...rgbOf(cssColor(air, new THREE.Color())))
    }
    u.frame.value = FRAME_PX / Math.max(side, 1)
  }

  /** Pose a dot per living player inside the square: north-up, each wedge on its own heading, dimmed off the drawn floor. */
  private placeDots(d: MinimapDraw, pose: MinimapPose, cutY: number, side: number): void {
    const radius = (MARKER_RADIUS_PX * DOT_SHARE) / Math.max(side, 1)
    for (const dot of this.dots.values()) dot.halo.visible = dot.disc.visible = dot.wedge.visible = false
    const studio = this.s.stage.studioColor()
    if (studio) this.haloMaterial.color.copy(studio)
    for (const p of d.players) {
      const [x, y] = minimapPoint(pose, p.feet.x, p.feet.z)
      if (Math.abs(x) > 0.5 - radius || Math.abs(y) > 0.5 - radius) continue
      const dot = this.dotFor(p)
      dot.material.opacity = floorOf(p.feet.y, cutY) ? DIMMED_MARKER_OPACITY : 1
      dot.halo.visible = studio !== null
      dot.disc.visible = dot.wedge.visible = true
      for (const m of [dot.halo, dot.disc, dot.wedge]) m.position.set(x, y, 0)
      dot.halo.scale.setScalar(radius * DOT_HALO)
      dot.disc.scale.setScalar(radius)
      dot.wedge.scale.setScalar(radius)
      dot.wedge.rotation.z = minimapAngle(pose, p.heading)
    }
  }

  private dotFor(p: MarkerPose): Dot {
    let dot = this.dots.get(p.xuid)
    if (!dot) {
      const material = new THREE.MeshBasicMaterial({ color: p.avatar.tint, transparent: true, depthTest: false, depthWrite: false })
      const halo = new THREE.Mesh(this.geo.disc, this.haloMaterial)
      const disc = new THREE.Mesh(this.geo.disc, material)
      const wedge = new THREE.Mesh(this.geo.wedge, material)
      halo.renderOrder = ORDER_HALO
      disc.renderOrder = wedge.renderOrder = ORDER_DOT
      this.overlay.add(halo, disc, wedge)
      dot = { halo, disc, wedge, material }
      this.dots.set(p.xuid, dot)
    }
    return dot
  }

  /** Draw the overlay scene in the minimap's square of the screen; the renderer's state is given back. */
  private renderOverlay(view: Viewport, rect: { left: number; top: number; side: number }): void {
    const r = this.s.renderer
    const saved = { autoClear: r.autoClear, viewport: r.getViewport(new THREE.Vector4()), target: r.getRenderTarget() }
    r.setRenderTarget(null)
    r.autoClear = false
    const y = view.height - rect.top - rect.side
    r.setViewport(rect.left, y, rect.side, rect.side)
    r.setScissor(rect.left, y, rect.side, rect.side)
    r.setScissorTest(true)
    try {
      r.render(this.overlay, this.camera)
    } finally {
      r.setScissorTest(false)
      r.setViewport(saved.viewport)
      r.setRenderTarget(saved.target)
      r.autoClear = saved.autoClear
    }
  }
}

/** The facing wedge on the minimap, out of a unit disc toward +Y (the minimap's up). */
function wedgeGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  // The top-down marker's wedge (playerMarkers3d), in the minimap's plane.
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.6, 0.5, 0, 0.6, 0.5, 0, 0, 1.9, 0], 3))
  return g
}

function rgbOf(c: THREE.Color): [number, number, number] {
  const out = { r: 0, g: 0, b: 0 }
  c.getRGB(out, THREE.SRGBColorSpace)
  return [out.r, out.g, out.b]
}
