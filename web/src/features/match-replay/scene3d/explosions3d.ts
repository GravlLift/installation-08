// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * explosions3d.ts — LES EXPLOSIONS DANS LA SCÈNE 3D : les éclats de `explosionFx3d` posés en deux
 * appels de dessin quel que soit leur nombre.
 *
 *  - Les éclats ronds (éclair, bouffées de feu, fumée) : UN nuage de points, chaque point un disque
 *    doux et bosselé tracé dans le nuanceur (aucune texture), à taille monde (sa taille à l'écran suit
 *    la distance). Mélange pré-multiplié : un éclat émet sa lumière (`r, g, b`) et cache ce qui est
 *    derrière lui selon son opacité (`a`), d'où une boule de feu qui a du corps et des lueurs qui
 *    n'en ont pas, dans le même lot.
 *  - Les étincelles : un lot de traits fins additifs (`SegmentPool`).
 *
 * Chaque image est reposée en entier depuis l'âge des explosions (`begin`, `add`, `end`) : rien n'est
 * simulé, rien n'est créé pendant la lecture.
 */
import * as THREE from 'three'

import { SegmentPool } from './actionKit'
import { blastAt, type BlastInk, type BlastSink, type BlastStyle } from './explosionFx3d'

/** Au plus autant d'éclats ronds et d'étincelles par image (une dizaine d'explosions simultanées). */
const SPRITE_CAPACITY = 1024
const STREAK_CAPACITY = 1024
/** L'épaisseur d'une étincelle (u) : ~1,5 cm, un trait blanc fin. */
const STREAK_RADIUS = 0.005
/** Le centre de l'explosion au-dessus du point de détonation (u, ~1 m) : la grenade saute en l'air. */
const BLAST_LIFT = 0.35

const VERTEX = /* glsl */ `
attribute vec3 aColor;
attribute float aAlpha;
attribute float aRadius;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
varying float vSeed;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, 2.0 * aRadius * uScale / max(0.05, -mv.z));
  vColor = aColor;
  vAlpha = aAlpha;
  vSeed = fract(dot(position, vec3(12.9898, 78.233, 37.719)));
}`

const FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vSeed;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  float a = atan(p.y, p.x);
  float lump = 0.1 * sin(a * 5.0 + vSeed * 40.0) + 0.07 * sin(a * 9.0 - vSeed * 23.0);
  float w = 1.0 - smoothstep(0.4 + lump, 1.0 + 0.5 * lump, r);
  if (w <= 0.002) discard;
  // Le cœur plus chaud que le bord : la lumière décroît plus vite que le corps, qui garde sa masse.
  gl_FragColor = vec4(vColor * w * (0.6 + 0.8 * w), vAlpha * sqrt(w));
}`

export class Explosions3d {
  private readonly points: THREE.Points
  private readonly material: THREE.ShaderMaterial
  private readonly position = new Float32Array(SPRITE_CAPACITY * 3)
  private readonly color = new Float32Array(SPRITE_CAPACITY * 3)
  private readonly alpha = new Float32Array(SPRITE_CAPACITY)
  private readonly radius = new Float32Array(SPRITE_CAPACITY)
  private readonly streaks: SegmentPool
  private n = 0
  private readonly center = new THREE.Vector3()
  private readonly a = new THREE.Vector3()
  private readonly b = new THREE.Vector3()
  private readonly c = new THREE.Color()
  private readonly viewport = new THREE.Vector4()
  private readonly sink: BlastSink

  constructor(parent: THREE.Object3D) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute('aRadius', new THREE.BufferAttribute(this.radius, 1).setUsage(THREE.DynamicDrawUsage))
    geometry.setDrawRange(0, 0)
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uScale: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    })
    this.points = new THREE.Points(geometry, this.material)
    this.points.frustumCulled = false
    // La taille d'un point se donne en pixels : celle de l'unité monde à un mètre de la caméra,
    // relue au rendu (taille de la cible, export compris).
    this.points.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getCurrentViewport(this.viewport)
      this.material.uniforms.uScale.value = (camera.projectionMatrix.elements[5] * this.viewport.w) / 2
    }
    parent.add(this.points)
    const glow = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    this.streaks = new SegmentPool(parent, glow, STREAK_CAPACITY)
    this.sink = {
      sprite: (x, y, z, radius, r, g, b, a) => this.sprite(x, y, z, radius, r, g, b, a),
      streak: (x0, y0, z0, x1, y1, z1, r, g, b) => {
        this.a.set(x0, y0, z0).add(this.center)
        this.b.set(x1, y1, z1).add(this.center)
        this.streaks.add(this.a, this.b, STREAK_RADIUS, this.c.setRGB(r, g, b))
      },
    }
  }

  begin(): void {
    this.n = 0
    this.streaks.begin()
  }

  /** add pose l'explosion de style `style` au point `at` (axes three), `age` secondes après elle. */
  add(at: THREE.Vector3, style: BlastStyle, age: number, seed: number, ink: BlastInk): void {
    // Les éclats sont des disques face à la caméra : posés au sol, le sol en couperait la moitié basse.
    this.center.copy(at).setY(at.y + BLAST_LIFT)
    blastAt(style, age, seed, ink, this.sink)
  }

  end(): void {
    const g = this.points.geometry
    g.setDrawRange(0, this.n)
    for (const name of ['position', 'aColor', 'aAlpha', 'aRadius']) g.getAttribute(name).needsUpdate = true
    this.streaks.end()
  }

  /** drawn : les éclats ronds de la dernière image (mesure, tests). */
  drawn(): number {
    return this.n
  }

  dispose(): void {
    this.points.removeFromParent()
    this.points.geometry.dispose()
    this.material.dispose()
    this.streaks.dispose()
  }

  private sprite(x: number, y: number, z: number, radius: number, r: number, g: number, b: number, a: number): void {
    if (this.n >= SPRITE_CAPACITY) return
    const i = this.n++
    this.position[i * 3] = this.center.x + x
    this.position[i * 3 + 1] = this.center.y + y
    this.position[i * 3 + 2] = this.center.z + z
    this.color[i * 3] = r
    this.color[i * 3 + 1] = g
    this.color[i * 3 + 2] = b
    this.alpha[i] = a
    this.radius[i] = radius
  }
}
