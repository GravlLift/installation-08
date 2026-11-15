/**
 * shadowSplit3d.ts — THE SUN'S SHADOW MAP IN TWO PARTS: the static map, drawn once, and what moves,
 * drawn at each replay frame on top of it.
 *
 * The shadow map follows the players and vehicles, so it is redone at each new replay frame; three
 * redraws every shadow caster for it, the whole map and its variant layer included (Recharge: 5.9M
 * triangles into the 4096 map per frame, as many as the view itself). The map does not move: its
 * casters (`setStatic`, the map and layer roots) are drawn once into a kept target, and each frame
 * the stock pass draws only the rest of the scene (players, weapons, vehicles, effects), then a
 * full-screen triangle merges the kept map in: it writes the kept texel and its depth (unpacked
 * from the RGBA packing three's PCF shadow maps use) under a depth test, so each texel keeps the
 * nearer of the two casters. The result is the map three would have drawn with every caster.
 *
 * It replaces `renderer.shadowMap.render` on the renderer (the stock pass still runs inside it):
 * the work stays inside `renderer.render`, where three's render state, matrices and skeletons are
 * ready. Any other call (another scene, other shadow lights, nothing static yet, `split` off) goes
 * to the stock pass unchanged.
 */
import * as THREE from 'three'

type ShadowRender = (lights: THREE.Light[], scene: THREE.Object3D, camera: THREE.Camera) => void

const MERGE_VERTEX = 'varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }'
const MERGE_FRAGMENT = `#include <packing>
uniform sampler2D tStatic;
varying vec2 vUv;
void main() {
  vec4 packed = texture2D(tStatic, vUv);
  gl_FragDepth = unpackRGBAToDepth(packed);
  gl_FragColor = packed;
}`

export class ShadowSplit {
  /** Off: every shadow update draws every caster (the stock pass), for A/B measurements. */
  split = true
  /** What the shadow updates drew since the scene last reset it (`renderer.info`), for the playback meter. */
  readonly cost = { calls: 0, triangles: 0 }
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly sun: THREE.DirectionalLight
  private readonly stock: ShadowRender
  private statics: THREE.Object3D[] = []
  private readonly staticSet = new Set<THREE.Object3D>()
  private kept: THREE.WebGLRenderTarget | null = null
  private dirty = true
  /** Stand-in parents the stock pass walks: their `children` point at scene objects without adopting them. */
  private readonly staticPart = new THREE.Group()
  private readonly movingPart = new THREE.Group()
  private readonly quadCamera = new THREE.OrthographicCamera()
  private readonly quadScene = new THREE.Scene()
  private readonly quad: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, sun: THREE.DirectionalLight) {
    this.renderer = renderer
    this.scene = scene
    this.sun = sun
    const shadowMap = renderer.shadowMap as THREE.WebGLShadowMap & { render?: ShadowRender }
    const stock = shadowMap.render
    // A stand-in renderer (tests) without a shadow pass: nothing to split.
    this.stock = typeof stock === 'function' ? stock.bind(shadowMap) : () => {}
    if (typeof stock === 'function') shadowMap.render = (lights, s, camera) => this.render(lights, s, camera)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
    const material = new THREE.ShaderMaterial({
      vertexShader: MERGE_VERTEX,
      fragmentShader: MERGE_FRAGMENT,
      uniforms: { tStatic: { value: null } },
      depthTest: true,
      depthWrite: true,
      depthFunc: THREE.LessDepth,
      blending: THREE.NoBlending,
      side: THREE.DoubleSide,
    })
    this.quad = new THREE.Mesh(geometry, material)
    this.quad.frustumCulled = false
  }

  /** setStatic: the roots whose casters never move (map, variant layer); the kept map is redone. */
  setStatic(roots: readonly THREE.Object3D[]): void {
    this.statics = [...roots]
    this.staticSet.clear()
    for (const r of roots) this.staticSet.add(r)
    this.invalidate()
  }

  /** invalidate: the static casters or the sun changed, the kept map is redone at the next shadow update. */
  invalidate(): void {
    this.dirty = true
  }

  dispose(): void {
    this.kept?.dispose()
    this.kept = null
    this.quad.geometry.dispose()
    this.quad.material.dispose()
  }

  private render(lights: THREE.Light[], scene: THREE.Object3D, camera: THREE.Camera): void {
    const shadowMap = this.renderer.shadowMap
    if (!shadowMap.enabled || (!shadowMap.autoUpdate && !shadowMap.needsUpdate)) return
    const info = this.renderer.info?.render
    const calls = info?.calls ?? 0
    const triangles = info?.triangles ?? 0
    try { this.update(lights, scene, camera) } finally {
      this.cost.calls += (info?.calls ?? 0) - calls
      this.cost.triangles += (info?.triangles ?? 0) - triangles
    }
  }

  private update(lights: THREE.Light[], scene: THREE.Object3D, camera: THREE.Camera): void {
    const shadowMap = this.renderer.shadowMap
    if (!this.split || scene !== this.scene || this.statics.length === 0 || lights.length !== 1 || lights[0] !== this.sun) {
      this.stock(lights, scene, camera)
      return
    }
    const shadow = this.sun.shadow
    if (this.dirty || !this.kept) {
      this.staticPart.children = this.statics
      this.stock(lights, this.staticPart, camera)
      this.kept?.dispose()
      this.kept = shadow.map
      // A fresh target for the moving part: three makes it at the next pass, at the same size.
      shadow.map = null
      this.dirty = false
      shadowMap.needsUpdate = true
    }
    const moving = this.movingPart.children
    moving.length = 0
    for (const c of this.scene.children) if (!this.staticSet.has(c)) moving.push(c)
    this.stock(lights, this.movingPart, camera)
    const map = shadow.map
    if (!map || !this.kept) return
    const target = this.renderer.getRenderTarget()
    const face = this.renderer.getActiveCubeFace()
    const mip = this.renderer.getActiveMipmapLevel()
    this.quad.material.uniforms.tStatic.value = this.kept.texture
    this.renderer.setRenderTarget(map)
    this.renderer.renderBufferDirect(this.quadCamera, this.quadScene, this.quad.geometry, this.quad.material, this.quad, null)
    this.renderer.setRenderTarget(target, face, mip)
  }
}
