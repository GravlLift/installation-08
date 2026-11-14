/**
 * shroud3d.ts — THE SHROUD SCREEN'S BUBBLE DRAWN: an opaque sphere that nobody sees through, from
 * outside or from inside (`shroud3d_logic` gives its place, radius and age).
 *
 * OPAQUE AND DEPTH-WRITING, BOTH FACES: the sphere hides what is behind it from every camera, and a
 * camera inside it sees only its inner wall. The surface is dark and smoky with a faint honeycomb
 * and a brighter rim: an ESTIMATE of the look (the owner's description of the game's bubble; its
 * render model and material are not in the data the app reads, see `shroud3d_logic`). Its two inks
 * are the bubble's theme inks (`inks.shroud.core`, the night blue, and `inks.shroud.glow`, the
 * electric blue, user decision of 2026-10-30), passed in by the layer: no color is written here.
 */
import * as THREE from 'three'

import type { ShroudBubble } from './shroud3d_logic'

/** Most bubbles up at once (each shroud screen lasts 7.5 s; beyond, a bubble is skipped). */
const CAPACITY = 8

/** Honeycomb cells across a unit of the sphere's direction (on-screen choice: about 20 around the bubble). */
const HEX_CELLS = 3.5

const VERTEX = /* glsl */ `
varying vec3 vDir;
varying vec3 vNormalView;
varying vec3 vViewPos;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  vNormalView = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}
`

const FRAGMENT = /* glsl */ `
uniform vec3 uCore;
uniform vec3 uGlow;
uniform float uAge;
uniform float uCells;
varying vec3 vDir;
varying vec3 vNormalView;
varying vec3 vViewPos;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

// Distance from a point of the plane to the nearest edge of its hexagonal cell (0 on the edge).
float hexEdge(vec2 p) {
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 q = abs(g);
  return 0.5 - max(dot(q, normalize(r)), q.x);
}

void main() {
  vec3 d = normalize(vDir);
  vec3 w = abs(d);
  w /= (w.x + w.y + w.z);
  float edge = hexEdge(d.yz * uCells) * w.x + hexEdge(d.xz * uCells) * w.y + hexEdge(d.xy * uCells) * w.z;
  float comb = 1.0 - smoothstep(0.015, 0.06, edge);
  vec3 drift = vec3(0.0, uAge * 0.12, uAge * 0.05);
  float smoke = 0.6 * noise(d * 2.5 + drift) + 0.4 * noise(d * 6.0 - drift);
  float rim = 1.0 - abs(dot(normalize(vNormalView), normalize(-vViewPos)));
  vec3 col = uCore * (0.45 + 0.55 * smoke) + uGlow * (0.18 * comb + 0.45 * rim * rim * rim);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

function bubbleMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uCore: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() },
      uAge: { value: 0 },
      uCells: { value: HEX_CELLS },
    },
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
    transparent: false,
  })
}

export class Shroud3d {
  private readonly parent: THREE.Object3D
  private readonly geometry = new THREE.SphereGeometry(1, 48, 24)
  private readonly meshes: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>[] = []
  private n = 0

  constructor(parent: THREE.Object3D) {
    this.parent = parent
  }

  begin(): void {
    this.n = 0
  }

  end(): void {
    for (let i = this.n; i < this.meshes.length; i++) this.meshes[i].visible = false
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.material.dispose()
      this.parent.remove(m)
    }
    this.meshes.length = 0
    this.geometry.dispose()
  }

  /** count — the bubbles drawn since `begin` (tests). */
  get count(): number {
    return this.n
  }

  /** bubble — one bubble centered on `center` (three axes) at its state, in its two inks. */
  bubble(center: THREE.Vector3, b: ShroudBubble, core: THREE.Color, glow: THREE.Color): void {
    if (this.n >= CAPACITY || !(b.radius > 0)) return
    let m = this.meshes[this.n]
    if (!m) {
      m = new THREE.Mesh(this.geometry, bubbleMaterial())
      this.meshes.push(m)
      this.parent.add(m)
    }
    this.n++
    m.visible = true
    m.position.copy(center)
    m.scale.setScalar(b.radius)
    const u = m.material.uniforms
    ;(u.uCore.value as THREE.Color).copy(core)
    ;(u.uGlow.value as THREE.Color).copy(glow)
    u.uAge.value = b.ageS
  }
}
